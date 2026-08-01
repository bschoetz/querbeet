# Capability digest R2-1 — Arquero programmability, concat/join semantics, DuckDB-WASM version, Danfo.js merge

Accessed 2026-08-01. Arquero version read: **npm `arquero@8.0.3`** (registry `latest`); source files read from the **`main` branch** of `github.com/uwdata/arquero`, which may be ahead of 8.0.3 — noted per claim.

---

## Q1 — Constructing `derive`/`filter` expressions programmatically

- **Arquero explicitly documents passing a table expression as a plain string, which Arquero parses itself.** The expressions guide states: "To parse table expressions, Arquero first maps input functions to source code strings. We can simply skip this step and pass a string directly." — `source:` https://idl.uw.edu/arquero/api/expressions · `publisher:` UW Interactive Data Lab · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **Two documented string forms exist: a full function string `"d => op.sqrt(d.value)"`, and a bare expression string `"sqrt(d.value)"` where "an implicit function definition is assumed and the row identifier defaults to `d`".** — `source:` https://idl.uw.edu/arquero/api/expressions · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **Template-literal interpolation of runtime values into an expression string is documented: ``table.filter(`d => d.value < ${threshold}`)``.** — `source:` https://idl.uw.edu/arquero/api/expressions · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **The arrow-function style and the string style are the *same* code path: Arquero converts author-written functions to source strings and re-parses them, so a UI-built string is not a degraded mode.** This follows directly from the documented sentence above ("Arquero first maps input functions to source code strings. We can simply skip this step"). — `source:` https://idl.uw.edu/arquero/api/expressions · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **`op` is a single unified catalog of all built-in functions; any function invocation inside a table expression is resolved by name against `op`.** Docs: "For _any_ function invocation, the function name will be looked up on the `op` object, even if the function is called directly." Callable as `op.sqrt()`, bare `sqrt()`, or `aq.op.sqrt()`. — `source:` https://idl.uw.edu/arquero/api/expressions · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **`op` functions are NOT composable as free-standing JavaScript values inside a table expression — they are resolved symbolically at parse time.** This is an inference from the "looked up on the `op` object" wording plus the parser's code-generation step; you compose them by composing *expression text* (or by writing the composition inside an `escape`d closure), not by building an object graph of `op` calls. — `source:` https://idl.uw.edu/arquero/api/expressions · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability

- **`escape()` "Annotate[s] a JavaScript function or _value_ to bypass Arquero's default table expression handling… no internal parsing or code generation is performed, and so closures and arbitrary function invocations are supported."** — `source:` https://idl.uw.edu/arquero/api/ · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **`escape()` costs three things, all documented: no aggregate or window `op` functions, it "sidestep[s] internal optimizations", and it breaks serialization of Arquero queries to worker threads (arquero-worker), producing an error on serialization attempts.** — `source:` https://idl.uw.edu/arquero/api/expressions and https://idl.uw.edu/arquero/api/ · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **Escaped values are detected structurally by the parser via an `escape` property, confirming escape is a first-class parser branch and not a doc-only convenience:** `main` branch `src/expression/parse.js` contains `value.escape ? parseEscape(ctx, value, params) : parseExpression(ctx, value)`. — `source:` https://raw.githubusercontent.com/uwdata/arquero/main/src/expression/parse.js · `publisher:` UW IDL (source) · `pub_date:` undated (main branch) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **A params mechanism exists for injecting runtime values (including column names) into an otherwise static arrow function: expressions may take a second argument `$` bound to table params, e.g. `(d, $) => d[$.col]`.** Seen in the parser test suite: `parse({ f: (d, $) => d[$.col] }, opt)`. — `source:` https://raw.githubusercontent.com/uwdata/arquero/main/test/expression/parse-test.js · `publisher:` UW IDL (source) · `pub_date:` undated (main branch) · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability

- **There is no documented public builder or AST-level expression API.** An internal `ast` option exists in the parser (`const e = node.escape || (opt.ast ? clean(node) : compileExpr(generate(node), params))` in `src/expression/parse.js`), but it is not surfaced in the public API docs and should be treated as private. — `source:` https://raw.githubusercontent.com/uwdata/arquero/main/src/expression/parse.js + https://idl.uw.edu/arquero/api/ · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability

- **Arquero performs runtime code generation internally on every non-escaped expression:** the parser ends in `compileExpr(generate(node), params)`, i.e. generated source compiled into a callable. A CSP that forbids `unsafe-eval` therefore threatens *all* Arquero expression use, not only the string path. — `source:` https://raw.githubusercontent.com/uwdata/arquero/main/src/expression/parse.js · `publisher:` UW IDL (source) · `pub_date:` undated (main branch) · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability (inference from a single code line; not documented)

