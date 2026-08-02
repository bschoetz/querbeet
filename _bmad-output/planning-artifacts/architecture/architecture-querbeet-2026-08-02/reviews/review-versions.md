---
name: 'review-versions'
type: architecture-review
lens: 'version and reality check'
target: 'ARCHITECTURE-SPINE.md — Stack table and every version named inside an AD'
reviewed: '2026-08-02'
method: 'live npm registry (registry.npmjs.org), package tarball/source inspection via unpkg + jsdelivr, GitHub REST API, official docs'
---

# Version Review — querbeet Architecture Spine

The spine claims its Stack was "verified against the registries on 2026-08-01, one day before this spine." **That claim is confirmed.** The spine pins 13 concrete versions. Every one of them exists, none is deprecated, and **12 of 13 are still the `latest` dist-tag today, 2026-08-02**. The single exception is `hyparquet-writer`: the spine pins 0.16.3, and 0.16.4 was published at 2026-08-01T23:24 UTC — late on the verification day itself.

Nothing was found to be fabricated. No version named in the spine fails to exist. There is no critical version finding.

The real risks are not in the pinned rows. They are in the two rows that carry **no version at all** — `Vite + vite-plugin-singlefile` and `Vitest / Playwright` — and in the test harness those rows imply: **AD-18's zero-network assertion cannot fail in Firefox**, and **Playwright's Firefox is more permissive about `file://` origins than a real double-click**, which is precisely the boundary AD-16 governs. Both were verified by running Playwright, not by reading about it.

## Verdict Table

Legend: **CURRENT** = pinned version is the current `latest`. **EXISTS+NEWER** = real, but a newer release is out. **UNPINNED** = spine names no version, so there was nothing to verify. **UNVERIFIED** = could not be confirmed against the web.

| Technology | Spine says | Actual latest (2026-08-02) | Verdict | Note |
| --- | --- | --- | --- | --- |
| Vue | 3.5.40 | 3.5.40 (pub. 2026-07-16) | **CURRENT** | 3.6.0-rc.2 in flight since 2026-07-22 |
| Vite | *(no version)* | 8.2.0 (pub. 2026-07-30) | **UNPINNED** | Vite 8 replaced Rollup with Rolldown — see F1 |
| `vite-plugin-singlefile` | *(no version)* | 2.3.3 (pub. 2026-04-17) | **UNPINNED** | Vite 8 branch shipped in 2.3.3 — see F1 |
| Arquero | 8.0.3, pinned and vendored | 8.0.3 (pub. 2025-05-29) | **CURRENT** | No upstream commit in 14 months — see F2 |
| Vue Flow (`@vue-flow/core`) | 1.48.2 | 1.48.2 (pub. 2026-01-28) | **CURRENT** | MIT, no paid tier, no runtime key — see F3 |
| Apache ECharts | 6.1.0, SVG renderer registered alone | 6.1.0 (pub. 2026-05-19) | **CURRENT** | SVG renderer separately registerable — see F4 |
| PapaParse | 5.5.4 | 5.5.4 (pub. 2026-06-19) | **CURRENT** | MIT, actively maintained |
| `write-excel-file` | 4.1.1 | 4.1.1 (pub. 2026-06-08) | **CURRENT** | MIT |
| `read-excel-file` | 9.3.5 | 9.3.5 (pub. 2026-07-28) | **CURRENT** | Disabled worker path confirmed in source — see F5 |
| `hyparquet-writer` | 0.16.3 | **0.16.4** (pub. 2026-08-01) | **EXISTS+NEWER** | One patch behind — see F6 |
| `hyparquet` | 1.27.1 | 1.27.1 (pub. 2026-07-30) | **CURRENT** | `hyparquet-writer` pins this exact version as a hard dep |
| `jsonrepair` | 3.15.0 | 3.15.0 (pub. 2026-07-03) | **CURRENT** | ISC (not MIT), ESM + CJS |
| `json-formatter-js` | 2.5.23 | 2.5.23 (pub. 2025-03-03) | **CURRENT** | Newest release is 17 months old — see F7 |
| `date-fns` | 4.4.0 | 4.4.0 (pub. 2026-05-29) | **CURRENT** | MIT, ESM; 5.0.0-alpha.0 exists |
| Tailwind CSS | v4.3.3, `preflight.css` omitted | 4.3.3 (pub. 2026-07-16) | **CURRENT** | Split import confirmed — see F8 |
| IndexedDB | platform, no library | — | **N/A** | Nothing to version |
| Vitest | *(no version)* | 4.1.10 (pub. 2026-07-06) | **UNPINNED** | See F9 |
| Playwright (`@playwright/test`) | *(no version)* | 1.62.1 (pub. 2026-07-30) | **UNPINNED** | AD-18's network assertion is vacuous in Firefox — see F10 |

