// Instruments from day one (rebuild plan, v1 lesson 5).
//   ?trace=1 — window.__trace: one record per frame (time, frame interval, main-thread work,
//              playhead, chapter, request, gate limit, rate) and named events, including every
//              render pipeline the backend creates and whether it was compiled ahead ('async')
//              or on a visible frame ('SYNC' — a hitch). Read by qa/phone-session.mjs.
//   ?hud=1   — a small readout: fps, p95 frame interval, profile, backend, DPR, chapter.

import type { WebGPURenderer } from 'three/webgpu';

export interface TraceFrame {
  at: number;
  dt: number;
  cpu: number;
  s: number;
  ch: number;
  req: number;
  lim: number;
  rate: number;
  ev?: string[];
}

export interface TraceData {
  frames: TraceFrame[];
  events: Array<{ at: number; e: string }>;
}

declare global {
  interface Window {
    __trace?: TraceData;
  }
}

export class Trace {
  readonly on: boolean;
  private pending: string[] = [];
  private readonly data: TraceData = { frames: [], events: [] };

  constructor(query: URLSearchParams) {
    this.on = query.get('trace') !== null;
    if (this.on) window.__trace = this.data;
  }

  mark(e: string): void {
    if (!this.on) return;
    this.pending.push(e);
    this.data.events.push({ at: +performance.now().toFixed(1), e });
  }

  frame(f: Omit<TraceFrame, 'ev'>): void {
    if (!this.on) return;
    const rec: TraceFrame = { ...f };
    if (this.pending.length) {
      rec.ev = this.pending;
      this.pending = [];
    }
    this.data.frames.push(rec);
  }

  /** Name every pipeline creation: async (pre-compiled) or SYNC (built during a visible frame). */
  hookPipelines(renderer: WebGPURenderer): void {
    if (!this.on) return;
    const be = renderer.backend as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const fn of ['createRenderPipeline', 'createComputePipeline']) {
      const orig = be[fn];
      if (typeof orig !== 'function') continue;
      const mark = (e: string): void => this.mark(e);
      be[fn] = function (this: unknown, ...a: unknown[]) {
        const ro = a[0] as { material?: { name?: string; type?: string }; object?: { name?: string; type?: string } } | undefined;
        const kind = fn === 'createComputePipeline' ? 'compute' : a[1] ? 'async' : 'SYNC';
        mark(`pipe:${kind}:${ro?.object?.name || ro?.object?.type || '?'}/${ro?.material?.name || ro?.material?.type || '?'}`);
        return orig.apply(this, a);
      };
    }
  }
}

export class Hud {
  private readonly el: HTMLElement | null;
  private fps = 60;
  private readonly ring: number[] = [];

  constructor(query: URLSearchParams) {
    this.el = query.get('hud') !== null ? document.getElementById('hud') : null;
    if (this.el) this.el.hidden = false;
  }

  update(dt: number, text: string): void {
    if (!this.el || dt <= 0) return;
    this.fps += (1 / dt - this.fps) * 0.05;
    this.ring.push(dt * 1000);
    if (this.ring.length > 180) this.ring.shift();
    const sorted = [...this.ring].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    this.el.textContent = `${Math.round(this.fps)} fps · p95 ${p95.toFixed(1)} ms · ${text}`;
  }
}
