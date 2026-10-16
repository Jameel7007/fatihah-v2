// node --test qa/transitions.test.ts — R3, the breath between the āyāt: the light passes along
// each āyah once and only over its own words; each translation is fully present when its āyah's
// chapter comes to rest, and only one is ever on screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LightPass } from '../src/ink/sweep.ts';
import { LIGHT_AT, LIGHT_DUR } from '../src/ink/schedule.ts';
import { CHAPTERS, sample } from '../src/chapters/story.ts';
import timing from '../src/ink/timing.json' with { type: 'json' };

const inst = JSON.parse(readFileSync(new URL('../public/text/ink-instances.json', import.meta.url), 'utf8'));
const spans = timing.spans as unknown as ConstructorParameters<typeof LightPass>[0];
const light = new LightPass(spans, inst.instances);
const FIRST_AYAH = CHAPTERS.findIndex((c) => c.id === 'ayah1');

test('the light passes along each āyah once, over its own words, right to left', () => {
  for (const sp of spans) {
    const t0 = sp.w1 + LIGHT_AT;
    let seen = 0;
    let firstX = NaN;
    let lastX = NaN;
    for (let t = t0; t <= t0 + LIGHT_DUR; t += 0.02) {
      const s = light.at(t);
      if (s.amp <= 0.01) continue;
      seen++;
      assert.equal(s.ayah, sp.ayah);
      assert.ok(s.x >= sp.box[0] - 1e-4 && s.x <= sp.box[2] + 1e-4, `āyah ${sp.ayah} x ${s.x}`);
      assert.ok(s.yLo >= sp.box[1] - 1e-4 && s.yHi <= sp.box[3] + 1e-4); // timing.json is rounded to 5 decimals
      if (Number.isNaN(firstX)) firstX = s.x;
      lastX = s.x;
    }
    assert.ok(seen > 20, `āyah ${sp.ayah}: the light shows`);
    if (sp.lines[0] === sp.lines[1]) assert.ok(firstX > lastX, `āyah ${sp.ayah} reads right to left`);
    // and not before or after its window
    assert.equal(light.at(t0 - 0.05).amp, 0);
    assert.equal(light.at(t0 + LIGHT_DUR + 0.05).amp, 0);
  }
});

test('each translation is fully present when its āyah comes to rest, and only one shows at a time', () => {
  for (let i = 0; i < spans.length; i++) {
    const end = sample(FIRST_AYAH + i + 1 - 1e-9);
    assert.equal(end.words.ayah, i + 1);
    assert.ok(end.words.opacity > 0.999, `āyah ${i + 1}: ${end.words.opacity}`);
  }
  assert.equal(sample(FIRST_AYAH).words.opacity, 0); // nothing before the first letter
  // sweep the whole writing: the shown āyah never goes backwards while moving forward
  let prev = 0;
  for (let s = FIRST_AYAH; s <= CHAPTERS.length; s += 0.002) {
    const w = sample(s).words;
    if (w.opacity > 0) {
      assert.ok(w.ayah >= prev, `at s=${s.toFixed(3)} āyah ${w.ayah} after ${prev}`);
      prev = w.ayah;
    }
  }
});
