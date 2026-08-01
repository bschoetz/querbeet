# buildpath-r1-1 — Vite + vite-plugin-singlefile + Vue 3 + workers, from `file://`

Scope note: every claim below is evidenced by a source retrieved 2026-08-01. Where the shipped
source of a package was read directly (plugin 2.3.3, Vite 8.2.0, vue 3.5.40 manifest), that is
marked as such and outranks prose about the same behaviour.

## Claims

### Workers (priority 1)

- [B-1] class=worker confidence=high — Vite's `?worker&inline` import suffix inlines the worker as a base64 string into the bundle instead of emitting a separate chunk, which is the only worker import form compatible with single-file output ("By default, workers emit as separate chunks in production builds. To inline workers as base64 strings, append `&inline`").
    source: https://vite.dev/guide/features | publisher: Vite (official docs, page reports v8.1.5) | published: unknown | accessed: 2026-08-01

- [B-2] class=worker confidence=high — `worker.format` accepts `'es' | 'iife'` and **defaults to `'iife'`**, so Vite's default already produces a *classic* worker; no config change is needed to avoid the module-worker form that fails in Chromium from `file://`. (Setting it explicitly is still recommended as a guard against a future default flip.)
    source: https://vite.dev/config/worker-options | publisher: Vite (official docs, page reports v8.1.5) | published: unknown | accessed: 2026-08-01

- [B-3] class=worker confidence=high — Vite 8.2.0's shipped bundler source constructs inline workers as a `Blob([...])` + object URL, with an explicit `workerType === "classic"` branch emitting `'(self.URL || self.webkitURL).revokeObjectURL(self.location.href);'` as the blob prelude — i.e. under the default `iife` format an inlined worker becomes a **classic worker from a `blob:` URL**, exactly the shape established to work from `file://` in both engines.
    source: https://registry.npmjs.org/vite/-/vite-8.2.0.tgz → `package/dist/node/chunks/node.js:27603` | publisher: Vite (published tarball) | published: 2026-07-30 | accessed: 2026-08-01

- [B-4] class=worker confidence=high — The idiomatic `new Worker(new URL('./w.js', import.meta.url))` form is documented to emit a **separate chunk** in production, and worker detection only fires when `new URL()` is written directly inside the `new Worker()` call with static literal options — so it is both unusable here and brittle to refactor.
    source: https://vite.dev/guide/features | publisher: Vite (official docs) | published: unknown | accessed: 2026-08-01

- [B-5] class=worker confidence=high — **Silent-deletion hazard, read from the plugin's shipped source.** `generateBundle` classifies every `.js`/`.mjs`/`.cjs` chunk into `files.js`, then for each one unconditionally does `bundlesToDelete.push(filename)` and calls `replaceScript(...)`. `replaceScript` is a regex replace against `<script ... src="…<filename>">`; if the HTML contains no such tag — which is exactly the case for a separately-emitted **worker chunk** — the replace is a silent no-op, yet the chunk is still deleted (`deleteInlinedFiles` defaults `true`). The build "succeeds", emits one HTML file, logs a misleading `Inlining: <worker>.js`, and the worker is simply gone at runtime. Only non-JS/CSS/HTML assets reach the honest `NOTE: asset not inlined:` warning.
    source: https://registry.npmjs.org/vite-plugin-singlefile/-/vite-plugin-singlefile-2.3.3.tgz → `package/dist/esm/index.js` (`generateBundle`, `replaceScript`) | publisher: Richard Tallent (published tarball) | published: 2026-04-17 | accessed: 2026-08-01

- [B-6] class=worker confidence=high — The plugin has **no built-in worker support** and none is imminent: issue #100 ("Support Web Worker files (eg. `autocomplete.worker.js?worker` syntax)", opened 2024-07-24, closed 2024-11-03) and PR #115 ("feat: add inline web worker support", opened 2026-02-04) — PR #115 is **still open and unmerged** today, with an unanswered maintainer ping, and 2.3.3 shipped 2026-04-17 without it. The workaround stated in-thread and confirmed working by a commenter is `import(...'?worker&inline')` at the call site; a second commenter objects that this pushes a packaging decision into every call site, which is precisely the maintenance cost the team inherits.
    source: https://github.com/richardtallent/vite-plugin-singlefile/pull/115 and https://github.com/richardtallent/vite-plugin-singlefile/issues/100 | publisher: GitHub issue tracker (richardtallent) | published: 2026-02-04 / 2024-07-24 | accessed: 2026-08-01

