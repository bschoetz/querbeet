# npm package audit — node-graph editor candidates

**Measured by the lead, not retrieved from a page.** Method: the npm registry JSON API read
directly (`https://registry.npmjs.org/<pkg>`) on 2026-08-01, then the published tarballs
installed with npm 12.0.1 / Node 26.5.0 and their shipped files inspected on disk. Raw registry
response: `npm-registry-2026-08-01.json` in this folder.

This is a **package-level** audit. It establishes what the published artefact contains; it does
**not** establish what a built single-file bundle does at runtime from `file://`. That is D3's job.

## Release recency and licence, from the registry

`published` is the publish timestamp of the version the `latest` dist-tag points at.
`releases since 2025-08-01` counts every version published inside the 12-month gate window,
which is a cadence signal a single snapshot cannot give.

| Package | latest | published | licence (manifest) | releases since 2025-08-01 |
| --- | --- | --- | --- | --- |
| `@vue-flow/core` | 1.48.2 | 2026-01-28 | MIT | 11 |
| `@vue-flow/background` | 1.3.2 | 2024-11-13 | MIT | 0 |
| `@vue-flow/controls` | 1.1.3 | 2025-08-07 | MIT | 1 |
| `@vue-flow/minimap` | 1.5.4 | 2025-08-15 | MIT | 1 |
| `baklavajs` (meta) | 2.8.1 | 2025-11-02 | MIT | 2 |
| `@baklavajs/renderer-vue` | 2.8.1 | 2025-11-02 | MIT | 2 |
| `rete` | 2.0.6 | 2025-06-30 | MIT | 0 |
| `rete-vue-plugin` | 2.1.3 | 2026-07-10 | MIT | 1 |
| `rete-area-plugin` | 2.3.2 | 2026-07-08 | MIT | 7 |
| `rete-connection-plugin` | 2.0.5 | 2024-08-30 | MIT | 0 |
| `drawflow` | 0.0.60 | 2024-09-03 | MIT | 0 |
| `litegraph.js` | 0.7.18 | 2024-01-08 | MIT | 0 |
| `@jsplumb/browser-ui` | 6.2.10 | 2023-07-14 | (MIT OR GPL-2.0) | 0 |
| `@antv/x6` | 3.1.7 | 2026-03-18 | MIT | 23 |
| `@maxgraph/core` | 0.24.0 | 2026-07-08 | Apache-2.0 | 3 |
| `@joint/core` | 4.3.1 | 2026-07-27 | MPL-2.0 | 15 |
| `jointjs` (old name) | 3.7.7 | 2023-11-07 | MPL-2.0 | 0 |
| `gojs` | 4.0.3 | 2026-07-17 | SEE LICENSE IN license.html | 22 |

Notes that the table alone does not carry:

- **`@antv/x6`'s `latest` tag is stale relative to its own publishing.** The `latest` dist-tag
  resolves to 3.1.7 (2026-03-18) while versions 3.2.7 and 3.3.7 were both published later, on
  2026-05-19. An `npm i @antv/x6` therefore does not install the newest published code.
- **`jointjs` was renamed.** The `jointjs` package's last stable is 3.7.7 (2023-11-07) and its
  newest entries are 4.0.0-alpha pre-releases from 2024-01; the maintained line is `@joint/core`,
  which is on 4.3.1 (2026-07-27) with 15 releases in the window. Screening `jointjs` by name alone
  would have wrongly scored the project as dead.
- **`gojs` declares no SPDX licence** — the manifest says `SEE LICENSE IN license.html`, which is
  how a commercial licence presents itself in the registry.
- **Drawflow, LiteGraph.js and `@jsplumb/browser-ui` have zero releases in the gate window** —
  1 year 11 months, 2 years 7 months and 3 years 0 months since their last publish respectively.

## Licence verification against the published tarball

The project's rule is to read the LICENCE **in the published package**, not in the repository,
because the two can disagree. Result:

| Package | manifest `license` | LICENCE file shipped in the tarball |
| --- | --- | --- |
| `@vue-flow/core` | MIT | **yes** — `LICENSE` |
| `baklavajs` | MIT | **yes** — `LICENSE` |
| `@baklavajs/core` | MIT | **yes** — `LICENSE` |
| `@baklavajs/renderer-vue` | MIT | **yes** — `LICENSE` |
| `rete` | MIT | **no file** |
| `rete-vue-plugin` | MIT | **no file** |
| `rete-area-plugin` | MIT | **no file** |
| `rete-connection-plugin` | MIT | **no file** |

**None of the four Rete packages ships a licence file at all.** The MIT claim rests entirely on
the `license` field in `package.json`. This is not evidence that Rete is not MIT — the repository
states MIT — but it is precisely the verification the project's G4 gate asks for, and Rete is the
one candidate family that cannot satisfy it from the artefact you actually install.

## Runtime-fetch hazards in the shipped files

Every `.js` / `.mjs` / `.cjs` / `.css` file in each package (source maps excluded) was searched
for `import(`, `fetch(`, `new Worker`, `importScripts`, `XMLHttpRequest` and `@font-face`, and
every CSS file for `url(...)`.

| Package | `import(` | `fetch(` | `new Worker` | `@font-face` | non-`data:` `url()` |
| --- | --- | --- | --- | --- | --- |
| `@vue-flow/core` | none | none | none | none | none |
| `@baklavajs/*` (all) | none | none | none | none | none |
| `rete` + area/connection/vue plugins | none | none | none | none | none |

The CSS the libraries ship is small and self-contained: `@vue-flow/core` ships
`style.css` (3,930 B) and `theme-default.css` (3,470 B); `@baklavajs/themes` ships
`classic.css` (20,949 B) and `syrup-dark.css` (20,962 B). **No `url()` of any kind appears in any
of the four files, and no `@font-face` rule appears in any of them** — so no icon sprite and no
web font to inline or to lose.

The only `http(s)://` strings in the shipped JavaScript are XML namespace constants
(`http://www.w3.org/2000/svg` and siblings) and three comment links to GitHub and to a TypeScript
pull request. None is a fetch.

**Conclusion at package level: all three candidate families pass the no-runtime-fetch gate.**
The gate is not yet closed — a bundler can still emit a chunk, and only the built file opened
from a real `file://` URL settles it.

## Dependency surface

| Package | runtime dependencies | peer |
| --- | --- | --- |
| `@vue-flow/core` | `@vueuse/core ^10.5.0`, `d3-drag ^3`, `d3-interpolate ^3`, `d3-selection ^3`, `d3-zoom ^3` | `vue ^3.3.0` |
| `baklavajs` | its own `@baklavajs/*` scope only | none declared |
| `@baklavajs/renderer-vue` | `@baklavajs/core`, `@baklavajs/events` | none declared |
| `rete` | `@babel/runtime ^7.21.0` | none |
| `rete-vue-plugin` | `@babel/runtime ^7.21.0` | `rete ^2.0.1`, `rete-area-plugin ^2`, `rete-render-utils ^2`, **`vue ^2.6 \|\| ^3.2`** |

Two things follow:

- **Vue Flow does not implement its own pan/zoom.** It delegates to `d3-zoom` / `d3-drag` /
  `d3-selection`, which is the same engine most of the field uses, and it pulls `@vueuse/core`.
  Four extra packages, all inlineable, but they are the pan/zoom implementation rather than an
  optional extra.
- **`rete-vue-plugin` declares a Vue 2 *or* Vue 3 peer range and resolves `vue-demi`** — the
  Vue 2/3 compatibility shim was installed as a transitive dependency. It is therefore a
  version-straddling renderer, not a Vue-3-native one, which is exactly what gate G2 was written
  to catch.
