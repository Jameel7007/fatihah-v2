# Al-Fātiḥah v2 — working rules

Read first: `docs/status.html` (plain-language spec + ledger), then v1's plan
`~/Code/fatihah-manuscript/docs/rebuild-plan.md`. v1 (`~/Code/fatihah-manuscript`, live at
jameel7007.github.io/fatihah-manuscript) stays untouched until v2 replaces it at R6.

## Non-negotiable
- Scripture: ʿUthmānic text, Ḥafṣ ʿan ʿĀṣim, Basmalah = āyah 1, verified byte-identical by
  `build/verify-text.mjs` (runs in `npm run build` and CI). Change how it is revealed, never the text.
- Reuse v1's pipeline (`build/shape-text.mjs`, `build-ink-atlas.mjs`, `build-glyph-mesh.mjs`,
  `outline-lib.mjs`); `npm run text:rebuild` reproduces every file in `public/text/` byte for byte.
- The approved gold (v1.6.6: roughness 0.52, metalness 0.72, no burnish, anisotropy 0) is not changed
  without the owner asking.
- Never use the word "drag" for the scripture — choose gentle words. Credits: "Thomas Mooney (@Jameel7007)".
- Work milestone by milestone (R0 → R6); stop at the end of each with frames/recording for the owner's
  phone. Report unverified results honestly; headless frame times are this Mac's GPU, not a phone's.

## How it is built
- Scroll picks the chapter; time plays it: `src/core/timeline.ts` (playhead s, chapter = ⌊s⌋, t = s − ⌊s⌋).
  Every visual is a pure function of s. Neighbouring chapters must agree at their shared boundary.
  The reader's own chapter (`timeline.reader`) plays at 1×; chapters scrolled past fast-forward at up to 16×,
  braking (√(2·CATCH_A·seconds behind)) into it — owner, R2: "the image takes too long to catch up".
- `src/core/assetGate.ts`: each chapter lists its assets (`CHAPTER_ASSETS`); download → build → pre-compile
  (against `grade.passTarget`, never the canvas) before the playhead may enter.
- `src/core/profile.ts`: phone / laptop / desktop, chosen once at boot, never changed mid-session.
- Chapters live in `src/chapters/story.ts`; neighbours must agree at their boundary and the camera path must
  not jump (qa/chapters.test.ts). Close shots use `Shot.absDist` (authored at 16:10, scaled for narrow screens).
- The scroll track height in index.html must equal Σ chapter scroll + 1 (qa/track.test.ts).
- R2 writing: `src/ink/schedule.ts` (v1 timings → the ink clock, with pen travel time) is run at BUILD time by
  `build/build-pen-paths.mjs`, which writes `public/text/pen-paths.json` and `src/ink/timing.json` (the āyah chapters'
  lengths, bundled). Rerun it after changing schedule constants (qa/ink.test.ts fails if stale). `src/ink/pen.ts`
  is the qalam's track; `src/ink/inkPass.ts` draws the ink into a page target + a sharp detail window around the
  camera's look point (both sampled by the parchment).
- R3 transitions: schedule.ts TAIL/PRE/LIGHT_*/WORDS_AT/BREATH_UP; `src/ink/sweep.ts` (light pass, CPU) +
  parchment emissive pool (ink A channel = cov × āyah / 8 — the ink pass must stay transparent + NoBlending or
  three writes alpha 1); story.ts ayahShot (breath) and wordsAt (translation card, `src/page/words.ts`).
- Assets after chapter 0 build/compile only at a quiet moment (`gate.quiet`: playhead at rest 250 ms, or the
  reader waiting for that asset). compileAsync stamps `renderer.depth` onto the context: for depth-less targets set
  `renderer.depth = false` around it, or the real render builds a second pipeline synchronously.

## How to run
- `npm run dev` (4530) · `npm run build` · `npm run preview` (4531) · `npm test`
- Phone harness: `npm run build && node qa/phone-session.mjs [--desktop] [--webgl2] [--record]`
  (headless Brave at 390×660@3, cold load, real scroll gestures; checks jumps, skips, SYNC compiles, the gate,
  and GPU lag — rAF keeps a 60 Hz cadence even when the GPU falls behind, so frame intervals alone prove little).
  Harness hygiene (2026-10-13 CPU incident): browser profiles live in the OS temp folder and are deleted
  after each run; the preview server is spawned as `node node_modules/vite/bin/vite.js` (an `npx` wrapper
  orphaned it when killed). Never write harness output under a watched folder: vite.config.ts
  `server.watch.ignored` covers qa/output, build/.headless-*, docs/review — 87 stale profiles in build/ had kept
  the dev server at ~300 % CPU.
  Headless Brave's Page.captureScreenshot can deadlock the page at 2880×1800 during the writing: desktop captures go
  through the screencast (`capture()` in qa/headless.mjs, CSS-pixel size); phone-size screenshots are safe.
- qa/output retention (`qa/retention.mjs`, run by the harness after each successful run, or `npm run qa:prune
  [-- --dry-run] [--keep N]`): the newest 3 runs of each kind stay whole (`--keep N` / `FATIHAH_QA_KEEP`;
  `--no-prune` skips it); older runs keep only report.json and *.mp4. A run folder holding a file named KEEP is never
  thinned; non-run folders are never touched. Deliverables belong in docs/review (tracked), not qa/output.
- Review frames: `node qa/frames.mjs --at 0.2,1,1.5 [--only phone] [--q dbg=normal]` (pinned playhead, PNG per screen).
- URL switches: `?hud=1` fps readout · `?trace=1` per-frame record in `window.__trace` · `?profile=phone|laptop|desktop`
  · `?at=S` pin the playhead · `?dbg=normal|dust|tag` shading normals / every mote unlit / the ink's āyah tag · `?nosweep` no light pass · `?gateDelay=MS` hold the ink download back · `?backend=webgl2`.
- Phone over the LAN: `FATIHAH_LAN=1 npm run preview -- --host` (HTTPS with v1's cert in `~/.fatihah-tls`).
- Deploy: push to main → `.github/workflows/pages.yml` → jameel7007.github.io/fatihah-v2 (base via `FATIHAH_BASE`;
  runtime URLs through `assetUrl()`).
