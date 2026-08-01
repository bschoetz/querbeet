# Arquero capability digest — R1-1

Scope: Arquero (uwdata/arquero), npm `arquero`. **Released latest verified this run: 8.0.3** (`https://registry.npmjs.org/arquero/latest` returned `"version":"8.0.3"`, accessed 2026-08-01). Documentation read at `idl.uw.edu/arquero` and repository `main` branch. **Version-drift check performed:** `src/verbs/concat.js` on `main` is byte-identical to `arquero@8.0.3/src/verbs/concat.js` on unpkg, so for the files read here `main` and the release agree. Other files were read from `main` only and are flagged as such.

All claims accessed 2026-08-01.

---

## Q1 — Verb inventory

- **Claim** — Arquero's documented verb set is 34 verbs across core, join, cleaning, reshape and set categories, listed in the table below. `source:` https://idl.uw.edu/arquero/api/verbs · `publisher:` UW Interactive Data Lab · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — The same verb list with full signatures and options objects appears in the repository at `docs/api/verbs.md` on `main`. `source:` https://raw.githubusercontent.com/uwdata/arquero/main/docs/api/verbs.md · `publisher:` uwdata · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` version

| Verb | Signature | What it does |
|---|---|---|
| **Core** | | |
| `derive` | `derive(values[, options])` | Adds computed columns; `options` = `{drop, before, after}` (placement built in). |
| `filter` | `filter(criteria)` | Row subset by boolean expression; returns a **view**, no data copy. |
| `slice` | `slice([start, end])` | Rows by index range, negative indices allowed; per group when grouped. |
| `groupby` | `groupby(...keys)` | Group by column names, indices, or `{name: expr}` objects. |
| `ungroup` | `ungroup()` | Drops grouping. |
| `orderby` | `orderby(...keys)` | Sort; wrap keys in `aq.desc()` / `aq.collate()`. Returns a view. |
| `unorder` | `unorder()` | Drops sort order. |
| `rollup` | `rollup(values)` | Aggregate to one row per group. |
| `count` | `count([options])` | Row tally per group (rollup shorthand). |
| `sample` | `sample(size[, options])` | Random rows; `{replace, shuffle, weight}`; `aq.frac(0.5)` for proportional, stratified when grouped. |
| `select` | `select(...columns)` | Choose **and order** columns; accepts names, indices, rename objects, selection helpers. |
| `rename` | `rename(columns)` | Rename via `{old: new}` map, **preserving existing order**. |
| `relocate` | `relocate(columns, {before\|after})` | Move columns to an anchor position. |
| `reify` | `reify([indices])` | Materialize a filtered/sorted view into real columns. |
| `assign` | `assign(...tables)` | Merge columns from tables with identical row counts (positional, not keyed). |
| **Joins** | | |
| `join` | `join(other[, on, values, options])` | `options` = `{left, right, suffix}`; default inner. |
| `join_left` | `join_left(other[, on, values, options])` | `join` with `{left: true, right: false}`. |
| `join_right` | `join_right(...)` | `{left: false, right: true}`. |
| `join_full` | `join_full(...)` | `{left: true, right: true}`. |
| `lookup` | `lookup(other[, on, ...values])` | Add columns from a secondary table by key; **cannot** multiply rows — "only the last observed instance will be considered" on duplicate keys. |
| `semijoin` | `semijoin(other[, on])` | Keep left rows that match right; returns a filtered **view**. |
| `antijoin` | `antijoin(other[, on])` | Keep left rows with no match; returns a filtered **view**. |
| `cross` | `cross(other[, values, options])` | Cartesian product. |
| **Cleaning** | | |
| `dedupe` | `dedupe(...keys)` | Drop duplicate rows; no keys = all columns. |
| `impute` | `impute(values[, options])` | Fill missing values per column, e.g. `impute({v: () => 0})`; `{expand: ['x','y']}` also **adds missing key combinations as rows**. |
| **Reshape** | | |
| `fold` | `fold(values[, {as: ['key','value']}])` | Wide → long. |
| `pivot` | `pivot(keys, values[, {limit, keySeparator, valueSeparator, sort}])` | Long → wide / cross-tab. |
| `spread` | `spread(values[, {drop, limit, as}])` | Array column → several columns. |
| `unroll` | `unroll(values[, {limit, index, drop}])` | Array column → several rows. |
| **Sets** | | |
| `concat` | `concat(...tables)` | SQL `UNION ALL`. "Only named columns in this table are included in the output." |
| `union` | `union(...tables)` | SQL `UNION` (dedupes). Same schema restriction. |
| `intersect` | `intersect(...tables)` | Rows present in all. |
| `except` | `except(...tables)` | Rows not present in the others. |
| `params` | `params(obj)` | Bind runtime values reachable as `$` in expressions. |

