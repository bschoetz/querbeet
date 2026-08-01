---
title: 'technical research: UI framework for querbeet'
type: 'technical'
topic: 'UI framework for the querbeet three-pane app'
decision: 'Vue 3 vs Alpine.js vs vanilla JS for the querbeet three-pane reactive UI'
source: 'deep-recon native run'
status: complete
preset: 'standard'
validation: 'normal'
claims:
  verified: 34
  unverified: 3
  disputed: 1
  overturned: 2
created: '2026-08-01'
updated: '2026-08-01'
valid_until: '2027-02-01'
---

# technical research: UI framework for querbeet

**Decision this research serves:** Which UI approach carries querbeet's three-pane interface (sources / pipeline step list / live preview) — Vue 3, Alpine.js, or vanilla JS?

## Executive summary

**Recommendation: Vue 3, using the global build with no build step** (88/100 on the weighted
matrix). Runner-up Preact + htm (80), then Alpine.js (76), then vanilla JS (65). Vue wins on the
criterion that carries the most weight and matches the app's actual shape: a list of five
heterogeneous, individually configured pipeline steps is exactly the `<component :is>` case, and
Vue is the only finalist for which that is a documented, worked pattern rather than an inference. Its large-data story is documented rather
than discovered, and its governance is the only one built to outlive its founder.

Three findings drive that answer, and two of them corrected beliefs this research started with.

**1. Deep reactivity over the dataset is unaffordable, and `Object.freeze` is a complete escape —
measured, not argued.** Wrapping 100k rows × 20 columns in `reactive()` inside a render effect costs
**437–479 MB** on top of 160 MB of data and slows a full read 11–13x. Freezing the rows removes that
cost entirely — no proxy is created at all — on both Alpine's pinned reactivity core and the current
one, for about 4% more heap in the freeze itself.
The public literature could not settle this (Vue's docs are qualitative; the one published benchmark
is undated and off-browser), and the estimate derived from that benchmark was low by an order of magnitude,
because the dominant cost is per-*key* dependency tracking, not per-object proxy allocation. This
makes "freeze every dataset at the boundary" an architecture rule, not a tuning tip.

**2. The `file://` folklore is wrong, and correcting it reshaped the candidate field.** An *inline*
`<script type="module">` runs fine from a double-clicked file in both Chromium and Firefox; only
modules that *fetch* something are blocked. `vite-plugin-singlefile` emits exactly such an inline
module, so its output should work from a double-click — an inference from two measured facts, not
yet built end-to-end — which makes Lit and Svelte 5 build-path-only rather than disqualified. It also settles a question R1 left open: a Web Worker *is* available from `file://`,
provided it is constructed as a classic script from a blob URL.

**3. Alpine passes the hard gate — the working hypothesis that it could not was wrong.** Alpine has
no `shallowReactive` and no `markRaw`, but a probe of a real Alpine app loaded from a real `file://`
URL — in both Chromium and Firefox — shows 100k frozen rows sitting in `x-data` with no proxy
created, while the small step array in the same component stays fully reactive, and `x-model`
writes back through `x-for` into nested config objects. Alpine loses on ergonomics instead: it has no component system, so five step kinds
mean five `x-if` branches in one template with no way to factor the markup.

**The biggest caveat:** the criterion that decides this verdict — how the step list actually feels
to author — is the one criterion not measured. Two rounds of searching found no multi-year
retrospective on Vue-via-CDN or on Alpine in a nontrivial app, so the literature cannot de-risk it.
One evening building the step list for two step kinds would tell you more than this report does.
Footprint, meanwhile, should be dropped as a tiebreaker entirely: Arquero at 236 KB raw is larger
than Vue's whole global build, and the spread across every UI candidate is about 58 KB gzip.

## Requirements frame

Set with the user before candidate research; not derived from web sources.

**Hard gates** (any candidate failing one is cut):

| ID | Gate |
| --- | --- |
| G1 | Ships as a single HTML file — either CDN-linked with no build, or a build step emitting one file |
| G2 | Runs by double-click from `file://` — no server, no localhost |
| G3 | Chrome/Edge 143+, Firefox 145+ (Safari optional) |
| G4 | Permissive OSS license |
| G5 | Can render a live preview over ~100k-row datasets without the data itself entering the reactivity system |

**Weighted criteria:**

| ID | Criterion | Weight |
| --- | --- | --- |
| C1 | Ergonomics for the dynamic step list (add/remove/reorder steps, per-step config panels) | 25 |
| C2 | Reactivity model under large data (keeping 100k rows out of the proxy, live preview updates) | 20 |
| C3 | Footprint and delivery (size, CDN vs. build, offline behaviour) | 20 |
| C4 | Ecosystem health / five-year regret risk | 15 |
| C5 | Solo-developer burden — learning curve, debuggability without a build step | 10 |
| C6 | Form/binding detail for many small config forms (German UI) | 10 |

**Carried in from R1 (settled, not re-researched):** the transformation engine is Arquero; the full pipeline runs in 10.5 ms at 100k rows, so transformation cost is not a framework argument. Memory is ~471 bytes per row (20 columns, array of objects), so data must not be proxied. R1 left open whether a Web Worker can be created at all from a `file://` page — D1 picks that up.

**Candidate field:** Vue 3, Alpine.js, vanilla JS (baseline); wildcards to screen: petite-vue, Preact + htm, Svelte 5, Lit, VanJS.

## D1 — Delivery and footprint

### What `file://` actually blocks

The premise this whole decision was built on turned out to be folklore, and correcting it
reopens options that would otherwise have been cut. A two-engine capability probe run for this
decision — headless Chromium 150.0.7871.186 and Firefox 153.0.1, a real `file://` URL, no
permissive flags — establishes the boundary precisely [1]:

