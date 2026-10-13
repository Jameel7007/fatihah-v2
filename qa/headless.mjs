// Shared headless-browser plumbing for the QA scripts: a production preview server (cold load,
// no HMR) and a headless Chromium (Brave by default) with WebGPU over Metal, driven through the
// DevTools protocol.
import { spawn } from 'node:child_process';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
process.on('exit', () => children.forEach((c) => { try { c.kill(); } catch { /* gone */ } }));

/** Serve dist/ on a free port unless a base URL is given. */
export async function previewBase(root, base) {
  if (base) return base;
  const port = 4600 + Math.floor(Math.random() * 300);
  children.push(spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }));
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) { try { await fetch(url); break; } catch { await sleep(250); } }
  return url;
}

/** Launch the headless browser; returns connect() for its first page. */
export async function launch(root, browser) {
  const dbg = 9700 + Math.floor(Math.random() * 200);
  const userData = join(root, 'build', `.headless-${dbg}`);
  children.push(spawn(browser, ['--headless=new', '--no-first-run', '--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1200,900', `--user-data-dir=${userData}`, `--remote-debugging-port=${dbg}`, 'about:blank'], { stdio: 'ignore' }));
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
