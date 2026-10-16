// Ink pack loader (R2) — v1's frozen atlases and instance table (unchanged files), with every
// instance's time taken from the R2 ink clock (pen-paths.json, baked by build/build-pen-paths.mjs).
// Builds the GPU lookups exactly as v1 did: a sheet-uv grid (8 instance slots per cell) and a
// packed instance texture, all fixed-point RGBA8 (float32 DataTextures break the physical
// material's pipeline in three r185 WebGPU — v1 bisection, 2026-08-27).

import { ClampToEdgeWrapping, DataTexture, LinearFilter, NearestFilter, NoColorSpace, RGBAFormat, Texture, UnsignedByteType } from 'three/webgpu';
import { assetUrl } from '../core/url.ts';
import { PenTrack } from './pen.ts';
import type { TimedInstance } from './schedule.ts';
import { LightPass } from './sweep.ts';
import timing from './timing.json' with { type: 'json' };

export interface InkPack {
  mtsdf: Texture;
  prog: Texture;
  inst: DataTexture;
  grid: DataTexture;
  gridW: number;
  gridH: number;
  slots: number;
  count: number;
  /** the ink clock's range (seconds) — the shader works in (t − tMin) / (tMax − tMin) */
  tMin: number;
  tMax: number;
  pen: PenTrack;
  /** R3: the light that passes along each āyah once it is written */
  light: LightPass;
}

interface Downloaded {
  instances: { instances: Array<{ order: number; ayah: number; line: number; word: number; kind: string; sheet: [number, number, number, number]; atlas: [number, number, number, number] }>; atlas: [number, number]; rangePx: number };
  pens: { tMin: number; tMax: number; paths: Array<{ order: number; path: Array<[number, number]>; start: number; dur: number }> };
  mtsdf: ImageBitmap;
  prog: ImageBitmap;
}

const GRID_W = 112;
const GRID_H = 144;
const SHEET_W = 0.78;
export const KIND_GLYPH = 0;
export const KIND_MARKER = 255;