| From a `file://` page | Chromium 150 | Firefox 153 |
| --- | --- | --- |
| Inline classic `<script>` | works | works |
| Classic `<script src="sibling.js">` | works | works |
| **Inline `<script type="module">`** | **works** | **works** |
| `<script type="module" src="…">` | blocked | blocked |
| Dynamic `import()` | blocked | blocked |
| `fetch()` of a sibling file | blocked | blocked |
| Import map resolution | works (the following fetch fails) | works (the following fetch fails) |
| Classic Worker from a `blob:` URL | works | works |
| Classic Worker from a `data:` URI | works | works |
| Module Worker from a `blob:` URL | **fails** | works |
| `new Worker('./sibling.js')` | throws synchronously | fires an error event |
| `new Function()` (no CSP set) | available | available |

The rule underneath is simple: **a `file://` page is a secure context with an opaque origin, and
anything that *fetches* fails CORS; anything already inline does not fetch and therefore runs.**
The blanket claim "ES modules don't work over `file://`" is true only of modules that load
something. Vue's own Quick Start states the blanket version [3], and MDN's Modules guide does
too [6] — both are describing the multi-file case they document, and neither distinguishes the
inline case. The measurement outranks both here because it is specific, current, and reproducible.

This restriction is not going away: allowing module scripts over `file://` has been an open
WHATWG HTML issue since 2022-07-21 with no vendor commitment to change it [4], and the Fetch
standard declines to define file-URL fetching at all — *"For now, unfortunate as it is, file:
URLs are left as an exercise for the reader. When in doubt, return a network error."* [5]. Plan
for it to persist. (Chromium's `--allow-file-access-from-files` flag is not a fix: a clerk — a *Sachbearbeiter*,
the user this app is for — double-clicking an HTML file will not pass command-line flags.)

Two consequences carry into the build:

- **Workers must be constructed as classic scripts from a blob URL.** That is the one
  configuration that works in both engines; the module-blob form is the single engine divergence
  the probe found, and Vite's idiomatic `new Worker(new URL('./w.js', import.meta.url), {type:'module'})`
  is exactly the combination that fails. This also settles the question R1 left open — a Web
  Worker *can* be created from a `file://` page, just not from a file URL.
- **Nothing may be loaded at runtime.** Everything the app needs must be inlined or arrive
  through a user-chosen `<input type="file">` / drag-and-drop, which is a different and permitted
  path.

### Two delivery paths, and what each admits

