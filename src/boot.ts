// Entry: the intro is already on screen (index.html). Load the engine; if WebGPU and WebGL2 both
// fail, say so plainly (the designed fallback arrives in R6).
try {
  await import('./main');
} catch (error) {
  console.error('[fatihah v2] startup failed', error);
  const intro = document.getElementById('intro');
  const en = intro?.querySelector('.en');
  if (en) en.textContent = 'This browser cannot draw the manuscript (WebGPU or WebGL2 is needed).';
}
export {};