export async function downloadInk(): Promise<Downloaded> {
  const bitmap = async (p: string): Promise<ImageBitmap> =>
    createImageBitmap(await (await fetch(assetUrl(p))).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' });
  const [instances, pens, mtsdf, prog] = await Promise.all([
    fetch(assetUrl('text/ink-instances.json')).then((r) => r.json()),
    fetch(assetUrl('text/pen-paths.json')).then((r) => r.json()),
    bitmap('text/ink-mtsdf.png'),
    bitmap('text/ink-prog.png'),
  ]);
  return { instances, pens, mtsdf, prog };
}

export function buildInk(d: Downloaded): InkPack {
  const tex = (img: ImageBitmap): Texture => {
    const t = new Texture(img);
    t.colorSpace = NoColorSpace;
    t.flipY = false; // atlas row 0 = top; sampled with v measured top-down
    t.generateMipmaps = false;
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.wrapS = ClampToEdgeWrapping;
    t.wrapT = ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  };
  const times = new Map(d.pens.paths.map((p) => [p.order, p]));
  const span = d.pens.tMax - d.pens.tMin;
  const unit = (t: number): number => (t - d.pens.tMin) / span;

  const put16 = (buf: Uint8Array, at: number, v01: number): void => {
    const q = Math.max(0, Math.min(65535, Math.round(v01 * 65535)));
    buf[at] = q >> 8;
    buf[at + 1] = q & 255;
  };
  // instance texture, 8 RGBA8 texels per row (v1 layout; rings dropped):
  //  T0 [su0, sv0] T1 [su1, sv1] T2 [au0, av0] T3 [au1, av1] T4 [start, dur] T5 [aaSlope/4096, kind, āyah]
  const INST_TEXELS = 8;
  const list = d.instances.instances;
  const count = list.length;
  const inst = new Uint8Array(count * INST_TEXELS * 4);
  const rowAt = (row: number, texel: number): number => (row * INST_TEXELS + texel) * 4;
  const rects: Array<[number, number, number, number]> = [];
  const timed: TimedInstance[] = [];
  list.forEach((g, i) => {
    const t = times.get(g.order);
    if (!t) throw new Error(`no pen timing for instance ${g.order}`);
    timed.push({ order: g.order, ayah: g.ayah, line: g.line, word: g.word, kind: g.kind, start: t.start, dur: t.dur });
    const [x0, y0, x1, y1] = g.sheet;
    const suA = (x0 + SHEET_W / 2) / SHEET_W;
    const suB = (x1 + SHEET_W / 2) / SHEET_W;
    const su0 = Math.min(suA, suB);
    const su1 = Math.max(suA, suB);
    rects.push([su0, y0, su1, y1]);
    put16(inst, rowAt(i, 0), su0);
    put16(inst, rowAt(i, 0) + 2, y0);
    put16(inst, rowAt(i, 1), su1);
    put16(inst, rowAt(i, 1) + 2, y1);
    put16(inst, rowAt(i, 2), g.atlas[0]);
    put16(inst, rowAt(i, 2) + 2, g.atlas[1]);
    put16(inst, rowAt(i, 3), g.atlas[2]);
    put16(inst, rowAt(i, 3) + 2, g.atlas[3]);
    put16(inst, rowAt(i, 4), unit(t.start));
    put16(inst, rowAt(i, 4) + 2, t.dur / span);
    const cellPxW = (g.atlas[2] - g.atlas[0]) * d.instances.atlas[0];
    const aaSlope = cellPxW / Math.max(1e-6, su1 - su0) / (2 * d.instances.rangePx);
    put16(inst, rowAt(i, 5), Math.min(1, aaSlope / 4096));
    inst[rowAt(i, 5) + 2] = g.kind === 'marker' ? KIND_MARKER : KIND_GLYPH;
    inst[rowAt(i, 5) + 3] = g.ayah; // R3: the light pass finds an āyah's ink by this
  });
  const instTex = new DataTexture(inst, INST_TEXELS, count, RGBAFormat, UnsignedByteType);
  instTex.minFilter = NearestFilter;
  instTex.magFilter = NearestFilter;
  instTex.needsUpdate = true;

  // sheet-uv grid: 8 slots per cell as 16-bit indices in 4 RGBA8 texels; 0xFFFF = empty
  const GRID_TEXELS = 4;
  const grid = new Uint8Array(GRID_W * GRID_TEXELS * GRID_H * 4).fill(255);
  const counts = new Uint8Array(GRID_W * GRID_H);
  let overflow = 0;
  rects.forEach(([su0, sv0, su1, sv1], idx) => {
    for (let cy = Math.max(0, Math.floor(sv0 * GRID_H)); cy <= Math.min(GRID_H - 1, Math.floor(sv1 * GRID_H)); cy++) {
      for (let cx = Math.max(0, Math.floor(su0 * GRID_W)); cx <= Math.min(GRID_W - 1, Math.floor(su1 * GRID_W)); cx++) {
        const c = counts[cy * GRID_W + cx]!;
        if (c >= 8) {
          overflow++;
          continue;
        }
        const at = (cy * GRID_W * GRID_TEXELS + cx * GRID_TEXELS + (c >> 1)) * 4 + (c & 1) * 2;
        grid[at] = idx >> 8;
        grid[at + 1] = idx & 255;
        counts[cy * GRID_W + cx] = c + 1;
      }
    }
  });
  if (overflow > 0) console.warn(`[ink] grid overflow: ${overflow} cell-entries dropped`);
  const gridTex = new DataTexture(grid, GRID_W * GRID_TEXELS, GRID_H, RGBAFormat, UnsignedByteType);
  gridTex.minFilter = NearestFilter;
  gridTex.magFilter = NearestFilter;
  gridTex.needsUpdate = true;

  const paths = new Map(d.pens.paths.map((p) => [p.order, p.path]));
  return {
    mtsdf: tex(d.mtsdf),
    prog: tex(d.prog),
    inst: instTex,
    grid: gridTex,
    gridW: GRID_W,
    gridH: GRID_H,
    slots: 8,
    count,
    tMin: d.pens.tMin,
    tMax: d.pens.tMax,
    pen: new PenTrack(timed, paths),
    light: new LightPass(timing.spans as unknown as ConstructorParameters<typeof LightPass>[0], list),
  };
}