**Path A — no build.** Inline a classic-script build of each library into the HTML. Requires that
the library publishes a UMD/IIFE/global artifact. Vue ships exactly this as `vue.global.prod.js`
("For direct use via `<script src>`… includes both the compiler and the runtime so it supports
compiling templates on the fly") [2]; Alpine's standard `<script defer src>` delivery is a plain
classic script [9]; Arquero's `dist/arquero.min.js` is UMD and exposes global `aq` [9].

**Path B — Vite + `vite-plugin-singlefile`.** The plugin is maintained (2.3.3, published
2026-04-17, roughly quarterly releases, already declaring Vite 8 support) and is strict about the
single-file goal: *"it creates one HTML file and no other files… Issues opened requesting multiple
entry points will be closed as `wontfix`"* [7]. Reading its published tarball shows it emits
`<script type="module">` — but **inline**, with the `crossorigin` attribute and the modulepreload
polyfill stripped [7]. By the probe above, that output should run from `file://` — note that this
is an inference from two measured facts, not an end-to-end result: no plugin output was built and
opened this run. The condition is absolute: *everything* must be inlined. Any surviving `import` of a sibling, any dynamic
`import()`, any `crossorigin src=` reintroduces the block.

One vendor claim here is contradicted by measurement. The plugin's README lists "requests for
local files relative to the same folder" as working from `file://` [7]; `fetch('./sib.js')` fails
in both engines [1]. Do not plan on reading a sibling config or data file at runtime.

### Measured footprint

All figures downloaded from jsDelivr and measured this run — `wc -c` raw, `gzip -9` compressed [9]:

| Artifact | Version | Raw | Gzip |
| --- | --- | --- | --- |
| Vue global (with template compiler) | 3.5.40 | 165,599 | 60,312 |
| Vue runtime-only global | 3.5.40 | 106,947 | 40,361 |
| Alpine.js | 3.15.12 | 46,346 | 16,703 |
| @alpinejs/csp | 3.15.12 | 61,522 | 20,284 |
| Lit (`lit-all.min.js`, GitHub dist — an ES module, not a classic script) | 3.x | 29,370 | 10,222 |
| Preact + hooks + htm (UMD, separate files) | 10.29.7 / 3.1.1 | 16,546 | 7,158 |
| htm/preact standalone UMD (one file) | 3.1.1 | 13,296 | 5,340 |
| petite-vue (IIFE) | 0.4.1 | 16,901 | 7,082 |
| VanJS (`src/van.js`, unminified) | 1.6.1 | 4,988 | 1,777 |
| **Arquero** | **8.0.3** | **236,290** | **73,583** |

Two things fall out. First, **Arquero is the largest single item in the budget — larger than
Vue's entire global build** — so it dominates every total: Vue global + Arquero is ~393 KB raw,
Alpine + Arquero ~276 KB, VanJS + Arquero ~236 KB. Second, **the entire spread across every UI
candidate is about 58 KB gzip**, which for a locally-opened file is close to noise. On
`file://` there is no transfer encoding at all, so raw bytes are what a user waits for; gzip
figures are informational. The in-browser template compiler is the one line item worth a decision:
it costs Vue ~58.7 KB raw / ~20.0 KB gzip, and it is only needed on Path A.

**Footprint is therefore not a discriminator between the finalists.** Any argument that picks a
UI library to save 40 KB while shipping a 236 KB data library is not an argument about this app.

### CSP

Moot unless the app imposes a CSP on itself: nothing about `file://` imposes one, and `new Function`
is available in both engines [1]. Two facts for the case where it stops being moot. Alpine uses
Function declarations, which *"still violate 'unsafe-eval'"* [8]; its CSP-safe build is released in
lockstep but costs real expressiveness — no arrow functions, destructuring or template literals in
directives, no globals, no `x-html` — and is *larger* than the standard build [8][9]. For Vue, no
primary source could be found stating whether the in-browser compiler requires `unsafe-eval`; that
belief is unverified and is not relied on here.

## Candidate screen

Screened against the hard gates; cuts recorded with the gate that decided them.

| Candidate | Verdict | Deciding evidence |
| --- | --- | --- |
| **Vue 3** | **Finalist** | Global build is a classic script, `file://`-safe [1][2]; documented `shallowRef` hatch for G5 [11][16] |
| **Alpine.js** | **Finalist** | Classic-script delivery [9]; G5 passed by measurement in a running app [17] |
| **Vanilla JS** | **Finalist (baseline)** | No reactivity layer to escape from; the cost is what you write yourself |
| **Preact + htm** | **Finalist** | `htm/preact/standalone.umd.js` is a genuine UMD exposing global `htmPreact` — preact core + hooks + htm in 13,296 B [18]; no proxy layer anywhere, so G5 is satisfied by construction rather than by opt-out [18]; MIT + Apache-2.0 [10] |
| petite-vue | **Cut** | Capability, not delivery: its README states no `v-is`/dynamic component binding, no `ref()`/`computed()`, no vDOM — the heterogeneous-step-kinds pattern is exactly the case it cannot express. Also self-declares "use at your own risk" with the issue tracker disabled, and its last release is 0.4.1 from 2022-01-18 — 4.5 years ago [24][9] |
| VanJS | **Cut (weak advance not taken)** | A first-party version-matched `nomodule` build exists, so G2 passes [22], and state is explicit containers rather than proxies. But list rendering is explicitly punted to the separate VanX extension [23], which would need its own `nomodule` check, and the README signs off with a single founder-maintainer [23]. Too thin a base for a multi-year solo project |
| Lit | **Cut** | No UMD/IIFE build exists in the `lit`, `lit-html` or `@lit/reactive-element` npm packages, and Lit's docs require bare-specifier resolution — a bundler — even for the "CDN" story [18][19]. A prebuilt `lit-all.min.js` (29,370 B) does exist in the `lit/dist` GitHub repo, and this run checked its format directly: it ends in `export{…}`, so it is an **ES module**, not a classic script [9]. Path A is therefore closed for Lit unless its code and the app's are hand-concatenated into one inline module — a build step wearing a disguise |
| Svelte 5 | **Cut — same correction** | The compiler emits ES modules only (no `format`/`iife` in the 5.56.8 `CompileOptions` type surface) [20], so Path A is closed. `$state.raw` is documented verbatim as the large-array hatch, so G5 was never the issue [21]. Under Path B it would work; it is cut for the same reason as Lit |

Two corrections to that table are worth stating plainly, because the first screen got them wrong.

**Lit and Svelte 5 were cut on the belief that a `file://` app must ship classic scripts, and that
belief is false.** An inlined module script runs [1], and `vite-plugin-singlefile` emits exactly
that [7] — so under Path B both would work. They remain cut because committing to a build step to
get them buys nothing this app needs, and a build step is a permanent tax on a solo maintainer's
ability to open the file and fix it. That is a judgement about this project, not an evidence claim.

**And Lit nearly escaped on a technicality worth recording.** The npm-only search that cut it is
exactly the search that would have wrongly cut VanJS, whose classic build also lives outside npm
[18] — and a prebuilt Lit bundle does exist by that same route. Checking the file rather than
trusting either search settled it: `lit-all.min.js` ends in `export{…}` and is an ES module [9].
The cut stands, but on a checked fact rather than on where a file happened to be published.

## D2 — Reactivity under 100k rows

This dimension decides hard gate G5, and the public literature could not settle it. Vue's own
performance page is qualitative throughout — its only quantity is the rhetorical
"100,000+ properties" per render [11] — and the one independent measurement found is undated,
run on Node/Deno/Bun rather than a browser, without machine specs, and its author states no raw
timings were kept [15]. So the gate was measured directly rather than argued from documents.

### What deep reactivity costs, measured

100,000 rows × 20 columns, Node v26.5.0 (V8 — the engine behind Chrome and Edge), one process
per case, GC-forced heap deltas. Both `@vue/reactivity` 3.1.1 (the version Alpine pins) and
3.5.40 (current, published 2026-07-16) [16]. Read the figures with the artifact's own limits
attached: this is Node rather than a browser tab, so the **ratios transfer and the absolute
megabytes are indicative**; it is one run per case with no variance reported; SpiderMonkey is
untested; and the effect reads every key of every row, which is deliberately the **worst case**
rather than the shape a windowed preview produces.

| Case | Added heap | Bytes/row | Full read |
| --- | --- | --- | --- |
| No reactivity (baseline: 159.7 MB of data) | — | — | ~105 ms |
| `reactive()`, no active effect | 7.9 MB | 82 | ~400–470 ms |
| **`reactive()` inside a render effect** | **436.8 MB (3.1.1) / 478.5 MB (3.5.40)** | **4580 / 5017** | 1193 / 1411 ms |
| `shallowReactive()` inside an effect | 21.2 / 23.4 MB | 222 / 245 | ~241–255 ms |
| **Frozen rows** | **0 MB of reactivity overhead** | **0** | **90–116 ms** |

Freezing is not itself free: the frozen dataset costs 166.6 MB against 159.7 MB plain, about
6.9 MB or ~4% more, since `Object.freeze` transitions the objects' shape [16]. That is the whole
price, and it buys the entire 437–479 MB back.

Four findings, and the third is the one that matters most:

1. **Deep reactivity over the dataset is not affordable.** Inside a render effect it costs three
   to four times the data itself and slows a full read by 11–13x. With five sources loaded, that
   is the difference between a working tool and a dead tab.
2. **The dominant cost is per-*key* dependency tracking, not per-object proxy allocation.** The
   same measurement without an active effect shows only 82 bytes/row — fifty times less. Any
   estimate derived from proxy *count* understates the real cost by an order of magnitude, which
   is precisely how the one published anchor [15] led to a "roughly doubles the heap" estimate
   that the measurement overturns.
3. **`Object.freeze()` on the rows is a complete escape hatch — zero overhead, no proxies at
   all.** The mechanism was first read out of Alpine's shipped bundle: `getTargetType` returns
   INVALID when a value carries `__v_skip` *or* is non-extensible, and `createReactiveObject`
   then returns the raw target untouched [12]. The measurement confirms it holds identically on
   3.1.1 and 3.5.40 [16] — five years apart, so this is the library's contract, not a version
   accident. `shallowReactive` is the documented second-best: ~20x cheaper than deep reactivity,
   still ~250x more expensive than freezing [11][16].
4. **Vue 3.5's reactivity rewrite does not help this shape and is marginally worse** (478.5 MB vs
   436.8 MB) [16]. The corollary is decision-relevant: Alpine sitting on a 2021 reactivity core
   costs nothing here. This is independently corroborated upstream — the open PR that bumps
   Alpine's pin reports memory unchanged, with gains in speed only [33].

