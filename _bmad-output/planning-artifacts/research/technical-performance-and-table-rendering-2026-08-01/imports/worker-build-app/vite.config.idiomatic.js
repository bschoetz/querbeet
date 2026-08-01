import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
export default defineConfig({
  plugins: [viteSingleFile()],
  worker: { format: 'iife' },
  build: {
    modulePreload: { polyfill: false },
    outDir: 'dist-idiomatic',
    rollupOptions: { input: 'index-idiomatic.html' },
  },
})
