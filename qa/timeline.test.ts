// node --test qa/timeline.test.ts — the playhead rules: the reader's own chapter plays at its
// authored pace, chapters scrolled past are fast-forwarded and caught up in seconds (never
// skipped), nothing jumps, the asset gate holds the playhead at a chapter's door, and the same
// inputs give the same frames. Inputs go through requestFromScroll, the real path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BOOST, Timeline, type ChapterSpec } from '../src/core/timeline.ts';

const SPECS: ChapterSpec[] = [
  { id: 'rest', duration: 3, scroll: 0.6, scrub: false },
  { id: 'unroll', duration: 5, scroll: 2.5, scrub: true },
  { id: 'page', duration: 4, scroll: 1.5, scrub: false },
  { id: 'a', duration: 8, scroll: 0.8, scrub: false },
  { id: 'b', duration: 10, scroll: 0.8, scrub: false },
  { id: 'c', duration: 6, scroll: 0.8, scrub: false },
];
const DT = 1 / 60;
const startOf = (tl: Timeline, k: number): number => tl.scrollStartOf(k);

/** run with the reader at scroll position vh (or a function of time) */
function run(tl: Timeline, seconds: number, vh: number | ((t: number) => number), onFrame?: (prev: number, tl: Timeline) => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const prev = tl.s;
    tl.update(DT, tl.requestFromScroll(typeof vh === 'function' ? vh(i * DT) : vh));
    onFrame?.(prev, tl);
  }
}

test('scroll maps to requests: a timed chapter asks for its own end, a scrubbed one for the reader', () => {
  const tl = new Timeline(SPECS);
  assert.equal(tl.requestFromScroll(0), 1);
  assert.equal(tl.reader, 0);
  assert.ok(Math.abs(tl.requestFromScroll(0.6 + 1.25) - 1.5) < 1e-9);
  assert.equal(tl.reader, 1);
  assert.equal(tl.requestFromScroll(0.6 + 2.5 + 0.1), 3);
  assert.equal(tl.reader, 2);
  assert.equal(tl.requestFromScroll(99), 6);
});

test("the reader's own timed chapter plays at its authored pace", () => {
  const tl = new Timeline(SPECS);
  run(tl, 1.5, 0);
  // half the 3 s chapter minus the start ramp
  assert.ok(tl.s > 0.42 && tl.s < 0.51, `s=${tl.s}`);
  run(tl, 2, 0);
  assert.equal(tl.s, 1);
  assert.equal(tl.rate, 0);
});

test('chapters scrolled past are fast-forwarded: a 27 s backlog clears in under 5 s', () => {
  const tl = new Timeline(SPECS);
  tl.pin(1); // at the end of the opening
  const target = startOf(tl, 5) + 0.1; // the reader jumps to chapter c
  let t = 0;
  let maxRate = 0;
  for (let i = 0; i < 600 && tl.s < 5.02; i++) {
    tl.update(DT, tl.requestFromScroll(target));
    if (tl.s < 5) t += DT;
    maxRate = Math.max(maxRate, tl.rate);
  }
  // ≈ 5 + 4 + 8 + 10 = 27 s of authored time behind → the rate saturates at MAX_BOOST
  assert.ok(maxRate <= MAX_BOOST + 1e-9 && maxRate > MAX_BOOST * 0.9, `max rate ${maxRate}`);
  assert.ok(t < 27 / MAX_BOOST + 1.5, `took ${t.toFixed(2)} s to reach the reader's chapter`);
  // and then the reader's own chapter plays at 1×
  const s0 = tl.s;
  run(tl, 1, target);
  assert.ok(Math.abs((tl.s - s0) * 6 - 1) < 0.15, `own chapter pace ${(tl.s - s0) * 6}`);
});

test('a flick never skips a chapter and never exceeds the boosted pace', () => {
  const tl = new Timeline(SPECS);
  const seen = new Set<number>();
  run(tl, 40, 99, (prev, x) => {
    const k = Math.min(SPECS.length - 1, Math.floor(prev));
    const kb = Math.min(SPECS.length - 1, Math.floor(x.s));
    const cap = (MAX_BOOST / Math.min(SPECS[k]!.duration, SPECS[kb]!.duration)) * DT;
    assert.ok(x.s >= prev, 'monotonic forward');
    assert.ok(x.s - prev <= cap * 1.0001 + 1e-12, `step ${x.s - prev} > cap ${cap} at s=${prev}`);
    seen.add(kb);
  });
  assert.equal(tl.s, 6);
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4, 5]);
});

test('the playback rate changes smoothly (no frame-to-frame jumps in speed)', () => {
  const tl = new Timeline(SPECS);
  let prev = 0;
  run(tl, 30, (t) => (t < 4 ? 1.7 : t < 8 ? 0.4 : t < 15 ? 99 : 1.0), (_p, x) => {
    const accel = MAX_BOOST / 0.3;
    assert.ok(Math.abs(x.rate - prev) <= accel * DT + 1e-9 || x.rate === 0, `rate step ${x.rate - prev} at s=${x.s}`);
    prev = x.rate;
  });
});

test('the asset gate holds the playhead at the door, then lets it through without a jump', () => {
  const tl = new Timeline(SPECS);
  tl.limit = 3; // chapter a not ready
  run(tl, 15, 99);
  assert.equal(tl.s, 3);
  tl.limit = 6;
  let maxStep = 0;
  run(tl, 20, 99, (prev, x) => { maxStep = Math.max(maxStep, x.s - prev); });
  assert.equal(tl.s, 6);
  assert.ok(maxStep <= (MAX_BOOST / 6) * DT + 1e-9);
});

test('going back rewinds, fast through the chapters passed over', () => {
  const tl = new Timeline(SPECS);
  tl.pin(6);
  const back = 0.6 + 1.25; // the middle of the unroll
  let t = 0;
  run(tl, 12, back, (prev, x) => {
    assert.ok(x.s <= prev);
    if (x.s > 2) t += DT;
  });
  assert.ok(Math.abs(tl.s - 1.5) < 1e-3, `s=${tl.s}`);
  assert.ok(t < 28 / MAX_BOOST + 1.5, `rewound the passed chapters in ${t.toFixed(2)} s`);
});

test('deterministic: the same inputs give the same playhead', () => {
  const a = new Timeline(SPECS);
  const b = new Timeline(SPECS);
  const req = (t: number): number => 3 + Math.sin(t) * 3;
  run(a, 12, req);
  run(b, 12, req);
  assert.equal(a.s, b.s);
});