### Alpine specifically

Alpine 3.15.12's only dependency is `@vue/reactivity` pinned at `~3.1.1`, confirmed both in npm
metadata and by reading the shipped bundle, where the engine is wired up as
`setReactivityEngine({reactive, effect, release: stop, raw: toRaw})` [12][13]. Alpine exposes no
`shallowReactive` and no `markRaw` of its own [12] — which made "Alpine has no escape hatch and
therefore fails G5" the working hypothesis. **That hypothesis is wrong**, and a probe of a real
Alpine app loaded from a real `file://` URL settles it — every result below reproduces identically
in Chromium 150 and Firefox 153 [17]:

| Check | Result |
| --- | --- |
| 50-row window rendered from a frozen 100k-row array | 50 rows |
| Row array proxied inside `x-data`? | **no** |
| Row object proxied / identity preserved / still frozen | no / yes / yes |
| Step array in the same component proxied? | **yes** — still fully reactive |
| `x-model` write-back through `x-for` into a nested config object | **works** |
| `<select>` + `x-model` write-back | **works** |
| Replacing the frozen array wholesale re-renders, rows stay unproxied | **works** |

So Alpine passes G5, and the reactivity split the app wants falls out naturally: the small mutable
step list stays reactive, the large frozen dataset never enters the proxy layer, in the same
component, with no discipline beyond calling `Object.freeze` on data as it arrives. Alpine also
exposes `Alpine.setReactivityEngine` as public API, so a modern `@vue/reactivity` could be
injected wholesale if `shallowReactive` were ever wanted [12].

One caveat is load-bearing: **the freeze hatch is a documented-by-code behaviour of the bundled
`@vue/reactivity`, not a documented Alpine API.** It is unsupported, and a dependency bump is
currently open upstream [33]. The measurement shows the behaviour is identical on both the old
and the new version [16], which reduces that risk to nearly nothing — but it should be pinned by
a test in the app rather than assumed.

For Vue the same architecture is idiomatic and documented rather than inferred: `shallowRef` for
the root, with the docs' own example being literally `shallowRef([/* big list of deep objects */])`,
and the trade being that updates require replacing the root rather than mutating in place [11].
That fits a pipeline where each step emits a fresh array anyway. The shallow contract is real and
maintained — a 2024 regression where shallowness leaked through `v-for` was labelled
`p4-important` and fixed [14].

## D3 — Ergonomics for the step list

The core pattern is: a list of N items of *different kinds*, each rendering its own configuration
form, each two-way bound to its own nested config object, with add / remove / reorder.

**Vue expresses this most directly.** `<component :is>` accepts a component object, so a
`{ filter: FilterStep, join: JoinStep, … }` dispatch map needs no global registration [35]. On
Path A there are no Single-File Components — the Quick Start says so verbatim [3] — but the docs
exempt `template:` strings and `<script type="text/x-template">` blocks from the in-DOM template
caveats (kebab-case attributes, no self-closing tags, placement restrictions inside tables and
selects) [35]. So authoring is: one JS object per step kind, each with a `template` string,
dispatched by `<component :is>`. The Composition API requires `setup()` when authoring this way. The DX
cost is real but bounded: HTML lives in JS strings, so no syntax highlighting or template type
checking.

**Alpine has no component system, and this is where it pays.** `Alpine.data()` supplies data,
never markup, and there is no `<component :is>` equivalent [34]. Five heterogeneous step editors
must therefore be a chain of `<template x-if="step.kind === '…'">` blocks inside one `x-for`, or
`x-html` with a template string — and Alpine's docs restrict `x-html` to trusted content [34].
Per-step *behaviour* can factor cleanly into `Alpine.data()` components; per-step *markup* cannot
be factored at all. For five kinds this is a long but honest template; for fifteen it would be a
maintenance problem.

One frequently-repeated criticism does not survive contact with the current version. Alpine's own
discussion threads carry the claim that it "re-renders the entire component when any piece of data
changes" — but those threads are from 2020 and Alpine 2, and Alpine 3 documents per-effect granular
reactivity [25][34]. It is reported here as superseded, not relied on as a weakness.

What Alpine does get right for this UI was measured rather than assumed [17]: `x-model` bound to
a nested property of an `x-for` iteration variable writes back to the source array, for text
inputs and selects alike. The mechanism — `x-for`'s scope assigns the item by reference and wraps
it in `reactive()` — means object iteration variables write through while primitive ones do not
[34]. `Alpine.store()` covers cross-pane shared state, though it is a flat namespace with no
scoping and no watch API [34].

