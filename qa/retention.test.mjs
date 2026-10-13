// node --test qa/retention.test.mjs — the QA output retention rule, on a throwaway project folder:
// the newest N runs of each kind stay whole, older runs lose only regenerable files, and nothing
// outside qa/output — or behind a symlink, or marked KEEP, or of unknown purpose — is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prune } from './retention.mjs';

const quiet = () => {};

function project() {
  const root = mkdtempSync(join(tmpdir(), 'fatihah-retention-'));
  const out = join(root, 'qa', 'output');
  mkdirSync(out, { recursive: true });
  const run = (name, { rec = true } = {}) => {
    const d = join(out, name);
    mkdirSync(d);
    for (const f of ['steady-01.png', 'trace-steady.json', 'report.json', 'steady.mp4']) writeFileSync(join(d, f), 'x');
    if (rec) {
      mkdirSync(join(d, 'rec-steady'));
      for (let i = 0; i < 5; i++) writeFileSync(join(d, 'rec-steady', `f${i}.jpg`), 'x');
      writeFileSync(join(d, 'rec-steady', 'list.txt'), 'x');
    }
    return d;
  };
  return { root, out, run };
}

test('keeps the newest N runs of each kind whole; older runs keep only their report and recordings', () => {
  const { root, out, run } = project();
  for (let h = 10; h < 15; h++) run(`phone-2026-10-13T${h}-00-00`);
  run('desktop-2026-10-13T09-00-00');
  for (let h = 10; h < 13; h++) run(`frames-2026-10-13T${h}-00-00`, { rec: false });
  const plan = prune({ keep: 3, root, log: quiet });
  for (const h of [12, 13, 14]) assert.equal(readdirSync(join(out, `phone-2026-10-13T${h}-00-00`)).length, 5, 'kept whole');
  for (const h of [10, 11]) assert.deepEqual(readdirSync(join(out, `phone-2026-10-13T${h}-00-00`)).sort(), ['report.json', 'steady.mp4']);
  assert.equal(readdirSync(join(out, 'desktop-2026-10-13T09-00-00')).length, 5, 'only one desktop run: kept');
  assert.equal(plan.files, 2 * (1 + 1 + 6));
  rmSync(root, { recursive: true, force: true });
});

test('a dry run deletes nothing', () => {
  const { root, out, run } = project();
  for (let h = 10; h < 15; h++) run(`phone-2026-10-13T${h}-00-00`);
  const plan = prune({ keep: 1, root, dryRun: true, log: quiet });
  assert.ok(plan.files > 0);
  for (let h = 10; h < 15; h++) assert.equal(readdirSync(join(out, `phone-2026-10-13T${h}-00-00`)).length, 5);
  rmSync(root, { recursive: true, force: true });
});

test('never touches: KEEP-marked runs, unknown folders, loose files, links, or anything outside qa/output', () => {
  const { root, out, run } = project();
  for (let h = 10; h < 14; h++) run(`phone-2026-10-13T${h}-00-00`);
  writeFileSync(join(out, 'phone-2026-10-13T10-00-00', 'KEEP'), 'reference');
  mkdirSync(join(out, 'baselines'));
  writeFileSync(join(out, 'baselines', 'ref.png'), 'x');
  writeFileSync(join(out, 'notes.png'), 'x');
  // outside qa/output, with a link to it planted inside an old run
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'precious.png'), 'x');
  symlinkSync(join(root, 'docs'), join(out, 'phone-2026-10-13T11-00-00', 'rec-link'));
  prune({ keep: 1, root, log: quiet });
  assert.equal(readdirSync(join(out, 'phone-2026-10-13T10-00-00')).length, 6, 'KEEP run untouched');
  assert.ok(existsSync(join(out, 'baselines', 'ref.png')), 'unknown folder untouched');
  assert.ok(existsSync(join(out, 'notes.png')), 'loose file untouched');
  assert.ok(existsSync(join(root, 'docs', 'precious.png')), 'outside qa/output untouched (link not followed)');
  rmSync(root, { recursive: true, force: true });
});

test('refuses when qa/output is a link to somewhere else, and rejects a bad keep', () => {
  const root = mkdtempSync(join(tmpdir(), 'fatihah-retention-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'fatihah-elsewhere-'));
  mkdirSync(join(root, 'qa'));
  symlinkSync(elsewhere, join(root, 'qa', 'output'));
  mkdirSync(join(elsewhere, 'phone-2026-10-13T10-00-00'));
  writeFileSync(join(elsewhere, 'phone-2026-10-13T10-00-00', 'a.png'), 'x');
  assert.throws(() => prune({ keep: 1, root, log: quiet }), /refusing/);
  assert.ok(existsSync(join(elsewhere, 'phone-2026-10-13T10-00-00', 'a.png')));
  assert.throws(() => prune({ keep: 0, root, log: quiet }), /keep/);
  rmSync(root, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});
