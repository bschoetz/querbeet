# D1 — Delivery and footprint (round 1, pass 1)

Research run 2026-08-01. Dimension: what actually ships, what actually loads from `file://`, what it weighs.

Two classes of evidence below:
- **retrieved** — documentation, spec text, package registries, source of published packages, fetched this run.
- **measured** — executed this run on this machine: real CDN downloads (`curl` + `wc -c` + `gzip -9`) and a real `file://` capability probe run in headless Chromium 150 and headless Firefox 153. The probe HTML and results are reproducible; the probe file is at `/tmp/claude-1000/-home-n-to-Github-querbeet/95899c7b-f273-4d0e-a5c7-76fc76d58314/scratchpad/ftest/t.html` (scratchpad, ephemeral).

---

## Claims

### The `file://` question (Q1)

- [D1-1] class=compat confidence=high — A `file://` page has opaque origin (`window.origin === "null"`) in both engines, but **is a secure context** (`isSecureContext === true`), so secure-context-gated APIs (Web Crypto, storage APIs, File System Access) are not blocked by the origin alone.
  source: measured locally — probe page `t.html` run under `chromium --headless --dump-dom` and `firefox --headless` with `browser.dom.window.dump.enabled` | publisher: this run (Chromium 150.0.7871.186 / Firefox 153.0.1, Arch Linux) | published: 2026-08-01 | accessed: 2026-08-01

- [D1-2] class=compat confidence=high — **Inline `<script>` classic scripts work** from `file://` in both Chromium 150 and Firefox 153. Result key `inline_classic=OK` in both.
  source: measured locally (same probe) | publisher: this run | published: 2026-08-01 | accessed: 2026-08-01

- [D1-3] class=compat confidence=high — **Classic `<script src="sibling.js">` in the same directory works** from `file://` in both engines (`classic_src_sibling=OK` in Chromium 150 and Firefox 153). Classic script loading is the documented legacy exception to CORS.
  source: measured locally; corroborated by @domenic in whatwg/html#8121 characterising classic scripts as "legacy exceptions" to the same-origin policy | publisher: this run + WHATWG | published: 2026-08-01 / issue opened 2022-07-21 | accessed: 2026-08-01

- [D1-4] class=compat confidence=high — **THE KEY FINDING: an *inline* `<script type="module">` executes fine from `file://`** in both Chromium 150 and Firefox 153 (`inline_module=OK` in both). An inline module is never fetched, so there is no request to fail CORS on. The blanket folklore "modules don't work on file://" is wrong as stated — it is true only for modules that *fetch something*.
  source: measured locally (probe key `inline_module`) | publisher: this run | published: 2026-08-01 | accessed: 2026-08-01

- [D1-5] class=compat confidence=high — **`<script type="module" src="./mod.mjs">` is BLOCKED** from `file://` in both engines. Chromium and Firefox both fire the `error` event on the tag (`module_src_sibling=BLOCKED/error-event`). Module scripts are fetched in CORS mode; the opaque `file://` origin cannot pass.
  source: measured locally | publisher: this run | published: 2026-08-01 | accessed: 2026-08-01

- [D1-6] class=compat confidence=high — **Dynamic `import()` of a same-directory file is BLOCKED** from `file://` in both engines. Chromium: `TypeError: Failed to fetch dynamically imported module: file:///…`. Firefox: `TypeError: error loading dynamically imported module: file:///…`. Same outcome, different message.
  source: measured locally (probe key `dynamic_import_sibling`) | publisher: this run | published: 2026-08-01 | accessed: 2026-08-01

- [D1-7] class=compat confidence=high — **Import maps are parsed and applied from `file://`, but are useless there.** An inline `<script type="importmap">` mapping `"bare/" → "./"` resolved the bare specifier correctly in both engines; the subsequent module fetch then failed with the same "error loading dynamically imported module: file:///…" as [D1-6]. So the importmap mechanism is not blocked — the module *fetch* it points at is.
  source: measured locally (probe key `importmap_bare`) | publisher: this run | published: 2026-08-01 | accessed: 2026-08-01

