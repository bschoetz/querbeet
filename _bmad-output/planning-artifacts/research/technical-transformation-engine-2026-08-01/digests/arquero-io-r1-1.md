# Arquero 8.0.3 — input, output, types, missing values, performance

All source claims below were read from the **tagged release `v8.0.3`** on GitHub (raw.githubusercontent.com/uwdata/arquero/v8.0.3/...), not from `main`, on 2026-08-01. Prose-doc claims come from idl.uw.edu/arquero (undated, tracks latest release). Where source and prose disagree, source is quoted.

---

## Q1 — Input paths

- **The `src/format/` directory of v8.0.3 contains exactly four input modules — `from-arrow.js`, `from-csv.js`, `from-fixed.js`, `from-json.js` — each exporting a sync `fromX`, a `fromXStream`, and a `loadX` variant.** `source:` https://api.github.com/repos/uwdata/arquero/git/trees/v8.0.3?recursive=1 · `publisher:` uwdata/arquero · `pub_date:` undated (tag v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` version

- **`table(columns, names)` builds a table from named column arrays; `from(values, names)` builds one from an array of row objects, any iterable, a Map, or a plain object of key/value pairs.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/table/index.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

```js
// src/table/index.js (v8.0.3)
table(columns /* object|Map of name -> array-like, equal length */, names?)
from(values /* object[] | Iterable | Map | object */, names?)
// from(): "If array-valued or iterable, imports rows for each non-null value,
// using the provided column names as keys for each row object. If no names are
// provided, the first non-null object's own keys are used."
// columns-from.js throws "Illegal argument type" for Date, RegExp, or string input.
```

- **`fromCSV(input: string, options?: CSVParseOptions)` is synchronous; `fromCSVStream(ReadableStream<string>, options)` and `loadCSV(path, LoadOptions & CSVParseOptions)` return Promises.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/from-csv.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **`fromFixed` requires a `positions` or `widths` option and calls `error('Fixed width files require a "positions" or "widths" option.')` otherwise; it forces `header: false`.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/from-fixed.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **`fromArrow(input, options)` accepts an `ArrayBuffer`, a `Uint8Array` of Arrow IPC bytes, or an existing Arrow/Flechette table; byte input is decoded with Flechette's `tableFromIPC(input, { useDate: true, ...rest })`, and options extend Flechette `ExtractionOptions` plus a `columns` selection.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/from-arrow.js and .../src/format/types.ts · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **`LoadOptions` (shared by all `loadX` functions) is `{ fetch?: RequestInit, decompress?: 'gzip'|'deflate'|null }`, with decompression inferred from `.gz`/`.zz` extensions when unspecified.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/types.ts · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

---

## Q2 — Type detection and control (priority)

### The exact option shapes (verbatim JSDoc typedefs, v8.0.3)

```js
// src/format/from-csv.js
/**
 * @typedef {object} CSVParseOptions
 * @property {string}   [delimiter=','] Single-character delimiter between values.
 * @property {string}   [decimal='.']   Single-character numeric decimal separator.
 * @property {boolean}  [header=true]   Flag to specify presence of header row.
 * @property {string[]} [names]         Column names for header-less CSV (ignored if header true).
 * @property {number}   [skip=0]        Number of lines to skip before reading data.
 * @property {string}   [comment]       String identifying comment lines.
 * @property {boolean}  [autoType=true] Flag for automatic type inference.
 * @property {number}   [autoMax=1000]  Maximum number of initial values used for type inference.
 * @property {Record<string, (value: string) => any>} [parse]
 *   Object of column parsing options. Keys = column names,
 *   values = parsing functions that transform values upon input.
 */
```

```js
// src/format/from-json.js
/**
 * @typedef {object} JSONParseOptions
 * @property {'columns'|'rows'|'ndjson'|null} [type]  Format type; inferred if absent.
 * @property {boolean}  [autoType=true]  "If false, date parsing for input JSON strings is disabled."
 * @property {Record<string, (value: any) => any>} [parse]  Per-column parsing functions.
 * @property {string[]} [columns]        Column names to include.
 * @property {number}   [skip=0]         NDJSON only.
 * @property {string}   [comment]        NDJSON only.
 */
```

