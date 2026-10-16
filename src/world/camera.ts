// Camera — frames each shot for the screen it is on. A shot (chapters/*) gives a direction, a
// look point and a focal length; the DISTANCE is solved here so the subject fits the viewport:
// the sheet (sampled on its posed surface) or the text block, with a margin. Portrait is the
// design case: the sheet may overflow a phone's sides a little once it opens, the text never.
//
// Close shots carry an authored distance instead (Shot.absDist, blended in by absW), so a
// low pass along the roll is the same move on every screen and a wide screen simply sees more.
//
// The distance is precomputed along the whole playhead per aspect (a table at 1/120 chapter
// steps, lightly smoothed), so the camera is a pure function of (s, aspect) and never wobbles
// with per-frame sampling.

import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { evalDeform } from './field/deform.ts';
import { cpuPose } from './field/cpuPose.ts';
import type { FrameState } from '../chapters/story.ts';

const STEPS = 120; // samples per chapter
const MARGIN = 0.08; // per side, landscape
const MARGIN_PORTRAIT = 0.05;
const SIDE_ALLOW_PORTRAIT = 0.12; // the open sheet may pass a phone's sides by this much
// the text block on the sheet (v1 §3 composition band)
const TEXT_X = [-0.285, 0, 0.285];
const TEXT_V = [0.145, 0.32, 0.5, 0.68, 0.87];

export class Camera {
  readonly camera = new PerspectiveCamera(30, 9 / 16, 0.05, 8);
  private table: Float32Array | null = null;
  /** distance from the camera to the look point this frame — the dust's focus plane */
  focus = 1;
  private tableAspect = 0;

  private readonly chapters: number;
  private readonly sample: (s: number) => FrameState;

  constructor(chapters: number, sample: (s: number) => FrameState) {
    this.chapters = chapters;
    this.sample = sample;
  }

  /** Forget the planned distances (a shot's subject changed — the pen track arrived). */
  invalidate(): void {
    this.tableAspect = 0;
  }

  /** Place the camera for playhead s at the current aspect. */
  apply(s: number): FrameState {
    const st = this.sample(s);
    if (this.tableAspect !== this.camera.aspect) this.build();
    const d = this.distanceAt(s);
    this.focus = d;
    this.camera.position.copy(st.shot.look).addScaledVector(st.shot.dir, d);
    this.camera.lookAt(st.shot.look);
    this.camera.fov = (2 * Math.atan(12 / st.shot.focal) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
    return st;
  }

  private distanceAt(s: number): number {
    const tab = this.table!;
    const x = Math.max(0, Math.min(tab.length - 1, s * STEPS));
    const i = Math.min(tab.length - 2, Math.floor(x));
    const f = x - i;
    return tab[i]! + (tab[i + 1]! - tab[i]!) * f;
  }

  private build(): void {
    const aspect = this.camera.aspect;
    const n = this.chapters * STEPS + 1;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = shotDistance(this.sample(i / STEPS), aspect);
    // light smoothing (5-tap binomial, twice) floored at the raw fit so the margin is never eaten
    let cur = Float32Array.from(raw);
    for (let pass = 0; pass < 2; pass++) {
      const src = cur;
      cur = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let acc = 0;
        const K = [0.0625, 0.25, 0.375, 0.25, 0.0625];
        for (let k = -2; k <= 2; k++) acc += src[Math.min(n - 1, Math.max(0, i + k))]! * K[k + 2]!;
        cur[i] = acc;
      }
    }
    for (let i = 0; i < n; i++) cur[i] = Math.max(cur[i]!, raw[i]!);
    this.table = cur;
    this.tableAspect = aspect;
  }
}

/** Portrait is the design case: a phone reads the text block filling the screen. A landscape (except
 *  for shots that fit a band of the text — the breath — which fit it on every screen)
 *  screen has room for the page around it, so it only leans a third of the way toward the text. */
const fitTextK = (k: number, portrait: boolean): number => (portrait ? k : k * 0.35);