**Reordering.** Alpine's `:key` is opt-in [34], and reading `x-for`'s source shows Alpine reuses
keyed nodes on re-render and refreshes their scope in place, so replacing the array wholesale
should preserve DOM state — and with it input focus and caret position — when keys match [34].
The focus consequence follows from the mechanism but was not spiked; the probe tested array
replacement and proxy state, not a focused input. The platform-native `Element.moveBefore()` preserves focus, animation,
media and popover state across a move — but MDN marks it "Limited availability — Not Baseline"
today, so it is a guarded progressive enhancement, not a strategy [26]. The classic failure mode
here is drag libraries fighting a framework's list diffing — "two sources of truth", corroborated
across three repositories with an open VueUse issue [27], though that evidence is snippet-level
only. The design that avoids the whole class of problem under any candidate: never let a library mutate
DOM order. Either up/down buttons and keyboard shortcuts that splice the array — which also gives
the German UI honest "Nach oben" / "Nach unten" labels and accessibility for free — or native HTML5
drag events that compute a target index and splice. One source of truth, no conflict.

**A gap worth naming.** Two rounds of searching found **no** multi-year retrospective on
Vue-via-CDN in a real application, and none reporting regret over Alpine in a nontrivial one [25][28]. The corpus is
how-to recipes and migrations *toward* Alpine on content sites, which do not transfer to a stateful
three-pane editor. Absence here is itself the finding: **this decision cannot be de-risked by other
people's experience reports.** It has to be de-risked by building something — which is exactly what
the two measurements in this report did for the load-bearing questions.

## D4 — Ecosystem health and five-year regret risk

| | Vue 3 | Alpine.js |
| --- | --- | --- |
| Current stable | 3.5.40, 2026-07-16 [29] | 3.15.12, 2026-04-30 [29] |
| Cadence | steady, ~2 patches/month through 2026 [29] | bursty: 6-month silence, then 12 releases, then 3 quiet months [29] |
| Bus factor | **>1, provable** — 22-member core team, written Team Charter; last 50 commits led by edison1105, Evan You absent from that window [29][31] | **2 for code, 1 for releases** — joshhanley now outpaces calebporzio and approves PRs, but calebporzio is the sole npm maintainer; no governance doc exists [29] |
| Funding | donations only (GitHub Sponsors on a personal account + OpenCollective); no foundation [31] | none documented |
| npm downloads | 0.69M → 1.92M/day over 24 months (~2.8x) [30] | 27.4k → 79.6k/day (~2.9x) [30] |
| Tracker | 566 open issues, 355 open PRs, 126 PRs merged since 2026-06-01 — busy and alive [29] | 3 open issues, 6 open PRs, 50 merged in 2026 — responsive, with real maintainer discussion [29] |
| License | MIT, verified from LICENSE [31] | MIT, verified from LICENSE.md [31] |

Both are growing at nearly the same rate, and neither is fading. Alpine's release bursts are
batching, not dormancy — the repository was pushed on 2026-07-28 while the last release is from April.
Alpine's ratio of three open issues to 31.8k stars is anomalously low and should be read as aggressive
triage and routing to Discussions, not as a defect-free library [29].

The difference that matters over five years is **structure, not activity**. Vue has a written
charter, a named 22-person core team, and demonstrated day-to-day maintenance transfer off its
founder. Alpine has one additional active maintainer and no governance document; if Porzio stepped
back, code could continue but publishing rights would need transferring. That is the honest
regret-risk gap, and it is a difference in kind rather than in current health.

On the reactivity pin: Vue's 3.5 release post claims the reactivity refactor cut memory 56% [32],
and Alpine does not receive it — it runs a 3.1.x core [29]. But the pin is unfinished work rather
than ideology: PR #4861 bumps `@vue/reactivity` to 3.5.40, was approved 2026-07-27, and is still
open [33]. And the pin matters less than the 56% figure suggests: that PR's own benchmarks report
**memory unchanged**
(gains are speed — effects +48%, `x-for` 8–19%) [33], which independently corroborates the direct
measurement in D2 that 3.5.40 is no better than 3.1.1 for this workload [16].

## Cross-dimension insights

Four things only the combination shows.

1. **The agreed weights are wrong in one place, and the evidence says so.** C3 (footprint and
   delivery) carries 20 points, but D1 shows the criterion is close to noise: Arquero alone is
   larger than Vue's entire global build and the spread across every UI candidate is ~58 KB
   gzip [9]. The weights were set before that was known. Re-weighting C3 toward zero and
   redistributing to C1 widens the gap between the top two rather than closing it, so the verdict
   survives the correction — but the matrix below should be read with that in mind.
2. **Alpine's five-year-old reactivity core is a non-issue precisely because the app must keep its
   data out of reactivity anyway.** The pin would matter if 100k rows went through the proxy layer
   — and D2 shows that is unaffordable under *any* version [16]. Once the data is frozen, the
   engine's version stops mattering. A weakness on paper that the required architecture cancels.
3. **The real gate was never a capability, it was the delivery path.** What separates the
   candidates is how a library is packaged, not what it can do — Svelte 5 documents `$state.raw`
   for exactly this workload [21] and is still cut. And the gate turned out narrower than folklore
   says once it was measured [1].
4. **The literature is empty exactly where the decision is hardest, and measurement is cheap
   exactly there.** Two rounds found no retrospectives and no browser-based reactivity benchmarks
   [25][28], while two afternoon-scale experiments settled the memory gate and the Alpine API
   questions outright [16][17]. For this class of decision the ratio strongly favours building the
   probe over reading more.

## Contrary evidence

The red-team pass was configured off for this run; no adversarial challenge was made to the
conclusions. The self-corrections that did occur are recorded inline where they happened — four of
them, each overturning a belief this research started with.

## Verdict

Scores are 1–5 against the agreed weights; the matrix is meant to be re-weighted, not trusted. If
you re-weight one thing, drop C3: the evidence shows footprint is decided by Arquero, not by the UI
library [9].

