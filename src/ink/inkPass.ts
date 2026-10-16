// The ink layer (R2) — v1's flat-ink evaluation (§14: grid lookup → up to 8 instances → MTSDF
// coverage with analytic AA, revealed along the stroke-order field), rendered into a sheet-space
// target once per frame while the ink clock moves. The parchment samples that one texture
// (v1 learned that this node graph inside the physical material breaks its lighting).
//
// What R2 adds, all pure functions of the ink clock:
//   · a wet bead (B channel) just behind the reveal front — the glossy drop under the nib
//   · bleed blooms where the pen pauses (each stroke's first and last few percent wick wider)
//   · the āyah rosettes bloom petal by petal from the top, the numeral last
//   · the wet trail dries over WET_S seconds of ink clock (v1: Δp 0.045)
//
// Two targets (R2): the whole page at modest resolution, and a DETAIL WINDOW — a square of the
// page around where the camera looks, at ~6× the texel density, so the close shots that follow
// the pen see crisp letters. The window's origin snaps to its own texel grid (no shimmer as it
// travels); the parchment blends from page to window over the window's edge.
//
// Output: R = coverage, G = wetness, B = bead, A = coverage × āyah / 8 (R3: the light pass's tag;
// stored premultiplied so filtering at stroke edges keeps A / R = the āyah).

import { ClampToEdgeWrapping, LinearFilter, Mesh, NoBlending, Vector4, MeshBasicNodeMaterial, OrthographicCamera, PlaneGeometry, RGBAFormat, RenderTarget, Scene, UnsignedByteType, type Texture, type WebGPURenderer } from 'three/webgpu';
import { atan, clamp, exp, float, floor, fract, fwidth, ivec2, length, max, min, smoothstep, step, texture, textureLoad, uniform, uv, vec2, vec4 } from 'three/tsl';
import type { InkPack } from './atlas.ts';
import { KIND_MARKER } from './atlas.ts';
import { WET_S } from './schedule.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

const E5_FEATHER = 0.006; // §13 E5: the leading edge, smoothstep over Δw 0.012
const BLOOM_FEATHER = 0.02; // the rosette's petals open softly
const PETALS = 8;

/** decode a 16-bit big-endian byte pair (channels already 0..1) back to [0,1] */
const d16 = (hi: N, lo: N): N => hi.mul(65280).add(lo.mul(255)).div(65535);

/** The ink targets. Created with the world (sampled from the first frame; WebGPU zero-fills them,
 *  so the page starts blank) and filled by InkPass once the ink has loaded. `rect` is the detail
 *  window in sheet uv (x0, y0, w, h) — shared by the pass and the parchment that samples it. */
export interface InkTargets {
  full: RenderTarget;
  detail: RenderTarget;
  rect: { value: Vector4 };
  /** the window's side in world units (sheet v; u is divided by the sheet width) */
  window: number;
}

/** detail window: a 0.32-unit square of the page (≈ two lines tall) */
export const DETAIL_WINDOW = 0.32;

