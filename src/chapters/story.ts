// The chapters of the piece, as pure functions of the playhead (chapter, t).
//
// Contract between neighbours: the end state of chapter k equals the start state of chapter
// k + 1 (qa/chapters.test.ts checks every field). Shots are authored for a portrait phone
// first; the camera module fits them to whatever screen they are on.
//
//   R1 · opening — timed. The stars come up, then a warm key light on the roll, gold dust in its
//        beam, while the camera pushes in from far to a close low view of the roll's right end.
//   R1 · unroll  — follows the scroll. A low camera travels with the roll as it pays out across
//        the page, then rises to look down on the opened sheet.
//   R0 · page    — timed placeholder until R2: the sheet settles flat, the camera rises over it.

import { Vector3 } from 'three';
import type { ChapterSpec } from '../core/timeline.ts';
import { E1, E2, EUnroll, span } from '../core/easing.ts';
import { evalDeform } from '../world/field/deform.ts';

export const CHAPTERS: ChapterSpec[] = [
  { id: 'opening', duration: 7.0, scroll: 0.8, scrub: false },
  { id: 'unroll', duration: 8.0, scroll: 3.0, scrub: true },
  { id: 'page', duration: 4.2, scroll: 1.4, scrub: false },
];

/** asset ids each chapter needs before it may begin (see main.ts for the definitions) */
export const CHAPTER_ASSETS: string[][] = [['world'], ['world'], ['world', 'ink']];

export interface Shot {
  /** unit vector from the look point toward the camera */
  dir: Vector3;
  look: Vector3;
  /** 35 mm-equivalent focal length; vertical fov = 2·atan(12 / focal) */
  focal: number;
  /** fitted framing: 0 = fit the sheet, 1 = fit the text block */
  fitText: number;
  /** multiplier on the fitted distance (a push-in starts above 1) */
  distMul: number;
  /** an authored distance (world units) for close shots, blended in by absW */
  absDist: number;
  absW: number;
}

export interface FrameState {
  chapter: number;
  t: number;
  /** v1 deform parameter: 0 rolled → 0.38 unrolled */
  deformP: number;
  /** sheet tilt (radians), pivoted at the top curl line */
  tilt: number;
  /** scene exposure 0..1 (the whole world, sky included) */
  exposure: number;
  /** the light rig (key, fill, rim, environment) 0..1 — the candle coming up */
  light: number;
  /** gold dust in the key light 0..1 (scaled by the profile's particle budget) */
  dust: number;
  shot: Shot;
}

const deg = (d: number): number => (d * Math.PI) / 180;
const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
const unit = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z).normalize();
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const smooth = (k: number): number => k * k * (3 - 2 * k);

// v1 §9 anchors (rolled ¾ view, the high view over the opened sheet, the reading view)
const ROLLED_LOOK = v3(0.0, 0.04, 0.34);
const D_ROLLED = unit(0.42, 0.23, 0.79);
const OPEN_LOOK = v3(0.0, 0.012, 0.03);
const D_OPEN = unit(0.33, 1.94, 1.287);
const READ_LOOK = v3(0.0, 0.0, 0.018);
const D_READ = unit(0.0, 2.64, 0.216);

// R1 close shots: low on the roll's right end, and in front of the roll as it travels away
const D_END = unit(0.78, 0.3, 0.55);
const D_TRACK = unit(0.5, 0.4, 0.77);
const END_DIST = 0.62;
const END_X = 0.22; // the look point sits toward the roll's right end (x = +0.39)
const TRACK_DIST = 0.78;

/** World centre of the top roll (u = 0), after the tilt about the top curl line. */
export function rollCentre(deformP: number, tilt: number, x = 0): Vector3 {
  const d = evalDeform(deformP);
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const y0 = d.rOuter;
  const z0 = d.zTopCurl;
  return v3(x, y0 * c - z0 * s + z0 * s, y0 * s + z0 * c + z0 * (1 - c));
}

