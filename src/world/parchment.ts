// The world (R0): the universe sky, the authored environment, the light rig and the parchment —
// carried over from v1's stage (look/stage.ts) without the ink, relief and contact layers,
// which return in R2/R4. The parchment is v1's field-driven sheet: a 192×256 grid whose vertex
// stage fetches positions/normals/tangents from the surface field's render targets, plus the
// cut-edge ribbon. Materials, colours and light ratios are v1's (§7/§8); the shadow filter is
// chosen by the render profile once at boot.

import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  Scene,
  Sphere,
  SpotLight,
  Vector3,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn,
  attribute,
  color,
  dFdx,
  dFdy,
  faceDirection,
  float,
  interleavedGradientNoise,
  ivec2,
  modelWorldMatrix,
  positionWorld,
  screenCoordinate,
  smoothstep,
  texture,
  textureLoad,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  vertexIndex,
  vogelDiskSample,
} from 'three/tsl';
import { Field } from './field/field.ts';
import { Residual } from './field/residual.ts';
import { buildSilhouette, GRID_H, GRID_W, type SilhouetteData } from './field/silhouette.ts';
import { THICKNESS, evalDeform } from './field/deform.ts';
import { buildEnvironment, buildFiberTexture, buildUtilTexture } from './textures.ts';
import { buildSky, type Sky } from './sky.ts';
import type { Profile } from '../core/profile.ts';
import { Dust, DUST_MAX } from './dust.ts';
import { makeInkTargets, type InkTargets } from '../ink/inkPass.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** v1 §16: scene-linear sky floor that the grade chain displays as #01030D exactly. */
export const BG_LINEAR: [number, number, number] = [0.00021515, 0.0023545, 0.0078083];
/** v1 §8: key scaled so an 18% grey card at sheet centre displays 128/255. */
export const KEY_INTENSITY = 9.87;
const KEY_POS: [number, number, number] = [-0.55, 1.3, 0.85];

export interface World {
  scene: Scene;
  sky: Sky;
  sheetRoot: Group;
  key: SpotLight;
  fill: DirectionalLight;
  rim: SpotLight;
  field: Field;
  dust: Dust;
  /** the ink layer's targets (sheet space, R cov · G wet · B bead) — blank until R2's ink loads */
  ink: InkTargets;
  /** the fibre map (the ink pass reads its grain for the bleed) */
  fiber: Texture;
  /** the light rig 0..1 (key, fill, rim, environment) times the candle's breath */
  setLight(light: number, breath: number): void;
  /** pose the parchment: v1 deform p (0 rolled … 0.38 unrolled … 0.6 flat), tilt (rad) */
  pose(renderer: WebGPURenderer, deformP: number, tiltRad: number, dt: number, vLpf: number): void;
}

/** v1 §8 PCSS (blocker search + Vogel PCF), or a fixed-radius PCF when blockerTaps = 0. */
const LIGHT_SIZE_UV = 0.05;
function makeShadowFilter(mapSize: number, blockerTaps: number, filterTaps: number): N {
  return Fn(({ depthTexture, shadowCoord }: { depthTexture: never; shadowCoord: N }) => {
    const texel = 1 / mapSize;
    const zRec: N = shadowCoord.z;
    const phi: N = interleavedGradientNoise(screenCoordinate.xy).mul(Math.PI * 2);
    const tap = (i: number, n: number, r: N): N => (texture as N)(depthTexture, shadowCoord.xy.add((vogelDiskSample as N)(i, n, phi).mul(r)));
    if (blockerTaps === 0) {
      let fixed: N = float(0);
      for (let i = 0; i < filterTaps; i++) fixed = fixed.add(tap(i, filterTaps, float(2.5 * texel)).compare(zRec));
      return fixed.mul(1 / filterTaps);
    }
    let blockerSum: N = float(0);
    let blockerCnt: N = float(0);
    for (let i = 0; i < blockerTaps; i++) {
      const d: N = tap(i, blockerTaps, float(LIGHT_SIZE_UV * 0.5)).r;
      const isB: N = d.lessThan(zRec).select(float(1), float(0));
      blockerSum = blockerSum.add(d.mul(isB));
      blockerCnt = blockerCnt.add(isB);
    }
    const zB: N = blockerSum.div(blockerCnt.max(1));
    const radius: N = zRec.sub(zB).div(zB.max(1e-4)).mul(LIGHT_SIZE_UV * 8).clamp(texel, 28 * texel);
    let lit: N = float(0);
    for (let i = 0; i < filterTaps; i++) lit = lit.add(tap(i, filterTaps, radius).compare(zRec));
    return blockerCnt.lessThan(0.5).select(float(1), lit.mul(1 / filterTaps));
  });
}

