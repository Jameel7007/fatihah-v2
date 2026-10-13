// Al-Fātiḥah v2 — boot and the frame loop (R0).
//
// Order of a session: choose the render profile (once) → start every download → bring up the
// renderer → the AssetGate builds and pre-compiles chapter 0 behind the intro → the intro lifts
// and the opening plays out of the dark. From then on each frame: the reader's scroll becomes a
// REQUEST, the Timeline moves the playhead toward it at the chapters' own pace (never past a
// chapter whose assets are not ready), and the picture is drawn as a pure function of the playhead.

import { REVISION, RenderTarget, Scene, Vector3 } from 'three/webgpu';
import { chooseProfile } from './core/profile.ts';
import { createRenderer } from './core/renderer.ts';
import { Timeline } from './core/timeline.ts';
import { AssetGate, type AssetDef } from './core/assetGate.ts';
import { CHAPTERS, CHAPTER_ASSETS, onSheet, sample, setPenTrack } from './chapters/story.ts';
import { buildInk, downloadInk, type InkPack } from './ink/atlas.ts';
import { InkPass } from './ink/inkPass.ts';
import { Qalam } from './world/qalam.ts';
import { Camera } from './world/camera.ts';
import { createGrade } from './world/grade.ts';
import { buildWorld, type World } from './world/parchment.ts';
import { Hud, Trace } from './qa/trace.ts';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const intro = document.getElementById('intro') as HTMLElement;
const introLine = document.getElementById('intro-line') as HTMLElement;
const waitNote = document.getElementById('wait') as HTMLElement;
const cue = document.getElementById('cue') as HTMLElement;
let cueDone = false;
const trace = new Trace(q);
const hud = new Hud(q);
const t0 = performance.now();
const since = (): number => +((performance.now() - t0) / 1000).toFixed(2);

// ---- 1. the render profile: once, at boot ------------------------------------------------
const profile = chooseProfile(q);
const dpr = Math.min(window.devicePixelRatio || 1, profile.dprCap);

// ---- 2. downloads start now, before the renderer ------------------------------------------
// The ink pack (atlases, instance table, pen paths) is what R2 writes with; it gates the āyah
// chapters. ?gateDelay=MS holds its download back to test the wait on purpose.
const gateDelay = Number(q.get('gateDelay') ?? '0');
const inkDownload = async (): Promise<unknown> => {
  const d = await downloadInk();
  if (gateDelay > 0) await new Promise((r) => setTimeout(r, gateDelay));
  return d;
};

// ---- 3. the renderer, scene, camera, grade -------------------------------------------------
const { renderer, backend } = await createRenderer(canvas, { forceWebGL: q.get('backend') === 'webgl2', dpr });
trace.hookPipelines(renderer);
console.info(`[fatihah v2] three r${REVISION} · ${backend} · ${profile.name} · dpr ${dpr}`);

// Touch devices: the canvas is the SMALL viewport (100svh, never under the toolbars) and the
// scroll is measured against the LARGE one (100lvh); neither moves when the toolbars slide, so
// the picture is never re-framed mid-scroll. Only a real change (rotation) resizes.
const probe = (unit: string): HTMLElement => {
  const d = document.createElement('div');
  d.style.cssText = `position:fixed;left:0;top:0;width:0;height:100${unit};visibility:hidden;pointer-events:none`;
  document.body.append(d);
  return d;
};
const svh = profile.touch ? probe('svh') : null;
const lvh = profile.touch ? probe('lvh') : null;
const viewH = (): number => svh?.offsetHeight || window.innerHeight;
const scrollH = (): number => lvh?.offsetHeight || window.innerHeight;

const timeline = new Timeline(CHAPTERS);
const scene = new Scene();
const cam = new Camera(CHAPTERS.length, sample);
const grade = createGrade(renderer, scene, cam.camera);
let fitKey = '';
const fit = (): void => {
  const w = window.innerWidth;
  const h = viewH();
  const key = `${w}x${h}`;
  if (key === fitKey) return;
  fitKey = key;
  renderer.setSize(w, h, false);
  canvas.style.height = profile.touch ? '100svh' : '100vh';
  cam.camera.aspect = w / h;
  cam.camera.updateProjectionMatrix();
  grade.setAspect(w / h);
  trace.mark(`resize ${key}`);
};
fit();
addEventListener('resize', fit);

