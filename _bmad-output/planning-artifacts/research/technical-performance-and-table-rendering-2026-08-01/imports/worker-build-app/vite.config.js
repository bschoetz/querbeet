import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// R2's build rules verbatim: one file out, no module-preload polyfill, IIFE
// workers. The point of this app is that it is the first querbeet build to
// contain an actual Worker — the Editor spike's build has none, so rule 1 has
// never been exercised end to end.
export default defineConfig({
  plugins: [viteSingleFile()],
  worker: { format: 'iife' },
  build: { modulePreload: { polyfill: false } },
})