/** Builds into `scene` (created at boot so the grade pass can exist before the world does). */
export function buildWorld(renderer: WebGPURenderer, profile: Profile, scene: Scene): World {
  const sky = buildSky(BG_LINEAR);
  scene.add(sky.mesh);
  scene.environment = buildEnvironment(renderer);
  scene.environmentIntensity = 0.32;
  scene.environmentRotation.y = (12 * Math.PI) / 180; // v1 §10 yaw through the unroll

  const sil = buildSilhouette();
  const field = new Field(sil);
  const residual = profile.residual ? new Residual() : null;
  const ink = makeInkTargets(profile.inkHeight, profile.inkDetail);
  const maps = { fiber: buildFiberTexture(renderer), util: buildUtilTexture(renderer), ink };

  const sheetRoot = new Group();
  scene.add(sheetRoot);
  sheetRoot.add(buildSheet(field, maps));
  sheetRoot.add(buildRibbon(field, sil));

  const key = new SpotLight(0xffd2a0, KEY_INTENSITY, 0, (26 * Math.PI) / 180, 0.5, 2);
  key.position.set(...KEY_POS);
  key.target.position.set(0, 0.04, 0.2);
  key.castShadow = true;
  key.shadow.mapSize.set(profile.shadowMap, profile.shadowMap);
  key.shadow.camera.near = 0.6;
  key.shadow.camera.far = 2.6;
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.0005;
  (key.shadow as unknown as { filterNode: unknown }).filterNode = makeShadowFilter(profile.shadowMap, profile.shadowBlockerTaps, profile.shadowFilterTaps);
  scene.add(key, key.target);

  const fill = new DirectionalLight(0xc7d8ee, 0.13 * 2.2);
  fill.position.set(0.85, 0.55, -0.45);
  scene.add(fill);

  const rim = new SpotLight(0xd6e0ff, KEY_INTENSITY * 0.3, 0, (28 * Math.PI) / 180 / 2, 0.6, 2);
  rim.position.set(-0.35, 0.18, -1.05);
  rim.target.position.set(0, 0, 0);
  scene.add(rim, rim.target);

  const KEY_ANGLE = (26 * Math.PI) / 180;
  const dust = new Dust(DUST_MAX * profile.particles, key.position, key.target.position, KEY_ANGLE, 0.5);
  scene.add(dust.sprite);
  const base = { key: key.intensity, fill: fill.intensity, rim: rim.intensity, env: scene.environmentIntensity };

  let lastP = NaN;
  let lastTilt = NaN;
  return {
    scene,
    sky,
    sheetRoot,
    key,
    fill,
    rim,
    field,
    dust,
    ink,
    fiber: maps.fiber,
    setLight(light, breath) {
      key.intensity = base.key * light * breath;
      fill.intensity = base.fill * light;
      rim.intensity = base.rim * light;
      scene.environmentIntensity = base.env * light;
    },
    pose(r, deformP, tiltRad, dt, vLpf) {
      // a still sheet needs no field passes (phones: no inertia layer, so rest frames are free)
      if (!residual && deformP === lastP && tiltRad === lastTilt) return;
      lastP = deformP;
      lastTilt = tiltRad;
      const d = evalDeform(deformP);
      if (residual && dt > 0) {
        residual.setInputs(dt, vLpf, d.wTop, d.wBot);
        residual.step(r);
        field.bindResidual(residual.freshRT().texture);
      }
      field.setDeform(d, residual !== null);
      field.run(r);
      // tilt pivots at the moving top curl line (v1 drivers.poseTransform)
      sheetRoot.rotation.x = tiltRad;
      sheetRoot.position.set(0, d.zTopCurl * Math.sin(tiltRad), d.zTopCurl * (1 - Math.cos(tiltRad)));
      sheetRoot.updateMatrixWorld();
    },
  };
}

interface Maps {
  fiber: Texture;
  util: Texture;
  ink: InkTargets;
}

const INK_DRY = '#2A211B'; // v1 §14 iron-gall ink, dry …
const INK_WET = '#17100B'; // … and wet

/** v1 §7 parchment: recto/verso by face direction, fibre-perturbed normals in the field TBN,
 *  macro wear, edge darkening, sheen, geometric specular AA and thin-surface translucency. */