- [B-7] class=worker confidence=medium — There is no *other* open issue about workers-plus-this-plugin: a repo-scoped issue search for "worker" returns exactly three results (PR #115 open, issue #100 closed 2024, PR #49 closed 2022). Low traffic, so absence of complaints is weak evidence of correctness rather than strong evidence.
    source: https://api.github.com/search/issues?q=repo:richardtallent/vite-plugin-singlefile+worker | publisher: GitHub API | published: n/a (query result) | accessed: 2026-08-01

### Build configuration (priority 2)

- [B-8] class=config confidence=high — What `_useRecommendedBuildConfig` **actually touches**, read from shipped source: `build.assetsInlineLimit = () => true` (a predicate forcing *every* asset inline, overriding the 4096-byte default — so there is no size ceiling left for the caller to raise), `build.chunkSizeWarningLimit = 100000000`, `build.cssCodeSplit = false`, `base = "./"`, `build.assetsDir = ""`, and on each `build.rollupOptions.output`: `codeSplitting = false` when the *installed Vite major* is ≥ 8, else `inlineDynamicImports = true`. Nothing else.
    source: https://registry.npmjs.org/vite-plugin-singlefile/-/vite-plugin-singlefile-2.3.3.tgz → `package/dist/esm/index.js` | publisher: Richard Tallent (published tarball) | published: 2026-04-17 | accessed: 2026-08-01

- [B-9] class=config confidence=high — Therefore **left to the caller**: `build.target`, `build.minify`, `build.sourcemap`, and `build.modulePreload`. Vite 8's `build.target` defaults to `'baseline-widely-available'` (`chrome111, edge111, firefox114, safari16.4, ios16.4`) and `build.modulePreload` defaults to `{ polyfill: true }`, which "is auto injected into the proxy module of each `index.html` entry" — dead weight in a single-file build. Set `build.modulePreload: { polyfill: false }` explicitly.
    source: https://vite.dev/config/build-options | publisher: Vite (official docs, page reports v8.1.5) | published: unknown | accessed: 2026-08-01

- [B-10] class=config confidence=high — The plugin partially compensates for preload machinery on its own: `replaceScript` rewrites `"?__VITE_PRELOAD__"?` → `void 0` in the inlined code, and the opt-in `removeViteModuleLoader: true` strips Vite's module-loader IIFE via a regex that assumes the loader is the first IIFE inside `<script type="module" crossorigin>`. That regex is explicitly documented in-source as fragile ("Changes to the SCRIPT tag especially could break this again in the future") — treat `removeViteModuleLoader` as a nice-to-have, not a load-bearing setting.
    source: https://registry.npmjs.org/vite-plugin-singlefile/-/vite-plugin-singlefile-2.3.3.tgz → `package/dist/esm/index.js` (`_removeViteModuleLoader`) | publisher: Richard Tallent (published tarball) | published: 2026-04-17 | accessed: 2026-08-01

- [B-11] class=config confidence=medium — `overrideConfig` is applied as `Object.assign(config, overrideConfig)` — a **shallow, top-level** merge executed *after* the recommended settings. Passing `overrideConfig: { build: {...} }` therefore replaces the entire `build` object and silently discards `assetsInlineLimit`, `cssCodeSplit`, `assetsDir` and the code-splitting flag. Only use it for top-level keys such as `base`.
    source: https://registry.npmjs.org/vite-plugin-singlefile/-/vite-plugin-singlefile-2.3.3.tgz → `package/dist/esm/index.js` | publisher: Richard Tallent (published tarball) | published: 2026-04-17 | accessed: 2026-08-01

- [B-12] class=config confidence=high — Forced inlining is not total. The README's own caveats: static resources in `public/` "are not inlined by Vite, and this plugin doesn't do that either" (they are copied beside the HTML and reachable via the relative `base: "./"`), SVG inlining "isn't supported directly by Vite, so it isn't supported directly here either" (needs `vite-svg-loader` or SVG pasted into the template), and "there may be other situations where referenced files aren't inlined by Vite and aren't caught by this plugin either." Fonts and images imported through the module graph are covered by `assetsInlineLimit = () => true`; anything reached through `public/` is not.
    source: https://registry.npmjs.org/vite-plugin-singlefile/-/vite-plugin-singlefile-2.3.3.tgz → `package/README.md` ("Caveats") | publisher: Richard Tallent | published: 2026-04-17 | accessed: 2026-08-01

### Vue (priority 3)

- [B-13] class=vue confidence=high — **Runtime-only is automatic; no flag or alias needed.** `vue@3.5.40`'s manifest sets `"module": "dist/vue.runtime.esm-bundler.js"` and `exports["."].import.default = "./dist/vue.runtime.esm-bundler.js"`. A bundler resolving `import { createApp } from 'vue'` therefore gets the runtime-only build by default; the full build carrying the in-browser template compiler is only reached by an *explicit* alias to `vue/dist/vue.esm-bundler.js`. The action item is negative: make sure no such alias exists, and avoid runtime string templates / `template:` options in components, which would force it back.
    source: https://registry.npmjs.org/vue/latest | publisher: npm registry / Vue core team | published: n/a (dist-tag `latest` = 3.5.40) | accessed: 2026-08-01

- [B-14] class=vue confidence=medium — The plugin's README documents the Vue combination as the canonical example (`plugins: [vue(), viteSingleFile()]`), and the plugin declares `enforce: "post"` so it runs after `@vitejs/plugin-vue` in the build pipeline. No open issue naming `@vitejs/plugin-vue` surfaced. Confidence capped at medium because this is partly absence-of-evidence on a low-traffic tracker.
    source: https://registry.npmjs.org/vite-plugin-singlefile/-/vite-plugin-singlefile-2.3.3.tgz → `package/README.md` + `package/dist/esm/index.js` | publisher: Richard Tallent | published: 2026-04-17 | accessed: 2026-08-01

### `file://` failure modes (priority 4)

- [B-15] class=fileurl confidence=high — README's confirmed-working list for local HTML files: `localStorage`, Persistent Storage APIs, FileSystem API, requests for local files relative to the same folder (explicitly "for Vue, resources from your `public` folder"), images and fonts from external sites, external API calls **only with `{ mode: 'no-cors' }`**, links to sibling files, hash-based SPA routing, WebXR. Broken: History-API routing, cookies, WebXR immersive mode, **Worklets**, sourcemaps. Note the maintainer's own hedge: "I've only tested some of the above in Chromium-based browsers."
    source: https://registry.npmjs.org/vite-plugin-singlefile/-/vite-plugin-singlefile-2.3.3.tgz → `package/README.md` | publisher: Richard Tallent | published: 2026-04-17 | accessed: 2026-08-01

- [B-16] class=fileurl confidence=medium — Dynamic `import()` is folded into the single chunk by the code-splitting flag [B-8], but this is a whole-bundle property: the plugin is emphatic that it produces "*one HTML file* and *no other files*", so multiple HTML entry points are unsupported and such requests are closed `wontfix` (issue #51). Any dependency whose dynamic import cannot be statically resolved by the bundler would remain a runtime `import()` and be blocked from `file://`.
    source: https://registry.npmjs.org/vite-plugin-singlefile/-/vite-plugin-singlefile-2.3.3.tgz → `package/README.md` | publisher: Richard Tallent | published: 2026-04-17 | accessed: 2026-08-01

- [B-17] class=fileurl confidence=medium — `crossorigin` is carried through, not stripped: `replaceScript` preserves the original tag's attributes (`beforeSrc`/`afterSrc` capture groups) when converting `<script src=…>` into an inline `<script>`. On an inline script `crossorigin` is inert, so this is harmless — but it is also the exact string the `removeViteModuleLoader` regex keys on, so the two interact.
    source: https://registry.npmjs.org/vite-plugin-singlefile/-/vite-plugin-singlefile-2.3.3.tgz → `package/dist/esm/index.js` | publisher: Richard Tallent | published: 2026-04-17 | accessed: 2026-08-01

### Maintenance / reproducibility (priority 5)

- [B-18] class=maintenance confidence=high — The peer range is **broad and actively widened**, not tightly pinned: 2.3.3 declares `vite: "^5.4.21 || ^6.0.0 || ^7.0.0 || ^8.0.0"` and `rollup: "^4.59.0"`. Vite 8 support landed in 2.3.1 on 2026-03-15; Vite 8.0 itself is recent enough that the lag was small. Risk is not the range but the *runtime* branch: the plugin reads `version` from `vite` and branches on `viteMajor >= 8`, so a future Vite 9 silently takes the Vite-8 path whether or not that stays correct.
    source: https://registry.npmjs.org/vite-plugin-singlefile (version metadata + `time`) | publisher: npm registry | published: 2.3.3 → 2026-04-17 | accessed: 2026-08-01

- [B-19] class=maintenance confidence=medium — Deprecation on the horizon: Vite 8 documents `build.rollupOptions` as **deprecated, an alias for `build.rolldownOptions`** (same for `worker.rollupOptions` → `worker.rolldownOptions`). The plugin still writes into `config.build.rollupOptions.output`. It works today through the alias, but that is the most likely breakage point at the next Vite major, and the plugin also still declares `rollup` as a peer dependency although Vite 8 bundles with Rolldown.
    source: https://vite.dev/config/build-options and https://vite.dev/config/worker-options | publisher: Vite (official docs) | published: unknown | accessed: 2026-08-01

## Leads

- **PR #115 is the thing to watch.** If merged, worker inlining becomes a plugin-level config concern instead of a per-call-site `?worker&inline` suffix, removing the coupling flagged in [B-6]. It has sat unanswered since 2026-02-04 — worth subscribing to, not worth waiting for.
- **`richardtallent/vite-plugin-singlefile-example`** — the maintainer's own sister test repo, referenced from the README's contributing section. Cheapest possible smoke-test bed for a worker + Vue + `file://` spike before committing.
- **Verify [B-5] empirically, cheaply.** Build once with a `new URL(..., import.meta.url)` worker and once with `?worker&inline`; assert that `dist/` contains exactly one file and that `index.html` contains `Blob(` / `createObjectURL`. This turns the single most dangerous failure mode into a CI assertion. Recommend making "`dist/` has exactly one file" a build-gate, since [B-5] means a broken build is otherwise indistinguishable from a good one.
- Vite 8 docs pages report `v8.1.5` while npm `latest` is `8.2.0` (2026-07-30) — a small docs lag; re-check `worker.format`'s default if a Vite minor changes worker handling.
- Not investigated: whether **Arquero** itself ships or triggers any dynamic `import()`, `new Worker`, or `fetch` path that would break under [B-16]. Worth a targeted check before committing to the stack.

## Looked for and could not find

- The **body and closing rationale of issue #100** — GitHub's unauthenticated API rate-limited mid-run; only the comment thread was retrievable (via `gh`), not the original text or the reason for the 2024-11-03 close. So "closed without built-in support" is inferred from 2.3.3's source containing no worker handling ([B-8]) plus PR #115 still being open, not from a maintainer statement.
- Direct confirmation that Vite's inline-worker wrapper passes `{ type: 'module' }` when `worker.format === 'es'`. The `workerType === "classic"` branch was read in Vite 8.2.0's source ([B-3]); the `es` counterpart was not read in full. This does not affect the recommendation, since the default is already `iife`.
- Any documented statement about whether `build.assetsInlineLimit` as a predicate applies to assets referenced from **CSS `url()`** specifically. The docs mention only a Git-LFS-placeholder exclusion; the plugin's README hedges generically ([B-12]). Treat CSS-referenced assets as needing empirical verification.
- Any open issue reporting an incompatibility between `@vitejs/plugin-vue` and `vite-plugin-singlefile`, or any issue about being stuck on an old Vite version. The tracker is low-volume, so this is weak evidence.