// Pre-compile against the beauty pass's render target — the canvas target compiles pipelines the
// pass never uses (v1.8.1). The render context is captured synchronously.
const precompile = async (): Promise<void> => {
  const saved = renderer.getRenderTarget();
  renderer.setRenderTarget(grade.passTarget);
  let job: Promise<void>;
  try { job = renderer.compileAsync(scene, cam.camera); } finally { renderer.setRenderTarget(saved); }
  await job;
};

// ---- 4. the asset gate ---------------------------------------------------------------------
let world = null as World | null;
let ink = null as InkPack | null;
let inkPass = null as InkPass | null;
let qalam = null as Qalam | null;
const UP = new Vector3(0, 1, 0);
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const tip = new Vector3();
const assets: AssetDef[] = [
  {
    id: 'world',
    download: async () => null, // procedural: sky, environment, fibre maps, parchment field
    build: () => {
      world = buildWorld(renderer, profile, scene);
      const st = cam.apply(0);
      world.pose(renderer, st.deformP, st.tilt, 0, 0);
      return world;
    },
    compile: async () => {
      await precompile();
      // the shadow pass and the post chain compile on their first render: do it now, unseen
      grade.setExposure(0);
      grade.render();
    },
  },
  {
    id: 'ink',
    download: inkDownload,
    build: async (data) => {
      // three pieces of main-thread work, one per frame
      ink = buildInk(data as Parameters<typeof buildInk>[0]);
      setPenTrack(ink.pen);
      await nextFrame();
      cam.invalidate(); // the writing chapters' shots follow the pen: re-plan their distances now,
      cam.apply(timeline.s); // inside the gate's build step rather than on a visible frame
      await nextFrame();
      inkPass = new InkPass(ink, world!.ink, world!.fiber);
      qalam = new Qalam();
      scene.add(qalam.group);
      return ink;
    },
    compile: async () => {
      await inkPass!.prepare(renderer, ink!.tMin);
      // the pen's pipelines (beauty and shadow) compile in one hidden frame with the pen on the page
      const st = sample(timeline.s);
      qalam!.place(onSheet(0.15, 0.2), UP, 0.01, true);
      await precompile();
      const scratch = new RenderTarget(8, 8);
      grade.renderTo(scratch);
      scratch.dispose();
      qalam!.place(onSheet(0.15, 0.2), UP, 0, st.pen);
    },
  },
];
const gate = new AssetGate(assets, CHAPTER_ASSETS);
gate.onChange = (id, step) => trace.mark(`asset ${id} ${step}`);
// a quiet moment: still under the intro, the playhead at rest for 250 ms, or the reader waiting
// at the door of a chapter that needs this very asset
let restingSince = -1;
let quietWaiters: Array<() => void> = [];
gate.quiet = () => new Promise<void>((resolve) => { quietWaiters.push(resolve); });
gate.start();

// ---- 5. the frame loop ---------------------------------------------------------------------
const pinned = q.get('at'); // QA: ?at=S pins the playhead (review frames at fixed times)
let introDone = false;
let presented = 0;
let last = -1;
let waitingSince = -1;
let waitShown = false;
let liftedAt = 0;
let lastDeform = 0;
let gpuLagPending = false;
let lastGpuLag = 0;

const liftIntro = (): void => {
  introDone = true;
  liftedAt = performance.now();
  trace.mark('intro lifted');
  canvas.style.opacity = '1';
  intro.classList.add('is-gone');
  setTimeout(() => intro.remove(), 900);
  (window as unknown as { __boot?: unknown }).__boot = { introLifted_s: since(), profile: profile.name, backend, dpr };
  console.info(`[boot] intro lifted at ${since()}s`);
};