Windowing is not a verb — it is `op.*` functions used inside `derive`, optionally wrapped in `aq.rolling(...)` to define a sliding frame.

- **Claim** — Window functions available are `row_number, rank, avg_rank, dense_rank, percent_rank, cume_dist, ntile, lag, lead, first_value, last_value, nth_value, fill_down, fill_up`; rolling frames come from `aq.rolling`. `source:` https://idl.uw.edu/arquero/api/op · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — Aggregate functions are `any, bins, count, distinct, valid, invalid, max, min, sum, product, mean/average, mode, median, quantile, stdev, stdevp, variance, variancep, corr, covariance, covariancep, array_agg, array_agg_distinct, object_agg, map_agg, entries_agg`. `source:` https://idl.uw.edu/arquero/api/op · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — String `op` functions are `parse_date, parse_float, parse_int, endswith, match, normalize, padend, padstart, lower, upper, repeat, replace, split, startswith, substring, trim`; `op.indexof(sequence, value)` is documented to accept "array or string", while `op.includes(array, value)` is documented for arrays only. `source:` https://raw.githubusercontent.com/uwdata/arquero/main/docs/api/op.md · `publisher:` uwdata (main) · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — There is **no row-level null test in `op`**: `op.valid` / `op.invalid` are aggregate functions ("Aggregate function to count the number of valid values. Invalid values are `null`, `undefined`, or `NaN`"), and `op.is_nan` returns true only for numeric `NaN`. `source:` https://raw.githubusercontent.com/uwdata/arquero/main/docs/api/op.md · `publisher:` uwdata (main) · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — `op.recode(value, map[, fallback])` maps values via an object/Map and is the built-in primitive for value remapping, usable with a runtime map through `params`. `source:` https://raw.githubusercontent.com/uwdata/arquero/main/docs/api/op.md · `publisher:` uwdata (main) · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — Selection helpers are `aq.all, aq.not, aq.range, aq.matches, aq.startswith, aq.endswith, aq.names`. `source:` https://idl.uw.edu/arquero/api/ · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

---

## Q2 — Building the six operations from config

### Expression strategy: which mechanism where

- **Claim** — Arquero accepts three expression forms: parsed function expressions (`d => op.sqrt(d.value)`), parsed **string** expressions (`"sqrt(d.value)"`, implicit row identifier `d`), and `aq.escape(fn)` which applies a plain JavaScript function as-is with no parsing or codegen. `source:` https://idl.uw.edu/arquero/api/expressions · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — `aq.escape` supports closures over enclosing-scope variables, but escaped values "do *not* support aggregation and window operations" and "result in an error when attempting to serialize Arquero queries". `source:` https://raw.githubusercontent.com/uwdata/arquero/main/docs/api/expressions.md · `publisher:` uwdata (main) · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — `escape()` is also documented in source as a way "to pass a constant, literal value as a table expression, bypassing the parser". `source:` https://raw.githubusercontent.com/uwdata/arquero/main/src/helpers/escape.js · `publisher:` uwdata (main) · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — `params()` binds runtime values that parsed expressions read from a second argument, default named `$`: `table.params({threshold: 5}).filter((d, $) => d.value < $.threshold)`. `source:` https://idl.uw.edu/arquero/api/expressions · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

