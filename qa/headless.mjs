// Shared headless-browser plumbing for the QA scripts: a production preview server (cold load,
// no HMR) and a headless Chromium (Brave by default) with WebGPU over Metal, driven through the
// DevTools protocol.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
const tempDirs = [];
// stop what this script started — the preview server and the browser — and remove the browser's
// throwaway profile, however the script ends (2026-10-13: runs stopped mid-way left orphaned
// preview servers and 87 profiles inside the project, which the dev server then watched)
const cleanup = () => {
  // SIGKILL: a browser asked to quit politely writes its profile on the way out, after the
  // folder below has been removed (seen 2026-10-13); the profile is throwaway, nothing to save
  children.forEach((c) => { try { c.kill('SIGKILL'); } catch { /* gone */ } });
  tempDirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } });
};
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });

/** Serve dist/ on a free port unless a base URL is given. */
export async function previewBase(root, base) {
  if (base) return base;
  const port = 4600 + Math.floor(Math.random() * 300);
  // the vite binary itself (not `npx vite`): killing an npx wrapper left the server running
  children.push(spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }));
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) { try { await fetch(url); break; } catch { await sleep(250); } }
  return url;
}

/** Launch the headless browser; returns connect() for its first page. */
export async function launch(root, browser) {
  const dbg = 9700 + Math.floor(Math.random() * 200);
  // a throwaway profile outside the project, removed when the script ends. Brave's helper processes
  // can write a few files after that, so earlier runs' leftovers (> 10 min old) are swept here too.
  for (const d of readdirSync(tmpdir())) {
    if (!d.startsWith('fatihah-headless-')) continue;
    const full = join(tmpdir(), d);
    try { if (Date.now() - statSync(full).mtimeMs > 10 * 60 * 1000) rmSync(full, { recursive: true, force: true }); } catch { /* in use or gone */ }
  }
  const userData = mkdtempSync(join(tmpdir(), 'fatihah-headless-'));
  tempDirs.push(userData);
  children.push(spawn(browser, ['--headless=new', '--no-first-run', '--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=3000,2100', `--user-data-dir=${userData}`, `--remote-debugging-port=${dbg}`, 'about:blank'], { stdio: 'ignore' }));
  for (let i = 0; i < 60; i++) { try { await (await fetch(`http://localhost:${dbg}/json/version`)).json(); break; } catch { await sleep(500); } }
  return async function connect() {
    const tabs = await (await fetch(`http://localhost:${dbg}/json`)).json();
    const tab = tabs.find((t) => t.type === 'page');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    let id = 0;
    const pending = new Map();
    const listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else if (m.method && listeners.has(m.method)) listeners.get(m.method)(m.params);
    });
    const send = (method, params = {}) => new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
    return { send, evalJs, on: (m, f) => listeners.set(m, f), close: () => ws.close() };
  };
}

export const BROWSER = process.env.FATIHAH_BROWSER ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
export const VIEWPORTS = { phone: { w: 390, h: 660, dpr: 3, mobile: true }, desktop: { w: 1440, h: 900, dpr: 2, mobile: false } };

/** One PNG of the page (base64). Uses the screencast path: on this Mac, headless Brave's
 *  Page.captureScreenshot can deadlock the page at 2880×1800 while the writing is on screen
 *  (diagnosed 2026-10-13: the page renders at 61 fps until a capture is requested; screencast
 *  frames do not wedge it, but come at CSS-pixel size). Phone-size screenshots have never wedged:
 *  pass { screencast: false } there for device-pixel frames. */
export async function capture(c, { screencast = true } = {}) {
  if (!screencast) return (await c.send('Page.captureScreenshot', { format: 'png' })).data; // full device pixels
  let frame = null;
  const onFrame = (p) => { if (!frame) frame = p.data; c.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {}); };
  c.on('Page.screencastFrame', onFrame);
  await c.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  for (let i = 0; i < 50 && !frame; i++) await sleep(100);
  await c.send('Page.stopScreencast');
  c.on('Page.screencastFrame', () => {});
  if (frame) return frame;
  return (await c.send('Page.captureScreenshot', { format: 'png' })).data;
}