```js
// src/format/from-fixed.js — FixedParseOptions
// { positions?: [number,number][], widths?: number[], names?: string[],
//   decimal='.', skip=0, comment?, autoType=true, autoMax=1000,
//   parse?: Record<string, (value: string) => any> }
```

- **A per-column parser IS supported on `fromCSV`, `fromFixed` and `fromJSON` via `parse: { columnName: fn }`; only function values are honoured (`isFunction(parse[name])`), and a column parser takes precedence over both autoType and `autoType: false`.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/stream/parse-text-rows.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

```js
// src/format/stream/parse-text-rows.js (v8.0.3) — the whole decision:
function getParsers(names, values, options) {
  const { parse = {} } = options;
  const noParse = options.autoType === false;
  return names.map(
    (name, i) => isFunction(parse[name]) ? parse[name]
      : noParse ? identity
      : parseValues(values[i], options)
  );
}
```

- **Automatic inference can be switched off entirely with `autoType: false`, which substitutes `identity` — every unparsed column stays a string (empty fields still become `null`).** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/stream/parse-text-rows.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **CSV/fixed inference is whole-column and all-or-nothing: candidate parsers are tried in the order boolean → number → ISO date, and one is adopted only if EVERY non-null value among the first `autoMax` (default 1000) values passes its test; otherwise the column is left as strings.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/util/parse-values.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

```js
// src/util/parse-values.js (v8.0.3) — complete inference logic
const parseBoolean = [ v => (v === 'true') || (v === 'false'),
                       v => v === 'false' ? false : true ];
const parseNumber  = [ v => v === 'NaN' || (v = +v) === v,  v => +v ];
const parseDate    = [ isISODateString, v => new Date(Date.parse(v)) ];

function numberParser(decimal) {
  return decimal && decimal !== '.'
    ? parseNumber.map(f => s => f(s && s.replace(decimal, '.')))  // NOTE: first occurrence only
    : parseNumber;
}

export function parseValues(values, options) {
  const { decimal, limit = values.length } = options;
  const types = [parseBoolean, numberParser(decimal), parseDate];
  for (const [test, parser] of types) if (check(values, test, limit)) return parser;
  return identity;                       // no type matched -> keep strings
}
function check(values, test, n) {        // nulls are skipped, not disqualifying
  for (let i = 0; i < n; ++i) { const v = values[i]; if (v != null && !test(v)) return false; }
  return true;
}
```

- **The `decimal` option only swaps a single decimal character for `.`; there is NO thousands-separator option anywhere in v8.0.3, so German `1.234,56` is not parseable by built-in inference at any setting.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/util/parse-values.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **SILENT-CORRUPTION HAZARD (derived by reading the code above): with default `decimal: '.'`, a German thousands-grouped value such as `"1.234"` (meaning 1234) passes the number test as `+"1.234" === 1.234` and is imported as **1.234**; with `decimal: ','`, `"1.234"` is likewise imported as 1.234 because the comma-replace is a no-op. `"1.234,56"` fails the test under both settings and the column falls back to strings.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/util/parse-values.js · `publisher:` uwdata/arquero (code read) · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **SECOND HAZARD: inference looks at only the first `autoMax` (default 1000) values, but the chosen parser is then applied to the WHOLE column with no re-validation — a German-formatted value appearing after row 1000 in an otherwise clean numeric column becomes `NaN` (or `Invalid Date` for the date parser, or `true` for the boolean parser, since any string other than `'false'` maps to `true`).** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/stream/parse-text-rows.js · `publisher:` uwdata/arquero (code read) · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **There is no error, warning, or rejection path for a value that fails to parse: parsing is unconditional coercion (`+v`, `new Date(Date.parse(v))`), so failures surface as `NaN` / `Invalid Date` values inside the column.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/util/parse-values.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **In CSV/fixed parsing an empty field becomes `null` BEFORE any parser runs (`values[i].push(row[i] === '' ? null : row[i])`), and custom/inferred parsers are skipped for `null` (`if (v[r] != null) v[r] = parse(v[r])`) — so a `parse` function never sees an empty cell in the sync path.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/stream/parse-text-rows.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **In the streaming CSV path the post-inference remainder loop uses a truthiness test — `values[i].push(row[i] ? parsers[i](row[i]) : null)` — so empty strings become `null` there too, and only rows past the inference window take this path.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/stream/parse-text-rows.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **JSON auto-typing is far narrower than CSV: `autoType` for JSON ONLY converts strings that are ISO date strings and not pure digit strings into `Date` objects (`isString(val) && isISODateString(val) && !isDigitString(val)`); no numeric coercion of JSON strings happens at all.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/from-json.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **ASYMMETRY: in `fromJSON`, a custom `parse` function IS invoked on every value including `null`/`undefined` (`col[i] = parsers[name](col[i])` with no null guard), unlike the CSV path — a per-column parser must be null-safe for JSON.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/from-json.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

