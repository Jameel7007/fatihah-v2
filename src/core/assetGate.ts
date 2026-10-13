// AssetGate — "a chapter starts only when it is ready" (rebuild plan, v1 lesson 3).
//
// Every chapter declares the assets it shows. An asset goes through three steps, all before the
// chapter can begin: download → build (geometry, materials, textures) → pre-compile (render
// pipelines, against the real render target, never the canvas). Assets are shared: a chapter
// that reuses one only waits for it once. The gate starts every download at boot, but builds and
// compiles in chapter order, so the first chapter is never queued behind the last.

export interface AssetDef<T = unknown> {
  id: string;
  /** network work (fetch + decode); runs in parallel for every asset from boot */
  download: () => Promise<unknown>;
  /** main-thread work: turn the download into scene objects; runs in chapter order */
  build: (data: unknown) => Promise<T> | T;
  /** pipeline compilation for the built objects (the caller targets the beauty pass) */
  compile?: (built: T) => Promise<void>;
}

export type AssetStep = 'queued' | 'downloading' | 'building' | 'compiling' | 'ready' | 'failed';

interface Entry {
  def: AssetDef;
  step: AssetStep;
  downloaded: Promise<unknown>;
  ready: Promise<unknown> | null;
  value?: unknown;
  error?: string;
  ms: { download?: number; build?: number; compile?: number };
  /** seconds from gate creation to ready */
  readyAt?: number;
}

export class AssetGate {
  private readonly entries = new Map<string, Entry>();
  private readonly chapters: string[][];
  private chain: Promise<unknown> = Promise.resolve();
  private readonly t0 = performance.now();
  /** called whenever any asset changes step (HUD, trace, intro progress) */
  onChange: (id: string, step: AssetStep) => void = () => {};
  /** Resolves at a quiet moment for main-thread work (v1 lesson: an attach mid-scroll is a
   *  hitch). Builds and compiles of assets after the first chapter wait for it. */
  quiet: () => Promise<void> = async () => {};

  /** `chapters[k]` lists the asset ids chapter k needs. */
  private readonly firstChapter: Set<string>;

  constructor(defs: AssetDef[], chapters: string[][]) {
    this.chapters = chapters;
    this.firstChapter = new Set(chapters[0] ?? []);
    for (const def of defs) {
      const ms: Entry['ms'] = {};
      const t = performance.now();
      const entry: Entry = { def, step: 'downloading', downloaded: Promise.resolve(), ready: null, ms };
      entry.downloaded = def.download().then((d) => { ms.download = performance.now() - t; return d; });
      entry.downloaded.catch(() => undefined);
      this.entries.set(def.id, entry);
    }
    for (const ids of chapters) for (const id of ids) if (!this.entries.has(id)) throw new Error(`chapter needs unknown asset ${id}`);
  }

  /** Start preparing chapters in order; resolves when all are ready (or one failed). */
  start(): void {
    for (let k = 0; k < this.chapters.length; k++) {
      for (const id of this.chapters[k] ?? []) this.prepare(id);
    }
  }

  private set(id: string, step: AssetStep): void {
    const e = this.entries.get(id)!;
    e.step = step;
    if (step === 'ready') e.readyAt = +((performance.now() - this.t0) / 1000).toFixed(2);
    this.onChange(id, step);
  }

  private prepare(id: string): Promise<unknown> {
    const e = this.entries.get(id)!;
    if (e.ready) return e.ready;
    // builds and compiles are serialized (they share the main thread and the GPU queue)
    e.ready = this.chain = this.chain.then(async () => {
      try {
        const data = await e.downloaded;
        if (!this.firstChapter.has(id)) await this.quiet();
        this.set(id, 'building');
        let t = performance.now();
        const built = await e.def.build(data);
        e.ms.build = performance.now() - t;
        if (e.def.compile) {
          this.set(id, 'compiling');
          t = performance.now();
          await e.def.compile(built);
          e.ms.compile = performance.now() - t;
        }
        e.value = built;
        this.set(id, 'ready');
      } catch (err) {
        e.error = String(err);
        this.set(id, 'failed');
        console.error(`[gate] ${id} failed`, err);
      }
    });
    return e.ready;
  }

  get<T>(id: string): T | undefined {
    return this.entries.get(id)?.value as T | undefined;
  }

  isReady(k: number): boolean {
    return (this.chapters[k] ?? []).every((id) => this.entries.get(id)?.step === 'ready');
  }

  /** The playhead limit for the Timeline: the start of the first chapter that is not ready. */
  limit(): number {
    for (let k = 0; k < this.chapters.length; k++) if (!this.isReady(k)) return k;
    return this.chapters.length;
  }

  /** 0..1 progress of chapter k's assets (for the intro line). */
  progress(k: number): number {
    const ids = this.chapters[k] ?? [];
    if (ids.length === 0) return 1;
    const w: Record<AssetStep, number> = { queued: 0, downloading: 0.1, building: 0.5, compiling: 0.75, ready: 1, failed: 1 };
    return ids.reduce((a, id) => a + w[this.entries.get(id)?.step ?? 'queued'], 0) / ids.length;
  }

  failed(): string | null {
    for (const [id, e] of this.entries) if (e.step === 'failed') return `${id}: ${e.error}`;
    return null;
  }

  /** timing report for the trace / status page */
  report(): Record<string, { step: AssetStep; ms: Entry['ms']; readyAt?: number }> {
    const out: Record<string, { step: AssetStep; ms: Entry['ms']; readyAt?: number }> = {};
    for (const [id, e] of this.entries) out[id] = { step: e.step, ms: e.ms, readyAt: e.readyAt };
    return out;
  }
}
