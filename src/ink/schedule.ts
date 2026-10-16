// The writing schedule (R2): v1's per-glyph timings (in v1 scroll units p) rescaled into the
// INK CLOCK — seconds of authored time that run continuously through the seven āyah chapters.
//
// Each āyah keeps v1's internal rhythm (the §17 pacing: letters, word gaps, marks flicked in after
// their word), scaled by K seconds per unit of p, plus the time the pen needs to travel between
// strokes that do not join. Around it the āyah gets room to breathe:
//   PRE  — the pen settles before the first letter (LEAD for āyah 1: the camera comes down first)
//   write — D_a (computed by buildTiming; build/build-pen-paths.mjs bakes it into spans.json)
//   TAIL — the pen lifts, the rosette blooms petal by petal, the last letters dry
// Chapter a spans the ink clock [W0_a − PRE_a, W0_a + D_a + TAIL]; the next one begins exactly
// there, so the ink, the pen and the camera are continuous across every boundary.
//
// No three.js imports: unit-tested directly by node.

/** v1 ink-instances.json → windows (p), frozen with the composition (qa/ink.test.ts checks them) */
export const WINDOWS: ReadonlyArray<readonly [number, number]> = [
  [0.32, 0.352],
  [0.356, 0.389],
  [0.393, 0.42],
  [0.424, 0.451],
  [0.455, 0.488],
  [0.492, 0.522],
  [0.526, 0.58],
];

export const K = 70; // seconds of ink clock per unit of v1 p — āyāt write in 2.8–5.1 s (āyah 7, ten words: 10 s)
export const TRAVEL_V = 0.6; // the pen crosses between strokes at 60 cm/s (a quick lift) …
export const TRAVEL_MIN = 0.02; // … plus a beat to lift and set down
export const LINE_TRAVEL = 1.1; // a line break: the pen lifts and returns to the right margin
export const LEAD = 4.0; // āyah 1: the camera comes down from the reading view to the nib before the first letter
export const PRE = 2.2; // R3: the camera settles from its breath onto the next line, the pen travels there
export const BLOOM_DELAY = 0.25; // after the last letter, before the rosette opens
export const BLOOM = 1.3; // the rosette blooms petal by petal
// R3 — the breath after each āyah (seconds after its last letter):
export const LIGHT_AT = 0.5; // a soft light passes along the words just written …
export const LIGHT_DUR = 1.8; // … right to left, line by line
export const WORDS_AT = 1.2; // the translation appears on its own beat
export const BREATH_UP = [0.6, 2.8] as const; // the camera lifts to show the page so far
export const TAIL = 3.2; // the chapter ends here: lifted, lit, translated, still
export const WET_S = 2.4; // how long a stroke stays wet after the pen passes (v1: Δp 0.045)
export const WRITTEN_S = 5.5; // the placeholder chapter after āyah 7 (the camera rises over the page)

export interface AyahSpan {
  ayah: number;
  /** the composition lines it is written on, and its extent on the page (sheet x, y) */
  lines: [number, number];
  box: [number, number, number, number];
  /** ink clock at the chapter's start and end */
  t0: number;
  t1: number;
  /** first letter, and the end of the last letter */
  w0: number;
  w1: number;
  /** the rosette's bloom */
  bloom0: number;
}

export interface TimedInstance {
  order: number;
  ayah: number;
  line: number;
  word: number;
  kind: string;
  /** ink clock (seconds) */
  start: number;
  dur: number;
}

export interface Timing {
  spans: AyahSpan[];
  instances: TimedInstance[];
  tMin: number;
  tMax: number;
}

interface V1Instance { order: number; ayah: number; line: number; word: number; kind: string; start: number; dur: number; sheet?: [number, number, number, number] }

/** v1 timing (p) + pen paths → the ink clock. Within an āyah v1's rhythm is kept (gaps × K)
 *  except where the next stroke begins away from where the last one ended: there the pen gets
 *  the time to travel. Markers leave the writing and bloom in the āyah's tail. */
export function buildTiming(v1: V1Instance[], paths: Map<number, Array<[number, number]>>): Timing {
  const spans: AyahSpan[] = [];
  const instances: TimedInstance[] = [];
  let w0 = 0;
  for (let a = 1; a <= WINDOWS.length; a++) {
    const strokes = v1.filter((g) => g.ayah === a && g.kind !== 'marker').sort((x, y) => x.start - y.start);
    let cursor = 0;
    let prevEndV1 = strokes[0]?.start ?? 0;
    let prevPt: [number, number] | null = null;
    let prevLine = strokes[0]?.line ?? 0;
    for (const g of strokes) {
      const path = paths.get(g.order) ?? [[0, 0]];
      const first = path[0]!;
      const gapV1 = Math.max(0, g.start - prevEndV1) * K;
      const jump = prevPt ? Math.hypot(first[0] - prevPt[0], first[1] - prevPt[1]) : 0;
      const travel = g.line !== prevLine ? Math.max(LINE_TRAVEL, TRAVEL_MIN + jump / TRAVEL_V) : jump > 0.002 ? TRAVEL_MIN + jump / TRAVEL_V : 0;
      const start = cursor + Math.max(gapV1, travel);
      const dur = g.dur * K;
      instances.push({ order: g.order, ayah: a, line: g.line, word: g.word, kind: g.kind, start: w0 + start, dur });
      cursor = start + dur;
      prevEndV1 = g.start + g.dur;
      prevPt = path[path.length - 1]!;
      prevLine = g.line;
    }
    const d = cursor;
    const pre = a === 1 ? LEAD : PRE;
    const mine = v1.filter((x) => x.ayah === a);
    const lines: [number, number] = [Math.min(...mine.map((x) => x.line)), Math.max(...mine.map((x) => x.line))];
    const rects: Array<[number, number, number, number]> = mine.map((x) => x.sheet ?? [0, 0, 0, 0]);
    const box: [number, number, number, number] = [
      Math.min(...rects.map(([x0, , x1]) => Math.min(x0, x1))),
      Math.min(...rects.map(([, y0]) => y0)),
      Math.max(...rects.map(([x0, , x1]) => Math.max(x0, x1))),
      Math.max(...rects.map(([, , , y1]) => y1)),
    ];
    const span: AyahSpan = { ayah: a, lines, box, t0: w0 - pre, t1: w0 + d + TAIL, w0, w1: w0 + d, bloom0: w0 + d + BLOOM_DELAY };
    spans.push(span);
    for (const g of v1.filter((x) => x.ayah === a && x.kind === 'marker')) {
      instances.push({ order: g.order, ayah: a, line: g.line, word: g.word, kind: g.kind, start: span.bloom0, dur: BLOOM });
    }
    w0 = w0 + d + TAIL + (a < WINDOWS.length ? PRE : 0);
  }
  const tMin = spans[0]!.t0;
  const tMax = spans[spans.length - 1]!.t1 + WRITTEN_S;
  return { spans, instances, tMin, tMax };
}
