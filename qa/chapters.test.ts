// node --test qa/chapters.test.ts — the authoring contract: every chapter ends exactly where the
// next begins (so the playhead can cross a boundary without a jump), and the camera path is
// continuous everywhere on a phone and on a desktop screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, sample, type FrameState } from '../src/chapters/story.ts';
import { shotDistance } from '../src/world/camera.ts';
import { evalDeform } from '../src/world/field/deform.ts';

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
    for (const key of ['tilt', 'exposure', 'light', 'dust'] as const) close(a[key], b[key], 1e-6, `${at} ${key}`);
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
  const N = 600; // samples per chapter
  for (const [name, aspect] of Object.entries(ASPECTS)) {
    let prev = camPos(sample(0), aspect);
    let worst = 0;
    let at = 0;
    for (let i = 1; i <= CHAPTERS.length * N; i++) {
      const s = i / N;
      const p = camPos(sample(s), aspect);
      // movement relative to the distance from the subject: what the eye reads as speed
      const st = sample(s);
      const dist = Math.hypot(p[0] - st.shot.look.x, p[1] - st.shot.look.y, p[2] - st.shot.look.z);
      const step = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) / dist;
      if (step > worst) { worst = step; at = s; }
      prev = p;
    }
    // the push-in and the rise are the piece's biggest moves (≈ 0.9 subject distances per second at
    // their fastest); a jump is a single step far beyond that
    assert.ok(worst < 0.012, `${name}: camera step ${worst.toFixed(4)} at s=${at.toFixed(3)}`);
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