### Versions named inside ADs

| Location | Claim | Verdict |
| --- | --- | --- |
| AD-15 | Workers imported `?worker&inline` | **CONFIRMED** for Vite 8 — still documented |
| AD-15 | `worker.format = 'iife'` | **CONFIRMED** for Vite 8 — `'es' \| 'iife'`, default `'iife'` |
| AD-15 | Workers exist only for the two exports | **CONTRADICTED** by the XLSX import path — see F5 |
| AD-18 | Build emits one file, asserted | **AT RISK** — see F1 and F10 |
| AD-5 | Arquero implements the `Table` handle | **CONFIRMED** — 8.0.3 real, BSD-3-Clause, ESM |

## Findings

### F1 — The build row has no version, and Vite 8 changed its bundler underneath it (HIGH)

The Stack row reads `Vite + vite-plugin-singlefile | build path B, single HTML output`. There is no version on either side, so the sentence "verified against the registries on 2026-08-01" cannot be true of this row — there was no version string to verify.

What is actually out there:

- **Vite latest is 8.2.0** (2026-07-30). Vite 8 dropped Rollup and depends directly on `rolldown: ~1.2.0`. `rollup` is no longer a transitive dependency of Vite.
- **`vite-plugin-singlefile` latest is 2.3.3** (2026-04-17). Its `peerDependencies` are `vite: ^5.4.21 || ^6.0.0 || ^7.0.0 || ^8.0.0` and `rollup: ^4.59.0` (optional).
- The plugin **does** handle Rolldown. Reading `dist/esm/index.js` at 2.3.3, it reads `version` from `vite` and branches:

```js
const viteMajor = parseInt(viteVersion.split(".")[0], 10);
// Vite 8+ (Rolldown) uses codeSplitting:false; earlier versions use inlineDynamicImports:true
if (viteMajor >= 8) { out.codeSplitting = false; }
else { out.inlineDynamicImports = true; }
```

So the "single-file build with current Vite" capability holds in principle. The caveats:

1. Upstream issue **#116 "Vite 8 support" is still open** (2026-03-12), and PR **#119 "Fix Vite 8 Rolldown compatibility" is still open and unmerged** (2026-03-23). The maintainer shipped his own fix in 2.3.3 rather than merging #119, but neither thread was closed. Upstream has not declared Vite 8 done.
2. The plugin declares `rollup ^4.59.0` as an optional peer *because* Vite 8 no longer brings Rollup along. Under Vite 8 the project may need `rollup` as an explicit devDependency.
3. Issue #118 (closed) documents the `inlineDynamicImports is deprecated, please use codeSplitting: false instead` warning that motivated the fix — it is the same code path.
4. There is an open PR **"feat: add inline web worker support"** (2026-02-04), unmerged. AD-15 relies on `?worker&inline`, which is a native Vite feature and independent of the plugin, but the existence of that PR suggests worker inlining under this plugin is not friction-free.

**I did not run a build.** Whether the plugin actually collapses a Vue + ECharts + Vue Flow app to exactly one file under Vite 8.2.0 with Rolldown is **UNVERIFIED**. AD-18 makes this a build-time assertion, which is the right mitigation, but the decision itself rests on an untested combination.

**Recommendation:** pin both — `vite@8.2.0` and `vite-plugin-singlefile@2.3.3` — and treat AD-18's one-entry assertion as a gating spike before any other work depends on it. If Rolldown proves hostile, `vite@7.3.6` (the `previous` dist-tag) is the Rollup-based fallback and the plugin supports it.

### F2 — Arquero has had no upstream commit in 14 months (MEDIUM)

`arquero@8.0.3` is real, is the current `latest`, is BSD-3-Clause, and is pure ESM. But it was published **2025-05-29**, and `uwdata/arquero`'s last push to GitHub is the same day: 2025-05-29T22:26Z. Fourteen months, 41 open issues, not archived.

