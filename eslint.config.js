// AD-1 — dependency direction, enforced by a lint rule, not by review.
//
//   core/      imports from core/ and ports/ only. No import points outward.
//   adapters/  implement ports/ and may import anything.
//   ui/        may import core/ and ports/, never adapters/.
//   app/       the composition root — the only place that names a concrete adapter.
//
// AD-2 — the core is framework-free and browser-free. No Vue, no DOM, no window,
// document, File, Blob, indexedDB or fetch anywhere under core/. That rule is what
// lets the domain run under Vitest with no browser, and it is why every hard
// constraint of this product — the opaque origin, the absent network, the
// single-file build — is invisible to the code that decides what a Step means.
//
// Cross-layer imports go through the @alias form (see vite.config.js), so the
// specifier itself carries the layer. The relative patterns below close the
// escape hatch of writing ../../adapters/ instead.

import js from '@eslint/js'
import globals from 'globals'
import pluginVue from 'eslint-plugin-vue'

const outward = (...layers) =>
  layers.flatMap((layer) => [`@${layer}`, `@${layer}/*`, `**/${layer}/**`])

// The editor library, which the Editor spike measured and story 5 wired: it is a
// view over a model that owns the truth, and `adapters/vueflow/` is its one
// importer. Written once and reused by every block below, because the same ban
// has to be restated wherever a block declares `no-restricted-imports` — flat
// config replaces a rule's options rather than merging them, so a later block
// that forgot this pattern would quietly lift the ban for its own files.
const vueFlowBan = {
  group: ['@vue-flow/*'],
  message:
    'AD-1: @vue-flow/core is imported in adapters/vueflow/ and nowhere else. It is the GraphView port’s one implementation; everything else receives the canvas as a prop.',
}

const browserBanned = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
  'File',
  'FileReader',
  'Blob',
  'Worker',
  'alert',
  'confirm',
]

export default [
  // Not project content: the BMad install, its outputs, and the spike artefacts
  // that were built to answer a research question and are not maintained code.
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.claude/**',
      '_bmad/**',
      '_bmad-output/**',
      'design-artifacts/**',
    ],
  },

  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],

  // Default: browser code, ES modules.
  {
    files: ['**/*.{js,mjs,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
  },

  // Node-side tooling. The e2e specs run under Node (Playwright drives the
  // browser from outside) and build fixture bytes with Buffer.
  {
    files: ['scripts/**/*.mjs', '*.config.js', 'tests/**/*.js', 'tests/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },

  // Substituted by vite.config.js `define` at compile time, so it is a real
  // global to the linter and a string literal to the artefact (AD-12).
  {
    files: ['app/**/*.js'],
    languageOptions: { globals: { __BUILD_VERSION__: 'readonly' } },
  },

  // ------------------------------------------------- the editor library, anywhere
  //
  // Story 5's acceptance says "no `@vue-flow/core` import exists outside
  // `adapters/vueflow/`", and until this block existed that held by accident of
  // the code rather than by a rule: `core/` banned the package, `ui/` banned
  // adapters, and `app/`, `tests/` and every other adapter were unrestricted.
  // Measured before adding it — a file under `ui/` importing `@vue-flow/core`
  // linted clean, exit 0.
  {
    files: ['**/*.{js,mjs,vue}'],
    ignores: ['adapters/vueflow/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [vueFlowBan] }],
    },
  },

  // ------------------------------------------------------------------ core/
  {
    files: ['core/**/*.js'],
    languageOptions: {
      // Not globals.browser. A reference to `document` here is an undefined
      // variable, which is the second line of defence behind the rule below.
      // TextDecoder/TextEncoder are JS primitives of the WHATWG Encoding
      // standard, present in Node and every engine — the encoding ladder of
      // CAP-2 runs on them in core/types, and AD-2 explicitly allows them.
      globals: { ...globals.es2025, TextDecoder: 'readonly', TextEncoder: 'readonly' },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: outward('adapters', 'ui', 'app'),
              message:
                'AD-1: no import points from core/ outward. Call through a port in ports/ instead.',
            },
            {
              group: ['vue', 'vue/*', '@vue/*', 'echarts', 'echarts/*'],
              message:
                'AD-2: core/ is framework-free. A framework swap must not become an architectural rewrite.',
            },
            vueFlowBan,
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...browserBanned.map((name) => ({
          name,
          message: `AD-2: core/ is browser-free. \`${name}\` belongs behind a port. The domain must run under Vitest with no browser.`,
        })),
      ],
    },
  },

  // -------------------------------------------------------------------- ui/
  {
    files: ['ui/**/*.{js,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: outward('adapters'),
              message:
                'AD-1: ui/ never imports a concrete adapter. Only app/ names one; ui/ receives it through a port.',
            },
            vueFlowBan,
          ],
        },
      ],
    },
  },

  // adapters/ implement ports/ and may import anything — deliberately unrestricted.
  // app/ is the composition root and is the one place that names a concrete adapter.
]
