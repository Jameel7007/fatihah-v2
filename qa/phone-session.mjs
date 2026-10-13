// Scripted phone session (rebuild plan: "trace and phone harness from day one").
//
// Drives a headless Chromium (Brave by default) as a 390 × 660 portrait phone at 3× through a
// COLD load of the production build, with real scroll gestures (Input.synthesizeScrollGesture —
// the same path a thumb takes: scroll position → request → playhead), and reads the ?trace=1
// record back. It checks the rules the plan sets, frame by frame:
//   · nothing jumps     — the playhead never moves faster than the boosted pace allows
//   · nothing skips     — during a flick the playhead passes through every chapter in order
//   · ready before shown — no render pipeline is compiled on a visible frame (no 'SYNC' after the intro)
//   · the gate holds     — with a delayed asset the playhead waits at the chapter's door and the
//                          "being prepared" note shows, then it continues without a jump
// and saves review frames at fixed moments. The GPU is this Mac's, not a phone's: frame times
// here show hitches and structure, not phone speed — the owner's phone is the real test.
//
// Usage: npm run build && node qa/phone-session.mjs [--base URL] [--out DIR] [--record] [--desktop] [--webgl2]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER, launch, previewBase, sleep } from './headless.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const browser = opt('--browser', BROWSER);
const desktop = args.includes('--desktop');
const record = args.includes('--record');
const webgl2 = args.includes('--webgl2');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = opt('--out', join(root, 'qa/output', `${desktop ? 'desktop' : 'phone'}${webgl2 ? '-webgl2' : ''}-${stamp}`));
mkdirSync(out, { recursive: true });

const base = await previewBase(root, opt('--base'));
const connect = await launch(root, browser);

const W = desktop ? 1440 : 390;
const H = desktop ? 900 : 660;
const DPR = desktop ? 2 : 3;
const query = (desktop ? 'trace=1&profile=desktop' : 'trace=1&profile=phone') + (webgl2 ? '&backend=webgl2' : '');

async function session(name, extra, script) {
  const c = await connect();
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: !desktop, screenWidth: W, screenHeight: desktop ? H : 844 });
  if (!desktop) await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await c.send('Network.enable');
  await c.send('Network.setCacheDisabled', { cacheDisabled: true }); // cold load
  const evalJs = async (expr) => (await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const mark = (label) => evalJs(`window.__trace && window.__trace.events.push({ at: performance.now(), e: 'harness:${label}' })`);
  const shot = async (label) => {
    await mark(`shot ${label}`);
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    await mark('end');
    writeFileSync(join(out, `${name}-${label}.png`), Buffer.from(r.data, 'base64'));
  };
  const frames = [];
  if (record) {
    c.on('Page.screencastFrame', (p) => { frames.push({ t: p.metadata.timestamp, data: p.data }); c.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {}); });
  }
  await c.send('Page.navigate', { url: `${base}/?${query}${extra}` });
  const tBoot = Date.now();
  let boot = null;
  for (let i = 0; i < 240 && !boot; i++) { await sleep(250); boot = await evalJs('window.__boot ?? null'); }
  if (!boot) throw new Error(`${name}: intro never lifted (${await evalJs('document.querySelector(".en")?.textContent')})`);
  if (record) await c.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
  // a real scroll gesture (touch source on the phone): the reader's thumb, not window.scrollTo
  const scroll = async (dy, speed = 900) => { await mark(`scroll ${dy}`); return c.send('Input.synthesizeScrollGesture', { x: Math.round(W / 2), y: Math.round(H * 0.6), yDistance: -dy, speed, gestureSourceType: desktop ? 'mouse' : 'touch', preventFling: true }); };
  await script({ c, evalJs, shot, scroll });
  if (record) await c.send('Page.stopScreencast');
  const trace = await evalJs('window.__trace');
  const app = await evalJs('({ chapters: window.__app.chapters, limit: window.__app.timeline.limit, assets: window.__app.gate.report() })');
  c.close();
  return { name, boot, bootWall_s: (Date.now() - tBoot) / 1000, trace, app, frames };
}