/** The candle: a quick warm rise with two small dips that settle (deterministic in t). */
function ignite(t: number): number {
  const k = span(t, 0.12, 0.55);
  if (k <= 0) return 0;
  const rise = E2(k);
  const flicker = 0.07 * Math.sin(k * 23) * Math.exp(-4.5 * k) * (1 - k);
  return Math.min(1, Math.max(0, rise + flicker));
}

function shot(dir: Vector3, look: Vector3, focal: number, o: Partial<Shot> = {}): Shot {
  return { dir, look, focal, fitText: 0, distMul: 1, absDist: 0, absW: 0, ...o };
}

function blendShot(a: Shot, b: Shot, k: number): Shot {
  return {
    dir: a.dir.clone().lerp(b.dir, k).normalize(),
    look: a.look.clone().lerp(b.look, k),
    focal: lerp(a.focal, b.focal, k),
    fitText: lerp(a.fitText, b.fitText, k),
    distMul: lerp(a.distMul, b.distMul, k),
    // an authored distance only exists where a shot has one: blend the weight, keep the value
    absDist: a.absW > 0 && b.absW > 0 ? lerp(a.absDist, b.absDist, k) : a.absW > 0 ? a.absDist : b.absDist,
    absW: lerp(a.absW, b.absW, k),
  };
}

const TILT0 = deg(14);
const TILT_OPEN = deg(6);

/** the opening's last frame = the unroll's first */
function openingEnd(): Shot {
  return shot(D_END, rollCentre(0, TILT0, END_X), 42, { absDist: END_DIST, absW: 1 });
}

function unrollShot(t: number, deformP: number, tilt: number): Shot {
  // A · travel with the roll: the look point rides the roll centre as it pays out, sliding from the
  //     right end toward the middle; the camera swings round in front of it, low
  // the camera keeps pace with the paper itself (the unroll is front-loaded), not with t
  const a = E1(span(EUnroll(t), 0, 0.9));
  const track = shot(
    D_END.clone().lerp(D_TRACK, a).normalize(),
    rollCentre(deformP, tilt, lerp(END_X, -0.02, a)),
    42,
    { absDist: lerp(END_DIST, TRACK_DIST, a), absW: 1 },
  );
  // B · rise over the opened sheet (fitted, so every screen sees the whole page)
  const b = smooth(span(t, 0.42, 1)); // gentler middle than E1: this is the biggest move in the piece
  return blendShot(track, shot(D_OPEN, OPEN_LOOK, 46), b);
}

/** The state of the piece at playhead s (chapter = ⌊s⌋, t = s − chapter). */
export function sample(s: number): FrameState {
  const chapter = Math.min(CHAPTERS.length - 1, Math.max(0, Math.floor(s)));
  const t = Math.min(1, Math.max(0, s - chapter));
  switch (CHAPTERS[chapter]!.id) {
    case 'opening': {
      const k = E1(t);
      const far = shot(D_ROLLED, ROLLED_LOOK, 40, { distMul: 1.6 });
      const light = ignite(t);
      return {
        chapter, t,
        deformP: 0,
        tilt: TILT0,
        exposure: E2(span(t, 0, 0.18)),
        light,
        dust: light,
        shot: blendShot(far, openingEnd(), k),
      };
    }
    case 'unroll': {
      const deformP = 0.06 + 0.32 * EUnroll(t);
      const tilt = lerp(TILT0, TILT_OPEN, E2(t));
      return { chapter, t, deformP, tilt, exposure: 1, light: 1, dust: 1, shot: unrollShot(t, deformP, tilt) };
    }
    default: {
      // 'page' (R0 placeholder until R2): the sheet settles flat and the camera rises over it
      const k = E1(t);
      return {
        chapter, t,
        deformP: 0.38,
        tilt: TILT_OPEN * (1 - E2(t)),
        exposure: 1,
        light: 1,
        dust: 1,
        shot: blendShot(shot(D_OPEN, OPEN_LOOK, 46), shot(D_READ, READ_LOOK, 55, { fitText: 1 }), k),
      };
    }
  }
}