This is not a blocker and the spine already anticipated it — "pinned and vendored" is exactly the right posture for a dependency this quiet, and AD-5 puts Arquero behind querbeet's own `Table` interface so it is replaceable. But the spine states the pin as a currency fact when it is really a **stability-through-abandonment** fact. Worth saying out loud: this dependency will not receive a security fix without a fork.

Its own runtime deps are `acorn ^8.14.1` and `@uwdata/flechette ^2.0.0`.

### F3 — Vue Flow 1.48.2: MIT confirmed, no paid tier, no runtime key (CONFIRMED)

Verified against the LICENSE file, the registry metadata, and the published tarball itself:

- `@vue-flow/core@1.48.2` is MIT. So are all five addons: `@vue-flow/background` 1.3.2, `@vue-flow/controls` 1.1.3, `@vue-flow/minimap` 1.5.4, `@vue-flow/node-resizer` 1.5.1, `@vue-flow/node-toolbar` 1.1.1.
- The LICENSE carries dual copyright (webkid GmbH, Burak Cakmakoglu) because Vue Flow is a port of React Flow — whose core is also MIT. No payment obligation attaches.
- **Runtime audit of the shipped bundles:** zero occurrences of `license`, `licenseKey`, `subscription`, `watermark`, `attribution`, or `proOptions`. Zero network primitives — no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, or `EventSource`. The only hardcoded URLs are the five W3C XML namespace constants from bundled d3. No `postinstall` script.
- This matters for AD-17: **Vue Flow has no code path that can make an HTTP request.** It cannot violate "nothing is fetched at runtime."
- Contrast with React Flow, which does ship a `proOptions` prop and an `<Attribution>` badge. Vue Flow has no equivalent.

**One nuance:** in discussion #1771 (2025-02-28) the maintainer said "VueFlow Pro might come into existence at some point, yes. *When* that will happen I can't say." Seventeen months on, nothing visible has happened, and an MIT release already published cannot be retroactively revoked. 1.48.2 is permanently MIT.

**Minor:** `@vue-flow/core` 1.48.2 depends on `@vueuse/core ^10.5.0`. Current `@vueuse/core` is **14.4.0** — four majors ahead. If querbeet uses VueUse directly at a modern version, the single-file bundle will carry two copies. Pick one, or use none.

### F4 — ECharts 6.1.0 still ships a separately registerable SVG renderer (CONFIRMED)

`echarts@6.1.0` (Apache-2.0, 2026-05-19) exposes `./renderers` in its `exports` map, and `lib/export/renderers.js` reads:

```js
export { install as SVGRenderer } from '../renderer/installSVGRenderer.js';
export { install as CanvasRenderer } from '../renderer/installCanvasRenderer.js';
```

`lib/renderer/installSVGRenderer.js` exists and exports `install`. So `import { SVGRenderer } from 'echarts/renderers'` + `use([SVGRenderer])` works, and registering SVG *alone* leaves the Canvas renderer out of the bundle. The spine's "SVG renderer registered alone" is exact. `echarts` pins `zrender: 6.1.0` and `tslib: 2.3.0` as hard deps.

### F5 — `read-excel-file` 9.3.5's disabled worker path is real, but it is not the whole story (CONFIRMED, with a new finding)

The spine's claim is confirmed literally. In `modules/xlsx/parseSpreadsheetContents.js` at 9.3.5:

```js
var CAN_USE_WORKER = false;
...
if (!createWorkerFunction || !CAN_USE_WORKER) { /* synchronous path */ }
```

`createWorkerFunction` is still threaded through from `worker-f/browser`, but the constant is hardcoded `false` and the worker construction is commented out. The author's own comment explains why: structured-clone of cell data cost 10 ms / 70 ms / 500 ms on 1 MB / 10 MB / 50 MB files, "negating the effect of using `worker-f` in the first place." He switched to chunked parsing spaced by `setTimeout(0)` instead. This is the same conclusion AD-15 reached independently from R4's measurements.

**However — a worker still gets spawned on the import path.** The `/browser` entry chains `readXlsxFileBrowser.js` → `unpackXlsxFileBrowser.js` → `modules/zip/unzipFromArrayBuffer.js`, which calls **fflate's async `unzip()`**. fflate 0.8.3 creates workers as `new Worker(URL.createObjectURL(new Blob([...])))` — classic blob-URL workers. fflate falls back to synchronous decompression only for small or barely-compressed archives.