**Recommendation.** For a UI-driven builder, use **`aq.escape()` for row-level operations whose *column name* is dynamic** (filter, computed column) — the column name is data at runtime, and `escape` guarantees no parser involvement and no string interpolation of untrusted user values into code. Use **`params()` + parsed expressions only where an aggregate or window function is required** (rollup, `derive` with `op.*`), because escaped functions cannot host aggregates. Use string expressions only when the whole expression is authored by you, not assembled from user input.

Caveat, unverified this run: I did not find documentation confirming that a **parsed** expression can do computed column access (`d[$.col]`). Treat "parsed expressions require statically-named columns" as an untested assumption and pin filters/computed columns to `escape()`, which demonstrably receives a row object (`escape(d => d.a.toFixed(2))`).

### 1. Filter from `{column, operator, value}`

```js
import * as aq from 'arquero';

const PREDICATE = {
  eq:        (col, val) => aq.escape(d => d[col] === val),
  neq:       (col, val) => aq.escape(d => d[col] !== val),
  gt:        (col, val) => aq.escape(d => d[col] >  val),
  gte:       (col, val) => aq.escape(d => d[col] >= val),
  lt:        (col, val) => aq.escape(d => d[col] <  val),
  lte:       (col, val) => aq.escape(d => d[col] <= val),
  contains:  (col, val) => aq.escape(d => {
                const v = d[col];
                return v != null && String(v).toLowerCase()
                  .includes(String(val).toLowerCase());
              }),
  empty:     (col)      => aq.escape(d => {
                const v = d[col];
                return v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
              }),
  not_empty: (col)      => aq.escape(d => {
                const v = d[col];
                return !(v == null || v === '' || (typeof v === 'number' && Number.isNaN(v)));
              })
};

const t2 = t.filter(PREDICATE[cfg.operator](cfg.column, cfg.value));
```

Notes tied to evidence:
- **"contains" has no clean `op` equivalent.** `op.includes` is documented as an *array* membership test; the string-capable primitive is `op.indexof(sequence, value)` ("array or string"), so a parsed form would be `op.indexof(d.col, needle) >= 0`. `op.match(value, regexp)` also works but needs regex-escaping of user input. Plain `String(v).includes(val)` inside `escape` is simpler and case-folding is free.
- **"is empty" must be hand-rolled.** `op.valid`/`op.invalid` are aggregates, not row predicates. Arquero's own internal definition of "invalid" is `null`, `undefined`, or `NaN`; empty string is *not* in that definition, so decide explicitly whether `''` counts for your report files (recommended: yes).
- `filter` returns a **view over the original data, no copy** — cheap to chain many filter steps.

Parsed-expression alternative (only if you need serializable pipelines):
```js
t.params({ v: cfg.value }).filter(`d["${cfg.column}"] > $.v`)  // column name interpolated, value bound
```

### 2. Computed column from a row-level formula

```js
// dynamic-column arithmetic, no aggregates -> escape
t.derive({ [cfg.outputName]: aq.escape(d => Number(d[cfg.a]) * Number(d[cfg.b])) },
         { after: cfg.a });                       // derive options: {drop, before, after}

// constant column (documented use of escape)
t.derive({ source: aq.escape(cfg.fileLabel) });

// formula needing op.* / aggregates -> parsed + params
t.params({ rate: cfg.rate })
 .derive({ net: (d, $) => op.round(d.gross * (1 - $.rate)) });
```
`derive`'s `{before, after}` options mean a computed column can be placed without a separate `relocate` step.

### 3. Multi-key join with runtime join type