const up = new Vector3(0, 1, 0);
const xAxis = new Vector3();
const yAxis = new Vector3();
const rel = new Vector3();

/** Smallest distance along the shot direction such that the subject's sampled points project
 *  inside the viewport with the margin: d ≥ r_z + |r_xy| / (tan(half fov)·(1 − margin)). */
export function fitDistance(st: FrameState, aspect: number): number {
  const { shot } = st;
  const d0 = evalDeform(st.deformP);
  const cosT = Math.cos(st.tilt);
  const sinT = Math.sin(st.tilt);
  const offY = d0.zTopCurl * sinT;
  const offZ = d0.zTopCurl * (1 - cosT);
  xAxis.crossVectors(up, shot.dir).normalize();
  yAxis.crossVectors(shot.dir, xAxis);
  const Ty = 12 / shot.focal;
  const Tx = Ty * aspect;
  const portrait = aspect < 1;
  const m = portrait ? MARGIN_PORTRAIT : MARGIN;
  // the open sheet may pass a phone's sides (never the text); the roll always fits
  const allow = portrait ? SIDE_ALLOW_PORTRAIT * Math.min(1, Math.max(0, (st.deformP - 0.1) / 0.15)) : 0;
  const fitPoints = (pts: Array<[number, number]>, kx: number, ky: number): number => {
    let dFit = 0.2;
    for (const [u, v] of pts) {
      const q = cpuPose(u, v, d0);
      const wy = q.y * cosT - q.z * sinT + offY;
      const wz = q.y * sinT + q.z * cosT + offZ;
      rel.set(q.x - shot.look.x, wy - shot.look.y, wz - shot.look.z);
      const rx = rel.dot(xAxis);
      const ry = rel.dot(yAxis);
      const rz = rel.dot(shot.dir);
      dFit = Math.max(dFit, rz + Math.abs(rx) / kx, rz + Math.abs(ry) / ky);
    }
    return dFit;
  };
  let dSheet = 0;
  if (fitTextK(shot.fitText, portrait || !!shot.fitRange) < 1) {
    const pts: Array<[number, number]> = [];
    for (const u of [-0.5, -0.25, 0, 0.25, 0.5]) for (let j = 0; j <= 32; j++) pts.push([u, j / 32]);
    dSheet = fitPoints(pts, Tx * (1 - m + allow), Ty * (1 - m));
  }
  let dText = 0;
  if (fitTextK(shot.fitText, portrait || !!shot.fitRange) > 0) {
    const pts: Array<[number, number]> = [];
    const vs = shot.fitRange ? [shot.fitRange[0], (shot.fitRange[0] + shot.fitRange[1]) / 2, shot.fitRange[1]] : TEXT_V;
    for (const x of TEXT_X) for (const v of vs) pts.push([x / 0.78, v]);
    dText = fitPoints(pts, Tx * (1 - m), Ty * (1 - m));
  }
  const k = fitTextK(shot.fitText, portrait || !!shot.fitRange);
  const d = k <= 0 ? dSheet : k >= 1 ? dText : dSheet + (dText - dSheet) * k;
  return d * shot.distMul;
}

/** The shot's distance: the fitted one, or an authored one for close shots (blended by absW). */
export function shotDistance(st: FrameState, aspect: number): number {
  const { absW } = st.shot;
  // authored distances are set on a 16:10 screen; a narrower screen sees less width at the same
  // distance, so it stands back by √(1.6 / aspect) (a phone ≈ 1.65×) — the same move, framed to fit
  const absDist = st.shot.absDist * Math.min(1.8, Math.max(1, Math.sqrt(1.6 / aspect)));
  if (absW >= 1) return absDist;
  const fitted = fitDistance(st, aspect);
  // blend in log space: a pull-back reads as a steady change of scale, not a rush at its middle
  return absW <= 0 ? fitted : Math.exp(Math.log(fitted) + (Math.log(absDist) - Math.log(fitted)) * absW);
}