Two consequences:

- **Mechanically this should work from `file://`**, because a classic blob-URL worker is precisely the form the spine's own research found to be the only one that works there (AD-15). The code is inlined by fflate itself, so it survives the single-file build without an external chunk. AD-17 and AD-18 are not obviously threatened.
- **But AD-15's wording is now false as written.** "Workers exist only for the two exports, and only an adapter knows" — the XLSX *import* adapter transitively spawns workers too, through a dependency, with no querbeet code involved. The second half ("only an adapter knows") still holds; the first half does not.

**Recommendation:** amend AD-15 to acknowledge the fflate worker in the XLSX reader, or state explicitly that the rule governs querbeet-authored workers only. Either way, the Playwright artifact test should exercise an XLSX import larger than the fflate sync threshold, so this path is actually covered from `file://`.

### F6 — `hyparquet-writer` 0.16.3 is one patch behind (LOW)

0.16.3 was published 2026-07-31T22:36 UTC. **0.16.4 was published 2026-08-01T23:24 UTC** — late on the very day the spine says it verified. The pin was almost certainly correct at the moment it was taken; it went stale within hours.

The delta is one commit, "Support byte arrays in column statistics (#34)". Both versions declare an identical hard dependency `hyparquet: 1.27.1` and identical `exports`. The upgrade is low-risk.

**ESM-only, no UMD — CONFIRMED.** The 0.16.3 tarball has 76 files: `/src/*.js` (raw ESM source), `/types/*.d.ts`, LICENSE, package.json, README. There is **no `dist/` directory, no `.umd.js`, no `.min.js`**, and no `unpkg` or `jsdelivr` field in package.json. `"type": "module"`, `"sideEffects": false`, and `exports` uses a `browser` condition pointing at `./src/index.js` (the Node build is `./src/node.js`). The spine's claim holds exactly.

Note this repo moves fast: 0.16.1 → 0.16.4 all landed between 2026-06-20 and 2026-08-01, four releases in six weeks. A pin will go stale again quickly. `hyparquet-writer` also pins `hyparquet` to an exact version, so pinning the writer effectively pins the reader — the spine's two pins (0.16.3 / 1.27.1) are internally consistent.

### F7 — `json-formatter-js` 2.5.23 is the newest release, and it is 17 months old (LOW)

2.5.23 is the current `latest`, but it was published **2025-03-03**, and `mohsen1/json-formatter-js` last pushed the same day. MIT, 717 stars. It ships ESM (`.mjs`), CJS, **and a UMD browser build** (`dist/json-formatter.umd.cjs` under the `browser` export condition) — worth knowing, because a bundler resolving the `browser` condition will pick the UMD file, which is not what a single-file ESM build wants. Check the resolved condition at build time.

This is the least-maintained dependency in the stack after Arquero. It is a leaf display component, so the blast radius is small.

### F8 — Tailwind v4.3.3 exists and the split import genuinely allows omitting preflight (CONFIRMED)

`tailwindcss@4.3.3` published 2026-07-16, MIT, current `latest`. Its `exports` map ships all three pieces as separately importable files, and all three return HTTP 200:

- `tailwindcss/theme.css` → `./theme.css`
- `tailwindcss/preflight.css` → `./preflight.css`
- `tailwindcss/utilities.css` → `./utilities.css` (contents: `@tailwind utilities;`)

`tailwindcss/index.css` is the everything bundle — it declares `@layer theme, base, components, utilities;`, inlines `@theme default { ... }` and the preflight reset into `@layer base`, then closes with `@layer utilities { @tailwind utilities; }`. Importing `theme.css` + `utilities.css` and skipping `preflight.css` is therefore supported and does exactly what the spine says. `@tailwindcss/vite@4.3.3` declares `vite: ^5.2.0 || ^6 || ^7 || ^8`, so it is Vite 8 clean.

### F9 — Vitest: current is 4.1.10, and nothing about it conflicts with the core (LOW)

`vitest@4.1.10`, published 2026-07-06, MIT. Constraints that matter:

- `engines: node ^20.0.0 || ^22.0.0 || >=24.0.0`
- `peerDependencies.vite: ^6.0.0 || ^7.0.0 || ^8.0.0`, and **not optional** — Vitest 4 requires Vite. That is fine here; it aligns with F1's Vite 8.
- `vitest@5.0.0-beta.7` exists (2026-07-24). Do not adopt a beta.

AD-2 makes the core framework-free and browser-free, so it runs under the default Node environment with no jsdom or happy-dom. That is the cheapest possible Vitest configuration and it dodges every Vitest-4-era DOM-environment change. **No conflict found with the single-file / `file://` constraints, because Vitest never touches the built artifact** — AD-18 assigns that to Playwright.

Two Vitest 4 breaking changes are worth naming even for this minimal setup:

- **The default `exclude` list is now only `node_modules` and `.git`.** Vitest 3 also excluded `dist`, `cypress`, `.idea` and others. querbeet's `dist/` is where AD-18's single HTML artifact lands — harmless today, but the moment anything test-shaped appears under `dist/` it will be collected. Set `exclude` explicitly.
- **`vi.restoreAllMocks()` no longer resets spy state**; it only restores manually created spies. This can silently leak state between tests. AD-4's pure synchronous Steps need almost no mocking, so exposure is low — but the core's port doubles will use spies.

Other v4 changes (config: `poolOptions` hoisted, `maxThreads`/`maxForks` → `maxWorkers`, `workspace` → `projects`, `deps.*` → `server.deps.*`; behavioral: `mock.invocationCallOrder` now 1-based, `getMockName()` returns `"vi.fn()"`, reporter lifecycle hooks removed, `basic` reporter gone) matter only if migrating an existing config. This is a greenfield project, so they are non-issues.

**Recommendation:** pin `vitest@4.1.10` in the Stack table, set `exclude` explicitly, and note that the Vite peer must match whatever F1 settles on.

### F10 — Playwright: current is 1.62.1, and AD-18's "zero network requests" assertion needs verifying against `file://` (see below)

`@playwright/test@1.62.1`, published 2026-07-30, Apache-2.0, `engines: node >=20`. The version is real and current; `1.63.0-alpha-2026-08-02` shows daily alpha cadence.

The load-bearing question is not the version. AD-18 says: "The Playwright suite opens that artifact from a `file://` URL and asserts zero network requests beyond the document." That assertion depends on whether Playwright's network layer observes `file://`-scheme requests at all.

**I tested this empirically rather than reasoning about it.** Using a locally available Playwright 1.61.1 (one minor behind current), I built a `file://` page loading four same-directory subresources (`style.css`, `pic.png`, `chunk.js`, plus the document) and one `https://` fetch, then recorded `page.on('request')`, `page.on('response')`, `page.on('requestfailed')` and `page.route('**/*')` in both engines.

**Result — the answer differs by engine, and this breaks AD-18 in Firefox:**

| Observed by Playwright | Chromium | Firefox |
| --- | --- | --- |
| `file://` document | yes | **no** |
| `file://` subresources (css, png, js) | yes (all 3) | **no (none)** |
| `https://` request | yes | yes |
| `page.route()` intercepts `file://` | yes (all 4) | **no** |
| Total requests seen | 5 | **1** |

- **Chromium: AD-18 works as designed.** All `file://` subresource loads surface as request events and are interceptable. An accidental external chunk would be caught. Note that the document itself counts as a request, so "zero beyond the document" means asserting exactly 1.
- **Firefox: AD-18's assertion is vacuous for the failure it is meant to catch.** Playwright sees no `file://` traffic at all. If the single-file build silently split and emitted a sibling `chunk.js`, the Firefox run would report zero requests and **pass** — the exact silent failure AD-18 exists to prevent. The test cannot fail for that reason in Firefox.
- Firefox still sees `http(s)://` requests, so the AD-17 concern (a CDN link, an external font) *is* caught in both engines. It is specifically the split-bundle case that goes unobserved.

Two side confirmations from the same run, both supporting the spine:

- `fetch('https://…')` from a `file://` page failed in **both** engines (`Failed to fetch` / `NetworkError`), confirming AD-17's premise directly.
- `file://` subresources do load and execute in both engines — the difference is purely one of *observability*, not of behavior.

