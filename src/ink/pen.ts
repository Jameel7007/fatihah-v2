// The qalam's track (R2): where the nib is at every moment of the ink clock, and how high it is
// lifted. Pure function of the clock, built from the timed instances (schedule.ts) and the pen
// paths (build/build-pen-paths.mjs), in composition coordinates (x across, y down the page).
//
//   writing — the nib follows the glyph's pen path at τ = (T − start) / dur, touching the page
//   between strokes — it glides to the next stroke's start in a low arc: a little lift inside a
//              word, more between words, most across a line break
//   long pauses (an āyah's tail) — it lifts to rest above the last letter, and only travels to
//              the next āyah's first letter in the last moments
// A short time-average (±40 ms) turns the joins between strokes into glides instead of steps.
//
// No three.js imports: unit-tested directly by node.

import { LEAD, TAIL, type TimedInstance } from './schedule.ts';

export interface PenSample {
  x: number;
  y: number;
  /** height of the nib above the page (world units) */
  lift: number;
  /** 1 while the nib is drawing */
  writing: number;
}

interface Stroke {
  start: number;
  end: number;
  path: Array<[number, number]>;
  line: number;
  word: number;
  ayah: number;
}

const LIFT_STROKE = 0.0025;
const LIFT_WORD = 0.007;
const LIFT_LINE = 0.016;
const LIFT_REST = 0.06; // R3: at rest the pen stands clear of the words (and steps aside, below)
const REST_GAP = 1.0; // gaps longer than this are rests: hover, then travel at the end
const TRAVEL = 0.8;
const ENTRY_LIFT = 0.09; // the pen comes down from here at the start of āyah 1

const smooth = (k: number): number => k * k * (3 - 2 * k);
const clamp01 = (k: number): number => Math.min(1, Math.max(0, k));

export class PenTrack {
  private readonly strokes: Stroke[];
  /** ink-clock times at the middle of every line break (the camera breathes out there) */
  readonly lineBreaks: number[] = [];

  constructor(instances: TimedInstance[], paths: Map<number, Array<[number, number]>>) {
    this.strokes = instances
      .filter((g) => g.kind !== 'marker')
      .map((g) => ({ start: g.start, end: g.start + g.dur, path: paths.get(g.order) ?? [[0, 0]], line: g.line, word: g.word, ayah: g.ayah }))
      .sort((a, b) => a.start - b.start);
    for (let i = 1; i < this.strokes.length; i++) {
      const a = this.strokes[i - 1]!;
      const b = this.strokes[i]!;
      if (b.line !== a.line && b.ayah === a.ayah) this.lineBreaks.push((a.end + b.start) / 2);
    }
  }

  get first(): Stroke {
    return this.strokes[0]!;
  }

  /** the raw track (no time-average) */
  private raw(t: number): PenSample {
    const S = this.strokes;
    // last stroke that has started by t
    let lo = -1;
    let hi = S.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (S[mid]!.start <= t) lo = mid;
      else hi = mid - 1;
    }
    if (lo < 0) {
      // before the first letter: the pen comes down from above it
      const p0 = S[0]!.path[0]!;
      const k = smooth(clamp01((t - (S[0]!.start - LEAD)) / (LEAD * 0.85)));
      return { x: p0[0] + 0.05 * (1 - k), y: p0[1] - 0.02 * (1 - k), lift: LIFT_STROKE + (ENTRY_LIFT - LIFT_STROKE) * (1 - k), writing: 0 };
    }
    const s = S[lo]!;
    if (t < s.end) {
      const tau = (t - s.start) / Math.max(1e-6, s.end - s.start);
      const f = tau * (s.path.length - 1);
      const i = Math.min(s.path.length - 2, Math.floor(f));
      const a = s.path[i]!;
      const b = s.path[i + 1] ?? a;
      const k = f - i;
      return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, lift: 0, writing: 1 };
    }
    const end = s.path[s.path.length - 1]!;
    const n = S[lo + 1];
    if (!n) {
      // after the last letter: rest aside like every āyah's breath, then (once the page is
      // finished, in the chapter after) lift away up and to the right
      const rise = smooth(clamp01((t - s.end) / 0.6));
      const away = smooth(clamp01((t - s.end - TAIL) / 2.5));
      return {
        x: end[0] - 0.035 * rise + 0.15 * away,
        y: end[1] + 0.05 * rise - 0.08 * away,
        lift: LIFT_REST * rise + 0.14 * away,
        writing: 0,
      };
    }
    const next = n.path[0]!;
    const gap = n.start - s.end;
    const top = n.line !== s.line ? LIFT_LINE : n.word !== s.word ? LIFT_WORD : LIFT_STROKE;
    if (gap > REST_GAP) {
      // a rest: rise over the last letter, wait, then travel in the last TRAVEL seconds
      const into = t - s.end;
      const travelK = smooth(clamp01((into - (gap - TRAVEL)) / TRAVEL));
      const rise = smooth(clamp01(into / 0.6));
      // aside: a little down the page and to the left, off the line just written
      const aside = rise * (1 - travelK);
      return { x: end[0] + (next[0] - end[0]) * travelK - 0.035 * aside, y: end[1] + (next[1] - end[1]) * travelK + 0.05 * aside, lift: LIFT_REST * aside, writing: 0 };
    }
    const k = gap > 1e-6 ? clamp01((t - s.end) / gap) : 1;
    const e = smooth(k);
    return { x: end[0] + (next[0] - end[0]) * e, y: end[1] + (next[1] - end[1]) * e, lift: top * Math.sin(Math.PI * k), writing: 0 };
  }

  /** the nib at ink-clock t: the raw track averaged over ±40 ms (joins become glides) */
  at(t: number): PenSample {
    const N = 4;
    let x = 0;
    let y = 0;
    let lift = 0;
    let writing = 0;
    for (let i = -N; i <= N; i++) {
      const r = this.raw(t + (i / N) * 0.04);
      x += r.x;
      y += r.y;
      lift += r.lift;
      writing += r.writing;
    }
    const m = 2 * N + 1;
    return { x: x / m, y: y / m, lift: lift / m, writing: writing / m };
  }

  /** where the camera looks: the nib's recent and coming path, weighted a little ahead. The
   *  samples sit on a FIXED time grid and only their weights slide with t, so the result is
   *  continuous (samples that move with t would catch different strokes from frame to frame). */
  look(t: number): [number, number] {
    const STEP = 0.05;
    const SIGMA = 0.55;
    const AHEAD = 0.1;
    const c = t + AHEAD;
    const k0 = Math.ceil((c - 2.5 * SIGMA) / STEP);
    const k1 = Math.floor((c + 2.5 * SIGMA) / STEP);
    let x = 0;
    let y = 0;
    let wsum = 0;
    for (let k = k0; k <= k1; k++) {
      const g = k * STEP;
      const u = (g - c) / SIGMA;
      const w = Math.exp(-u * u) * Math.max(0, 1 - (u / 2.5) ** 2); // tapered to 0 at the window's edge
      const p = this.raw(g);
      x += p.x * w;
      y += p.y * w;
      wsum += w;
    }
    return [x / wsum, y / wsum];
  }

  /** 0..1: how far into a line break the pen is (a gentle bell around its middle) */
  lineBreak(t: number): number {
    let b = 0;
    for (const m of this.lineBreaks) b = Math.max(b, Math.exp(-(((t - m) / 1.1) ** 2)));
    return b;
  }
}
