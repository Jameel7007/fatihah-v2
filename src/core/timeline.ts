// Timeline — "scroll picks the scene; time plays it" (rebuild plan, v1 lesson 2).
//
// The piece is a row of chapters. The playhead is one number s ∈ [0, n]: chapter k spans
// [k, k + 1] and its local time is t = s − k. Every visual is a pure function of (chapter, t),
// so a frame is reproducible from those two numbers (?at=k:t pins them for review frames).
// Authors keep one contract: the state at the end of chapter k equals the state at the start of
// chapter k + 1 — then the playhead can cross any boundary without a jump.
//
// The reader's scroll only REQUESTS a position:
//   · a timed chapter (scrub: false) requests its own end the moment the reader enters it, and
//     the playhead plays it at its authored pace (1 / duration per second);
//   · a scrubbable chapter requests the reader's position inside it, and the playhead follows
//     with a soft spring, never faster than the chapter's speed cap.
// The chapter the reader is IN plays at its authored pace. Chapters the reader has scrolled past
// (forward or back) are fast-forwarded at up to MAX_BOOST ×, braking at a constant CATCH_A so it
// arrives in the reader's chapter at 1× — the picture never skips, but it never trails the reader
// for long either (the whole piece, ≈ 95 s, clears in ≈ 6.5 s; the rest of one āyah in under a second)
// (owner, R2 phone review: "I scroll down and the image takes too long to catch up"). The playhead never enters a chapter whose assets are not ready
// (`limit`, set from the AssetGate); it waits at the end of the previous one instead.
//
// No imports: this file is unit-tested directly by node (qa/timeline.test.ts).

export interface ChapterSpec {
  id: string;
  /** authored play time of the whole chapter at 1× (seconds) */
  duration: number;
  /** scroll length of the chapter (viewport heights) */
  scroll: number;
  /** true: the reader's position inside the chapter is followed; false: it plays once entered */
  scrub: boolean;
}

export const MAX_BOOST = 16;
/** the fast-forward's braking (rate units per second): rate = √(2 · CATCH_A · authored seconds behind) */
export const CATCH_A = 10;
/** a scrubbed chapter follows the reader's thumb at up to this rate */
const SCRUB_CAP = 3;
/** time to reach full speed from rest, and to come to rest (seconds) */
const RAMP_S = 0.3;
/** scrub follow time constant (seconds) */
const SCRUB_TAU = 0.22;

export class Timeline {
  readonly specs: readonly ChapterSpec[];
  /** total scroll length of the chapters (viewport heights) */
  readonly scrollTotal: number;
  private readonly starts: number[] = [];
  /** playhead */
  s = 0;
  /** playback rate: 1 = the authored pace, negative = rewinding */
  rate = 0;
  /** last requested position (before the asset limit) */
  request = 0;
  /** the chapter the reader's scroll position is in (set by requestFromScroll / pin) */
  reader = 0;
  /** highest s the playhead may reach: the start of the first chapter that is not ready */
  limit: number;

  constructor(specs: readonly ChapterSpec[]) {
    if (specs.length === 0) throw new Error('timeline needs chapters');
    this.specs = specs;
    let acc = 0;
    for (const c of specs) {
      this.starts.push(acc);
      acc += c.scroll;
    }
    this.scrollTotal = acc;
    this.limit = specs.length;
  }

  get count(): number {
    return this.specs.length;
  }

  /** current chapter index and local time 0..1 */
  get chapter(): number {
    return Math.min(this.count - 1, Math.floor(this.s));
  }
  get t(): number {
    return this.s - this.chapter;
  }

  /** Scroll position (viewport heights from the top of the track) → requested playhead. */
  requestFromScroll(vh: number): number {
    const pos = Math.max(0, Math.min(this.scrollTotal, vh));
    let k = this.count - 1;
    for (let i = 0; i < this.count; i++) {
      const start = this.starts[i] ?? 0;
      const spec = this.specs[i]!;
      if (pos < start + spec.scroll) {
        k = i;
        break;
      }
    }
    const spec = this.specs[k]!;
    this.reader = k;
    if (!spec.scrub) return k + 1;
    const local = (pos - (this.starts[k] ?? 0)) / spec.scroll;
    return k + Math.max(0, Math.min(1, local));
  }

  /** Scroll offset (viewport heights) where chapter k begins — for "jump to" controls and QA. */
  scrollStartOf(k: number): number {
    return this.starts[Math.max(0, Math.min(this.count - 1, k))] ?? 0;
  }

  /** Authored seconds between playhead positions a < b. */
  private seconds(a: number, b: number): number {
    let sum = 0;
    for (let k = Math.max(0, Math.floor(a)); k < Math.min(this.count, Math.ceil(b)); k++) {
      const lo = Math.max(a, k);
      const hi = Math.min(b, k + 1);
      if (hi > lo) sum += (hi - lo) * this.specs[k]!.duration;
    }
    return sum;
  }

  /** Advance the playhead toward `request` by dt seconds. Returns true when it moved. */
  update(dtRaw: number, request: number): boolean {
    this.request = request;
    const dt = Math.min(Math.max(dtRaw, 0), 1 / 20);
    if (dt === 0) return false;
    const target = Math.max(0, Math.min(this.limit, this.count, request));
    const dist = target - this.s;
    const dir = Math.sign(dist);
    const k = Math.min(this.count - 1, Math.floor(this.s + (dir < 0 ? -1e-9 : 0)));
    const spec = this.specs[Math.max(0, k)]!;
    const pace = 1 / Math.max(0.05, spec.duration);

    // The playback RATE (1 = the authored pace) is the continuous quantity: crossing into a
    // chapter with a different duration changes how fast s moves, never how fast the picture does.
    // How much authored time lies between the playhead and the reader's own chapter?
    const reader = Math.min(this.count - 1, Math.max(0, this.reader));
    const behind = dir > 0 ? this.seconds(this.s, Math.min(target, reader)) : dir < 0 ? this.seconds(Math.max(target, reader + 1), this.s) : 0;
    // passed-over chapters fast-forward and brake into the reader's chapter; that one plays at 1×
    const cap = Math.max(1, Math.min(MAX_BOOST, Math.sqrt(2 * CATCH_A * behind)));
    const ahead = Math.abs(dist);
    let desired = spec.scrub && k === reader ? dist / SCRUB_TAU / pace : dir * cap;
    const lim0 = spec.scrub && k === reader ? Math.max(cap, SCRUB_CAP) : cap;
    // come to rest over RAMP_S rather than stopping dead (the authored tweens also ease at t = 1)
    const accel = Math.max(1, lim0, Math.abs(this.rate)) / RAMP_S;
    const stopping = Math.sqrt((2 * accel * ahead) / pace);
    const lim = Math.min(lim0, stopping);
    desired = Math.max(-lim, Math.min(lim, desired));
    this.rate += Math.max(-accel * dt, Math.min(accel * dt, desired - this.rate));

    let next = this.s + this.rate * pace * dt;
    // never pass the target (an overshoot would read as a bounce)
    if (dir === 0 || Math.abs(target - next) < 1e-5 || (dir > 0 && next >= target) || (dir < 0 && next <= target)) {
      next = target;
      this.rate = 0;
    }
    const moved = next !== this.s;
    this.s = Math.max(0, Math.min(this.count, next));
    return moved;
  }

  /** Pin the playhead (QA frames, reduced motion). */
  pin(s: number): void {
    this.s = Math.max(0, Math.min(this.count, s));
    this.reader = Math.min(this.count - 1, Math.floor(this.s));
    this.rate = 0;
  }
}