```js
// src/format/from-json.js — postprocessJSON (v8.0.3)
if (autoType || parse) {
  const parsers = parse || {};
  for (const name in columns) {
    const col = columns[name]; const len = col.length;
    if (parsers[name]) {
      for (let i = 0; i < len; ++i) col[i] = parsers[name](col[i]);   // no null guard
    } else if (autoType) {
      for (let i = 0; i < len; ++i) {
        const val = col[i];
        if (isString(val) && isISODateString(val) && !isDigitString(val)) col[i] = new Date(val);
      }
    }
  }
}
```

---

## Q3 — Missing values

- **`src/util/null.js` in v8.0.3 is exactly `export const NULL = undefined;` — the "Default NULL (missing) value to use".** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/util/null.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` version

- **In practice `NULL` is what aggregates EMIT when there is nothing valid to report (e.g. `sum: value: s => s.valid ? s.sum : NULL`), so an all-missing group yields `undefined`, not `null` and not `0`.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/op/aggregate-functions.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **On INPUT, missing values are `null`: CSV/fixed empty fields become `null`, and JSON nulls stay `null` — so a table can contain a mix of `null` (from input) and `undefined` (from aggregation and from row-object access to absent keys).** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/stream/parse-text-rows.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **The single validity predicate is `isValid(value) { return value != null && value === value; }` — loose `!=` means `null` and `undefined` are treated identically, and the self-equality test also classifies `NaN` as invalid. There is no user-visible semantic difference between `null` and `undefined` in aggregation.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/util/is-valid.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **The reducer increments `count` for every row but `valid` only when `isValid` passes, and only valid values are handed to an aggregate's `add()` — so `op.sum`, `op.mean`, `op.min`, `op.max`, `op.variance` etc. skip missing values entirely rather than propagating them.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/verbs/reduce/field-reducer.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

```js
// src/verbs/reduce/field-reducer.js — Field1Reducer.add (v8.0.3)
add(state, row, data) {
  const value = this._fields[0](row, data);
  ++state.count;
  if (isValid(value)) { ++state.valid; if (state.list) state.list.add(value); this._add(state, value); }
}
// Two-field ops (e.g. corr, covariance) require BOTH values valid:
// if (isValid(value1) && isValid(value2)) { ++state.valid; ... }
```

- **Concrete op semantics in v8.0.3: `count` returns `s.count` (ALL rows, including missing); `valid` returns `s.valid`; `invalid` returns `s.count - s.valid`; `sum`/`mean`/`average` return `NULL` (=`undefined`) when `s.valid === 0`; `variance`/`stdev` return `NULL` unless `s.valid > 1`.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/op/aggregate-functions.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **`op.distinct` counts distinct VALID values and adds exactly 1 if any invalid value was present: `value: s => s.distinct.count() + (s.valid === s.count ? 0 : 1)` — i.e. all missing values (null, undefined, NaN together) count as one additional distinct category.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/op/aggregate-functions.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **`op.sum` uses `s.sum += +v`, so a `NaN` that slipped through parsing is filtered out by `isValid` before reaching `add` — but a NaN stored in a column still makes `op.count` and `op.valid` disagree, which is the detectable signal for a corrupted numeric import.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/op/aggregate-functions.js + is-valid.js · `publisher:` uwdata/arquero (code read) · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

---

## Q4 — Output paths

- **`ColumnTable` exposes `toArrow(options)`, `toArrowIPC(options)`, `toCSV(options)`, `toHTML(options)`, `toJSON(options)`, `toMarkdown(options)`, plus `objects(options)`, `values(name)`, `[Symbol.iterator]()`, `scan(fn, order, limit, offset)`, `get(name, row)`, `getter(name)`, `array(name)` and `print(options)`.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/table/ColumnTable.js and .../src/table/Table.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

```js
// src/format/to-csv.js — CSVFormatOptions (v8.0.3)
// { delimiter=',', header=true, limit=Infinity, offset=0,
//   columns?: string[] | (table) => string[],
//   format?: Record<string, (value:any) => any> }   // per-column output formatter
```

- **CSV export writes `''` for any `null`/`undefined`, formats `Date` values as UTC via `formatUTCDate(value, true)`, and quotes a value only if it contains `"`, the active delimiter, `\n` or `\r`, doubling inner quotes: `reFormat = new RegExp('["' + delim + '\\n\\r]')`.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/to-csv.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

