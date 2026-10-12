// node --test qa/timeline.test.ts — the playhead rules from the rebuild plan:
// timed chapters play at their authored pace, a flick never skips, nothing jumps, the asset
// gate holds the playhead at a chapter's door, and the same inputs give the same frames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BOOST, REVERSE_RATE, Timeline, type ChapterSpec } from '../src/core/timeline.ts';

const SPECS: ChapterSpec[] = [
  { id: 'rest', duration: 3, scroll: 0.6, scrub: false },
  { id: 'unroll', duration: 5, scroll: 2.5, scrub: true },
  { id: 'page', duration: 4, scroll: 1.5, scrub: false },
];
const DT = 1 / 60;

function run(tl: Timeline, seconds: number, request: number | ((t: number) => number), onFrame?: (prev: number, tl: Timeline) => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const prev = tl.s;
    tl.update(DT, typeof request === 'function' ? request(i * DT) : request);
    onFrame?.(prev, tl);
  }
}

test('scroll maps to requests: a timed chapter asks for its own end, a scrubbed one for the reader', () => {
  const tl = new Timeline(SPECS);
  assert.equal(tl.requestFromScroll(0), 1);
  assert.equal(tl.requestFromScroll(0.59), 1);
  assert.ok(Math.abs(tl.requestFromScroll(0.6 + 1.25) - 1.5) < 1e-9);
  assert.equal(tl.requestFromScroll(0.6 + 2.5 + 0.1), 3);
  assert.equal(tl.requestFromScroll(99), 3);
});

test('a timed chapter plays at its authored pace and finishes', () => {
  const tl = new Timeline(SPECS);
  run(tl, 1.5, 1);
  // half the 3 s chapter minus the start ramp (≤ 0.15 s of lost travel)
  assert.ok(tl.s > 0.42 && tl.s < 0.51, `s=${tl.s}`);
  run(tl, 2, 1);
  assert.equal(tl.s, 1);
  assert.equal(tl.rate, 0);
});

test('a flick to the end never skips and never exceeds the boosted pace', () => {
  const tl = new Timeline(SPECS);
  let maxStep = 0;
  run(tl, 30, 3, (prev, t) => {
    const k = Math.min(2, Math.floor(prev));
    const cap = (MAX_BOOST / SPECS[k]!.duration) * DT;
    const step = t.s - prev;
    assert.ok(step >= 0, 'monotonic forward');
    assert.ok(step <= cap * 1.0001 + 1e-12, `step ${step} > cap ${cap} at s=${prev}`);
    maxStep = Math.max(maxStep, step);
  });
  assert.equal(tl.s, 3);
  assert.ok(maxStep > 0);
});

test('the playback rate changes smoothly (no frame-to-frame jumps in speed)', () => {
  const tl = new Timeline(SPECS);
  let prev = 0;
  run(tl, 20, (t) => (t < 4 ? 1.7 : t < 8 ? 0.4 : 3), (_p, t) => {
    const accel = (MAX_BOOST * REVERSE_RATE) / 0.3;
    assert.ok(Math.abs(t.rate - prev) <= accel * DT + 1e-9 || t.rate === 0, `rate step ${t.rate - prev} at s=${t.s}`);
    prev = t.rate;
  });
});

test('the asset gate holds the playhead at the door, then lets it through without a jump', () => {
  const tl = new Timeline(SPECS);
  tl.limit = 2; // chapter 2 not ready
  run(tl, 15, 3);
  assert.equal(tl.s, 2);
  tl.limit = 3;
  let maxStep = 0;
  run(tl, 10, 3, (prev, t) => { maxStep = Math.max(maxStep, t.s - prev); });
  assert.equal(tl.s, 3);
  assert.ok(maxStep <= (MAX_BOOST / 4) * DT + 1e-9);
});

test('going back rewinds at the reverse rate', () => {
  const tl = new Timeline(SPECS);
  tl.pin(3);
  run(tl, 1, 1.5, (prev, t) => assert.ok(t.s <= prev));
  assert.ok(tl.s < 3 && tl.s > 2, `s=${tl.s}`);
  run(tl, 10, 1.5);
  assert.ok(Math.abs(tl.s - 1.5) < 1e-3, `s=${tl.s}`);
});

test('deterministic: the same inputs give the same playhead', () => {
  const a = new Timeline(SPECS);
  const b = new Timeline(SPECS);
  const req = (t: number): number => 1.5 + Math.sin(t) * 1.4;
  run(a, 12, req);
  run(b, 12, req);
  assert.equal(a.s, b.s);
});