// --- the checks ----------------------------------------------------------------------------
const MAX_BOOST = 2.5;
const REVERSE_RATE = 1.6;
function analyse(run) {
  const { trace, app } = run;
  const durations = app.chapters.map((c) => c.duration);
  const fr = trace.frames;
  const liftedAt = trace.events.find((e) => e.e === 'intro lifted')?.at ?? 0;
  const live = fr.filter((f) => f.at > liftedAt + 1000); // after the intro's own fade
  // the harness's own screenshots and gesture starts stall the headless compositor: frames that
  // fall inside a screenshot's capture (from its start to 150 ms after it returned) or a
  // gesture's first 400 ms are reported separately as harnessStalls, not as the page's own
  const hev = trace.events.filter((e) => e.e.startsWith('harness:'));
  const acts = [];
  hev.forEach((e, i) => {
    if (e.e.startsWith('harness:shot')) acts.push({ a: e.at - 60, b: (hev[i + 1]?.e === 'harness:end' ? hev[i + 1].at : e.at + 1500) + 150 });
    else if (e.e.startsWith('harness:scroll')) acts.push({ a: e.at - 60, b: e.at + 400 });
  });
  const nearAct = (f) => acts.some((w) => f.at >= w.a && f.at <= w.b);
  const own = live.filter((f) => !nearAct(f));
  const harnessStalls = live.filter((f) => nearAct(f) && f.dt > 25).length;
  const dts = own.map((f) => f.dt).sort((a, b) => a - b);
  const q = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))] ?? 0;
  let jumps = 0;
  let worstStep = 0;
  let overLimit = 0;
  for (let i = 1; i < fr.length; i++) {
    const a = fr[i - 1];
    const b = fr[i];
    const k = Math.min(durations.length - 1, Math.floor(Math.min(a.s, b.s)));
    const dtS = Math.min(b.dt, 50) / 1000; // the timeline caps a frame at 1/20 s
    const allowed = (MAX_BOOST * REVERSE_RATE / durations[k]) * dtS + 1e-4;
    const step = Math.abs(b.s - a.s);
    worstStep = Math.max(worstStep, step / allowed);
    if (step > allowed) jumps++;
    if (b.s > b.lim + 1e-6) overLimit++;
  }
  const syncAfter = trace.events.filter((e) => e.at > liftedAt && e.e.startsWith('pipe:SYNC')).map((e) => e.e);
  const syncBefore = trace.events.filter((e) => e.at <= liftedAt && e.e.startsWith('pipe:SYNC')).length;
  // chapters visited in order (no skipping): the sequence of chapter indices, collapsed
  const seq = [];
  for (const f of fr) if (seq[seq.length - 1] !== f.ch) seq.push(f.ch);
  const skipped = seq.some((c, i) => i > 0 && Math.abs(c - seq[i - 1]) > 1);
  return {
    introLifted_s: run.boot.introLifted_s,
    frames: live.length,
    harnessStalls,
    dt_ms: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: dts[dts.length - 1] ?? 0, over25: dts.filter((d) => d > 25).length, over50: dts.filter((d) => d > 50).length },
    playhead: { jumps, worstStepVsAllowed: +worstStep.toFixed(3), overGateLimit: overLimit, chapterSequence: seq.join('→'), skipped },
    pipelines: { compiledBeforeIntroLifted: syncBefore, syncOnVisibleFrames: syncAfter.length, syncList: syncAfter.slice(0, 20) },
    waitNote: trace.events.filter((e) => e.e.startsWith('wait')).map((e) => e.e),
    resizes: trace.events.filter((e) => e.e.startsWith('resize')).length,
    assets: app.assets,
  };
}

// the chapters' scroll lengths and the opening's duration (chapters/story.ts)
const openingVh = 0.8;
const unrollVh = 3.0;
const openingMs = 7000;
const results = {};

// 1 · a reader at a steady pace, with review frames at fixed moments
const steady = await session('steady', '', async ({ shot, scroll, evalJs }) => {
  await sleep(1500); await shot('00-opening-early');
  await sleep(openingMs - 1000); await shot('01-opening-end');
  const vh = await evalJs('innerHeight');
  await scroll(vh * openingVh * 0.95, 700); await sleep(600);
  for (let i = 1; i <= 4; i++) {
    await scroll(vh * unrollVh / 4, 500);
    await sleep(900);
    await shot(`0${1 + i}-unroll-${i * 25}`);
  }
  await scroll(vh * 0.3, 500); await sleep(5200); await shot('06-page');
  await scroll(vh * 0.6, 500); await sleep(1500); await shot('07-end');
});
results.steady = analyse(steady);

// 2 · flicks: to the end and back to the top, hard — the playhead must not skip or jump
const flick = await session('flick', '', async ({ shot, scroll }) => {
  await sleep(openingMs + 300);
  await scroll(6000, 6000); await sleep(400); await shot('mid-flick');
  await sleep(6000); await shot('after-flick-down');
  await scroll(-6000, 6000); await sleep(9000); await shot('after-flick-up');
});
results.flick = analyse(flick);

// 3 · the gate: the ink pack held back 15 s while the reader rushes ahead
const gated = await session('gate', '&gateDelay=20000', async ({ shot, scroll }) => {
  await sleep(openingMs + 300);
  await scroll(6000, 6000); await sleep(7000); await shot('waiting');
  await sleep(10000); await shot('released');
});
results.gate = analyse(gated);

if (record) {
  for (const run of [steady, flick]) {
    const dir = join(out, `rec-${run.name}`);
    mkdirSync(dir, { recursive: true });
    const lines = [];
    run.frames.forEach((f, i) => {
      const file = `f${String(i).padStart(5, '0')}.jpg`;
      writeFileSync(join(dir, file), Buffer.from(f.data, 'base64'));
      const next = run.frames[i + 1];
      lines.push(`file '${file}'`, `duration ${next ? Math.max(0.001, next.t - f.t).toFixed(4) : 0.04}`);
    });
    writeFileSync(join(dir, 'list.txt'), lines.join('\n'));
  }
}

writeFileSync(join(out, 'report.json'), JSON.stringify({ base, viewport: `${W}x${H}@${DPR}`, results }, null, 1));
writeFileSync(join(out, 'trace-steady.json'), JSON.stringify(steady.trace));
console.log(JSON.stringify(results, (k, v) => (k === 'assets' ? undefined : v), 1));
console.log(`\nframes and report → ${out}`);
process.exit(0);