```js
// src/format/to-csv.js — the entire value-formatting rule (v8.0.3)
const formatValue = value => value == null ? ''
  : isDate(value) ? formatUTCDate(value, true)
  : reFormat.test(value += '') ? '"' + value.replace(/"/g, '""') + '"'
  : value;
// numbers go through String(value) => JS default, always '.' as decimal mark
// rows are joined with `delim` and terminated with '\n' (LF, no BOM, no CRLF option)
```

- **PRACTICAL CONSEQUENCE for German spreadsheet users: `toCSV` has no locale, decimal, quoting-policy, line-ending or BOM option — German-formatted output requires a per-column `format` function (e.g. `format: { amount: v => v.toLocaleString('de-DE') }`) plus `delimiter: ';'`, and the `;` delimiter automatically becomes the quoting trigger character.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/to-csv.js · `publisher:` uwdata/arquero (code read) · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

```js
// src/format/to-json.js — JSONFormatOptions (v8.0.3)
// { type?: 'columns'|'rows'|'ndjson'|null   // default 'rows'
//   limit=Infinity, offset=0,
//   columns?: string[] | (table) => string[],
//   format?: Record<string, (value:any) => any> }
// default formatter: Dates -> formatUTCDate(value, true); everything else via JSON.stringify
// 'ndjson' strips '\n' from each row's serialized text
```

- **`objects(options)` returns a NEW array of plain row objects — "A new set of objects will be created, copying the backing table data" — with options `limit` (default `Infinity`), `offset` (default `0`), `columns`, and `grouped` (nested output for grouped tables only).** `source:` https://idl.uw.edu/arquero/api/table.html · `publisher:` UW Interactive Data Lab · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **`[Symbol.iterator]()` yields freshly built row objects one at a time (no array materialization); `values(name)` yields the values of a single column and "respects any table filter or orderby criteria"; `scan(fn, order, limit, offset)` visits only non-filtered rows with no object allocation at all.** `source:` https://idl.uw.edu/arquero/api/table.html + .../src/table/Table.js · `publisher:` UW IDL / uwdata · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **`toArrow()` "will throw an error if type inference fails or if the generated columns have differing lengths"; `ArrowFormatOptions` = Flechette `TableBuilderOptions` plus `columns`, `limit` (default `Infinity`), `offset` (default `0`); `toArrowIPC` adds `format: 'stream' | 'file'` (default `'stream'`).** `source:` https://idl.uw.edu/arquero/api/table.html + .../src/format/types.ts · `publisher:` UW IDL / uwdata · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **`toHTML`/`toMarkdown` use `formatValue`, which renders numbers with `toFixed(digits)` where `digits` comes from an inferred `ValueFormatObject { utc?, digits?, maxlen? }` (default `digits: 0`, capped by `options.maxdigits || 6` in `inferFormat`) — display formatting only, never applied by `toCSV`/`toJSON`.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/format/util/format-value.js + .../src/format/util/infer.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

