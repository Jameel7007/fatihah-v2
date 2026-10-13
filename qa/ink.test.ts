// node --test qa/ink.test.ts — the writing schedule and the pen track.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WINDOWS, buildTiming, type TimedInstance } from '../src/ink/schedule.ts';
import { PenTrack } from '../src/ink/pen.ts';

const read = (p: string): any => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const inst = read('../public/text/ink-instances.json');
const pens = read('../public/text/pen-paths.json');
const baked = read('../src/ink/timing.json');
const paths = new Map<number, Array<[number, number]>>(pens.paths.map((p: { order: number; path: Array<[number, number]> }) => [p.order, p.path]));
const timing = buildTiming(inst.instances, paths);
const timed: TimedInstance[] = timing.instances;
const track = new PenTrack(timed, paths);

test('the schedule uses the frozen composition windows', () => {
  for (let a = 1; a <= 7; a++) assert.deepEqual(WINDOWS[a - 1], inst.windows[String(a)]);
});

test('the baked schedule (timing.json, pen-paths.json) matches the code — rerun build-pen-paths if not', () => {
  for (const s of timing.spans) {
    const b = baked.spans[s.ayah - 1];
    for (const k of ['t0', 't1', 'w0', 'w1', 'bloom0'] as const) assert.ok(Math.abs(b[k] - s[k]) < 1e-4, `āyah ${s.ayah} ${k}`);
  }
  for (const t of timed) {
    const p = pens.paths.find((x: { order: number }) => x.order === t.order);
    assert.ok(Math.abs(p.start - t.start) < 1e-4 && Math.abs(p.dur - t.dur) < 1e-4, `order ${t.order}`);
  }
});

test('āyah chapters tile the ink clock without gaps; each writes in a few seconds', () => {
  const S = timing.spans;
  for (let i = 1; i < S.length; i++) assert.ok(Math.abs(S[i]!.t0 - S[i - 1]!.t1) < 1e-9);
  for (const s of S) {
    const d = s.w1 - s.w0;
    assert.ok(d > 2.5 && d < (s.ayah === 7 ? 11 : 6), `āyah ${s.ayah} writes in ${d.toFixed(2)} s`);
  }
});

test('every letter is written inside its āyah in v1 order, and each rosette blooms after its words', () => {
  for (const s of timing.spans) {
    const mine = timed.filter((g) => g.ayah === s.ayah);
    const v1 = inst.instances.filter((g: { ayah: number; kind: string }) => g.ayah === s.ayah && g.kind !== 'marker').sort((a: { start: number }, b: { start: number }) => a.start - b.start);
    const v2 = mine.filter((g) => g.kind !== 'marker').sort((a, b) => a.start - b.start);
    assert.deepEqual(v2.map((g) => g.order), v1.map((g: { order: number }) => g.order));
    for (const g of mine) {
      if (g.kind === 'marker') assert.ok(g.start >= s.w1 && g.start + g.dur <= s.t1 + 1e-9);
      else assert.ok(g.start >= s.w0 - 1e-9 && g.start + g.dur <= s.w1 + 1e-9, `order ${g.order}`);
    }
  }
});

test('the nib is on the letter it is writing', () => {
  for (const g of inst.instances.filter((x: { kind: string }) => x.kind !== 'marker')) {
    const t = timed.find((x) => x.order === g.order)!;
    const p = track.at(t.start + t.dur * 0.5);
    const [x0, y0, x1, y1] = g.sheet;
    const pad = 0.004; // the ±40 ms average may pull the nib a little toward its neighbours
    assert.ok(p.x >= Math.min(x0, x1) - pad && p.x <= Math.max(x0, x1) + pad && p.y >= y0 - pad && p.y <= y1 + pad, `order ${g.order} at ${p.x.toFixed(3)},${p.y.toFixed(3)}`);
  }
});

test('the pen never jumps (≤ 2 cm per 1/60 s: its quickest lifts glide at ≈ 0.9 m/s over several frames) and touches the page while it writes', () => {
  let prev = track.at(timing.tMin);
  let worst = 0;
  for (let t = timing.tMin; t <= timing.tMax; t += 1 / 60) {
    const p = track.at(t);
    worst = Math.max(worst, Math.hypot(p.x - prev.x, p.y - prev.y, p.lift - prev.lift));
    if (p.writing >= 1) assert.ok(p.lift < 1e-9);
    prev = p;
  }
  assert.ok(worst < 0.02, `worst step ${worst.toFixed(4)}`);
});
