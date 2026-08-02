import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

const dir = (p) => fileURLToPath(new URL(p, import.meta.url))

// AD-27 — core/ is tested under Vitest with no browser. The built artefact is
// tested under Playwright from a file:// URL, which is a separate envelope and
// not configured here yet.
//
// `environment: 'node'` is the assertion, not a convenience: if a core test ever
// needs a DOM, AD-2 has been broken somewhere upstream of the test.
export default defineConfig({
  resolve: {
    alias: {
      '@core': dir('./core'),
      '@ports': dir('./ports'),
      '@adapters': dir('./adapters'),
      '@ui': dir('./ui'),
      '@app': dir('./app'),
    },
  },
  test: {
    environment: 'node',
    include: ['core/**/*.test.js', 'ports/**/*.test.js'],
  },
})
