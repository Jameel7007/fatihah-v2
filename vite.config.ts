import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Phone review over the LAN (FATIHAH_LAN=1): HTTPS on every interface so a phone gets a secure
// context (WebGPU needs one off localhost). The self-signed cert is v1's, outside the repo.
const lan = process.env.FATIHAH_LAN === '1';
const tlsDir = process.env.FATIHAH_TLS_DIR ?? resolve(process.env.HOME ?? '', '.fatihah-tls');
const lanServer = lan ? { host: true, https: { key: readFileSync(resolve(tlsDir, 'key.pem')), cert: readFileSync(resolve(tlsDir, 'cert.pem')) } } : {};

export default defineConfig({
  // GitHub Pages serves the site from /fatihah-v2/; the deploy workflow sets FATIHAH_BASE.
  base: process.env.FATIHAH_BASE ?? '/',
  build: { target: 'es2022' },
  // one three instance across three / three/webgpu / three/tsl (v1 gotcha)
  resolve: { dedupe: ['three'] },
  optimizeDeps: { exclude: ['three'] },
  server: { ...lanServer },
  preview: { ...lanServer },
});