function parchmentMaterial(maps: Maps, pos: N, normalObj: N, tangentObj: N, suv: N): MeshPhysicalNodeMaterial {
  const m = new MeshPhysicalNodeMaterial();
  m.side = DoubleSide;
  const fib: N = texture(maps.fiber, suv);
  const det: N = texture(maps.fiber, suv.mul(6.0));
  const util: N = texture(maps.util, suv);
  const fn: N = fib.xy.add(det.xy.mul(0.5));
  const height: N = fib.z.mul(0.7).add(det.z.mul(0.3));
  const rmod: N = fib.w.mul(0.65).add(det.w.mul(0.35));
  const fd: N = faceDirection;
  const backAmt: N = fd.mul(-0.5).add(0.5);

  const dEdge: N = suv.x.min(float(1).sub(suv.x)).mul(0.78).min(suv.y.min(float(1).sub(suv.y)));
  const edgeZone: N = float(1).sub(dEdge.div(0.07).clamp(0, 1));
  let col: N = color('#E6D5AF');
  col = col.mix(color('#C9AE7E'), edgeZone.mul(0.55));
  col = col.mul(util.x.sub(0.5).mul(0.12).add(1));
  col = col.mul(float(1).sub(util.y.mul(0.05)));
  col = col.mul(float(1).sub(util.w.mul(0.12)));
  col = col.mix(color('#DCC79A').mul(util.z.sub(0.5).mul(0.1).add(1)), backAmt.mul(0.85));

  // the ink (v1 §14, recto only): wet → dry colour, pooled darker in the fibre valleys; wet ink
  // is glossier, and the bead under the nib glossiest of all. Every lerp is explicit mul/add —
  // TSL mix() with a texture-derived factor breaks this material's lighting (v1, r185).
  // the page-wide layer, and the sharp detail window where it covers this fragment
  const rect: N = maps.ink.rect;
  const dl: N = suv.sub(vec2(rect.x, rect.y)).div(vec2(rect.z, rect.w));
  const edge: N = dl.min(float(1).sub(dl));
  const inWin: N = smoothstep(0.0, 0.04, edge.x.min(edge.y));
  const inkT: N = texture(maps.ink.full.texture, suv).mul(float(1).sub(inWin)).add(texture(maps.ink.detail.texture, dl.clamp(0, 1)).mul(inWin));
  const recto: N = float(1).sub(backAmt);
  const cov: N = inkT.r.mul(recto);
  const wetF: N = inkT.g;
  const inkCol: N = color(INK_DRY).mul(float(1).sub(wetF)).add(color(INK_WET).mul(wetF));
  const cavity: N = float(1).sub(height.sub(0.5).mul(0.24));
  col = col.mul(float(1).sub(cov)).add(inkCol.mul(cavity).mul(cov));
  m.colorNode = col;

  let rBase: N = rmod.sub(0.5).mul(0.28).add(0.62).add(backAmt.mul(0.09));
  const inkRough: N = float(0.5).sub(wetF.mul(0.26)).sub(inkT.b.mul(0.16));
  rBase = rBase.mul(float(1).sub(cov)).add(inkRough.mul(cov));
  const nDx: N = dFdx(transformNormalToView(normalObj));
  const nDy: N = dFdy(transformNormalToView(normalObj));
  const sigma2: N = nDx.dot(nDx).add(nDy.dot(nDy)).mul(0.25);
  m.roughnessNode = rBase.mul(rBase).add(sigma2.mul(2).min(0.18)).sqrt();
  m.sheen = 0.18;
  m.sheenColor.set('#E8DCC0');
  m.sheenRoughness = 0.55;

  const Nv: N = transformNormalToView(normalObj).mul(fd);
  const Tv: N = transformNormalToView(tangentObj);
  const Bv: N = Nv.cross(Tv);
  const k = 0.00055;
  // the bead stands a hair above the page: its height gradient tilts the normal (as v1's emboss)
  // (the bead lives under the nib, always inside the detail window)
  const eps = 1.5 / maps.ink.detail.width;
  const dtex = maps.ink.detail.texture;
  const dlc: N = dl.clamp(0, 1);
  const bR: N = texture(dtex, dlc.add(vec2(eps, 0))).b;
  const bL: N = texture(dtex, dlc.sub(vec2(eps, 0))).b;
  const bU: N = texture(dtex, dlc.add(vec2(0, eps))).b;
  const bD: N = texture(dtex, dlc.sub(vec2(0, eps))).b;
  const hBead = 0.00035;
  // slope per unit suv = per-dl slope ÷ window size; world slope along u ÷ the sheet width
  const gU: N = bR.sub(bL).div(rect.z.mul(2 * eps)).mul(hBead / 0.78).mul(recto).mul(inWin);
  const gV: N = bU.sub(bD).div(rect.w.mul(2 * eps)).mul(hBead).mul(recto).mul(inWin);
  m.normalNode = Nv.add(Tv.mul(fn.x.mul(k))).add(Bv.mul(fn.y.mul(k))).sub(Tv.mul(gU)).add(Bv.mul(gV)).normalize();
  if (new URLSearchParams(location.search).get('dbg') === 'normal') { m.colorNode = Nv.mul(0.5).add(0.5); m.normalNode = Nv; m.sheen = 0; } // QA: ?dbg=normal shows the shading normal

  const keyPos: N = uniform(vec3(...KEY_POS));
  const nW: N = modelWorldMatrix.mul(vec4(normalObj, 0)).xyz.normalize().mul(fd);
  const L: N = keyPos.sub(positionWorld).normalize();
  const backLit: N = nW.mul(-1).dot(L).add(0.4).div(1.4).clamp(0, 1);
  const thick: N = height.mul(0.6).add(util.x.mul(0.4));
  m.emissiveNode = color('#B08D52').mul(backLit.mul(backLit)).mul(float(1).sub(thick).mul(0.18)).mul(2.2);
  m.positionNode = pos;
  return m;
}

