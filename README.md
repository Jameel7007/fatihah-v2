# Al-Fātiḥah — v2 (in progress)

Sūrat al-Fātiḥah, the opening chapter of the Qurʾān, written on a parchment in the dark — verse by
verse, with a reed pen — and then raised into gold. This is the second version of
[the Al-Fātiḥah manuscript](https://jameel7007.github.io/fatihah-manuscript/), rebuilt for more motion
and to feel smooth on a phone. Live (work in progress): <https://jameel7007.github.io/fatihah-v2/>

**Status:** milestone R1 of R6. The foundations (R0) and the opening (R1) are in: a parchment in the
dark, a warm light with gold dust in its beam, a slow push-in, and a camera that travels with the roll as
it opens. The writing, the verse-by-verse transitions and the rise into gold arrive in R2–R4. Progress: [`docs/status.html`](docs/status.html).

## How it works, in plain words

- **Scrolling chooses the moment; time plays it.** The piece is a row of chapters. Scrolling asks for a
  chapter, and the animation plays at its own calm pace. A fast flick makes it play a little faster —
  it never jumps or skips.
- **Nothing appears before it is ready.** Each chapter lists what it needs (images, shapes, shader
  programs). Those are downloaded, built and prepared before the chapter may begin, so nothing freezes
  mid-scroll. If the reader arrives early, the page waits quietly.
- **One quality setting per device.** A phone, a laptop and a desktop each get a fixed budget, chosen
  once when the page opens, so the picture never changes quality while you watch.

## The text

The Arabic is the ʿUthmānic text in the reading of Ḥafṣ ʿan ʿĀṣim (Tanzil project), with the Basmalah
counted as the first āyah. Every build checks it letter for letter against the pinned source
(`build/verify-text.mjs`). The hand is Amiri Quran by Khaled Hosny (SIL Open Font License).

## Running it

```bash
npm install
npm run dev
```

Open <http://localhost:4530>. Add `?hud=1` for a frame-rate readout. `npm test` runs the timeline checks;
`npm run build && node qa/phone-session.mjs` runs the scripted phone session.

Made by Thomas Mooney (@Jameel7007). Three.js r185 (WebGPU, with a WebGL2 fallback).
