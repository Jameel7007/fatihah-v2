// node --test qa/track.test.ts — the scroll track in index.html must be the chapters' scroll
// lengths plus one screen, or the last chapter can never be requested (v1's spacer.test idea).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('index.html track height = Σ chapter scroll + one viewport', () => {
  const src = readFileSync(new URL('../src/chapters/r0.ts', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('export const CHAPTERS'), src.indexOf('];', src.indexOf('export const CHAPTERS')));
  const total = [...block.matchAll(/scroll:\s*([\d.]+)/g)].reduce((a, m) => a + Number(m[1]), 0);
  assert.ok(total > 0);
  const expected = Math.round((total + 1) * 100);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const vh = [...html.matchAll(/#track\s*\{[^}]*height:\s*(\d+)(l?vh)/g)].map((m) => Number(m[1]));
  assert.ok(vh.length >= 2, 'both the vh and lvh rules are present');
  for (const v of vh) assert.equal(v, expected);
});
