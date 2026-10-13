// node --test qa/chapters.test.ts — the authoring contract: every chapter ends exactly where the
// next begins (so the playhead can cross a boundary without a jump), and the camera path is
// continuous everywhere on a phone and on a desktop screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAPTERS, sample, setPenTrack, type FrameState } from '../src/chapters/story.ts';
import { PenTrack } from '../src/ink/pen.ts';
import { shotDistance } from '../src/world/camera.ts';
import { evalDeform } from '../src/world/field/deform.ts';

// the writing chapters follow the pen: give them the real track
const pens = JSON.parse(readFileSync(new URL('../public/text/pen-paths.json', import.meta.url), 'utf8'));
const inst = JSON.parse(readFileSync(new URL('../public/text/ink-instances.json', import.meta.url), 'utf8'));
const times = new Map(pens.paths.map((p: { order: number; start: number; dur: number }) => [p.order, p]));
setPenTrack(new PenTrack(
  inst.instances.map((g: { order: number; ayah: number; line: number; word: number; kind: string }) => ({ ...g, start: (times.get(g.order) as { start: number }).start, dur: (times.get(g.order) as { dur: number }).dur })),
  new Map(pens.paths.map((p: { order: number; path: Array<[number, number]> }) => [p.order, p.path])),
));

const ASPECTS = { phone: 390 / 660, desktop: 1440 / 900 };

function camPos(st: FrameState, aspect: number): [number, number, number] {
  const d = shotDistance(st, aspect);
  const { look, dir } = st.shot;
  return [look.x + dir.x * d, look.y + dir.y * d, look.z + dir.z * d];
}

function close(a: number, b: number, tol: number, what: string): void {
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
}

test('neighbouring chapters agree at their shared boundary', () => {
  for (let k = 1; k < CHAPTERS.length; k++) {
    const a = sample(k - 1e-9);
    const b = sample(k);
    assert.equal(a.chapter, k - 1);
    assert.equal(b.chapter, k);
    const da = evalDeform(a.deformP);
    const db = evalDeform(b.deformP);
    const at = `${CHAPTERS[k - 1]!.id}→${CHAPTERS[k]!.id}`;
    for (const key of ['wTop', 'wBot', 'rCore', 'sag', 'sagA', 'cup'] as const) close(da[key], db[key], 1e-6, `${at} deform.${key}`);
    for (const key of ['tilt', 'exposure', 'light', 'dust', 'inkT'] as const) close(a[key], b[key], 1e-6, `${at} ${key}`);
    close(a.shot.focal, b.shot.focal, 1e-6, `${at} focal`);
    for (const [name, aspect] of Object.entries(ASPECTS)) {
      const pa = camPos(a, aspect);
      const pb = camPos(b, aspect);
      for (let i = 0; i < 3; i++) close(pa[i]!, pb[i]!, 1e-4, `${at} camera[${i}] on ${name}`);
      close(a.shot.look.distanceTo(b.shot.look), 0, 1e-4, `${at} look on ${name}`);
    }
  }
});

test('the camera path has no jumps inside any chapter', () => {
  // Two checks on the camera's movement relative to its distance from the subject (what the eye
  // reads as speed), sampled 600 times per chapter:
  //   · a ceiling: the piece's biggest authored moves (the push-in, the rise, the descent to the
  //     pen) peak near 0.8 subject-distances per second; 1.2 /s would be a lurch
  //   · continuity: no step may be more than 2.5× the steps around it — that is a jump
  const N = 600;
  for (const [name, aspect] of Object.entries(ASPECTS)) {
    const steps: Array<{ s: number; rel: number; perSec: number }> = [];
    let prev = camPos(sample(0), aspect);
    for (let i = 1; i <= CHAPTERS.length * N; i++) {
      const s = i / N;
      const st = sample(s);
      const p = camPos(st, aspect);
      const dist = Math.hypot(p[0] - st.shot.look.x, p[1] - st.shot.look.y, p[2] - st.shot.look.z);
      const rel = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) / dist;
      const k = Math.min(CHAPTERS.length - 1, Math.floor((i - 1) / N));
      steps.push({ s, rel, perSec: rel / (CHAPTERS[k]!.duration / N) });
      prev = p;
    }
    const fastest = steps.reduce((a, b) => (b.perSec > a.perSec ? b : a));
    assert.ok(fastest.perSec < 1.2, `${name}: ${fastest.perSec.toFixed(2)} subject-distances/s at s=${fastest.s.toFixed(3)}`);
    for (let i = 2; i < steps.length - 2; i++) {
      const here = steps[i]!.rel;
      if (here < 0.002) continue;
      const around = (steps[i - 2]!.rel + steps[i - 1]!.rel + steps[i + 1]!.rel + steps[i + 2]!.rel) / 4;
      assert.ok(here <= 2.5 * around + 1e-4, `${name}: a jump at s=${steps[i]!.s.toFixed(3)} (${here.toFixed(4)} vs ${around.toFixed(4)} around it)`);
    }
  }
});

test('the opening starts in the dark and ends fully lit', () => {
  const a = sample(0);
  assert.equal(a.exposure, 0);
  assert.equal(a.light, 0);
  const b = sample(1 - 1e-9);
  close(b.light, 1, 1e-6, 'light');
  close(b.exposure, 1, 1e-6, 'exposure');
});