**Why Firefox is blind — confirmed at source level.** Playwright's Firefox network layer (`browser_patches/firefox/juggler/NetworkObserver.js` at v1.62.1) is built entirely on Gecko's HTTP-channel observer topics (`http-on-modify-request`, `http-on-examine-response`) and bails on anything else:

```js
_onRequest(channel, topic) {
  if (!(channel instanceof Ci.nsIHttpChannel))
    return;
```

`file://` loads use `nsIFileChannel`, never `nsIHttpChannel`. This is structural, not a bug, and it will not change. Chromium by contrast has no `file:`-scheme carve-out anywhere in `crNetworkManager.ts` (the only scheme special-case is `data:`), which is why it reports everything.

The good news buried in that: **an `http(s)` request is an HTTP channel regardless of the document's scheme**, so a stray CDN link, font, or beacon fired from a `file://` page *is* reported in both engines. AD-17's concern is fully covered. It is only AD-18's split-bundle case — a relative `./chunk.js` — that Firefox cannot see.

Supporting evidence from upstream: Playwright issue **#8412** ("`page.goto()` with route interceptor no longer works with `file:///` URLs", closed 2021-08-29) ends with maintainer Pavel Feldman writing: *"file:// does not go through the network stack and routing it might become an uphill battle in the modern browsers going forward… it is unlikely we'll be able to maintain file:// + routing long term."* Chromium's behavior today is better than that statement implies; Firefox's matches it. Either way, **file:// network observability is explicitly not a supported guarantee** and could regress in a future release.

`page.goto('file://…')` itself is fine and actively covered by Playwright's own suite (PR #42053, 2026-07-30, "test(page): cover file URL to about:blank navigation").

**Recommendation:** amend AD-18. The one-entry `dist/` filesystem check is engine-independent and is the real guard — keep it and lean on it. Scope the zero-network assertion to **Chromium** and say so explicitly; run Firefox for behavior, not for network accounting. Do not write the assertion in a way that lets a green Firefox run be read as proof the bundle is single-file.

**Caveat:** my probe ran on 1.61.1, not the current 1.62.1. The Juggler and `crNetworkManager` source facts above were read at tag **v1.62.1**, and they match what the probe measured, so the result carries over. Re-run the probe against the pinned version anyway.

**Three further Playwright constraints, from reading v1.62.1 source and tests:**