```js
const on =
  cfg.keys.length === 1 && cfg.keys[0].left === cfg.keys[0].right
    ? cfg.keys[0].left                                    // 'sharedKey'
    : [cfg.keys.map(k => k.left), cfg.keys.map(k => k.right)];  // [['a','b'], ['x','y']]

const out = left.join(right, on, undefined, {
  left:  cfg.type === 'left',    // 'inner' -> both false
  right: false,
  suffix: ['', '_right']         // keep left names bare; empty suffix is supported
});
```
- Choosing the type at runtime is done with the **options object on `join`**, not by selecting a method name: `join_left` is documented as "shorthand for `join()` with `{left: true, right: false}`".
- **Footgun:** a flat two-element array is the *left/right pair* form, not two keys — `table.join(other, ['keyL', 'keyR'])` matches left column `keyL` against right column `keyR`. Confirmed by test `tl.join(tr, ['k', 'u'], ...)` where `k` is on the left table and `u` on the right. Multi-key therefore requires the nested `[[...left], [...right]]` shape (confidence: medium — I read the flat form in a test and the nested form in prose, not a nested-form test).
- Empty-string suffix is explicitly supported: `{ suffix: ['', '_2'] }` (test `allows empty suffix`).
- `source:` https://raw.githubusercontent.com/uwdata/arquero/main/test/verbs/join-test.js and https://raw.githubusercontent.com/uwdata/arquero/main/docs/api/verbs.md · `publisher:` uwdata (main) · `accessed:` 2026-08-01 · `confidence:` high (option shape) / medium (nested multi-key form) · `class:` capability

For pure enrichment (add columns, never change row count) prefer `lookup`:
```js
left.lookup(right, [cfg.leftKey, cfg.rightKey], ...cfg.valueColumns);
```

### 4. Select + rename + reorder

```js
// one call does all three: select fixes order, rename objects rename
const spec = cfg.columns.map(c => c.newName ? { [c.name]: c.newName } : c.name);
const out = t.select(...spec);

// equivalent split form
const out2 = t.select(...cfg.columns.map(c => c.name))   // choose + order
              .rename(cfg.renameMap);                    // {old: new}, order preserved

// nudge a few columns without respecifying the whole schema
t.relocate(['colY', 'colZ'], { after: 'colX' });
```
`select` is documented to accept "rename objects" and to determine output order; `rename` "change[s] column names while preserving order"; `relocate` takes `{before}` / `{after}`.

### 5. Union of several tables with column mapping

See Q3 for the full-outer-union helper. Column *mapping* (different source headers → one canonical name) is done by `select` with rename objects **before** concatenating:
```js
const canonical = raw.select({ Betrag: 'amount', Datum: 'date' });
```

### 6. Group-by aggregation

```js
const aggs = Object.fromEntries(cfg.aggregations.map(a => [
  a.outputName,
  ({ sum: `op.sum(d["${a.column}"])`,
     mean: `op.mean(d["${a.column}"])`,
     min: `op.min(d["${a.column}"])`,
     max: `op.max(d["${a.column}"])`,
     count: `op.count()`,
     distinct: `op.distinct(d["${a.column}"])`,
     median: `op.median(d["${a.column}"])`
   })[a.fn]
]));

const out = t.groupby(...cfg.groupColumns).rollup(aggs);
```
This is the one place where **`escape()` cannot be used** — escaped functions "do not support aggregation and window operations" — so string expressions with the column name interpolated (validated against `t.columnNames()` first) are the correct tool. `op.count()` takes no argument.

---

## Q3 — The two known traps

### Trap 1: `concat` / `union` are anchored to the receiving table's schema

- **Claim** — `concat` iterates only `table.columnNames()` of the *receiving* table; for any input table lacking a column it substitutes `NULL`, and `NULL` is defined as `undefined`. Verified in the **released 8.0.3** source, identical to `main`. `source:` https://unpkg.com/arquero@8.0.3/src/verbs/concat.js + https://raw.githubusercontent.com/uwdata/arquero/main/src/util/null.js · `publisher:` uwdata · `pub_date:` 8.0.3 · `accessed:` 2026-08-01 · `confidence:` high · `class:` version