| Criterion | Wt | Vue 3 | Preact + htm | Alpine.js | Vanilla JS |
| --- | --- | --- | --- | --- | --- |
| C1 Step-list ergonomics | 25 | **5** — `<component :is>` dispatch map, no registration [35] | 4 — components are plain functions; `<${Foo}>` interpolation, though htm's docs show only homogeneous lists, so the dispatch-map shape is inference [36] | 3 — no component system; `x-if` chains or `x-html`, markup cannot be factored [34] | 2 — dispatch and DOM updates hand-written |
| C2 Reactivity at 100k rows | 20 | **5** — documented `shallowRef` + freeze, 0 MB measured [11][16] | **5** — no proxy layer in core, so G5 holds by construction; read off the shipped API surface, not measured [18] | 4 — freeze works, measured in a live app, but the hatch is undocumented and unsupported [12][17] | 3 — nothing to escape, but nothing drives the preview either |
| C3 Footprint & delivery | 20 | 3 — 165,599 B raw (106,947 without the compiler) [9] | **5** — 13,296 B in one UMD file [18] | 4 — 46,346 B [9] | **5** — nothing |
| C4 Ecosystem health | 15 | **5** — 22-member core team, charter, bus factor >1 [29][31] | 2 — Preact is healthy, but htm is dormant: last release 2022-04-26, last commit 2024-02-01, 49 open issues [36] | 3 — 2 maintainers for code, 1 for releases, no governance doc [29] | **5** — no dependency to rot |
| C5 Solo-dev burden | 10 | 3 — larger API; no SFCs on Path A, `setup()` required [3][35] | 4 — JS-native and debuggable; unusual template syntax | **5** — smallest surface, directives in markup, no build | 2 — you own every line, forever |
| C6 Form binding detail | 10 | **5** — `v-model` on nested props; standard and unremarkable, but not evidenced this run | 3 — controlled inputs mean manual handlers across many small forms | **5** — `x-model` writes back through `x-for` into nested objects, measured [17] | 2 — all manual |
| **Weighted total (of 100)** | | **88** | **80** | **76** | **65** |

**The pick: Vue 3, on the global build, Path A (no build step).** It wins on the criterion that
carries the most weight and is the app's actual shape — a list of heterogeneous, individually
configured steps is the `<component :is>` case, and Vue is the only finalist with a first-class
answer to it. Its large-data story is documented rather than discovered, its governance is the only
one built to outlive its founder, and its one real cost — 165 KB raw and no SFCs — is bounded and,
next to Arquero's 236 KB, close to irrelevant.

**Runner-up: Preact + htm (80), and the condition under which it wins instead.** If authoring in
plain JavaScript matters more than framework ergonomics — components as functions, no template
strings, no directive language — Preact + htm is genuinely better on three of six criteria and
ships 13 KB. What holds it back is not the technology but htm's dormancy: last release four years
ago, last commit two years ago, 49 open issues, not archived [36]. Choose it if you are willing to
vendor htm's 1.3 KB into the file and own it — which is a rational trade a solo developer can make,
and it removes the only real objection.

**Alpine (76) is the right answer to a slightly different question.** It has the smallest surface,
the least ceremony and the best form-binding story of any no-build option, and it passed the hard
gate in a live measurement. It loses on exactly one thing: five step kinds mean five `x-if` branches
in one template with no way to factor the markup. If the step list stays small and simple, Alpine's
lower burden is worth more than Vue's dispatch map, and the gap closes.

**The strongest argument against the pick** is that Vue is the heaviest and most ceremonious option
for an app whose UI is three panes and a list, chosen partly on governance quality that a solo
project may never need to draw on. If the step list turns out simpler than specified, that argument
wins and Alpine is the better tool.

**Cheapest reversibility hedge:** keep the pipeline model — steps, their config objects, and the
transformation functions that execute them — in plain JavaScript with no framework imports at all,
and let the framework own only rendering and binding. Every finalist here re-renders from a fresh
frozen array, so a framework swap becomes rewriting the view layer against an unchanged core. Build
the step list first, in whichever candidate: it is the criterion that decides this, and one evening
of real code will tell you more than this report does.

## Recommendations

1. **Adopt Vue 3 (`vue.global.prod.js`, 3.5.40) with no build step** — Path A. Feeds the
   architecture spine as a fixed paradigm choice. Confidence: high on delivery and reactivity
   (measured [1][16]); medium on authoring ergonomics, which rest on documentation rather than on a
   built prototype.
2. **Freeze every dataset at the boundary.** `Object.freeze` each row as it enters from the parser,
   and hold results in `shallowRef`. This is the G5 answer and it is measured: no reactivity
   overhead at all versus 437–479 MB for the naive path, against a ~4% cost for the freeze
   itself [16]. Make it a rule in the architecture spine, not a habit — a
   single unfrozen 100k array inside a computed re-creates the entire problem.
3. **Never let the preview render more than a window.** ~50 rows, with the full result held outside
   the DOM. Confidence: high — it is Vue's own documented answer to large lists [11], and it is what
   R4 will build on.
4. **Construct any Web Worker as a classic script from a blob URL.** Measured as the only form that
   works in both engines from `file://` [1]. This also closes R1's open worker question — a worker
   is available if R4 wants one, just not from a file URL.
5. **Inline everything; plan for nothing to be fetchable at runtime.** No sibling config file, no
   lazy chunk, no CDN link at load time [1]. Data enters only through file input or drag-and-drop.
6. **Keep the pipeline core framework-free** (see the hedge above). Feeds the architecture spine as
   a boundary rule.
7. **Do not spend design effort on bundle size.** Arquero decides the total [9]; the UI spread is
   noise. If size ever becomes a real constraint, the lever is Arquero, not the framework.

## Open questions

