import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const dir = (p) => fileURLToPath(new URL(p, import.meta.url))

// The build emits exactly one HTML file, opened by double-click from the local
// filesystem (C-1). `npm run build` chains scripts/assert-single-file.mjs, which
// is where that claim is allowed to fail (AD-18).
export default defineConfig({
  // A file:// page has no server root. Every URL the document contains must be
  // relative or a data: URI (AD-17).
  base: './',

  plugins: [vue(), tailwindcss(), viteSingleFile()],

  resolve: {
    // The layer aliases exist so a cross-layer import is visible in the
    // specifier itself, which is what makes AD-1 lintable rather than reviewable.
    alias: {
      '@core': dir('./core'),
      '@ports': dir('./ports'),
      '@adapters': dir('./adapters'),
      '@ui': dir('./ui'),
      '@app': dir('./app'),
    },
  },

  worker: {
    // Classic scripts from a blob URL are the only worker form measured to work
    // from file:// in both engines. Vite's idiomatic module worker emits a
    // separate chunk, silently breaks the single-file build, and fails at
    // runtime with no build-time signal (AD-15). Import workers as
    // `?worker&inline`; this setting is the other half of that rule.
    format: 'iife',
  },

  build: {
    // Everything inlines. The plugin sets these too; they are repeated here so
    // a reader of this file does not have to know the plugin's defaults.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    reportCompressedSize: false,

    // Vite otherwise injects a modulepreload polyfill that walks
    // `<link rel="modulepreload">` and calls `fetch(el.href)`. In a single-file
    // build there is nothing to preload, so the code is dead — but it is real
    // `fetch(` in the artefact, and AD-17 does not have an exception for dead
    // code. The one-file assertion caught this on the first build; leave it off.
    modulePreload: false,
  },
})
