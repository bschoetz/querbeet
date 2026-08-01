import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  // Classic (IIFE) workers: a module worker from a blob URL fails in Chromium.
  worker: { format: 'iife' },
})
