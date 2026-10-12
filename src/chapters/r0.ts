// R0 chapters — the skeleton the later milestones replace shot by shot. Three chapters prove
// the rules on a phone: a timed opening out of the dark, a scrubbed unroll, and a timed settle
// onto the reading page that may only begin once its assets (the ink pack R2 writes with) have
// passed the gate. Everything here is a pure function of (chapter, t).
//
// Contract between neighbours: the end state of chapter k equals the start state of chapter k+1.

import { Vector3 } from 'three/webgpu';
import type { ChapterSpec } from '../core/timeline';
import { E1, E2, EUnroll } from '../core/easing';

export const CHAPTERS: ChapterSpec[] = [
  { id: 'opening', duration: 3.6, scroll: 0.7, scrub: false },
  { id: 'unroll', duration: 6.0, scroll: 2.6, scrub: true },
  { id: 'page', duration: 4.2, scroll: 1.4, scrub: false },
];

/** asset ids each chapter needs before it may begin (see main.ts for the definitions) */
export const CHAPTER_ASSETS: string[][] = [['world'], ['world'], ['world', 'ink']];

/** What the camera frames: the whole sheet, or the text block on it. */
export type FitTarget = 'sheet' | 'text';

export interface Shot {
  /** unit vector from the look point toward the camera */
  dir: Vector3;
  look: Vector3;
  /** 35 mm-equivalent focal length; vertical fov = 2·atan(12 / focal) */
  focal: number;
  /** blend 0 = fit the sheet, 1 = fit the text block */
  fitText: number;
  /** distance multiplier on top of the fit (a push-in starts above 1) */
  distMul: number;
}

export interface FrameState {
  chapter: number;
  t: number;
  /** v1 deform parameter: 0 rolled → 0.38 unrolled */
  deformP: number;
  /** sheet tilt (radians), pivoted at the top curl line */
  tilt: number;
  /** scene exposure 0..1 */
  exposure: number;
  shot: Shot;
}

// Shot anchors carried over from v1's camera table (§9): the rolled ¾ view, the high view at the
// end of the unroll, the reading view above the flat page.
const ROLLED = { pos: new Vector3(0.42, 0.27, 1.13), look: new Vector3(0.0, 0.04, 0.34), focal: 40 };
const OPEN = { pos: new Vector3(0.33, 1.952, 1.317), look: new Vector3(0.0, 0.012, 0.03), focal: 46 };
const READ = { pos: new Vector3(0.0, 2.64, 0.234), look: new Vector3(0.0, 0.0, 0.018), focal: 55 };
const dirOf = (a: { pos: Vector3; look: Vector3 }): Vector3 => a.pos.clone().sub(a.look).normalize();
const D_ROLLED = dirOf(ROLLED);
const D_OPEN = dirOf(OPEN);
const D_READ = dirOf(READ);
const deg = (d: number): number => (d * Math.PI) / 180;

function lerpShot(a: typeof ROLLED, da: Vector3, b: typeof ROLLED, db: Vector3, k: number, fitText: number, distMul: number): Shot {
  return {
    dir: da.clone().lerp(db, k).normalize(),
    look: a.look.clone().lerp(b.look, k),
    focal: a.focal + (b.focal - a.focal) * k,
    fitText,
    distMul,
  };
}

/** The state of the piece at playhead s (chapter = ⌊s⌋, t = s − chapter). */
export function sample(s: number): FrameState {
  const chapter = Math.min(CHAPTERS.length - 1, Math.max(0, Math.floor(s)));
  const t = Math.min(1, Math.max(0, s - chapter));
  switch (CHAPTERS[chapter]!.id) {
    case 'opening': {
      // out of the dark, a slow push in on the roll (R1 replaces this with the designed opening)
      return {
        chapter, t,
        deformP: 0,
        tilt: deg(14),
        exposure: E2(Math.min(1, t / 0.75)),
        shot: lerpShot(ROLLED, D_ROLLED, ROLLED, D_ROLLED, 0, 0, 1.22 - 0.22 * E1(t)),
      };
    }
    case 'unroll': {
      const k = E1(t);
      return {
        chapter, t,
        deformP: 0.06 + 0.32 * EUnroll(t),
        tilt: deg(14 + (6 - 14) * E2(t)),
        exposure: 1,
        shot: lerpShot(ROLLED, D_ROLLED, OPEN, D_OPEN, k, 0, 1),
      };
    }
    default: {
      // 'page': the sheet settles flat and the camera rises over the reading page
      const k = E1(t);
      return {
        chapter, t,
        deformP: 0.38,
        tilt: deg(6 * (1 - E2(t))),
        exposure: 1,
        shot: lerpShot(OPEN, D_OPEN, READ, D_READ, k, k, 1),
      };
    }
  }
}
