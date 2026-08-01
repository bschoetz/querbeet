# Original measurement: the Vite single-file build path, end to end

Run 2026-08-01, after the project chose the build path (Path B) over the report's Path A
recommendation. The probe sources are preserved alongside under `build-probe/`.

## Why this was measured

Two questions decided whether Path B is safe to commit to, and neither could be answered from
documents. First, the whole path had never been run end to end — the report's claim that a
`vite-plugin-singlefile` output works from `file://` was an inference from two separate measured
facts, not a built artifact anyone had opened. Second, the plugin has no worker support, and the
literature warned that a worker emitted as a separate chunk would break both the single-file goal
and `file://` loading. A build either produces one working file or it does not; that is testable.

## Method

A minimal but realistic app: Vue 3 Single-File Component with `<script setup>`, a scoped `<style>`,
Arquero performing a real `filter` over a table, rows frozen with `Object.freeze` and held in
`shallowRef` (the architecture rule this research produced), and a Web Worker doing a round trip.
Built with `vite build`, then the output opened over a real `file://` URL in headless Chromium
150.0.7871.186 and Firefox 153.0.1.

Versions, all current on the day: `vite@8.2.0`, `@vitejs/plugin-vue@6.0.8`,
`vite-plugin-singlefile@2.3.3`, `vue@3.5.40`, `arquero@8.0.3`.

Config, in full — this is the whole file:

```js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  worker: { format: 'iife' },   // classic worker; a module worker from a blob URL fails in Chromium
})
```

The worker is imported per call site with the inline suffix, which is the part that matters:

```js
import DataWorker from './worker.js?worker&inline'
const w = new DataWorker()
```

## Results

**Build output: exactly one file.** `dist/index.html`, **280,519 bytes** (93.9 KB gzip), nothing
beside it. The plugin logged `Inlining: index-….js` and `Inlining: style-….css`.

**Runtime, from `file://`, identical in both engines:**

```
status=mounted rows=4 rowIsProxy=false worker=worker-alive:42
```

Vue mounted, Arquero's filter ran and returned 4 rows, the frozen rows were **not** proxied by
`shallowRef`, and the inlined worker received 21 and answered 42. Scoped CSS applied
(`data-v-6b8f5a5a`). The whole architecture works as one artifact.

**Size, against the no-build path.** Path A would ship Vue's global build (165,599 B) plus
Arquero's UMD bundle (236,290 B) = **401,889 B** before a line of application code. The built file
is **280,519 B including** the app, its CSS and the worker — about **121 KB (30%) smaller**. Two
causes: templates are compiled at build time, so Vue's runtime-only build is what ships (no
in-browser template compiler — confirmed: the output contains no `compileToFunction`), and Arquero
is tree-shaken to what the app actually imports.

## The trap, confirmed by measurement

Rebuilding with Vite's *idiomatic* worker syntax and nothing else changed:

```js
const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
```

- **The build still reports success** — same "✓ built in 263ms", same inlining log lines.
- **`dist/` now contains two files**: `index.html` and `worker-Dvg4tSHy.js`.
- **From `file://` the app is broken**: `status=starting … worker=(pending)`. The worker
  constructor throws synchronously in Chromium — the documented `file://` behaviour — and takes
  the rest of `onMounted` down with it, so the status line never advances.

Nothing in the build output says anything is wrong. This is the single most dangerous property of
the path: **build success does not imply a working artifact.** The guardrail is mechanical — assert
that `dist/` contains exactly one file, and fail the build if not.

## Two corrections to earlier findings in this run

- **`crossorigin` is not stripped.** The built file's tag is `<script type="module" crossorigin>`.
  D1 reported the plugin removes the attribute; it preserves the original tag's attributes. Inert
  on an inline script, so harmless — but the claim was wrong.
- **The modulepreload polyfill is not stripped either.** It is present in the output as an IIFE
  containing a `fetch(e.href, n)` call. It is inert because a single file has no
  `link[rel=modulepreload]` for it to act on, but it is dead weight and one more thing that could
  reach for the network. Set `build.modulePreload: { polyfill: false }`.

## Limits of this measurement

- A minimal app: one component, one worker, one Arquero call, ~5 rows. It proves the *path* works;
  it does not exercise 100k rows, multiple sources, file input, or XLSX export. Nothing here
  contradicts the reactivity measurements, which were made separately and at full scale.
- Headless browsers at versions above the project's floor (Chromium 150 / Firefox 153 vs. the
  stated Chrome 143 / Firefox 145). Safari untested.
- One build per variant, no repetition. The outcomes are categorical (one file or two; mounts or
  does not), so repetition would add nothing.
- The size comparison is not like-for-like by construction: the built file includes application
  code that the Path A figure excludes. The comparison still favours the build path, and by more
  than the app code accounts for.
