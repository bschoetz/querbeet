import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

const dir = (p) => fileURLToPath(new URL(p, import.meta.url))

const alias = {
  '@core': dir('./core'),
  '@ports': dir('./ports'),
  '@adapters': dir('./adapters'),
  '@ui': dir('./ui'),
  '@app': dir('./app'),
}

// AD-27 — three test envelopes, and which code runs in which is the rule.
//
//   core/ ports/ adapters/  Vitest, environment 'node'. No DOM.
//   ui/                     Vitest, environment 'happy-dom'. Components only.
//   the built artefact      Playwright, from a real file:// URL, both engines.
//
// The two Vitest envelopes are separate projects rather than one config with a
// DOM switched on, and that separation is the point: `environment: 'node'` for
// core/ is an assertion, not a convenience. If a core test ever needs a DOM,
// AD-2 has been broken somewhere upstream of the test, and a shared environment
// would hide it.
//
// The ui/ project was added 2026-08-02 (R10) for one specific reason: a Vue
// template's own execution — a `v-if`, a `:disabled` binding, an interpolated
// German label — exists only inside a render function. State derivation belongs
// in core/ and is the first move for any ui/ gap; but pushing conditional
// rendering into core/ would mean rebuilding Vue there, against AD-2's reason
// for existing. The trigger was RowWindow.vue's paging controls, reachable only
// above 571,428 rows and therefore not by any affordable e2e fixture.
//
// WHAT HAPPY-DOM DOES NOT DO, verified by reading its source rather than its
// docs, which are silent on all of it:
//
//   ResizeObserver          observe/unobserve/disconnect are empty stubs.
//   getBoundingClientRect   always returns an all-zero DOMRect.
//   scrollTop, scrollLeft,  genuine settable/gettable properties. A test can
//   scrollHeight, scrollWidth   set them and read them back.
//
// So a component test here can drive a scroll offset, and cannot assert layout
// or a resize. Do not debug an observer that "should" fire in this envelope —
// it never will. A ui/ component whose untested branch genuinely needs real
// geometry goes to Playwright Component Testing instead (built into the
// @playwright/test this project already carries); that is R10's named upgrade
// path, not a second thing to decide from scratch.
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'core',
          environment: 'node',
          // adapters/ is included because an adapter is framework-free code
          // behind a port; only the built artefact needs Playwright (AD-27).
          //
          // scripts/ is here for one file and for one reason: AD-18's gate is
          // the *only* enforcement AD-17 has, and its reject path had no test at
          // all — it was evidenced by prose about a manual probe, and an
          // exception added to it turned out to excuse a real dynamic import
          // standing beside acorn's error message. The pure scans behind the
          // gate now live in `scripts/artifact-scan.mjs` and are asserted here.
          // It widens the envelope's *directory* list, not its rule: this is
          // node tooling with no DOM in it, which is what `environment: 'node'`
          // asserts.
          include: [
            'core/**/*.test.js',
            'ports/**/*.test.js',
            'adapters/**/*.test.js',
            'scripts/**/*.test.js',
          ],
        },
      },
      {
        plugins: [vue()],
        resolve: { alias },
        test: {
          name: 'ui',
          environment: 'happy-dom',
          include: ['ui/**/*.test.js'],
        },
      },
    ],
  },
})
