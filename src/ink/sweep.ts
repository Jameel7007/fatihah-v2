// The light pass (R3): after each āyah is written, a soft band of light travels along its words —
// right to left, line by line, the way it is read. Pure function of the ink clock, computed on
// the CPU from the āyah's extent on each line; the parchment draws it (world/parchment.ts).
//
// No three.js imports: unit-tested directly by node.

import { LIGHT_AT, LIGHT_DUR, type AyahSpan } from './schedule.ts';

export interface SweepSample {
  /** sheet x of the band's centre, and the line's y-range on the page */
  x: number;
  yLo: number;
  yHi: number;
  ayah: number;
  /** 0..1 strength (fades in, out, and through each line's ends) */
  amp: number;
}

interface Segment { xR: number; xL: number; yLo: number; yHi: number; len: number }

const smooth = (k: number): number => k * k * (3 - 2 * k);
const clamp01 = (k: number): number => Math.min(1, Math.max(0, k));
const NONE: SweepSample = { x: 0, yLo: 0, yHi: 0, ayah: 0, amp: 0 };

export class LightPass {
  private readonly ayat: Array<{ start: number; segs: Segment[]; total: number; ayah: number }> = [];

  constructor(spans: readonly AyahSpan[], instances: ReadonlyArray<{ ayah: number; line: number; sheet: [number, number, number, number] }>) {
    for (const sp of spans) {
      const segs: Segment[] = [];
      for (let line = sp.lines[0]; line <= sp.lines[1]; line++) {
        const r = instances.filter((g) => g.ayah === sp.ayah && g.line === line).map((g) => g.sheet);
        if (r.length === 0) continue;
        const xL = Math.min(...r.map(([x0, , x1]) => Math.min(x0, x1)));
        const xR = Math.max(...r.map(([x0, , x1]) => Math.max(x0, x1)));
        segs.push({ xR, xL, yLo: Math.min(...r.map(([, y0]) => y0)), yHi: Math.max(...r.map(([, , , y1]) => y1)), len: xR - xL });
      }
      this.ayat.push({ start: sp.w1 + LIGHT_AT, segs, total: segs.reduce((a, g) => a + g.len, 0), ayah: sp.ayah });
    }
  }

  at(t: number): SweepSample {
    const a = this.ayat.find((x) => t >= x.start && t <= x.start + LIGHT_DUR);
    if (!a || a.total <= 0) return NONE;
    const k = clamp01((t - a.start) / LIGHT_DUR);
    let along = smooth(k) * a.total;
    for (const g of a.segs) {
      if (along <= g.len || g === a.segs[a.segs.length - 1]) {
        const local = Math.min(along, g.len);
        // fade through each line's ends (the band wraps to the next line at its right end)
        const ends = smooth(clamp01(local / 0.03)) * smooth(clamp01((g.len - local) / 0.03));
        const env = Math.sin(Math.PI * k) ** 0.6;
        return { x: g.xR - local, yLo: g.yLo, yHi: g.yHi, ayah: a.ayah, amp: env * ends };
      }
      along -= g.len;
    }
    return NONE;
  }
}
