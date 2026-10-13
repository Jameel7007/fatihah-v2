// Gold dust in the key light (R1). A cloud of motes drifts slowly through the space above the
// page; each one is lit only while it is inside the key light's cone, so the beam shows itself
// through the dust. Looking toward the light makes the motes brighter (forward scattering, the
// way dust glows against a window), a few catch the light like turning flakes, and motes away
// from the focus plane grow into large faint discs (a cheap depth of field).
//
// Motion is a pure function of the dust clock (deterministic, no simulation state), drawn as one
// instanced sprite batch — identical on WebGPU and the WebGL2 fallback. The plan suggested a
// compute pass; an analytic drift needs no state at all, so there is nothing to compute.

import { AdditiveBlending, InstancedBufferAttribute, PointsNodeMaterial, Sprite, Vector3 } from 'three/webgpu';
import { cameraPosition, float, instancedBufferAttribute, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export const DUST_MAX = 2400;
// The motes live in the beam's own frame: a = distance along the key's axis, (u, v) = position
// across the cone in units of its radius at that distance. Drift and wrap happen in that frame,
// so the cloud stays in the light however long the page is open.
const A0 = 0.7; // from just above the page's highest pose …
const A1 = 1.62; // … to just past the page (the key reaches the sheet at ≈ 1.52)
const SPREAD = 1.15; // a little beyond the cone, so its soft edge has motes to fade

export class Dust {
  readonly sprite: Sprite;
  private readonly uT: N = uniform(0);
  private readonly uAmount: N = uniform(0);
  private readonly uFocus: N = uniform(1);
  private readonly uKeyPos: N;
  private readonly uKeyDir: N;
  private readonly uCos: N;

  constructor(count: number, keyPos: Vector3, keyTarget: Vector3, coneRad: number, penumbra: number) {
    const n = Math.max(0, Math.min(DUST_MAX, Math.round(count)));
    const pos = new Float32Array(DUST_MAX * 3);
    const seed = new Float32Array(DUST_MAX * 4); // phase, speed, size, glint
    let s = 20261013;
    const rnd = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < DUST_MAX; i++) {
      pos[i * 3] = A0 + rnd() * (A1 - A0);
      pos[i * 3 + 1] = rnd() * 2 - 1;
      pos[i * 3 + 2] = rnd() * 2 - 1;
      seed[i * 4] = rnd() * Math.PI * 2;
      seed[i * 4 + 1] = 0.55 + rnd() * 0.9;
      seed[i * 4 + 2] = 0.5 + rnd() * rnd() * 1.6; // most motes fine, a few larger
      seed[i * 4 + 3] = rnd() < 0.18 ? 1 : 0; // flakes that catch the light
    }
    this.uKeyPos = uniform(keyPos.clone());
    this.uKeyDir = uniform(keyTarget.clone().sub(keyPos).normalize());
    this.uCos = uniform(new Vector3(Math.cos(coneRad), Math.cos(coneRad * (1 - penumbra)), 0));

    const mat = new PointsNodeMaterial();
    const base: N = instancedBufferAttribute(new InstancedBufferAttribute(pos, 3));
    const sd: N = instancedBufferAttribute(new InstancedBufferAttribute(seed, 4));
    const t: N = this.uT.mul(sd.y).add(sd.x);
    // slow drift in the beam frame: a lazy slide down the light, a sway across it
    const drift: N = vec3(
      t.mul(0.006).add(t.mul(0.21).sin().mul(0.012)),
      t.mul(0.37).sin().mul(0.03).add(t.mul(0.004)),
      t.mul(0.29).cos().mul(0.03).sub(t.mul(0.003)),
    );
    const q: N = base.add(drift);
    const a: N = q.x.sub(A0).mod(A1 - A0).add(A0);
    const uv2: N = vec3(0, q.y, q.z).add(1).mod(2).sub(1);
    const axis = keyTarget.clone().sub(keyPos).normalize();
    const e1 = new Vector3(0, 1, 0).cross(axis).normalize();
    const e2 = axis.clone().cross(e1).normalize();
    const radius: N = a.mul(Math.tan(coneRad) * SPREAD);
    const p: N = vec3(keyPos.x, keyPos.y, keyPos.z)
      .add(vec3(axis.x, axis.y, axis.z).mul(a))
      .add(vec3(e1.x, e1.y, e1.z).mul(uv2.y.mul(radius)))
      .add(vec3(e2.x, e2.y, e2.z).mul(uv2.z.mul(radius)));
    mat.positionNode = p;

    // lit by the key cone only (spot falloff with the light's own penumbra)
    const toP: N = p.sub(this.uKeyPos);
    const dKey: N = toP.length();
    const L: N = toP.div(dKey);
    const inCone: N = smoothstep(this.uCos.x, this.uCos.y, L.dot(this.uKeyDir));
    // forward scattering (Henyey–Greenstein, g = 0.55): brighter looking toward the light
    const V: N = cameraPosition.sub(p).normalize();
    const cosT: N = L.dot(V);
    const g = 0.55;
    const hg: N = float(1 - g * g).div(float(1 + g * g).sub(cosT.mul(2 * g)).pow(1.5)).mul(0.25);
    // flakes: a brief bright glint now and then as they turn
    const glint: N = t.mul(2.3).sin().max(0).pow(24).mul(sd.w).mul(5);
    const lit: N = inCone.mul(hg.add(0.3)).mul(glint.add(1));

    // depth of field: motes off the focus plane grow and dim (energy roughly conserved)
    const dCam: N = cameraPosition.sub(p).length();
    const blur: N = dCam.sub(this.uFocus).abs().div(this.uFocus).mul(2.2).clamp(0, 2.5);
    const grow: N = blur.add(1);
    mat.sizeNode = sd.z.mul(0.0085).mul(grow); // sprite size reads ≈ ⅓ of a world diameter: this is a 2–4 px mote on a phone
    mat.sizeAttenuation = true;
    // never a smear across the lens: fade motes right in front of the camera
    const near: N = smoothstep(0.06, 0.16, dCam);

    const d: N = uv().sub(0.5).length().mul(2);
    const disc: N = float(1).sub(d).clamp(0, 1).pow(blur.mul(-0.5).add(2).max(0.9));
    let strength: N = lit.mul(this.uAmount).mul(near).div(grow.mul(grow)).mul(3.2);
    const dbg = new URLSearchParams(location.search).get('dbg');
    if (dbg === 'dust') { strength = float(3); mat.sizeNode = float(0.02); } // QA: every mote, big and unlit
    // additive: the colour IS the light added (alpha 1); kept below the AgX shoulder so the motes stay
    // gold rather than burning white like the stars
    mat.colorNode = vec4(vec3(1.0, 0.66, 0.3).mul(disc).mul(strength), 1);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    mat.fog = false;

    this.sprite = new Sprite(mat);
    this.sprite.name = 'dust';
    this.sprite.count = n;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 5;
    this.sprite.visible = n > 0;
  }

  /** time (seconds, the dust clock), amount 0..1, the camera's focus distance (world) */
  update(time: number, amount: number, focus: number): void {
    this.uT.value = time;
    this.uAmount.value = amount;
    this.uFocus.value = Math.max(0.1, focus);
    this.sprite.visible = this.sprite.count > 0 && amount > 0.001;
  }
}