- **`page.goto()` returns `null` on Firefox for a `file://` URL.** Playwright's own suite skips Firefox on `should provide a Response with a file URL` with the comment *"Firefox does return null for file:// URLs"*. So `(await page.goto(url)).status()` **throws** on Firefox. Write the navigation without touching the response object.
- **Playwright 1.61 had a Firefox `file://` → `about:blank` navigation regression** (#42050, *"interrupted by another navigation"*), fixed in **1.62** by PR #41859 with a regression test landed 2026-07-30. Pinning 1.62.1 puts the project on the right side of this — another reason not to leave the row unpinned.
- **`page.route()` does not intercept `blob:` URLs** outside WebKit (`interception.spec.ts`: `should intercept blob url requests` is `skip(browserName !== 'webkit')`). But **http fetches made from inside a blob-URL worker *are* intercepted and reported on all engines**. Relevant to AD-15: a worker that phoned home would still be caught.

### F10b — Playwright's bundled Firefox disables `file://` origin isolation, which weakens AD-16's testability (MEDIUM)

This one is architectural, not a version issue, and it was not on the review checklist — it surfaced while checking Playwright's launch defaults.

Playwright ships its own Firefox build with `browser_patches/firefox/preferences/playwright.cfg` baked in, containing:

```
// Local documents have access to all other local documents,
// including directory listings
pref("security.fileuri.strict_origin_policy", false);
```

Stock Firefox defaults this pref to **`true`**. Playwright's Firefox sets it **`false`**, meaning *your entire disk is one origin* — strictly **more permissive** than what a real user gets double-clicking `querbeet.html`.

Consequences for the spine:

- **AD-16 is about exactly this boundary.** R9 measured that the `file://` origin is one shared bucket across directories, and AD-16 namespaces `SessionStore` keys in response. Under Playwright's Firefox, cross-document local access is wide open, so a test that *should* demonstrate isolation failure will behave differently from the real product — in the permissive direction. A regression in the discriminator could pass the suite and fail for the user.
- The correction is a one-liner in `playwright.config.ts`:

```ts
use: { launchOptions: { firefoxUserPrefs: { 'security.fileuri.strict_origin_policy': true } } }
```

`firefoxUserPrefs` is honored — `ffBrowser.ts` merges it into `Browser.enable`, and the internal `kBandaidFirefoxUserPrefs` override table is currently empty.

**Correction to a premise in the review brief:** `privacy.file_unique_origin` — often cited as the Firefox `file://` isolation switch — **was removed in Firefox 95** (Bugzilla 1732052) and is absent from current `StaticPrefList.yaml`. Playwright 1.62 ships Firefox 153, so that pref no longer exists at all. The surviving pref is `security.fileuri.strict_origin_policy`. Any R-run note or spine wording that references `privacy.file_unique_origin` is out of date.

Chromium, for its part, is clean: `chromiumSwitches.ts` at v1.62.1 contains **no** `--allow-file-access-from-files` and no `--disable-web-security`, so Chromium runs at stock `file://` origin semantics. It does disable background networking, component update, and the `HttpsUpgrades` feature — all of which reduce stray network noise and help AD-18.

### F11 — Module-format notes that affect a single-file ESM build (LOW, but check before building)

Collected while verifying the pins. None is a version error; each is a shape that could surprise the build.

- **PapaParse 5.5.4 is a UMD script with no `exports` and no `module` field** — `main: papaparse.js`, no `"type"`. Vite will interop it as CJS. It also carries its own worker: `getWorkerBlob()` stringifies Papa's own source into a `Blob` and does `new Worker(URL.createObjectURL(...))`, so `worker: true` would in fact survive both bundling and `file://`. AD-15 says workers exist only for the two exports, so **PapaParse's `worker` option must stay off** — the spine currently only says `dynamicTyping` is permanently off. Worth naming both.
- **`write-excel-file` 4.1.1 depends on `fflate ^0.8.2`**, and fflate's async zip spawns blob-URL workers. AD-15 already puts XLSX export inside a worker, which means fflate would be spawning a **nested** worker from inside a blob-URL worker on a `file://` origin. That combination is not covered by any R-run cited in the spine. Either verify it or force fflate's synchronous path.
- **`json-formatter-js` 2.5.23 resolves to a UMD file under the `browser` export condition** (`dist/json-formatter.umd.cjs`), while `import` gives `dist/json-formatter.mjs`. Confirm which condition the build resolves.
- **`jsonrepair` 3.15.0 is ISC-licensed, not MIT** — a trivial but real correction if a licence inventory is ever produced. Everything else in the stack is MIT except Arquero (BSD-3-Clause) and ECharts (Apache-2.0).
- **`hyparquet` 1.27.1 is pure ESM with zero dependencies** — the cleanest thing in the stack.

## Summary of Recommended Spine Changes

1. **Pin the build row.** `Vite 8.2.0` + `vite-plugin-singlefile 2.3.3`, with `vite 7.3.6` named as the Rollup-based fallback. Gate everything downstream on an actual single-file build spike (F1).
2. **Pin the test row.** `Vitest 4.1.10`, `@playwright/test 1.62.1` (F9, F10).
3. **Bump `hyparquet-writer` to 0.16.4**, or state that 0.16.3 is deliberate (F6).
4. **Amend AD-15.** The XLSX import path spawns fflate blob-URL workers; "workers exist only for the two exports" is not true as written (F5).
5. **Restate the Arquero pin as deliberate vendoring of a dormant dependency**, not as a currency claim (F2).
6. **Amend AD-18.** Scope the zero-network assertion to Chromium and say so. In Firefox it cannot observe `file://` traffic and would pass a split bundle. Monitor with `page.on('request')` + `page.on('requestfailed')` only — never `page.route()`, which is explicitly unsupported on `file://`. The `dist/` one-entry check is the engine-independent guard (F10).
7. **Set `security.fileuri.strict_origin_policy: true` in the Playwright Firefox project**, or AD-16's isolation behavior is tested under a more permissive origin model than the real product runs in. Drop any reference to `privacy.file_unique_origin` — that pref was removed in Firefox 95 (F10b).
8. **Name PapaParse's `worker: false` alongside `dynamicTyping: false`**, and verify or forbid fflate's nested worker inside the XLSX export worker (F11).
