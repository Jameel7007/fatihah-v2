// Renderer boot (carried over from v1): WebGPURenderer with the WebGL2 fallback forced by
// ?backend=webgl2 or used automatically where WebGPU is unavailable. MSAA 4× either way.
// The grade pass applies AgX itself; see world/grade.ts.

import { AgXToneMapping, SRGBColorSpace, WebGPURenderer } from 'three/webgpu';

export type Backend = 'webgpu' | 'webgl2';

export async function createRenderer(canvas: HTMLCanvasElement, opts: { forceWebGL: boolean; dpr: number }): Promise<{ renderer: WebGPURenderer; backend: Backend }> {
  const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL: opts.forceWebGL });
  renderer.toneMapping = AgXToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  await renderer.init();
  const be = (renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
  const backend: Backend = be?.isWebGPUBackend === true ? 'webgpu' : 'webgl2';
  renderer.setPixelRatio(opts.dpr);
  return { renderer, backend };
}