```js
export function concat(table, ...others) {
  others = others.flat();
  const trows = table.numRows();
  const nrows = trows + others.reduce((n, t) => n + t.numRows(), 0);
  if (trows === nrows) return table;              // <-- see footgun below
  const tables = [table, ...others];
  const cols = columnSet();
  table.columnNames().forEach(name => {           // <-- receiver schema only
    const arr = Array(nrows);
    let row = 0;
    tables.forEach(table => {
      const col = table.column(name) || { at: () => NULL };   // NULL === undefined
      table.scan(trow => arr[row++] = col.at(trow));
    });
    cols.add(name, arr);
  });
  return cols.new(table);
}
```

- **Claim** — Arquero offers **no built-in full-outer union**; the docs state flatly for both `concat` and `union` that "Only named columns in this table are included in the output". The application must compute the column-name union and pad each input. `source:` https://raw.githubusercontent.com/uwdata/arquero/main/docs/api/verbs.md · `publisher:` uwdata (main) · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

Idiomatic workaround:
```js
function unionAll(tables) {
  const names = [...new Set(tables.flatMap(t => t.columnNames()))];
  const padded = tables.map(t => {
    const have = new Set(t.columnNames());
    const missing = names.filter(n => !have.has(n));
    const filled = missing.length
      ? t.derive(Object.fromEntries(missing.map(n => [n, aq.escape(null)])))  // escape() passes a literal
      : t;
    return filled.select(...names);      // force identical order on every input
  });
  const [first, ...rest] = padded;
  return first.concat(rest);             // concat flattens an array argument (others.flat())
}
```
Two details this buys you: every input gets the same **order** (via `select(...names)`), and missing cells become explicit `null` rather than `undefined`, which matters for `toJSON`/CSV export and for `d[col] == null` checks (`== null` catches both, `=== null` does not).

Also note `concat(...tables)` accepts an array — the source calls `others.flat()`.

### Trap 2: joins treat `null` as not equal to `null`

- **Claim** — Key-based joins do not match `null`, `undefined` or `NaN` against each other; only `'a'` matched in the library's own test with keys `['a', null, undefined, NaN]` vs `[null, undefined, NaN, 'a']`. `source:` https://raw.githubusercontent.com/uwdata/arquero/main/test/verbs/join-test.js (test `does not treat null values as equal`) · `publisher:` uwdata (main) · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — This is `op.equal` semantics: "Compare two values for equality, using join semantics in which `null !== null` … helpful within custom join condition expressions." `source:` https://raw.githubusercontent.com/uwdata/arquero/main/docs/api/op.md · `publisher:` uwdata (main) · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — There is **no option to change this**: `join` options are only `left`, `right`, `suffix`. `source:` https://raw.githubusercontent.com/uwdata/arquero/main/docs/api/verbs.md · `publisher:` uwdata (main) · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

Two overrides, with a hard performance difference:

**(a) Custom two-table predicate — correct, but O(n·m).**
```js
left.join(right, (a, b) => a.k === b.u, values, opts);        // === makes null===null true
```
- **Claim** — Arquero picks its algorithm with `const join = isArray(predicate) ? hashJoin : loopJoin;` — an array of keys gets a hash index, a *function* predicate gets a nested loop over every row pair. `source:` https://raw.githubusercontent.com/uwdata/arquero/main/src/verbs/join.js · `publisher:` uwdata (main) · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

Beware: `===` also makes `undefined === undefined` true but `NaN === NaN` false, and it does not equate `null` with `undefined`.