---

## Q5 — Performance idioms

- **The README's first bullets claim Arquero can "process data tables with million+ rows" and query "over arrays, typed arrays, array-like objects, or Apache Arrow columns" — typed arrays and Arrow columns are first-class column backings, not converted to plain arrays.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/README.md · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **Verbs are eager (each returns a new table immediately) but `filter`, `orderby` and `slice` do NOT copy column data — the JSDoc for these verbs says to "call *reify* on the output table" if new data structures are wanted, i.e. filtering is a bitmask and ordering an index vector over shared columns.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/table/ColumnTable.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **Because filtered/ordered tables carry an index, `Table.get()` and `getter()` add an indirection (`column.at(this.indices()[row])`) only when `isFiltered() || isOrdered()`; `reify()` collapses that, and repeated random access is best done through a cached `getter(name)` rather than per-cell `get`.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/table/Table.js · `publisher:` uwdata/arquero (code read) · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **`objects()` is explicitly documented as copying the backing table data into new objects; `scan()`, `values(name)` and the row iterator are the non-materializing alternatives, and `toCSV`/`toJSON` themselves stream through `scan`/`table.scan` rather than going via `objects()`.** `source:` https://idl.uw.edu/arquero/api/table.html + .../src/format/to-csv.js + .../src/format/to-json.js · `publisher:` UW IDL / uwdata · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **Aggregation is compiled, not interpreted: `field-reducer.js` uses `unroll()` to generate a single function body invoking every op's `add`/`rem` inline, with the comment "unroll op invocations for performance" — so many ops in one `rollup` are cheaper than many separate rollups.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/src/verbs/reduce/field-reducer.js · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

- **The repo ships a benchmark suite runnable via `npm run perf`, indicating maintainer-tracked performance rather than published numbers.** `source:` https://raw.githubusercontent.com/uwdata/arquero/v8.0.3/README.md · `publisher:` uwdata/arquero · `pub_date:` undated (v8.0.3) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability

---

## Leads

- `src/format/stream/delimited-text-stream.js` (not read) governs quote handling, embedded newlines and whether values are trimmed on CSV import — worth reading before trusting `"1.234,56"` quoted fields.
- `src/util/is-iso-date-string.js` and `is-digit-string.js` (not read) define exactly which strings become `Date`; relevant to whether `31.12.2025` or `2025-12-31` bare-date strings are treated as UTC midnight.
- `src/util/format-date.js` `formatUTCDate(value, true)` determines the exact CSV date rendering (ISO shape and whether time is dropped for exact-UTC dates) — read before locking export format.
- `op.recode`, `impute` verb, and `src/op/functions/recode.js` are the documented paths for null replacement after import.
- Streaming parse (`fromCSVStream`) plus `autoMax` tuning is the lever if inference over the first 1000 rows proves too narrow; setting `autoMax` to the full row count makes inference exact but costs a full pre-scan.
- Spreadsheet (XLSX) import/export has no Arquero support at all — the tree contains no such module; an external library must produce row objects for `aq.from()`.

## Looked for but could not find

- Any thousands-separator / locale / `Intl.NumberFormat` option in parsing or formatting — none exists in v8.0.3.
- Any error, warning, strict mode, or rejected-row collection for values that fail to parse — parsing is unconditional coercion with no diagnostics.
- Any BOM, CRLF, or quote-all option on `toCSV` — the writer emits LF-terminated rows, no BOM, minimal quoting.
- A prose docs page at `https://idl.uw.edu/arquero/api/input` (404 on 2026-08-01); the live docs are at `/arquero/api/table.html`, `/arquero/api/op.html`, etc.
- Any documented statement that `main` differs from v8.0.3 for these files — everything above was read at the `v8.0.3` tag, so no ahead-of-release caveat applies.