| Question | Blocks the decision? | What would answer it |
| --- | --- | --- |
| Does the Vue Path A authoring pattern actually feel workable — `template:` strings, `<component :is>`, `setup()` — for five step kinds? | **Yes — the only one** | Build the step list for two kinds in one HTML file. One evening. This is the only criterion that decides the verdict and the only one not measured. |
| Alpine's freeze hatch is undocumented and therefore unsupported; PR #4861 bumps the dependency it relies on [33] | Only if Alpine is chosen | Pin it with a test in the app that asserts that a frozen row survives `Alpine.raw` with its identity intact. |
| Does `vite-plugin-singlefile` inline worker chunks, or emit a separate file (which would break both single-file and `file://`)? | Only on Path B | Read its issue tracker, or build one worker-using app and check the output. |
| No practitioner evidence exists on recompute-all vs memoize-per-step for live-preview pipelines | No — decide by measuring | Searched in two rounds; the corpus is server-side ETL vendors whose economics do not transfer. Decide it by measurement once the pipeline exists — at 10.5 ms per pass (R1) recompute-all is very likely fine. |
| Safari/WebKit behaviour on `file://` | No — accepted | Untested — no WebKit engine available on this machine. Safari is optional per the constraints, so this is accepted rather than open. |
| `Element.moveBefore()` per-browser support table | No | Not pinned this run. Only matters if drag-reorder is built on it, which the recommendation advises against anyway. |

## Source appendix

