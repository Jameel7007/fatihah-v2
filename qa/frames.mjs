// Review frames at fixed playhead positions (rebuild plan: "review frames per chapter at fixed
// times"). Pins the playhead with ?at=S (no scroll, grain and breath held still), waits for the
// picture to settle and saves one PNG per position for the phone (390 × 660 @3) and the desktop.
//
// Usage: npm run build && node qa/frames.mjs [--at 0,0.5,1,1.5] [--only phone|desktop] [--out DIR] [--base URL] [--q k=v&…] [--keep N] [--no-prune]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER, VIEWPORTS, capture, launch, previewBase, sleep } from './headless.mjs';
import { prune } from './retention.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const at = opt('--at', '0.1,0.35,0.6,0.85,1,1.25,1.5,1.75,2,2.5,3').split(',').map(Number);
const only = opt('--only', '');
const extra = opt('--q', ''); // extra query, e.g. --q dbg=normal
const out = opt('--out', join(root, 'qa/output', `frames-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`));
mkdirSync(out, { recursive: true });
const base = await previewBase(root, opt('--base'));
const connect = await launch(root, opt('--browser', BROWSER));
const c = await connect();
await c.send('Page.enable');
for (const [name, vp] of Object.entries(VIEWPORTS)) {
  if (only && only !== name) continue;
  await c.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.mobile, screenWidth: vp.w, screenHeight: vp.mobile ? 844 : vp.h });
  for (const s of at) {
    await c.send('Page.navigate', { url: `${base}/?at=${s}&profile=${name}${extra ? `&${extra}` : ''}` });
    let ok = false;
    for (let i = 0; i < 120 && !ok; i++) { await sleep(150); ok = Boolean(await c.evalJs('window.__boot ?? null')); }
    await sleep(1400); // the intro's fade
    const file = `${name}-s${s.toFixed(2)}.png`;
    writeFileSync(join(out, file), Buffer.from(await capture(c, { screencast: !vp.mobile }), 'base64'));
  }
}
console.log(`frames → ${out}`);
// retention: after a successful run, thin older runs (qa/retention.mjs; --keep N, --no-prune). A run
// written elsewhere with --out is not a qa/output run and is never touched.
if (!args.includes('--no-prune')) prune(opt('--keep') ? { keep: Number(opt('--keep')) } : {});
process.exit(0);
