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
- `src/core/assetGate.ts`: each chapter lists its assets (`CHAPTER_ASSETS`); download → build → pre-compile
  (against `grade.passTarget`, never the canvas) before the playhead may enter.
- `src/core/profile.ts`: phone / laptop / desktop, chosen once at boot, never changed mid-session.
- The scroll track height in index.html must equal Σ chapter scroll + 1 (qa/track.test.ts).

## How to run
- `npm run dev` (4530) · `npm run build` · `npm run preview` (4531) · `npm test`
- Phone harness: `npm run build && node qa/phone-session.mjs [--desktop] [--webgl2] [--record]`
  (headless Brave at 390×660@3, cold load, real scroll gestures; checks jumps, skips, SYNC compiles, the gate).
- URL switches: `?hud=1` fps readout · `?trace=1` per-frame record in `window.__trace` · `?profile=phone|laptop|desktop`
  · `?at=S` pin the playhead · `?gateDelay=MS` hold the ink download back · `?backend=webgl2`.
- Phone over the LAN: `FATIHAH_LAN=1 npm run preview -- --host` (HTTPS with v1's cert in `~/.fatihah-tls`).
- Deploy: push to main → `.github/workflows/pages.yml` → jameel7007.github.io/fatihah-v2 (base via `FATIHAH_BASE`;
  runtime URLs through `assetUrl()`).
