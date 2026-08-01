import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// R2's build rules, unchanged: one file out, no module preload polyfill, IIFE
// workers. The build is gated on "dist/ contains exactly one file" by the
// driver, because build success does not imply a working artefact on this path.
export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  worker: { format: 'iife' },
  build: { modulePreload: { polyfill: false } },
})