export function makeInkTargets(fullHeight: number, detailSize: number): InkTargets {
  const mk = (w: number, h: number): RenderTarget => {
    const rt = new RenderTarget(w, h, { format: RGBAFormat, type: UnsignedByteType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
    rt.texture.wrapS = ClampToEdgeWrapping;
    rt.texture.wrapT = ClampToEdgeWrapping;
    rt.texture.generateMipmaps = false;
    return rt;
  };
  return {
    full: mk(Math.round(fullHeight * 0.78), fullHeight),
    detail: mk(detailSize, detailSize),
    rect: uniform(new Vector4(0.3, 0.3, DETAIL_WINDOW / 0.78, DETAIL_WINDOW)) as unknown as { value: Vector4 },
    window: DETAIL_WINDOW,
  };
}

export class InkPass {
  private readonly uT: N = uniform(0);
  private readonly pack: InkPack;
  private readonly targets: InkTargets;
  private readonly passes: Array<{ scene: Scene; rt: RenderTarget; last: string }> = [];
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(pack: InkPack, targets: InkTargets, fiberTex: Texture) {
    this.pack = pack;
    this.targets = targets;
    const fib = (suv: N): N => texture(fiberTex, suv).z.mul(0.7).add(texture(fiberTex, suv.mul(6.0)).z.mul(0.3));
    // the quad's v flips between RT write and texture read on this backend (v1, probed 2026-08-27)
    const quadUv: N = vec2(uv().x, float(1).sub(uv().y));
    const rect: N = targets.rect;
    for (const [rt, suv] of [
      [targets.full, quadUv],
      [targets.detail, vec2(rect.x, rect.y).add(quadUv.mul(vec2(rect.z, rect.w)))],
    ] as const) {
      const mat = new MeshBasicNodeMaterial();
      mat.toneMapped = false;
      mat.fog = false;
      // write all four channels exactly: three forces alpha to 1 for opaque materials, which
      // erased the āyah tag in A (R3) — 'transparent' with blending off writes it raw
      mat.transparent = true;
      mat.blending = NoBlending;
      const ink = this.inkNode(suv, fib(suv));
      mat.colorNode = vec4(ink.cov, ink.wet, ink.bead, ink.cov.mul(ink.ayah).div(8));
      const scene = new Scene();
      const quad = new Mesh(new PlaneGeometry(2, 2), mat);
      quad.frustumCulled = false;
      scene.add(quad);
      this.passes.push({ scene, rt, last: '' });
    }
  }

  private inkNode(suv: N, fiberH: N): { cov: N; wet: N; bead: N; ayah: N } {
    const pack = this.pack;
    const span = pack.tMax - pack.tMin;
    const wetU = WET_S / span;
    const uT: N = this.uT;
    const gx: N = clamp(floor(suv.x.mul(pack.gridW)), 0, pack.gridW - 1).toInt();
    const gy: N = clamp(floor(suv.y.mul(pack.gridH)), 0, pack.gridH - 1).toInt();
    const suvFw: N = length(vec2(fwidth(suv.x), fwidth(suv.y))).max(1e-6);
    let cov: N = float(0);
    let wet: N = float(0);
    let bead: N = float(0);
    let ayah: N = float(0);
    for (let slot = 0; slot < pack.slots; slot++) {
      const gtx: N = textureLoad(pack.grid, ivec2(gx.mul(4).add(slot >> 1), gy));
      const pair: N = slot % 2 === 0 ? gtx.xy : gtx.zw;
      const idxV: N = pair.x.mul(65280).add(pair.y.mul(255));
      const valid: N = float(1).sub(step(65534.5, idxV));
      const row: N = idxV.min(pack.count - 1).toInt();
      const T = (t: number): N => textureLoad(pack.inst, ivec2(t, row));
      const T0: N = T(0);
      const T1: N = T(1);
      const T2: N = T(2);
      const T3: N = T(3);
      const T4: N = T(4);
      const T5: N = T(5);
      const r0: N = vec4(d16(T0.x, T0.y), d16(T0.z, T0.w), d16(T1.x, T1.y), d16(T1.z, T1.w));
      const start: N = d16(T4.x, T4.y);
      const dur: N = d16(T4.z, T4.w).max(1e-6);
      const isMarker: N = step(0.5, T5.z.mul(255).div(KIND_MARKER));
      const aaSlope: N = d16(T5.x, T5.y).mul(4096);

      const luv: N = suv.sub(r0.xy).div(r0.zw.sub(r0.xy).max(1e-6));
      const inside: N = step(0, luv.x).mul(step(luv.x, 1)).mul(step(0, luv.y)).mul(step(luv.y, 1));
      const feather: N = float(E5_FEATHER).add(isMarker.mul(BLOOM_FEATHER - E5_FEATHER));
      const t01raw: N = clamp(uT.sub(start).div(dur), 0, 1);
      const t01: N = t01raw.mul(feather.mul(4).add(1)).sub(feather.mul(2));

      const auv0: N = vec2(d16(T2.x, T2.y), d16(T2.z, T2.w));
      const auv1: N = vec2(d16(T3.x, T3.y), d16(T3.z, T3.w));
      const auv: N = auv0.add(luv.mul(auv1.sub(auv0)));
      const s: N = texture(pack.mtsdf, auv);
      const med: N = max(min(s.r, s.g), min(max(s.r, s.g), s.b));
      const wStroke: N = texture(pack.prog, auv).r;

      // the rosette: petals open one after another from the top, each growing outward; the
      // numeral at its heart arrives last
      const d: N = luv.sub(0.5);
      const r: N = length(d).mul(2);
      const ang: N = fract(atan(d.x.negate(), d.y.negate()).div(2 * Math.PI));
      const petal: N = floor(ang.mul(PETALS)).add(smoothstep(0.3, 1.0, r).mul(0.9)).div(PETALS).mul(0.86);
      const heart: N = float(0.88).add(r.div(0.32).clamp(0, 1).mul(0.1));
      const wBloom: N = r.lessThan(0.32).select(heart, petal);
      const w: N = wStroke.mul(float(1).sub(isMarker)).add(wBloom.mul(isMarker));

      const tReveal: N = start.add(w.mul(dur));
      const dry: N = clamp(uT.sub(tReveal).div(wetU), 0, 1);
      // ink wicks into the grain as it sets, and blooms a little where the pen paused
      const pause: N = max(float(1).sub(smoothstep(0, 0.06, wStroke)), smoothstep(0.94, 1, wStroke)).mul(float(1).sub(isMarker));
      const bleed: N = fiberH.sub(0.5).mul(0.055).add(pause.mul(0.06)).mul(dry.mul(0.5).add(0.5));
      const aa: N = suvFw.mul(aaSlope).max(1e-5);
      const covShape: N = clamp(med.sub(0.5).add(bleed).div(aa).add(0.5), 0, 1);
      const reveal: N = smoothstep(w.sub(feather), w.add(feather), t01);
      const c: N = covShape.mul(reveal).mul(inside).mul(valid);

      // the bead rides just behind the front while the stroke is being drawn
      const drawing: N = step(0.0001, t01raw).mul(step(t01raw, 0.9999)).mul(float(1).sub(isMarker));
      const b: N = exp(w.sub(t01).div(0.035).pow(2).negate()).mul(c).mul(drawing);

      ayah = c.greaterThan(cov).select(T5.w.mul(255), ayah);
      cov = max(cov, c);
      wet = max(wet, float(1).sub(dry).mul(c));
      bead = max(bead, b);
    }
    return { cov, wet, bead, ayah };
  }

  /** Compile both pipelines against their own targets, then draw them once at ink-clock t. */
  async prepare(renderer: WebGPURenderer, t: number): Promise<void> {
    const prev = renderer.getRenderTarget();
    const jobs: Promise<void>[] = [];
    // compileAsync stamps renderer.depth onto the render context; these targets have no depth
    // buffer, so without matching it the real render needs a different pipeline and builds it
    // synchronously (seen in the trace: 'async' then 'SYNC' for the same material)
    const depth = renderer.depth;
    renderer.depth = false;
    for (const p of this.passes) {
      renderer.setRenderTarget(p.rt);
      try { jobs.push(renderer.compileAsync(p.scene, this.cam)); } finally { renderer.setRenderTarget(prev); }
    }
    renderer.depth = depth;
    try { await Promise.all(jobs); } catch { /* compiles on first run instead */ }
    this.run(renderer, t, 0.5, 0.45);
  }

  /** Draw the ink as it is at ink-clock t (seconds), with the detail window centred on sheet uv
   *  (cu, cv) and snapped to its texel grid. Each pass skips when nothing it shows has changed. */
  run(renderer: WebGPURenderer, t: number, cu: number, cv: number): void {
    const tc = Math.min(this.pack.tMax, Math.max(this.pack.tMin, t));
    this.uT.value = (tc - this.pack.tMin) / (this.pack.tMax - this.pack.tMin);
    const r = this.targets.rect.value;
    const size = this.targets.detail.width;
    const snapU = r.z / size;
    const snapV = r.w / size;
    r.x = Math.round(Math.min(1 - r.z, Math.max(0, cu - r.z / 2)) / snapU) * snapU;
    r.y = Math.round(Math.min(1 - r.w, Math.max(0, cv - r.w / 2)) / snapV) * snapV;
    const prev = renderer.getRenderTarget();
    this.passes.forEach((p, i) => {
      const key = i === 0 ? `${tc}` : `${tc}|${r.x}|${r.y}`;
      if (key === p.last) return;
      p.last = key;
      renderer.setRenderTarget(p.rt);
      renderer.render(p.scene, this.cam);
    });
    renderer.setRenderTarget(prev);
  }
}