- [D1-8] class=compat confidence=high — **`fetch()` of a same-directory file is BLOCKED** from `file://` in both engines. Chromium: `TypeError: Failed to fetch`. Firefox: `TypeError: NetworkError when attempting to fetch resource.` This matches the Fetch spec, which declines to define file URL fetching at all: *"For now, unfortunate as it is, file: URLs are left as an exercise for the reader. When in doubt, return a network error."*
  source: measured locally + https://fetch.spec.whatwg.org/ ("scheme fetch", `"file"` switch case) | publisher: this run + WHATWG Fetch Living Standard | published: living standard, retrieved 2026-08-01 | accessed: 2026-08-01

- [D1-9] class=compat confidence=high — **Web Workers from a `blob:` URL (classic) WORK** from `file://` in both Chromium 150 and Firefox 153 (`worker_blob_classic=OK`). This is the escape hatch for keeping a 100k-row transform off the main thread in a single-file app.
  source: measured locally | publisher: this run | published: 2026-08-01 | accessed: 2026-08-01

- [D1-10] class=compat confidence=high — **Web Workers from a `data:text/javascript,…` URI (classic) WORK** from `file://` in both engines (`worker_data_uri=OK`).
  source: measured locally | publisher: this run | published: 2026-08-01 | accessed: 2026-08-01

- [D1-11] class=compat confidence=high — **ENGINE DIVERGENCE: a *module-type* worker from a blob URL (`new Worker(blobUrl, {type:'module'})`) works in Firefox 153 but FAILS in Chromium 150.** Firefox: `worker_blob_module=OK:hi-mod`. Chromium: `worker_blob_module=ERR` (error event fired, no message). This is the only behavioural difference the probe found between the two engines. Practical rule: **construct workers as classic, not module**, and the same code runs on both.
  source: measured locally | publisher: this run | published: 2026-08-01 | accessed: 2026-08-01

- [D1-12] class=compat confidence=high — **`new Worker('./sibling.js')` (a worker from a same-directory file URL) FAILS in both engines**, with different failure modes: Chromium *throws synchronously* — `Failed to construct 'Worker': Script at 'file:///…' cannot be accessed from origin 'null'`; Firefox constructs the object and fires an `error` event instead. Code that only guards the constructor with try/catch will look like it works in Firefox and then silently do nothing.
  source: measured locally (probe key `worker_same_dir_file`) | publisher: this run | published: 2026-08-01 | accessed: 2026-08-01

- [D1-13] class=compat confidence=medium — **`new Function()` is available** from `file://` in both engines when no CSP is set (`new_Function=OK`). Nothing about the `file://` scheme itself imposes a CSP. Confidence medium only because a single-file app that later adds a `<meta http-equiv="Content-Security-Policy">` would change this by its own choice.
  source: measured locally | publisher: this run | published: 2026-08-01 | accessed: 2026-08-01

- [D1-14] class=compat confidence=medium — MDN's Modules guide still states the blanket rule: *"if you try to load the HTML file locally (i.e., with a `file://` URL), you'll run into CORS errors due to JavaScript module security requirements. You need to do your testing through a server."* This is correct for the multi-file case the guide describes but **does not distinguish the inline-module case** measured in [D1-4]. Treat MDN as confirming [D1-5]/[D1-6], not as contradicting [D1-4].
  source: https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/javascript/guide/modules/index.md (lines 411, 1004) | publisher: MDN / Mozilla | published: file last modified 2026-04-04 (per GitHub commits API) | accessed: 2026-08-01