**(b) Sentinel key column — keeps the hash join (recommended for a browser tool).**
```js
const SENTINEL = ' __NULL__';
const key = col => aq.escape(d => d[col] == null ? SENTINEL : d[col]);
const L = left.derive({ __k: key(cfg.leftKey) });
const R = right.derive({ __k: key(cfg.rightKey) });
const out = L.join(R, '__k', undefined, { left: true }).select(aq.not('__k'));
```
This is my construction from the source evidence above, not a documented recipe — confidence medium on it being idiomatic, high on it being correct given `hashJoin` selection is driven purely by `isArray(predicate)`.

**Default recommendation for a report-merging tool: do neither, and treat null keys as non-matching (Arquero's default), but surface the count of null-keyed rows in the UI.** Silent null-to-null matching is usually wrong for report data.

---

## Q4 — Other footguns

- **Claim** — Duplicate keys multiply rows: the library's own inner-join test shows left key `b` (2 rows) against right key `b` (2 rows) producing 4 output rows — a per-key cartesian product. Use `lookup` when the UI intent is "add columns", since `lookup` keeps only "the last observed instance" of a duplicate key and cannot change the row count. `source:` https://raw.githubusercontent.com/uwdata/arquero/main/test/verbs/join-test.js + https://raw.githubusercontent.com/uwdata/arquero/main/docs/api/verbs.md · `publisher:` uwdata (main) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — **Browser CSP:** open issue #361 "Support Basic non-Strict Content-Security Policy (CSP)" reports Arquero "requires unsafe-eval due to dynamic function compilation" (opened 2024-08-07, still open as of 2026-08-01). This is a first-order risk for a browser tool served under a strict CSP; `escape()` skips parsing/codegen for that expression and is the mitigation lever to investigate. `source:` https://api.github.com/search/issues?q=repo:uwdata/arquero+is:issue+state:open · `publisher:` GitHub / uwdata · `pub_date:` 2024-08-07 · `accessed:` 2026-08-01 · `confidence:` high (issue exists and is open) / medium (whether escape fully avoids eval) · `class:` capability
- **Claim** — **Empty tables are a known sharp edge:** open issues #329 "Table concatenation results in empty table" (2023-06-01), #275 "Invalid column reference on empty table" (2022-05-06), #308 "fromCSV fails with uncaught TypeError on CSV with headers only" (2022-12-08). Uploaded report files with zero data rows will hit these. `source:` https://api.github.com/search/issues?q=repo:uwdata/arquero+is:issue+state:open · `publisher:` GitHub / uwdata · `pub_date:` 2022-05-06…2023-06-01 · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — Related short-circuit in `concat` source: `if (trows === nrows) return table;` — if every other table has zero rows, the receiver is returned **unchanged**, so a union that should have widened the schema silently does not. `source:` https://unpkg.com/arquero@8.0.3/src/verbs/concat.js · `publisher:` uwdata · `pub_date:` 8.0.3 · `accessed:` 2026-08-01 · `confidence:` high · `class:` version
- **Claim** — **Type coercion on import:** `aq.fromCSV` has `autoType` defaulting to `true` plus a per-column `parse` option; `aq.fromJSON` states "String values matching ISO standard date format are parsed into JavaScript Date objects". Report columns like `"2024-01"` or zero-padded account numbers can silently become Dates or numbers. `source:` https://idl.uw.edu/arquero/api/ · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — Aggregates ignore invalid values: Arquero defines invalid as `null`, `undefined` **or** `NaN` (`op.valid` / `op.invalid` docs), and the op reference states invalid values "are typically excluded from calculations", so `mean` over a column with blanks averages only the valid cells while `op.count()` counts all rows. Use `op.valid(col)` alongside any mean to expose the denominator. `source:` https://raw.githubusercontent.com/uwdata/arquero/main/docs/api/op.md + https://idl.uw.edu/arquero/api/op · `publisher:` uwdata / UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — `op.mean` throws on BigInt columns: open issue #364 "Uncaught TypeError: can't convert BigInt to number when computing means" (2024-09-12), noting other aggregates do support BigInt. Relevant if Arrow/Parquet inputs are ever added. `source:` https://api.github.com/search/issues?q=repo:uwdata/arquero+is:issue+state:open · `publisher:` GitHub / uwdata · `pub_date:` 2024-09-12 · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — The expression parser has its own quirks: issue #320 "Table expressions do not support underscores as numeric separators" (2023-02-12) and #256, where Istanbul coverage instrumentation breaks arrow-function parsing in `derive` (2021-12-30). Both argue for `escape()` in application code. `source:` https://api.github.com/search/issues?q=repo:uwdata/arquero+is:issue+state:open · `publisher:` GitHub / uwdata · `pub_date:` 2021-12-30 / 2023-02-12 · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — `op.parse_int(value[, radix])` explicitly "does not default to 10" for the radix — always pass 10 when parsing report numerics. `source:` https://raw.githubusercontent.com/uwdata/arquero/main/docs/api/op.md · `publisher:` uwdata (main) · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Claim** — **Lazy vs eager is per verb, not per pipeline.** `filter`, `orderby`, `semijoin` and `antijoin` are documented to return a *view* over the original data with "no data copy"; `derive`, `rollup`, `join` and `concat` build new column arrays immediately (visible in the `concat` source, which allocates `Array(nrows)` per column). `reify([indices])` materializes a view. There is no deferred query graph — each verb call executes on invocation. `source:` https://raw.githubusercontent.com/uwdata/arquero/main/docs/api/verbs.md + https://unpkg.com/arquero@8.0.3/src/verbs/concat.js · `publisher:` uwdata · `accessed:` 2026-08-01 · `confidence:` high (views documented) / medium (the "no deferred graph" generalisation) · `class:` capability

---

## Leads

- **CSP / `unsafe-eval` (issue #361)** is the highest-value follow-up for a browser tool: determine empirically whether a pipeline built entirely from `escape()` + `params()` avoids `new Function`, or whether Arquero's verb machinery compiles regardless. Test with a `Content-Security-Policy: script-src 'self'` page.
- Arquero query **serialization** (`aq.query` / worker-thread transfer) is mentioned as a feature that `escape()` breaks. If pipeline persistence or Web Worker offload is ever wanted, the escape-everywhere strategy conflicts with it — the alternative is a JSON pipeline spec of your own that is compiled to Arquero calls at run time.
- `impute(values, {expand})` is a strong fit for "make the report rectangular" (fill missing group/period combinations) — worth a dedicated look.
- `aq.addFunction` (registering custom `op` functions) is referenced in the wider Arquero surface but was not present on the API index page I read; check `docs/api/extensibility.md`.
- `aq.rolling` frames plus `lag`/`lead`/`fill_down` cover period-over-period report columns without a custom verb.

## Looked for but could not find

- Whether a **parsed** table expression supports computed column access (`d[$.col]` / `d[name]`). Not documented on the expressions page or in `docs/api/expressions.md`. This is why the recommendation pins dynamic-column filters and computed columns to `escape()`.
- A `CHANGELOG.md` in the repository root — `https://raw.githubusercontent.com/uwdata/arquero/main/CHANGELOG.md` returns **404**, so per-version change history for 8.x could not be read this run. Version drift was instead checked by diffing one source file against unpkg's 8.0.3.
- Any join option for null-equality (a `keys`/`nullEquals`/`na` flag). None exists; the options object is exactly `{left, right, suffix}`.
- A documented multi-key join example using the nested `[[l1,l2],[r1,r2]]` form. Prose describes "array of [left, right] columns"; the test I read uses the flat two-element form. The nested shape is inferred, not verified.
- Explicit documentation of `undefined` vs `null` semantics in output/export (both are "invalid" for aggregates, but their behaviour in `toCSV`/`toJSON` was not checked).
