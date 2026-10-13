// Pen paths (R2) — where the qalam is at every moment of every glyph, read from the same
// stroke-order field that reveals the ink, so the nib is always exactly on the letters.
//
// For each ink instance, the progression atlas cell holds w ∈ [0, 1] per texel: when the pen
// reaches that texel (ink-prog.png R; G = true SDF, > 0.5 inside the glyph). For τ = 0, 1/12 … 1
// the pen sits at the centroid of the inside texels whose w is near τ. Positions are written in
// composition coordinates (x across, y down the page — the sheet's v), like ink-instances.json.
//
// Input: public/text/ink-prog.png + ink-instances.json (v1's frozen outputs, unchanged)
// Then the writing schedule (src/ink/schedule.ts buildTiming): v1's rhythm in seconds, with travel
// time wherever the pen must move between strokes.
// Output: public/text/pen-paths.json (paths + every instance's time on the ink clock) and
//         src/ink/timing.json (the āyah chapters' spans — bundled, the timeline needs them at boot)
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pngDecode } from './png-io.mjs';
import { buildTiming } from '../src/ink/schedule.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const progBuf = readFileSync(join(root, 'public/text/ink-prog.png'));
const inst = JSON.parse(readFileSync(join(root, 'public/text/ink-instances.json'), 'utf8'));
const prog = pngDecode(progBuf);
const [AW, AH] = [prog.w, prog.h];
const STEPS = 12;
const BAND = 0.07; // half-width of the w band whose centroid is the pen

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const paths = [];
let empty = 0;
for (const g of inst.instances) {
  const [ax0, ay0, ax1, ay1] = g.atlas;
  const [sx0, sy0, sx1, sy1] = g.sheet;
  const i0 = Math.floor(ax0 * AW);
  const i1 = Math.ceil(ax1 * AW);
  const j0 = Math.floor(ay0 * AH);
  const j1 = Math.ceil(ay1 * AH);
  const pts = []; // [lu, lv, w]
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const k = (j * AW + i) * 4;
      if (prog.pix[k + 1] < 128) continue; // outside the glyph
      const u = ((i + 0.5) / AW - ax0) / (ax1 - ax0);
      const v = ((j + 0.5) / AH - ay0) / (ay1 - ay0);
      pts.push([u, v, prog.pix[k] / 255]);
    }
  }
  const toSheet = (u, v) => [r4(sx0 + u * (sx1 - sx0)), r4(sy0 + v * (sy1 - sy0))];
  const path = [];
  let last = [0.5, 0.5];
  for (let s = 0; s <= STEPS; s++) {
    const tau = s / STEPS;
    let su = 0;
    let sv = 0;
    let n = 0;
    for (const [u, v, w] of pts) {
      const d = Math.abs(w - tau);
      if (d > BAND) continue;
      const wt = 1 - d / BAND;
      su += u * wt;
      sv += v * wt;
      n += wt;
    }
    if (n > 0) last = [su / n, sv / n];
    path.push(toSheet(last[0], last[1]));
  }
  if (pts.length === 0) empty++;
  paths.push({ order: g.order, path });
}

const timing = buildTiming(inst.instances, new Map(paths.map((p) => [p.order, p.path])));
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const times = new Map(timing.instances.map((t) => [t.order, t]));
const out = {
  source: { prog: createHash('sha256').update(progBuf).digest('hex'), instances: inst.checksums },
  steps: STEPS,
  tMin: r5(timing.tMin),
  tMax: r5(timing.tMax),
  paths: paths.map((p) => ({ ...p, start: r5(times.get(p.order).start), dur: r5(times.get(p.order).dur) })),
};
writeFileSync(join(root, 'public/text/pen-paths.json'), JSON.stringify(out));
const spans = timing.spans.map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'ayah' ? v : r5(v)])));
writeFileSync(join(root, 'src/ink/timing.json'), JSON.stringify({ tMin: r5(timing.tMin), tMax: r5(timing.tMax), spans }, null, 1) + '\n');
console.log(`pen-paths.json  ${paths.length} instances · ${STEPS + 1} points each · ${empty} without inside texels`);
for (const s of timing.spans) console.log(`  āyah ${s.ayah}: chapter ${(s.t1 - s.t0).toFixed(2)} s · writing ${(s.w1 - s.w0).toFixed(2)} s`);