- [D1-15] class=compat confidence=medium — Allowing module scripts over `file://` is an **open, unresolved** WHATWG HTML issue (whatwg/html#8121, opened 2022-07-21). The thread records the Chromium error text *"Cross origin requests are only supported for protocol schemes: http, data, chrome, chrome-extension, chrome-untrusted, https"* and @domenic's position that new platform features must comply with CORS without exception. No browser-engineer commitment to change it. **Plan for this restriction to persist.**
  source: https://github.com/whatwg/html/issues/8121 | publisher: WHATWG | published: 2022-07-21, still open at access | accessed: 2026-08-01

### Vue 3 distribution builds (Q2)

- [D1-16] class=version confidence=high — **Vue 3.5.40** is the current `latest` on npm, published **2026-07-16**. (jsDelivr resolves `vue@3` → 3.5.40.)
  source: https://registry.npmjs.org/vue + https://data.jsdelivr.com/v1/packages/npm/vue/resolved?specifier=3 | publisher: npm / jsDelivr | published: 2026-07-16 | accessed: 2026-08-01

- [D1-17] class=build confidence=high — Vue ships four browser-relevant builds. Per `packages/vue/README.md` in vuejs/core: `vue.global.js` / `vue.global.prod.js` — *"For direct use via `<script src="...">` in the browser"*, *"includes both the compiler and the runtime so it supports compiling templates on the fly"*. `vue.runtime.global.js` — same loading, *"contains only the runtime and requires templates to be pre-compiled"*. `vue.esm-browser.js` / `vue.runtime.esm-browser.js` — *"For usage via native ES modules imports (in browser via `<script type="module">`)"*. `vue.esm-bundler.js` / `vue.runtime.esm-bundler.js` — for webpack/rollup/parcel.
  source: https://raw.githubusercontent.com/vuejs/core/main/packages/vue/README.md | publisher: Vue core team | published: unknown (main branch, retrieved this run) | accessed: 2026-08-01

- [D1-18] class=build confidence=high — **The global build is the one that survives `file://`.** It is loaded with a classic `<script src>` ([D1-3] measured OK) or can be inlined outright ([D1-2]). The `esm-browser` builds are loaded exactly the way [D1-5] measures as blocked; the importmap pattern Vue documents is exactly [D1-7]. Vue's own Quick Start says so explicitly: *"If you directly open the above `index.html` in your browser, you will find that it throws an error because ES modules cannot work over the `file://` protocol, which is the protocol the browser uses when you open a local file."* and *"Due to security reasons, ES modules can only work over the `http://` protocol… we need to serve the `index.html` over the `http://` protocol, with a local HTTP server."*
  source: https://vuejs.org/guide/quick-start.html | publisher: Vue.js docs | published: unknown (current docs) | accessed: 2026-08-01
  NOTE: Vue's statement is about the *external-URL* ESM pattern it documents. It does not contradict [D1-4]; a fully-inlined module has nothing to fetch.

- [D1-19] class=csp confidence=low — **Could not evidence a CSP claim from Vue's own docs.** Neither `packages/vue/README.md` nor the Quick Start page contains any sentence mentioning CSP, Content Security Policy, `unsafe-eval`, or `new Function` (checked explicitly, both returned nothing). My prior belief — that the in-browser template compiler compiles templates to render functions via `new Function` and therefore requires `unsafe-eval` — is **unverified this run** and must be flagged as such until a primary source is found. See Leads.
  source: absence in https://raw.githubusercontent.com/vuejs/core/main/packages/vue/README.md and https://vuejs.org/guide/quick-start.html | publisher: Vue core team / Vue docs | published: n/a | accessed: 2026-08-01

### Alpine.js delivery (Q3)

- [D1-20] class=version confidence=high — **Alpine.js 3.15.12** is current `latest`, published **2026-04-30**. `@alpinejs/csp` is versioned in lockstep: also **3.15.12**, published 2026-04-30 (three seconds after the main package — same release pipeline, so the CSP build is actively maintained, not abandoned).
  source: https://registry.npmjs.org/alpinejs + https://registry.npmjs.org/@alpinejs/csp | publisher: npm | published: 2026-04-30 | accessed: 2026-08-01

- [D1-21] class=build confidence=high — Alpine's standard delivery is `<script defer src="…/alpinejs@3/dist/cdn.min.js">` — a **classic script**, therefore in the `file://`-safe class per [D1-3], and inlinable per [D1-2]. The `dist/cdn.min.js` file downloaded this run is a plain non-module script.
  source: measured (downloaded https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js, HTTP 200) | publisher: this run / jsDelivr | published: 2026-08-01 | accessed: 2026-08-01
  CAVEAT: I did **not** run an actual Alpine app from `file://` this run. The inference is from the delivery mechanism ([D1-3] measured), not from an end-to-end Alpine test.

- [D1-22] class=csp confidence=high — Alpine's directive evaluator does use eval-class code: *"Alpine doesn't use `eval()` directly. Instead, it uses Function declarations, which are much better, but still violate 'unsafe-eval'."* The CSP-safe alternative is the `@alpinejs/csp` package, delivered the same way: `<script defer src="https://cdn.jsdelivr.net/npm/@alpinejs/csp@3.x.x/dist/cdn.min.js"></script>`.
  source: https://alpinejs.dev/advanced/csp | publisher: Alpine.js docs | published: unknown (current docs) | accessed: 2026-08-01

- [D1-23] class=csp confidence=high — **The CSP build costs real expressiveness.** Per the same page it does *not* support complex expressions (arrow functions, destructuring, template literals), does *not* give access to globals (`console`, `document`, `window`, `Math`, `JSON`), and does not support `x-html`. It does support basic operations, object/array literals, method calls and simple assignments — i.e. logic must move into `x-data` component objects. The page presents it as a standard offering with no experimental/unstable caveat.
  source: https://alpinejs.dev/advanced/csp | publisher: Alpine.js docs | published: unknown | accessed: 2026-08-01
  RELEVANCE: For a `file://` app with no CSP meta tag, [D1-13] says `new Function` is available, so **the plain build is fine and the CSP build is not needed** unless the project chooses to impose a CSP on itself.

### The build path (Q4)

- [D1-24] class=version confidence=high — **`vite-plugin-singlefile` 2.3.3**, published **2026-04-17**. Release cadence from the registry: 2.0.3 (2024-11-03), 2.1.0 (2024-12-08), 2.2.0 (2025-03-10), 2.2.1 (2025-07-02), 2.3.0 (2025-07-02), 2.3.1 (2026-03-15), 2.3.2 (2026-03-15), 2.3.3 (2026-04-17). **Maintained** — roughly quarterly, most recent release ~3.5 months old, and it already declares Vite 8 support (`peerDependencies: { rollup: "^4.59.0", vite: "^5.4.21 || ^6.0.0 || ^7.0.0 || ^8.0.0" }`) against Vite 8.2.0 published 2026-07-30. Repo: github.com/richardtallent/vite-plugin-singlefile.
  source: https://registry.npmjs.org/vite-plugin-singlefile (full metadata document) | publisher: npm | published: 2026-04-17 | accessed: 2026-08-01

- [D1-25] class=build confidence=high — **The plugin's emitted single file DOES contain `<script type="module">`.** Confirmed by reading the published tarball's `dist/esm/index.js` (vite-plugin-singlefile 2.3.3): it contains a replacement whose pattern is `<script type="module" crossorigin>\s*)\(function(?: polyfill)?\(\)\s*\{[\s\S]*?\}\)\(\)` and whose replacement is `'<script type="module">'`. So Vite's normal `<script type="module" crossorigin src=…>` tag is what the plugin operates on; it inlines the code into the tag and strips the `crossorigin` attribute and the modulepreload polyfill IIFE. The output is an **inline** module script.
  source: measured — downloaded https://registry.npmjs.org/vite-plugin-singlefile/-/vite-plugin-singlefile-2.3.3.tgz, extracted, grepped `package/dist/esm/index.js` | publisher: this run / richardtallent | published: package 2026-04-17 | accessed: 2026-08-01

- [D1-26] class=build confidence=high — **That output nonetheless works from `file://`, because [D1-4] holds: an inline module script is never fetched.** This resolves the apparent contradiction between "the plugin emits type=module" and the plugin's own claim of double-click operation. The condition is that *everything* is inlined — any surviving `import` of a sibling file, any dynamic `import()`, or any `crossorigin src=` reintroduces [D1-5]/[D1-6] and breaks it.
  source: synthesis of [D1-4] (measured) and [D1-25] (measured) | publisher: this run | published: 2026-08-01 | accessed: 2026-08-01

- [D1-27] class=build confidence=high — The plugin inlines *"all JavaScript and CSS resources directly into the final `dist/index.html` file"* and *"will automatically adjust your vite configuration to allow assets to be combined into a single file"*. Reading the published `dist/esm/index.js` confirms it touches `assetsInlineLimit`, `cssCodeSplit`, and `inlineDynamicImports` (all three symbols appear in the shipped code) — so the caller does **not** have to set those by hand.
  source: package README + measured grep of `package/dist/esm/index.js` in the 2.3.3 tarball | publisher: richardtallent | published: 2026-04-17 | accessed: 2026-08-01

- [D1-28] class=build confidence=high — The README explicitly targets this use case: *"this can be very handy for offline web applications — apps bundled into a single HTML file that you can double-click and open directly in your web browser, no server needed."* It is a **strict** single-file plugin: *"it creates one HTML file and no other files… this either will not work or will not be optimized for apps that require multiple 'entry points' (HTML files). Issues opened requesting multiple entry points will be closed as `wontfix`."*
  source: README.md inside vite-plugin-singlefile-2.3.3.tgz | publisher: richardtallent | published: 2026-04-17 | accessed: 2026-08-01

- [D1-29] class=build confidence=high — The README's stated `file://` limitations: **does not work** — SPA routing via the Web History API; cookies (*"passed via HTTP headers, which don't exist for `file:///` URIs"*); WebXR immersive mode; worklets; sourcemaps (*"useless, since inlining happens after they are generated"*). **Does work** — `localStorage`, Persistent Storage APIs, FileSystem API, requests for images/fonts from external sites, requests to external APIs (*"requires `{ mode: 'no-cors' }` in your fetch call"*), following links to files in the same folder.
  source: README.md inside vite-plugin-singlefile-2.3.3.tgz | publisher: richardtallent | published: 2026-04-17 | accessed: 2026-08-01

- [D1-30] class=build confidence=high — **The README contains one claim that my measurement CONTRADICTS.** It lists as working: *"Requests for local files relative to the same folder (i.e., for Vue, resources from your `public` folder)"*. Measured: `fetch('./sib.js')` from `file://` fails in **both** Chromium 150 (`TypeError: Failed to fetch`) and Firefox 153 (`NetworkError when attempting to fetch resource`) — see [D1-8]. Do not plan on loading a sibling data/config file at runtime. Everything the app needs must be inlined, or come from a user-chosen `<input type="file">` / drag-and-drop (which is a different, permitted path).
  source: README.md claim vs. measured probe key `fetch_sibling` | publisher: richardtallent vs. this run | published: 2026-04-17 vs. 2026-08-01 | accessed: 2026-08-01

- [D1-31] class=build confidence=low — **Alternatives that emit classic (non-module) scripts were not investigated this run** (Vite `build.lib` with `formats: ['iife']`, `build.rollupOptions.output.format`, or non-Vite single-file bundlers). Given [D1-26] the need may be moot, but see Leads.
  source: n/a — not searched | publisher: n/a | published: n/a | accessed: 2026-08-01

### Measured sizes (Q5)

All downloaded 2026-08-01 from jsDelivr; `raw` = `wc -c` of the fetched file, `gzip` = `gzip -9 -c | wc -c`. Versions resolved via the jsDelivr data API and npm registry the same run.

- [D1-32] class=size confidence=high — **Vue 3.5.40 global build (with in-browser template compiler)** — `vue.global.prod.js`: **raw 165,599 B / gzip 60,312 B**.
  source: https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js (resolved vue@3.5.40) | publisher: measured this run | published: 2026-07-16 | accessed: 2026-08-01

- [D1-33] class=size confidence=high — **Vue 3.5.40 runtime-only global** — `vue.runtime.global.prod.js`: **raw 106,947 B / gzip 40,361 B**. The in-browser compiler therefore costs **~58.7 KB raw / ~20.0 KB gzip**.
  source: https://cdn.jsdelivr.net/npm/vue@3/dist/vue.runtime.global.prod.js | publisher: measured this run | published: 2026-07-16 | accessed: 2026-08-01

- [D1-34] class=size confidence=high — Vue 3.5.40 ESM browser builds, for comparison (not `file://`-usable as external imports, [D1-5]): `vue.esm-browser.prod.js` **raw 170,432 / gzip 61,981**; `vue.runtime.esm-browser.prod.js` **raw 108,998 / gzip 41,023**.
  source: https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js and …/vue.runtime.esm-browser.prod.js | publisher: measured this run | published: 2026-07-16 | accessed: 2026-08-01

- [D1-35] class=size confidence=high — **Alpine.js 3.15.12** — `dist/cdn.min.js`: **raw 46,346 B / gzip 16,703 B**.
  source: https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js (resolved 3.15.12) | publisher: measured this run | published: 2026-04-30 | accessed: 2026-08-01

- [D1-36] class=size confidence=high — **@alpinejs/csp 3.15.12** — `dist/cdn.min.js`: **raw 61,522 B / gzip 20,284 B**. The CSP build is *larger* than the standard build (+15.2 KB raw / +3.6 KB gzip) — it ships its own expression parser instead of delegating to `Function`.
  source: https://cdn.jsdelivr.net/npm/@alpinejs/csp@3/dist/cdn.min.js | publisher: measured this run | published: 2026-04-30 | accessed: 2026-08-01

- [D1-37] class=size confidence=high — **petite-vue 0.4.1** — `dist/petite-vue.iife.js`: **raw 16,901 B / gzip 7,082 B**. IIFE format = classic script = `file://`-safe by [D1-3].
  source: https://cdn.jsdelivr.net/npm/petite-vue/dist/petite-vue.iife.js | publisher: measured this run | published: **2022-01-18** | accessed: 2026-08-01
  FRESHNESS FLAG: petite-vue's latest release is **4.5 years old** (0.4.1, 2022-01-18). Far outside every freshness bar. Treat as unmaintained absent evidence to the contrary.

- [D1-38] class=size confidence=high — **Preact 10.29.7 + htm 3.1.1** — `preact.umd.js` **raw 11,481 / gzip 4,876**; `preact/hooks` UMD **raw 3,800 / gzip 1,597**; `htm/dist/htm.js` (UMD, verified IIFE-wrapped) **raw 1,265 / gzip 685**. **Combined for a hooks-based app: raw 16,546 B / gzip ~7,158 B.** (`preact.min.js` alone is raw 11,360 / gzip 4,848 — but it is the ESM/module variant; the **UMD** files are the classic-script ones you need for `file://`.)
  source: https://cdn.jsdelivr.net/npm/preact/dist/preact.umd.js, …/preact/hooks/dist/hooks.umd.js, https://cdn.jsdelivr.net/npm/htm/dist/htm.js | publisher: measured this run | published: preact 2026-07-08, htm 2022-04-26 | accessed: 2026-08-01
  FRESHNESS FLAG: htm 3.1.1 is from 2022-04-26 — stable/finished rather than abandoned is plausible for a 1.2 KB library, but it is unverified this run.

- [D1-39] class=size confidence=high — **Lit 3.3.3** — the bundled classic-script distribution `lit-all.min.js`: **raw 29,370 B / gzip 10,222 B**. Sourced from the `lit/dist` GitHub repo via jsDelivr's `gh` endpoint, *not* from npm — the npm `lit` package ships ES modules only, so a `file://` app must use this prebuilt bundle (or bundle it itself).
  source: https://cdn.jsdelivr.net/gh/lit/dist@3/all/lit-all.min.js | publisher: measured this run | published: lit npm latest 3.3.3 on 2026-05-14; the `gh` bundle's own date not verified | accessed: 2026-08-01
  CAVEAT: I verified the file's content begins with the Lit license header and Lit source, but did **not** verify that `lit/dist@3` tracks 3.3.3 exactly.

- [D1-40] class=size confidence=high — **VanJS (vanjs-core) 1.6.1** — `src/van.js`: **raw 4,988 B / gzip 1,777 B**. Note the commonly cited `public/van-latest.min.js` path **404s** on jsDelivr for 1.6.1; the package now ships only `src/van.js`, `src/van.debug.js` and typings. Measured file is the unminified `src/van.js` (its own header says it deliberately uses `let` over `const` to shrink the bundle) — a minifier would take it lower.
  source: https://cdn.jsdelivr.net/npm/vanjs-core@1.6.1/src/van.js; file listing from https://data.jsdelivr.com/v1/packages/npm/vanjs-core@1.6.1 | publisher: measured this run | published: 2026-07-16 | accessed: 2026-08-01

- [D1-41] class=size confidence=high — **Arquero 8.0.3** — `dist/arquero.min.js`: **raw 236,290 B / gzip 73,583 B**. Verified UMD (file begins `!function(t,e){"object"==typeof exports&&…define.amd?define(["exports"],e):e((t=…globalThis…).aq={})`), so it exposes global `aq` under a classic script and is `file://`-safe by [D1-3]. **Arquero is the single largest item in the budget — larger than Vue's full global build.**
  source: https://cdn.jsdelivr.net/npm/arquero/dist/arquero.min.js (resolved 8.0.3) | publisher: measured this run | published: 2025-05-29 | accessed: 2026-08-01
  FRESHNESS FLAG: Arquero 8.0.3 is ~14 months old. Within the "landscape ≤12 months" bar only marginally; not necessarily a problem for a stable data library, but worth a maintenance check.

- [D1-42] class=size confidence=high — **Total budget, gzipped, UI + Arquero** (Arquero 73.6 KB gzip in every row): Vue global 60.3 → **133.9 KB**; Vue runtime-only global 40.4 → **114.0 KB**; Alpine 16.7 → **90.3 KB**; Alpine CSP 20.3 → **93.9 KB**; petite-vue 7.1 → **80.7 KB**; Preact+hooks+htm 7.2 → **80.8 KB**; Lit 10.2 → **83.8 KB**; VanJS 1.8 → **75.4 KB**; vanilla 0 → **73.6 KB**. **The spread across every UI candidate is ~58 KB gzip, and Arquero alone is 55–100% of the total in every scenario.** Raw (uncompressed) byte size is what actually matters for a double-clicked `file://` HTML file — there is **no transfer encoding**, so gzip figures are informational only. Raw totals: Vue global + Arquero = **401,889 B (~393 KB)**; Alpine + Arquero = **282,636 B (~276 KB)**; VanJS + Arquero = **241,278 B (~236 KB)**.
  source: arithmetic over [D1-32]…[D1-41], all measured this run | publisher: this run | published: 2026-08-01 | accessed: 2026-08-01

---

## Leads

- **Vue + CSP / `unsafe-eval`, primary source needed.** [D1-19] is an evidence gap, not a negative finding. Chase: `packages/compiler-core` / `compiler-dom` source in vuejs/core for `new Function`; the Vue Security guide (vuejs.org/guide/best-practices/security.html); `app.config.compilerOptions` API docs; and any `csp` label in vuejs/core issues. Low practical stakes for this decision given [D1-13] (no CSP is imposed on a `file://` page unless the app imposes one), but it decides whether "use the runtime-only build + precompiled templates" is ever forced.
- **Does the plugin path actually need Vue's global build at all?** If `vite-plugin-singlefile` + `@vitejs/plugin-vue` precompiles SFC templates, the app ships `vue.runtime` and saves the 20 KB gzip / 58.7 KB raw compiler ([D1-33]). Worth confirming end-to-end: build a hello-world Vue SFC app with the plugin, double-click the output, confirm it renders. **That single experiment would validate the whole delivery path** and is cheap.
- **`build.target` / browser-support interaction.** Not examined. Vite 8 defaults may emit syntax that is fine everywhere modern, but the plugin README's silence on `build.target` plus [D1-25]'s modulepreload-polyfill stripping suggests reading `_useRecommendedBuildConfig` in the repo's `index.ts` directly.
- **`vite-plugin-singlefile` issue tracker** — not read this run. Specifically search its issues for `file://`, `CORS`, `worker`, `web worker`. If the app wants a worker, does the plugin inline worker chunks, or does it emit a separate `.js` file (which would break single-file *and* break `file://` per [D1-12])? **This is the highest-value unresolved risk.**
- **Worker strategy under a bundler.** [D1-9]/[D1-11] say: blob URL + **classic** worker is the portable construction. Vite's `new Worker(new URL('./w.js', import.meta.url), {type:'module'})` idiom is exactly the combination that fails in Chromium ([D1-11]) *and* points at a separate file ([D1-12]). Check whether `vite-plugin-singlefile` handles this or whether the app must hand-roll `new Worker(URL.createObjectURL(new Blob([codeString])))`.
- **Alpine end-to-end on `file://`** — [D1-21] is an inference from delivery mechanism, not a run. Cheap to verify alongside the Vue experiment.
- **petite-vue maintenance status** ([D1-37]): 4.5 years without a release. Check the repo for commit activity / an archive notice before this is treated as a live option.
- **Arquero maintenance** ([D1-41]) and whether a smaller alternative would move the total budget meaningfully — it is the dominant term.
- **Chromium `--allow-file-access-from-files`** — out of scope here (a non-technical double-clicker will not pass flags), but worth one line in the writeup so nobody proposes it as a fix.

## Looked for and could not find

- **Any statement about CSP, `unsafe-eval`, or `new Function` in Vue's own documentation.** Explicitly checked `vuejs/core/packages/vue/README.md` and `vuejs.org/guide/quick-start.html`; both returned nothing on those terms. Not evidence that Vue's compiler is CSP-safe — evidence that these two pages do not discuss it.
- **A named browser-engineer commitment (crbug / Bugzilla number) on `file://` module scripts.** whatwg/html#8121 quotes the Chromium error string and @domenic's spec position but contains no linked crbug or Bugzilla ID and no Blink/Gecko/WebKit engineer statement in the portion retrieved. I could not evidence a *stated intention* by any vendor to change the behaviour — only that the current behaviour is as [D1-5]/[D1-6] measure.
- **Firefox-specific documentation** of the `file://` module restriction. Firefox's behaviour is measured here ([D1-1]–[D1-13]) but I did not retrieve a Mozilla document or Bugzilla entry describing it. MDN's blanket statement ([D1-14]) is engine-agnostic.
- **A `vite-plugin-singlefile` changelog or release notes.** The published tarball contains only `README.md`, `package.json`, `LICENSE` and `dist/`. Release dates in [D1-24] come from npm registry `time` metadata, not from notes describing what changed.
- **The plugin's own docs/issues on `file://` script types.** The README asserts double-click operation ([D1-28]) but never mentions `type="module"`; I established the module-script fact by reading the shipped code ([D1-25]) instead. The GitHub issue tracker was not read (budget).
- **A minified VanJS distribution.** The widely-referenced `public/van-latest.min.js` path 404s for vanjs-core@1.6.1; the package file listing shows no `public/` directory and no `.min.js` at all ([D1-40]).
- **Confirmation that `lit/dist@3` on jsDelivr corresponds to lit 3.3.3.** The bundle downloaded and is genuine Lit, but the version correspondence is unverified ([D1-39]).
- **Alternatives to `vite-plugin-singlefile` that emit classic scripts** ([D1-31]). Not searched — budget exhausted before this question.

## Method note / limitations

- Browser probe ran on **Chromium 150.0.7871.186** and **Firefox 153.0.1**, both *newer* than the brief's floor (Chrome 143+, Firefox 145+). Behaviour at 143/145 specifically is **not** measured; for these long-standing security invariants regression between 143 and 150 is implausible but unverified.
- Chromium was run with `--headless --no-sandbox --disable-gpu --virtual-time-budget=6000`; `--no-sandbox` affects process isolation, not URL-scheme security policy, and no `--allow-file-access-from-files` flag was passed. Firefox ran `--headless` with a fresh profile, `browser.dom.window.dump.enabled=true`. Neither run used a custom CSP.
- WebKit/Safari was **not** tested — no engine available on this machine. All two-engine claims above should read "Chromium and Gecko"; Safari is an open gap.
- Sizes are raw CDN artifacts, not what a bundler would emit after tree-shaking. For the plugin path, real single-file output size will differ (lower for tree-shakable ESM inputs like Lit/Preact/Vue-runtime, roughly equal for Alpine/Arquero which ship as prebuilt bundles).