### Concrete shape for a UI-built filter from `{column, operator, value}`

Such a shape **does exist**. Three viable options, in descending order of safety:

**(A) `escape()` with a closure built at runtime — no source strings at all.** Documented to support closures and arbitrary function invocation.

```js
import { escape } from 'arquero';

const ops = {
  '>':  (a, b) => a >  b,
  '>=': (a, b) => a >= b,
  '<':  (a, b) => a <  b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

function buildFilter({ column, operator, value }) {
  const cmp = ops[operator];                 // chosen from a fixed allow-list
  return escape(d => cmp(d[column], value)); // closure over UI state
}

table.filter(buildFilter(uiState));
```
Cost: no aggregate/window `op` functions inside that closure, no internal optimization, and query serialization to a worker thread will error.

**(B) Params + a fixed set of authored arrow functions — keeps the optimized/serializable path.** Column and value come from params; only the operator selects among predefined functions (a finite, author-written set — exactly what a UI operator dropdown is).

```js
const preds = {
  '>':  (d, $) => d[$.col] >  $.val,
  '<':  (d, $) => d[$.col] <  $.val,
  '==': (d, $) => d[$.col] === $.val,
};
table.params({ col: column, val: value }).filter(preds[operator]);
```
Confidence medium — the `(d, $)` params form is evidenced in the parser test file, and `escape` docs note params exist, but the surrounding `table.params()` contract was not read this run.

**(C) String expression assembled from UI state — the documented string path.**
```js
table.filter(`d => d.${column} ${operator} ${JSON.stringify(value)}`);
```
This is documented and supported, but it *is* generating JavaScript source at runtime, so column names and values must be validated/escaped by the app (identifier allow-list from the actual schema; `JSON.stringify` for literals). For a computed column the same shape applies: `table.derive({ [newName]: `d => d.${a} * d.${b}` })`.

Bottom line for the decision: **the app does not have to hand-write arrow functions at author time, and option (A) avoids generating source strings entirely.** Options (A) and (C) both work today; (A) trades away worker serialization and aggregate/window ops, (C) trades away source-string safety.

---

## Q2 — `concat` / `union` fill semantics

- **A column present in the receiving table but absent from an incoming table is filled with `undefined`; it does not throw.** `src/verbs/concat.js` (main branch) does `const col = table.column(name) || { at: () => NULL };` and `src/util/null.js` defines `export const NULL = undefined;`. — `source:` https://raw.githubusercontent.com/uwdata/arquero/main/src/verbs/concat.js + https://raw.githubusercontent.com/uwdata/arquero/main/src/util/null.js · `publisher:` UW IDL (source) · `pub_date:` undated (main branch) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **`concat` keeps only the columns of the *receiving* (first) table; columns that exist only in an incoming table are silently DROPPED.** The implementation iterates `table.columnNames().forEach(...)` — the incoming tables' own column lists are never consulted. This is a material trap for a union-with-column-mapping UI: mapping must be applied *before* concat, or data disappears without error. — `source:` https://raw.githubusercontent.com/uwdata/arquero/main/src/verbs/concat.js · `publisher:` UW IDL (source) · `pub_date:` undated (main branch) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **`concat` short-circuits and returns the receiving table unchanged when the incoming tables contribute zero rows** (`if (trows === nrows) return table;`). — same source · `confidence:` high · `class:` capability

---

## Q3 — Join behavior on duplicate keys

- **Arquero joins produce the full cartesian product of matching rows on duplicate keys, i.e. standard SQL semantics.** `src/verbs/join.js` (main branch) `hashJoin` looks up the match list for a key and emits one output row per entry: `const list = lut.get(...); if (list) { const n = list.length; for (let k = 0; k < n; ++k) { const i = list[k]; emitScan(...); } }`. — `source:` https://raw.githubusercontent.com/uwdata/arquero/main/src/verbs/join.js · `publisher:` UW IDL (source) · `pub_date:` undated (main branch) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **Left/right/full outer semantics are implemented as a post-pass over unmatched rows, emitting a sentinel index (`NONE`) for the missing side** — `if (options.left) { for (…) if (!hitL[i]) emit(idxL[i], dataL, NONE, dataR); }` and the symmetric right branch; both flags true gives a full join. Unmatched cells therefore resolve to the same `undefined` missing value used elsewhere. — same source · `confidence:` high (emit logic) / medium (that the filled cell is literally `undefined` — inferred from the shared `NULL` convention, not read in the emit implementation) · `class:` capability