renderer.setAnimationLoop((now: number) => {
  const dt = last < 0 ? 0 : Math.min(0.1, (now - last) / 1000);
  last = now;
  const cpuStart = performance.now();
  introLine.style.transform = `scaleX(${gate.progress(0).toFixed(3)})`;
  if (!world || !gate.isReady(0)) return;

  // the playhead may not move until the intro has gone (the opening plays out of the dark)
  const opened = introDone && performance.now() - liftedAt > 800;
  timeline.limit = opened ? gate.limit() : 0;
  const request = pinned !== null ? Number(pinned) : timeline.requestFromScroll(scrollY / scrollH());
  if (pinned !== null) timeline.pin(Number(pinned));
  else timeline.update(dt, request);

  const st = cam.apply(timeline.s);
  // the parchment's inertia layer is excited by how fast the paper is moving
  const deformV = dt > 0 ? (st.deformP - lastDeform) / dt : 0;
  lastDeform = st.deformP;
  world.pose(renderer, st.deformP, st.tilt, dt, deformV);
  // the ink as it is at this moment of the ink clock, sharpest around where the camera looks;
  // the nib where the pen track says it is
  if (inkPass && ink) {
    inkPass.run(renderer, st.inkT, st.shot.look.x / 0.78 + 0.5, st.shot.look.z + 0.5);
    if (st.pen) {
      const p = ink.pen.at(st.inkT);
      tip.copy(onSheet(p.x, p.y));
      qalam!.place(tip, UP, p.lift, true);
    } else qalam!.place(tip, UP, 0, false);
  }
  // the candle breathes: two slow, incommensurate swells (live only; pinned QA frames hold still)
  const tSec = now / 1000;
  const breath = pinned !== null ? 1 : 1 + 0.018 * Math.sin(tSec * 1.46) + 0.009 * Math.sin(tSec * 3.7 + 1.3);
  world.setLight(st.light, breath);
  world.dust.update(pinned !== null ? 0 : tSec, st.dust, cam.focus);
  world.sky.uPxRad.value = ((cam.camera.fov * Math.PI) / 180) / Math.max(1, canvas.height);
  grade.setExposure(pinned !== null ? Math.max(st.exposure, 1e-3) : introDone ? st.exposure : 0);
  grade.setGrainSeed(pinned !== null ? 0 : Math.floor(now / 125));
  grade.render();

  if (!introDone && ++presented >= 3) liftIntro();

  // release main-thread asset work at a quiet moment
  if (timeline.rate === 0) { if (restingSince < 0) restingSince = now; } else restingSince = -1;
  const atDoor = request > timeline.limit + 1e-3 && timeline.s >= timeline.limit - 1e-3;
  if (quietWaiters.length && (!introDone || atDoor || (restingSince >= 0 && now - restingSince > 250))) {
    const w = quietWaiters;
    quietWaiters = [];
    trace.mark('quiet');
    w.forEach((f) => f());
  }

  // the scroll cue: once the opening has played, until the reader's first scroll
  if (!cueDone && scrollY > 24) {
    cueDone = true;
    cue.classList.remove('is-on');
  } else if (!cueDone && timeline.s >= 0.97 && !cue.classList.contains('is-on')) cue.classList.add('is-on');

  // "still arriving": the reader is ahead of a chapter whose assets are not ready yet
  const held = opened && request > timeline.limit + 1e-3 && timeline.s >= timeline.limit - 1e-3;
  if (held && waitingSince < 0) waitingSince = now;
  if (!held) waitingSince = -1;
  const showWait = held && now - waitingSince > 600;
  if (showWait !== waitShown) {
    waitShown = showWait;
    waitNote.classList.toggle('is-on', showWait);
    trace.mark(showWait ? 'wait shown' : 'wait hidden');
  }

  // GPU lag (trace): how long the GPU takes to finish what has been submitted. A frame loop can
  // keep its 60 Hz cadence while the GPU falls behind; a growing lag is the sign of it.
  if (trace.on && !gpuLagPending && now - lastGpuLag > 500) {
    const device = (renderer.backend as unknown as { device?: GPUDevice }).device;
    if (device) {
      gpuLagPending = true;
      lastGpuLag = now;
      const t = performance.now();
      void device.queue.onSubmittedWorkDone().then(() => {
        trace.mark(`gpulag ${(performance.now() - t).toFixed(1)}`);
        gpuLagPending = false;
      });
    }
  }
  trace.frame({ at: +now.toFixed(1), dt: +(dt * 1000).toFixed(2), cpu: +(performance.now() - cpuStart).toFixed(2), s: +timeline.s.toFixed(5), ch: timeline.chapter, req: +request.toFixed(4), lim: timeline.limit, rate: +timeline.rate.toFixed(3), rd: timeline.reader });
  hud.update(dt, `${profile.name} · ${backend} · dpr ${dpr} · ${CHAPTERS[timeline.chapter]!.id} ${timeline.t.toFixed(2)} → ${request.toFixed(2)}${timeline.limit < CHAPTERS.length ? ` · gate ${timeline.limit}` : ''}`);
});

(window as unknown as { __app?: unknown }).__app = { timeline, gate, profile, backend, dpr, chapters: CHAPTERS };