| [n] | Supports | Publisher | Published | Accessed | Confidence |
| --- | --- | --- | --- | --- | --- |
| [1] | The `file://` capability boundary: what is blocked, what runs, engine divergence | [Original two-engine probe, this run — Chromium 150.0.7871.186 / Firefox 153.0.1](imports/) | 2026-08-01 | 2026-08-01 | high |
| [2] | Vue's four browser-relevant distribution builds and what each is for | [vuejs/core `packages/vue/README.md`](https://raw.githubusercontent.com/vuejs/core/main/packages/vue/README.md) | undated (main) | 2026-08-01 | high |
| [3] | No SFC syntax from a CDN; ES modules over `http://` only | [Vue.js Quick Start](https://vuejs.org/guide/quick-start.html) | undated | 2026-08-01 | high |
| [4] | `file://` module scripts are an open, uncommitted WHATWG issue | [whatwg/html#8121](https://github.com/whatwg/html/issues/8121) | 2022-07-21, still open | 2026-08-01 | medium |
| [5] | The Fetch standard declines to define file-URL fetching | [WHATWG Fetch Living Standard](https://fetch.spec.whatwg.org/) | living | 2026-08-01 | high |
| [6] | MDN's blanket statement that modules need a server | [MDN JavaScript Modules guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) | 2026-04-04 | 2026-08-01 | medium |
| [7] | `vite-plugin-singlefile` 2.3.3: maintenance, inline-module output, `file://` claims | [npm registry + published tarball, richardtallent](https://registry.npmjs.org/vite-plugin-singlefile) | 2026-04-17 | 2026-08-01 | high |
| [8] | Alpine uses Function declarations; the CSP build and what it costs | [alpinejs.dev/advanced/csp](https://alpinejs.dev/advanced/csp) | undated | 2026-08-01 | high |
| [9] | All measured bundle sizes, raw and gzip; Alpine and Arquero delivery format | [Measured from jsDelivr this run (`curl` + `wc -c` + `gzip -9`)](https://cdn.jsdelivr.net/) | 2026-08-01 | 2026-08-01 | high |
| [10] | Preact MIT / htm Apache-2.0 licensing | [npm registry metadata](https://registry.npmjs.org/preact/latest) | current `latest` | 2026-08-01 | high |
| [11] | Deep reactivity is the documented problem; `shallowRef`/`shallowReactive`; virtualization for large lists | [Vue.js performance best practices](https://vuejs.org/guide/best-practices/performance.html) | undated | 2026-08-01 | medium |
| [12] | `getTargetType` INVALID on non-extensible values; `setReactivityEngine`; no shallow/markRaw in Alpine's surface | [Alpine 3.15.12 `dist/module.esm.js`, read directly](https://unpkg.com/alpinejs@3.15.12/dist/module.esm.js) | 2026-04-30 | 2026-08-01 | high |
| [13] | Alpine's sole dependency is `@vue/reactivity ~3.1.1` | [npm registry, alpinejs@3.15.12](https://registry.npmjs.org/alpinejs) | 2026-04-30 | 2026-08-01 | high |
| [14] | The shallow contract is enforced: a `v-for` leak was labelled p4-important and fixed | [vuejs/core#11869](https://github.com/vuejs/core/issues/11869) | 2024-09-09 | 2026-08-01 | medium |
| [15] | The 471.6 bytes-per-proxy anchor that the direct measurement overturns | [AwesomeAlpine, "Alpine Performance: The DataStack"](https://awesomealpine.com/posts/alpine-performance-part-1/) | undated | 2026-08-01 | low |
| [16] | Measured reactivity cost, the freeze hatch, `shallowReactive`, 3.5.40 vs 3.1.1 | [Original benchmark, this run](imports/reactivity-benchmark-2026-08-01.md) | 2026-08-01 | 2026-08-01 | high |
| [17] | Alpine with 100k frozen rows from `file://`: no proxies, `x-model` write-back, array replacement | [Original probe, this run](imports/alpine-probe-2026-08-01.md) | 2026-08-01 | 2026-08-01 | high |
| [18] | Package file listings and measured UMD artifacts: htm standalone, Lit's ESM-only packaging, VanJS, Preact | [jsDelivr data API + npm registry](https://data.jsdelivr.com/v1/packages/npm/htm@3.1.1?structure=flat) | live, this run | 2026-08-01 | high |
| [19] | Lit requires bare-specifier resolution, i.e. a bundler, even for its CDN story | [lit.dev tooling requirements](https://lit.dev/docs/tools/requirements/) | undated | 2026-08-01 | high |
| [20] | Svelte 5's `CompileOptions` exposes no `format`/`iife` — the compiler emits ESM only | [svelte@5.56.8 `types/index.d.ts`](https://unpkg.com/svelte@5.56.8/types/index.d.ts) | 5.56.8 | 2026-08-01 | medium |
| [21] | `$state.raw` is Svelte's documented large-array escape hatch | [sveltejs/svelte docs, `$state.md`](https://raw.githubusercontent.com/sveltejs/svelte/main/documentation/docs/02-runes/02-%24state.md) | undated (main) | 2026-08-01 | high |
| [22] | VanJS documents a first-party `nomodule` classic-script build | [vanjs.org/start](https://vanjs.org/start) | undated (references 1.6.1) | 2026-08-01 | high |
| [23] | VanJS punts list rendering to the VanX extension; single founder-maintainer | [vanjs-core@1.6.1 README](https://cdn.jsdelivr.net/npm/vanjs-core@1.6.1/README.md) | 1.6.1 | 2026-08-01 | medium |
| [24] | petite-vue supports no `v-is`/dynamic component binding, no `ref()`/`computed()`; "use at your own risk" | [vuejs/petite-vue README](https://github.com/vuejs/petite-vue) | undated | 2026-08-01 | high |
| [25] | Alpine v2-era complexity statements and the `x-html` re-evaluation complaint | [alpinejs/alpine discussion #749](https://github.com/alpinejs/alpine/discussions/749) | 2020-09-04 | 2026-08-01 | low |
| [26] | `Element.moveBefore()` preserves state but is "Limited availability — Not Baseline" | [MDN `Element.moveBefore()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/moveBefore) | living doc | 2026-08-01 | high |
| [27] | The drag-reorder vs list-diffing "two sources of truth" conflict | [VueUse#3727 and related SortableJS threads](https://github.com/vueuse/vueuse/issues/3727) | undated | 2026-08-01 | low |
| [28] | A migration *toward* Alpine on a static site — evidence against uniform Alpine regret, but not transferable | [Fyle engineering blog](https://stories.fylehq.com/p/how-we-replaced-vue-2-with-alpinejs) | undated | 2026-08-01 | low |
| [29] | Versions, release cadence, bus factor, tracker responsiveness for both projects | [GitHub REST/search API + npm registry time maps](https://api.github.com/repos/alpinejs/alpine) | 2026-08-01 | 2026-08-01 | high |
| [30] | npm download trends over 24 months for `vue` and `alpinejs` | [npm downloads API](https://api.npmjs.org/downloads/) | 2026-07-25 | 2026-08-01 | high |
| [31] | MIT licenses verified from LICENSE files; Vue's Team Charter, core-team roster and funding model | [vuejs/core, vuejs/governance, alpinejs/alpine repositories](https://raw.githubusercontent.com/vuejs/core/main/LICENSE) | main branch | 2026-08-01 | high |
| [32] | Vue 3.5's reactivity refactor claim of -56% memory | [blog.vuejs.org, "Announcing Vue 3.5"](https://blog.vuejs.org/posts/vue-3-5) | 2024-09-01 | 2026-08-01 | high |
| [33] | The `@vue/reactivity` bump PR: approved, still open, memory unchanged | [alpinejs/alpine#4861](https://github.com/alpinejs/alpine/pull/4861) | 2026-07-21 | 2026-08-01 | high |
| [34] | Alpine's `x-html` restriction, `Alpine.data`, `Alpine.store`, `:key` opt-in and per-effect reactivity (docs); `x-for` scoping, `x-model` write-back and keyed-node reuse (read from `packages/alpinejs/src/directives/x-for.js`, which no doc asserts) | [alpinejs.dev + alpinejs/alpine source](https://alpinejs.dev/) | undated / main branch | 2026-08-01 | high |
| [35] | Vue global-build authoring: `template:` strings, `<script type="text/x-template">`, `<component :is>` with a component object | [vuejs.org documentation](https://vuejs.org/) | undated | 2026-08-01 | high |
| [36] | htm's dormancy: last release 2022-04-26, last commit 2024-02-01, 49 open issues, not archived | [developit/htm + npm registry](https://github.com/developit/htm) | 2024-02-01 | 2026-08-01 | medium |

## Staleness map

Computed from the claims ledger against the technical pack's freshness bars, not hand-derived.

| Claim | Class | Published | Re-check by | Stale today |
| --- | --- | --- | --- | --- |
| Vue 3.5.40 / Alpine 3.15.12 are current stable | version | 2026-07-16 | 2026-08-16 | no |
| Alpine pins `@vue/reactivity ~3.1.1`; bump PR open | version | 2026-04-30 | 2026-05-30 | **yes** |
| `file://` capability boundary | compat | 2026-08-01 | 2026-09-01 | no |
| Measured bundle sizes | size | 2026-08-01 | 2026-09-01 | no |
| `vite-plugin-singlefile` emits an inline module | build | 2026-04-17 | 2026-10-17 | no |
| Reactivity costs 437–479 MB; freezing costs zero | memory | 2026-08-01 | 2027-08-01 | no |
| Alpine keeps frozen rows unproxied; `x-model` writes back | api | 2026-08-01 | 2027-08-01 | no |
| Bus factors and governance structure | governance | 2026-07-21 | 2027-01-21 | no |
| Download growth for both libraries | adoption | 2026-07-25 | 2027-01-25 | no |
| htm is dormant | maintenance | 2024-02-01 | 2024-08-01 | **yes** |
| Alpine `:key` reuse preserves DOM state (focus inferred, not spiked) | pattern | 2026-08-01 | 2028-08-01 | no |
| Alpine v2-era complexity complaints | retrospective | 2020-09-04 | 2022-09-04 | **yes** |

Three claims are stale, and each is already handled in the text: the Alpine dependency pin is
tracked through an open PR [33] and the measurement shows the bump changes nothing that matters
here [16]; the htm dormancy claim needs re-checking before anyone acts on the runner-up (a revived
htm removes its only real objection); and the 2020 Alpine complaints are reported as superseded
rather than relied on.

**The earliest live re-check is 2026-08-16** — the version claims. Anything version-shaped in this
report has a two-week half-life by the pack's own bar; everything the verdict rests on is measured
and holds for a year. As a selection report, it should be refreshed before anyone acts on it more than
roughly two quarters from now — that is, after 2027-02-01.