function buildSheet(field: Field, maps: Maps): Mesh {
  const count = GRID_W * GRID_H;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
  const idx: number[] = [];
  for (let j = 0; j < GRID_H - 1; j++) {
    for (let i = 0; i < GRID_W - 1; i++) {
      const a = j * GRID_W + i;
      const c = a + GRID_W;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  geo.setIndex(idx);
  geo.boundingSphere = new Sphere(new Vector3(0, 0, 0), 1.2);
  const vi: N = vertexIndex.toInt();
  const tj: N = vi.div(GRID_W);
  const ti: N = vi.sub(tj.mul(GRID_W));
  const texel: N = ivec2(ti, tj);
  const pos: N = textureLoad(field.posRT.texture, texel).xyz;
  // explicit varyings: fetched per vertex, INTERPOLATED across each triangle. Left implicit, the
  // fragment stage received them unblended — flat bands, one per grid row, visible on the roll
  // the moment a camera came close (R1).
  const nrm: N = varying(textureLoad(field.nrmRT.texture, texel).xyz);
  const tan: N = varying(textureLoad(field.tanRT.texture, texel).xyz);
  const suv: N = varying(vec2(ti.toFloat().div(GRID_W - 1), tj.toFloat().div(GRID_H - 1)));
  const mesh = new Mesh(geo, parchmentMaterial(maps, pos, nrm, tan, suv));
  mesh.name = 'parchment';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildRibbon(field: Field, sil: SilhouetteData): Mesh {
  const ring = sil.ring;
  const n = ring.length;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 2 * 3), 3));
  const tx = new Float32Array(n * 2);
  const ty = new Float32Array(n * 2);
  const side = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const r = ring[k]!;
    tx[k * 2] = tx[k * 2 + 1] = r[0];
    ty[k * 2] = ty[k * 2 + 1] = r[1];
    side[k * 2 + 1] = 1;
  }
  geo.setAttribute('texelX', new BufferAttribute(tx, 1));
  geo.setAttribute('texelY', new BufferAttribute(ty, 1));
  geo.setAttribute('side', new BufferAttribute(side, 1));
  const idx: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = k * 2;
    const b = ((k + 1) % n) * 2;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  geo.setIndex(idx);
  geo.boundingSphere = new Sphere(new Vector3(0, 0, 0), 1.2);
  const texel: N = ivec2((attribute('texelX', 'float') as N).toInt(), (attribute('texelY', 'float') as N).toInt());
  const pos: N = textureLoad(field.posRT.texture, texel).xyz;
  const nrmV: N = textureLoad(field.nrmRT.texture, texel).xyz;
  const nrm: N = varying(nrmV);
  const m = new MeshStandardNodeMaterial();
  m.side = DoubleSide;
  m.color.set('#B08F5C');
  m.roughness = 0.8;
  m.positionNode = pos.add(nrmV.mul(-THICKNESS).mul(attribute('side', 'float')));
  m.normalNode = transformNormalToView(nrm).mul(faceDirection);
  const mesh = new Mesh(geo, m);
  mesh.name = 'edge';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