- **No warning about row-count blow-up on duplicate keys appears in the API reference.** The join section of https://idl.uw.edu/arquero/api/ returned no material on duplicate keys or cartesian products when queried. Absence of evidence, from one page fetch. — `source:` https://idl.uw.edu/arquero/api/ · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability

---

## Q4 — DuckDB-WASM version

- **The npm `latest` dist-tag for `@duckdb/duckdb-wasm` is `1.33.1-dev57.0`, and `next` is `1.33.1-dev64.0` — installing `@duckdb/duckdb-wasm` with no version pin ships a development build.** dist-tags read directly from the registry: `{"latest": "1.33.1-dev57.0", "next": "1.33.1-dev64.0"}`. — `source:` https://registry.npmjs.org/@duckdb/duckdb-wasm · `publisher:` npm registry · `pub_date:` n/a (live) · `accessed:` 2026-08-01 · `confidence:` high · `class:` version

- **The most recent non-prerelease GitHub release of duckdb-wasm is `v1.33.0`, published 2025-12-16, `prerelease: false`.** Its release note reads: "There are no real differences from 1.32.0, but NPM publishing setup had been off, this aims at correct that." — `source:` https://api.github.com/repos/duckdb/duckdb-wasm/releases/latest · `publisher:` DuckDB Labs / GitHub · `pub_date:` 2025-12-16 · `accessed:` 2026-08-01 · `confidence:` high · `class:` version

- **Recommendation: pin `@duckdb/duckdb-wasm@1.33.0` explicitly rather than relying on `latest`.** Inference from the two facts above. — `confidence:` medium · `class:` version

- **The "1.5.4" figure attributed to duckdb.org is most likely the bundled DuckDB *engine* version, not the duckdb-wasm npm package version, which tracks its own 1.3x.x line.** UNVERIFIED — the duckdb.org Wasm overview page returned only a redirect stub this run and could not be read. — `source:` https://duckdb.org/docs/stable/clients/wasm/overview.html (fetch failed, redirect stub) · `accessed:` 2026-08-01 · `confidence:` low · `class:` version

---

## Q5 — Danfo.js `merge`

- **`merge` supports multi-key joins: the `on` option is typed `Array<string>` and the implementation loops `for (let i = 0; i < this.on.length; i++)` over all keys.** — `source:` https://raw.githubusercontent.com/javascriptdata/danfojs/dev/src/danfojs-base/transformers/merge.ts · `publisher:` JSData / danfo.js (source, `dev` branch) · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability

- **`merge` supports four join types via `how`: `"outer" | "inner" | "left" | "right"`, with unmatched cells filled with `NaN`.** — same source · `confidence:` medium · `class:` capability

- **Danfo.js `concat` column alignment by name: NOT INVESTIGATED this run** (budget exhausted). No claim.

---

## Leads

- `table.params()` contract — read `src/table/Table.js` / the API doc entry for `params` to confirm option (B) above and whether params are serializable to workers. This is the path that would give a click-driven UI dynamic columns *without* strings and *without* the `escape` penalties.
- `src/expression/parse.js` `opt.ast` branch — if the AST output is stable, a genuine builder API may be reachable, but it is undocumented and would be a private-API dependency.
- `github.com/uwdata/arquero-worker` — confirm whether it is still maintained; if the project never uses worker threads, the main documented cost of `escape()` is moot and option (A) becomes near-free.
- Whether `main` branch source differs from the published `8.0.3` tarball for `concat.js`, `join.js`, `null.js` — re-read at tag `v8.0.3` before relying on the Q2/Q3 claims in production.
- DuckDB Wasm docs live page (follow the redirect from `/docs/stable/clients/wasm/overview.html`) to resolve the 1.5.4 vs 1.33.x question definitively.

## Looked for but could not find

- Any Arquero test exercising a **string** expression input, or `escape()`, in `test/verbs/filter-test.js` or `test/expression/parse-test.js` — both files returned only arrow-function tests. The string path is documented in prose but I found **no test coverage for it this run**. This is a genuine docs-vs-tests gap worth flagging: the documentation asserts the capability, the two test files I read do not exercise it.
- Any public, documented AST/builder API for Arquero expressions.
- Any API-doc statement on `concat` fill values or on join duplicate-key row multiplication (confirming the round-1 report that the docs are silent).
- A readable duckdb.org Wasm client page (redirect stub only).
- Danfo.js `concat` column-alignment behavior.
