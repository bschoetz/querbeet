# Digest — D1 / Vue 3 integration, frozen data, runtime fetches, a11y — round 1, assistant 2

Brief: how the virtualizer candidates actually meet Vue 3; whether they tolerate frozen,
non-reactive row data (load-bearing); whether anything is fetched at runtime (disqualifying
under file://); ARIA semantics for a grid whose rows are mostly absent from the DOM.
Budget: 4 sources, 10 tool calls. Returned 2026-08-01.

### Findings

1. **TanStack Virtual's Vue adapter accepts a plain (non-reactive) options object; `MaybeRef` means a ref is optional, not required.** The adapter's source wraps options in `computed(() => ({...defaults, ...unref(options)}))`, so a plain object passes through `unref` unchanged. `{source: https://raw.githubusercontent.com/TanStack/virtual/main/packages/vue-virtual/src/index.ts, publisher: TanStack (GitHub), publication date: main branch as of 2026-08-01, accessed: 2026-08-01, confidence: high, class: capability}`

2. **The TanStack Vue adapter watches options *shallowly*, not deeply.** The base composable uses `watch(() => unref(options), fn, { immediate: true })` with no `deep: true`, so it reacts to reference replacement only and never traverses into the data. `{source: same as (1), publisher: TanStack, date: 2026-08-01 snapshot, accessed: 2026-08-01, confidence: high, class: capability}`

3. **The TanStack Vue adapter never reads the row data array at all — it consumes `count`, `estimateSize`, `getScrollElement` and manages offsets/rects.** Row data is indexed by the consumer inside the render loop, outside the library. `{source: same as (1), publisher: TanStack, accessed: 2026-08-01, confidence: high, class: capability}`

4. **`@tanstack/vue-virtual` is actively released: latest 3.13.35, published 2026-07-28, with six releases between 2026-06-26 and 2026-07-28.** The Vue adapter version-bumps in lockstep with `@tanstack/virtual-core` 3.17.7 (same publish timestamp), i.e. the adapter is not lagging the core. `{source: https://registry.npmjs.org/@tanstack%2Fvue-virtual, publisher: npm registry, date: 2026-07-28, accessed: 2026-08-01, confidence: high, class: version}`

5. **`@tanstack/vue-virtual` has exactly one runtime dependency (`@tanstack/virtual-core`), peer `vue ^2.7.0 || ^3.0.0`, and exports only `.` and `./package.json` — no CSS export, no style field.** `{source: same as (4), publisher: npm registry, accessed: 2026-08-01, confidence: high, class: version}`

6. **`virtua` 0.50.0 was published 2026-07-25 and is a single multi-framework package with a `./vue` export, zero runtime dependencies, and peer deps for React/Vue/Solid/Svelte/Angular.** Release cadence over the last ~5 months is regular (0.48.8 -> 0.50.0). It is still pre-1.0. `{source: https://registry.npmjs.org/virtua, publisher: npm registry, date: 2026-07-25, accessed: 2026-08-01, confidence: high, class: version}`

7. **`virtua`'s Vue entry is `virtua/vue` and its `VList` takes a `data` prop (the items array) plus a slot receiving `{ item, index }` — i.e. unlike TanStack it does own the array.** `{source: https://github.com/inokawa/virtua, publisher: inokawa (GitHub README), accessed: 2026-08-01, confidence: high, class: capability}`

8. **`virtua`'s README advertises ~3kB and mentions no CSS file, web worker, WASM, or dynamic import.** `{source: same as (7), publisher: inokawa, accessed: 2026-08-01, confidence: medium (absence in README is weaker than reading the bundle), class: capability}`

9. **`vue-virtual-scroller` is alive again: 3.0.4 published 2026-05-20, after 3.0.0 on 2026-04-23 — the long-dormant v2 line was superseded this spring. Peer dep `vue ^3.3.0`.** `{source: https://registry.npmjs.org/vue-virtual-scroller, publisher: npm registry, date: 2026-05-20, accessed: 2026-08-01, confidence: high, class: version}`

10. **`vue-virtual-scroller` ships a stylesheet and exposes it as a package export (`./dist/vue-virtual-scroller.css`), unlike the other two candidates.** `{source: same as (9), publisher: npm registry, accessed: 2026-08-01, confidence: high, class: capability}`

11. **`vue-virtual-scroller`'s own documentation explicitly recommends frozen / non-reactive item arrays for large lists:** freeze the array passed to `items` with `Object.freeze` (Options API), and in Composition API do *not* wrap it in `ref()`/`computed()`/`reactive()`, "which allows Vue to skip making the list responsive to changes". This is the only candidate with an explicit documented frozen-data blessing. `{source: https://github.com/Akryum/vue-virtual-scroller (README, surfaced via search), publisher: Akryum, accessed: 2026-08-01, confidence: medium — text is near-verbatim from the README but the README page was not fetched directly, class: capability}`

12. **Vue's reactivity system cannot proxy frozen objects: anything for which `Object.isFrozen` is true, or which carries the `__v_skip` flag set by `markRaw`, is skipped by `reactive()`.** This means a `Object.freeze`d dataset is structurally immune to accidental deep-reactivity conversion even if a library passes it to `reactive()`. `{source: search synthesis over Vue reactivity source commentary incl. https://segmentfault.com/a/1190000040953963 and vuejs/rfcs discussion #357, publisher: various, accessed: 2026-08-01, confidence: medium — consistent across sources and matches Vue's documented `markRaw` semantics, but not verified against vuejs.org this run, class: platform-behaviour}`

13. **ARIA APG explicitly covers the virtualized case:** "If there are conditions where some rows or columns are hidden or not present in the DOM, e.g., data is dynamically loaded when scrolling...", then `aria-rowcount`/`aria-colcount` are "set to the total number of columns or rows, respectively" and `aria-rowindex`/`aria-colindex` are "set to the position of a cell within a row or column". `{source: https://www.w3.org/WAI/ARIA/apg/patterns/grid/, publisher: W3C WAI ARIA Authoring Practices Guide, accessed: 2026-08-01, confidence: high, class: standards}`

14. **APG names a known unsolved keyboard problem specific to virtualization:** "If navigation functions can dynamically add more rows or columns to the DOM, key events that move focus to the beginning or end of the grid, such as Control + End, may move focus to the last row in the DOM rather than the last available row in the back-end data." `{source: same as (13), publisher: W3C WAI APG, accessed: 2026-08-01, confidence: high, class: standards}`

15. **APG does not mandate `role="grid"` over `role="table"` for a read-only data table.** It frames the choice as a focus-management difference worth considering for tabular content, not a requirement. `{source: same as (13), publisher: W3C WAI APG, accessed: 2026-08-01, confidence: high, class: standards}`

16. **Sticky headers inside a virtualized table have a documented, recurring failure mode: the sticky element cannot escape a `<table>` whose body contains only the visible rows, so the header can disappear on scroll.** TanStack Virtual has an issue on exactly this (#640, "Sticky header ... disappears when scrolling"), and the community pattern is to place the `position: sticky` header in a container *outside* the virtualized row area and add its height to the total measured size. `{source: https://github.com/TanStack/virtual/issues/640 and TanStack sticky-header guidance, publisher: TanStack (GitHub), accessed: 2026-08-01, confidence: medium — issue title and pattern summary seen, not the full thread, class: platform-behaviour}`

### Frozen-data verdict per candidate

- **TanStack Virtual (`@tanstack/vue-virtual`) — safe, strongest evidence.** The adapter never receives or touches the row array; it takes `count` (a number), `estimateSize`, `getScrollElement`, and returns virtual items with `index`/`start`/`size`. Options may be a plain object (`MaybeRef`, unwrapped via `unref`), and the internal watch is shallow. A `Object.freeze`d array held in a `shallowRef` (or in a plain module-scope binding) outside Vue's reactivity is fully compatible; only `count` needs to be reachable, and it can be a getter. Source: adapter source, findings (1)-(3).
- **`vue-virtual-scroller` — safe, and explicitly documented for exactly this case.** Its docs tell you to freeze the `items` array (Options API) or to avoid `ref`/`reactive` wrapping (Composition API) for large lists. The trade-off is stated in its own issue tracker: with a non-reactive array, mutations like `splice` do not propagate — you must replace the array reference. Finding (11); caveat from issue #866 (title only, not read in depth).
- **`virtua` (`virtua/vue`) — probably fine, could not establish directly.** `VList` takes the array as a Vue prop (`:data`), and Vue props do not require the passed value to be reactive; a frozen array passed as a prop renders fine and Vue cannot proxy it anyway (finding 12). But no documentation or issue confirming frozen/`markRaw` data was found, and the Vue adapter source was not read to check for a `deep` watch on `data`. **Could not establish** whether `virtua/vue` deep-watches its `data` prop.
- **Other Vue-3 virtualizers surfaced (VueUse `useVirtualList`, Quasar `QVirtualScroll`, PrimeVue `VirtualScroller`, Vuestic `VaVirtualScroller`) — not investigated.** They surfaced in search only; no primary-source verification this run. VueUse `useVirtualList` is the one worth a follow-up since it is headless and dependency-free, but note it takes the list as a `MaybeRef` and its watch depth was not verified.

### Runtime-fetch verdict per candidate

- **`@tanstack/vue-virtual` — no runtime fetch found.** Package exports are only `.` and `./package.json`; no `style` field, no CSS export, single dependency on `@tanstack/virtual-core` (also dependency-free, no CSS). It is a pure-JS, styles-are-yours library: you supply the transform/absolute positioning inline. No evidence of workers, WASM, or dynamic `import()`. Confidence: medium-high — established from package metadata and the adapter source, not from a bundle audit.
- **`virtua` — no runtime fetch found, weaker evidence.** Zero runtime dependencies; exports are per-framework JS entries only; README mentions no CSS/worker/WASM. `lib/index.js` was not inspected for dynamic `import()`. Confidence: medium.
- **`vue-virtual-scroller` — ships a stylesheet, which is the one thing to watch.** `./dist/vue-virtual-scroller.css` is a real package export and its docs require importing it. Under Vite + a single-file build this is normally inlined into a `<style>` tag rather than fetched, so it is not automatically disqualifying — but it is the one candidate where a build misconfiguration would leave a `file://`-broken `<link>`. Whether that CSS references any `url()` asset (font/sprite) **could not be established**.
- **None of the three showed evidence of a web worker or WASM.** For all three, absence of dynamic `import()` is **not established** — the shipped bundles were not read. The cheap definitive check is local: build once and grep the emitted single file for `import(`, `fetch(`, `new Worker`, `.wasm`, and `url(` outside data URIs.

### Leads worth chasing

1. **Read `virtua`'s Vue adapter source** for `watch(..., { deep: true })` on `data` and whether it stores `data` in `ref` vs `shallowRef`. This is the single unresolved fatal-risk question among the three.
2. **VueUse `useVirtualList`** — headless, zero-dep; check whether its `list` argument is `MaybeRefOrGetter` and whether it deep-watches. Cheapest possible adoption if it holds up.
3. **TanStack Virtual issue #640 and the sticky-header pattern** — read the thread fully before committing to `position: sticky` `<th>` inside the scroll container; the safe layout (header outside the virtualized area, `stickyHeight` added to total size) may force a div-grid rather than a real `<table>`, which then collides with the ARIA work in finding (13).
4. **Column virtualization at 20-50 columns** — TanStack Virtual supports a second horizontal virtualizer, but 50 columns x ~30 visible rows = 1500 cells, which may not need it. Worth measuring before adding the complexity, since horizontal virtualization is what breaks `aria-colindex` and sticky first columns.
5. **`content-visibility: auto` + `contain-intrinsic-size` as a no-library alternative** — nothing sourcing its interaction with virtualization was found this run; deserves its own MDN/spec pass.

### What I looked for and could not find

- **Any documentation, issue, or discussion in TanStack Virtual or `virtua` that names `Object.freeze`, `markRaw`, or `shallowRef` for row data.** The TanStack answer had to be derived from reading the adapter source rather than from documented guidance. Only `vue-virtual-scroller` documents the frozen-data case explicitly — the least "modern" of the three candidates is the one with the clearest statement on the load-bearing question.
- **Any source on CSS `content-visibility` / `contain` interacting with virtualization or with sticky headers.** The targeted search returned nothing on `content-visibility` at all. Reported as a genuine gap, not as "no interaction exists".
- **Any evidence about `file://` behaviour of these specific libraries.** No candidate's documentation mentions `file://`, CSP, or offline single-file builds. The `file://` risk assessment above is inferred from package metadata, not from anyone having tried it.
- **Screen-reader field reports on virtualized grids** (what NVDA/JAWS/VoiceOver actually announce when `aria-rowcount` is 100000 but 30 rows are in the DOM). APG specifies the attributes; no practitioner testing evidence was found this run, and APG itself flags the Control+End focus problem as unsolved.
- **Open-issue counts for the Vue adapters specifically.** Release cadence was established from the registry (a strong maintenance signal) but the issue trackers were not read, so whether `@tanstack/vue-virtual`- or `virtua`-labelled issues are accumulating unaddressed is unknown.
