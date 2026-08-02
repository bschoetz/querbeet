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

  // Node-side tooling.
  {
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: { globals: globals.node },
  },

  // ------------------------------------------------------------------ core/
  {
    files: ['core/**/*.js'],
    languageOptions: {
      // Not globals.browser. A reference to `document` here is an undefined
      // variable, which is the second line of defence behind the rule below.
      globals: globals.es2025,
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
              group: ['vue', 'vue/*', '@vue/*', '@vue-flow/*', 'echarts', 'echarts/*'],
              message:
                'AD-2: core/ is framework-free. A framework swap must not become an architectural rewrite.',
            },
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
          ],
        },
      ],
    },
  },

  // adapters/ implement ports/ and may import anything — deliberately unrestricted.
  // app/ is the composition root and is the one place that names a concrete adapter.
]
