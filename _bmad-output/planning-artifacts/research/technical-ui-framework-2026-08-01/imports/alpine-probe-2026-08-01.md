# Original measurement: Alpine.js 3.15.12 with 100k frozen rows, run from `file://`

Run for this decision on 2026-08-01. The probe page is preserved alongside as
`alpine-file-url-probe.html`; open it by double-click to reproduce. It pulls Alpine from a CDN by a
classic `<script src>`, which loads fine from a `file://` page — swap in a local copy to run offline.
Results appear in the `<pre id="out">` block at the top of the page.

## Why this was measured

Three claims decisive for Alpine as a candidate had no evidence either way in the retrieved
literature: whether freezing rows really keeps them out of Alpine's proxy layer *in a running
app* (as opposed to in the bundle's source, where the mechanism was read); whether `x-model`
bound to a property of an `x-for` iteration variable writes back into the source array; and
whether Alpine can express a step list whose items are of different kinds. The first is a hard
gate (G5), the second and third decide whether the app can be built at all. All three are
cheaper to test than to search for.

## Method

- **Browsers:** Chromium 150.0.7871.186 and Firefox 153.0.1 (Arch Linux), both headless, both
  loaded over a real `file://` URL, no permissive flags. Chromium additionally ran with
  `--enable-precise-memory-info` for the heap figure.
- **Page:** a single HTML file with Alpine 3.15.12 (`dist/cdn.min.js`, 46,346 B) loaded as a
  classic sibling script. 100,000 rows × 20 columns are built and `Object.freeze`d — rows and
  the array itself — *before* Alpine initialises, then handed to `x-data` as a plain property.
  A `x-for` renders a 50-row window (`rows.slice(0, 50)` via a getter). A second `x-for`
  renders three steps of *different kinds* (filter / join / union), each with its own config
  control inside `x-if`, each `x-model`-bound to a nested property of its step object.
- **Assertions** read the live component scope via `Alpine.mergeProxies(el._x_dataStack)` and
  compare `Alpine.raw(x) !== x` to detect a proxy. Write-back is exercised by setting an
  input's `value` and dispatching a real `input`/`change` event, then reading the raw data.

## Results

| Check | Result |
| --- | --- |
| Rows rendered from the frozen 100k array | **50** |
| Steps rendered, of three different kinds | **3** — `filter,join,union` |
| Row array proxied inside `x-data`? | **false** |
| Row object proxied? | **false** |
| Row identity preserved (`Alpine.raw(scope.rows[0]) === original`) | **true** |
| Row still frozen inside the component | **true** |
| Step array proxied (i.e. still reactive)? | **true** |
| `x-model` write-back through `x-for` into a nested object | **works** — `"typed-by-user"` |
| `<select>` + `x-model` write-back | **works** — `"b"` |
| Replacing the whole frozen array re-renders the window | **works** — first row became `REPLACED` |
| Rows still unproxied after the replacement | **false** (i.e. still no proxy) |
| Used JS heap with 100k × 20 frozen rows loaded | **77.6 MB** (Chromium only) |

**Firefox 153.0.1 reproduces every row above identically** — same 50 rows rendered, same three step
kinds, no proxy on the array or the rows, identity and frozenness preserved, the step array still
proxied, both write-backs landing, and the array replacement re-rendering to `REPLACED`. The only
absent field is the heap figure, since `performance.memory` is Chromium-only.

## Findings

1. **The freeze hatch works in a running Alpine app, not just in theory.** 100,000 rows sit
   inside `x-data` and Alpine creates no proxy for them, while `x-for` renders a window over
   them normally and `Alpine.raw()` returns the very same object that was put in. This is the
   gate-G5 answer for Alpine, and it is a *positive* one — the hypothesis that Alpine has no
   escape hatch and therefore fails the gate is wrong.
2. **The reactivity split falls out exactly right.** In the same component the small, mutable
   step array *is* proxied and fully reactive, while the large frozen dataset is not. That is
   precisely the architecture the app wants, and it needs no special discipline beyond calling
   `Object.freeze` on data as it enters.
3. **`x-model` writes back through `x-for` into nested config objects.** Both a text input
   (`step.config.value`) and a `<select>` (`step.config.mode`) updated the source array. The
   heterogeneous-step-list pattern is expressible in Alpine with `x-for` + `x-if` + `x-model`,
   with no component system required.
4. **Replacing the frozen array wholesale re-renders the preview**, and the replacement rows
   stay unproxied. So the pipeline's "each step emits a fresh array" model composes with the
   freeze hatch — freeze the new result, assign it, done.

## Limits of this measurement

- Two engines, but neither at the project's floor versions (Chrome 143 / Firefox 145); 150 and 153
  were what this machine had. Safari/WebKit is untested — no engine available here.
- The re-render timing recorded (120 ms) is dominated by the probe's own `setTimeout` and is
  **not** a measurement of re-render cost. All it establishes is that the re-render completed
  within that window. A real timing needs a `MutationObserver` or `requestAnimationFrame`.
- The 77.6 MB heap figure is not comparable to the Node benchmark's 159.7 MB: this page uses
  shorter string values. It is reported only as evidence that the frozen dataset does not
  explode in a browser tab.
- Only three steps and a 50-row window were rendered — the shape of the real UI, but not a
  stress test. Nothing here measures Alpine's `x-for` cost on a *large* rendered list, which
  remains an open question and is why the preview must stay windowed.
- The freeze hatch is a documented-by-code behaviour of the bundled `@vue/reactivity`, not a
  documented Alpine API. It is therefore unsupported and could in principle change on an
  Alpine dependency bump — a live risk, since a PR bumping that dependency is open upstream.
