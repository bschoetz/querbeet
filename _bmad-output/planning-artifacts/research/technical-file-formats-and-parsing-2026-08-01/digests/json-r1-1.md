# Digest: D4 JSON — round 1

Accessed date for every source below: 2026-08-01. Two machine-readable primary sources were queried in bulk and are cited throughout by short name:
- **npm-registry** = `https://registry.npmjs.org/<pkg>` (latest version, publish timestamp, licence field)
- **gh-api** = `https://api.github.com/repos/<owner>/<repo>` plus `/commits?since=2025-08-01` (last push, stars, archived flag, commit count in the last 12 months)
- **bundlephobia** = `https://bundlephobia.com/api/size?package=<pkg>` (minified / gzipped size, dependency count)

## Findings

### Q1 — jsonrepair

1. jsonrepair is at **3.15.0, published 2026-07-03**, i.e. under one month old at time of research. `{npm-registry (registry.npmjs.org/jsonrepair), npm, 2026-07-03, accessed 2026-08-01, confidence: high, class: version}`
2. The repository was last pushed **2026-07-03** and has **26 commits in the 12 months since 2025-08-01**, with 2,390 stars and 18 open issues, not archived — steady, low-volume maintenance rather than a burst or a stall. `{gh-api josdejong/jsonrepair, GitHub, 2026-07-03, accessed 2026-08-01, confidence: high, class: ecosystem}`
3. Licence is **ISC** — stated in the README ("Released under the ISC license") and in the npm `license` field; GitHub's licence detector reports NOASSERTION, which is a detector artefact, not a conflicting claim. `{https://github.com/josdejong/jsonrepair + npm-registry, GitHub/npm, 2026-07-03, accessed 2026-08-01, confidence: high, class: licence}`
4. Bundle size is **~7 KB minified / ~2.88 KB gzipped with zero dependencies** and an ESM entry (`lib/esm/index.js`), which makes inlining into a single HTML file trivial. `{bundlephobia jsonrepair@3.15.0, Bundlephobia, accessed 2026-08-01, confidence: medium (single source), class: version}`
5. The README documents a **UMD build** (`lib/umd/jsonrepair.js`) for direct browser `<script>` use, so CDN/inline delivery is supported by the package itself. `{https://github.com/josdejong/jsonrepair, GitHub, accessed 2026-08-01, confidence: high, class: version}`
6. The documented repair list is: missing quotes around keys, missing escape characters, missing commas, missing closing brackets, **truncated JSON**, single quotes → double quotes, special/smart quote characters, special whitespace, **Python constants None/True/False**, trailing commas, `/* */` and `//` comments, **fenced markdown code blocks**, ellipsis in arrays/objects, JSONP notation, escaped-string unwrapping, MongoDB data types, string concatenation, and **NDJSON → array conversion**. `{https://github.com/josdejong/jsonrepair, GitHub, accessed 2026-08-01, confidence: high, class: pattern}`
7. That list covers every LLM-characteristic breakage named in the brief, **including truncation** ("Repair truncated JSON" is an explicit bullet), so on the feature axis jsonrepair is a superset of the single-purpose alternatives. `{same as #6, confidence: high, class: pattern}`
8. jsonrepair also ships a **streaming transform** (`jsonrepair/stream`, `jsonrepairTransform()`, chunkSize/bufferSize default 65536) but it is written against **Node streams**, and it throws "Index out of range" when a single string or number exceeds `bufferSize` — a real hazard for long cell values and not directly usable in a browser without a shim. `{https://github.com/josdejong/jsonrepair, GitHub, accessed 2026-08-01, confidence: medium, class: failure}`
9. **The dangerous-failure question does not resolve the way the brief anticipated**: a scan of the issue tracker for "wrong/incorrect/corrupt/silently" surfaces failures that are **thrown errors and crashes**, not silent corruption — #170 (open, 2026-06-12) infinite recursion / "Maximum call stack size exceeded" on a string followed by a backslash-escaped delimiter; #159 (open, 2026-03-28) refuses to repair a superfluous closing brace; #137 (open, 2025-01-12) "Unexpected character" on a complex nested structure; #158 (closed, 2026-03-12) crash on LLM output using `>` instead of `:`. `{https://api.github.com/search/issues?q=repo:josdejong/jsonrepair..., GitHub, accessed 2026-08-01, confidence: medium, class: failure}`
10. The one historic hint of silent misbehaviour is **#102 (closed, 2023-10-09)**, "strings with commas or apostrophes lacking a closing quote fail silently" — over two years old and closed, therefore not a live claim against 3.15.0; and **#101 (closed, 2023-09-29)** was a regression that rejected *valid* JSON with escaped newlines, i.e. a false-negative, not corrupted output. `{same issue search, GitHub, 2023, accessed 2026-08-01, confidence: medium, class: failure — flagged as ~2.8 years old}`
11. #139 (open, 2025-01-27, "OpenAI broken JSON rescue needed") shows the residual real-world gap is **multiple concatenated JSON objects plus markdown wrapping needing iterative repair** — i.e. jsonrepair repairs one document, not a stream of documents glued together. `{same issue search, GitHub, 2025-01-27, confidence: medium, class: failure}`

### Q2 — alternatives for tolerant parsing

12. **best-effort-json-parser 1.5.1, published 2026-06-26, BSD-2-Clause**, ~1.81 KB gzipped, zero dependencies; repo pushed 2026-06-26 with **23 commits in the last 12 months**, 278 stars — genuinely maintained. `{npm-registry + gh-api beenotung/best-effort-json-parser + bundlephobia, npm/GitHub/Bundlephobia, 2026-06-26, accessed 2026-08-01, confidence: high, class: version|licence|ecosystem}`
13. Its self-described niche is **incomplete/streaming JSON**: it returns the partial data parsed so far rather than repairing a whole document, and it extracts JSON out of ```` ```json ```` fences; the practical division is best-effort-json-parser for a stream you are still receiving, jsonrepair for a file you already have. `{https://github.com/beenotung/best-effort-json-parser (repo description) via search, GitHub, accessed 2026-08-01, confidence: medium, class: pattern}`
14. **partial-json 0.1.7 was published 2024-05-14 (over 2 years old)**, MIT, ~1.52 KB gzipped; the repo (promplate/partial-json-parser-js) was pushed 2026-06-01 but shows only **1 commit in the last 12 months** — alive but effectively frozen, and no release in two years. `{npm-registry + gh-api promplate/partial-json-parser-js, npm/GitHub, accessed 2026-08-01, confidence: high, class: ecosystem}`
15. **json5 is a permissive dialect, not a repairer**: 2.2.3 was published **2022-12-31** (3.5 years old), MIT, ~9 KB gzipped, and the repo shows **0 commits in the last 12 months** with a last push of 2024-10-25 — dormant. It parses JSON5-legal input (comments, trailing commas, single quotes, unquoted keys) but by definition rejects anything outside its grammar, so it cannot recover truncated or structurally broken LLM output. `{npm-registry + gh-api json5/json5 + bundlephobia, npm/GitHub, accessed 2026-08-01, confidence: high, class: version|ecosystem}`
16. **dirty-json is disqualified twice over**: last publish **0.9.2 on 2020-08-28** (nearly 6 years old) and the npm licence field is **AGPL-3.0**, which is copyleft and incompatible with "free unrestricted use" in a distributed single-HTML artefact. `{npm-registry/dirty-json, npm, 2020-08-28, accessed 2026-08-01, confidence: high for dates and licence field, class: licence|ecosystem}`
17. **untruncate-json is a 0.0.1 from 2019-11-10 with 3 published versions ever** (MIT) — a single-trick dependency whose trick jsonrepair already performs. `{npm-registry/untruncate-json, npm, 2019-11-10, accessed 2026-08-01, confidence: high, class: ecosystem}`
18. **No head-to-head evidence of any library beating jsonrepair on LLM output was found** — the comparison search returned only project self-descriptions and Python-ecosystem articles (`json_repair`, `truncjson`), no benchmark with data. Treat "jsonrepair is best for LLM output" as unproven-but-unrefuted. `{web search "best-effort-json-parser vs jsonrepair comparison", accessed 2026-08-01, confidence: low, class: performance}`

### Q3 — streaming / large JSON

19. **V8 caps a single JavaScript string at 2^29−24 = 536,870,888 characters** on 64-bit builds, which is the hard ceiling for handing a file's text to `JSON.parse` in Chrome/Edge; this is an order of magnitude beyond anything a 100k-row dataset produces. `{web search aggregating groups.google.com/g/v8-users and github.com/minoki/javascript-limits, accessed 2026-08-01, confidence: low-medium (single aggregated retrieval, second independent source not read), class: performance}`
20. The operative constraint is not the ceiling but that **`JSON.parse` is synchronous and blocks the main thread for its full duration**, so a hundreds-of-MB payload visibly freezes the tab even when it parses — the mitigation is a Worker, not a different parser. `{same search result, accessed 2026-08-01, confidence: low-medium, class: performance}`
21. **`@streamparser/json` is the only browser-native streaming JSON parser in the candidate list that is actually being worked on**: repo juanjoDiaz/streamparser-json pushed **2026-07-31 with 42 commits in the last 12 months**, MIT, ~5.62 KB gzipped, zero dependencies, ESM entry — but its **published version is still 0.0.22 from 2025-01-26**, so shipped code is 18 months behind the repo. `{npm-registry + gh-api juanjoDiaz/streamparser-json + bundlephobia, accessed 2026-08-01, confidence: high, class: version|ecosystem}`
22. **clarinet is dormant** — 0.12.6 published 2023-08-24, repo last pushed 2023-08-24, **0 commits in the last 12 months**. `{npm-registry + gh-api dscape/clarinet, accessed 2026-08-01, confidence: high, class: ecosystem}`
23. **oboe.js is near-dormant** — 2.1.7 published 2024-09-25 (~22 months old), licence field simply "BSD". `{npm-registry/oboe, npm, 2024-09-25, accessed 2026-08-01, confidence: medium, class: ecosystem}`
24. **stream-json is maintained (3.5.0, 2026-07-07, BSD-3-Clause)** but is built on Node stream semantics, making it the wrong shape for a no-build browser page. `{npm-registry/stream-json, npm, 2026-07-07, accessed 2026-08-01, confidence: high for version/licence, medium for browser-fit, class: version}`
25. **There is no TC39 streaming-`JSON.parse` proposal** — searching TC39 proposals surfaced only `proposal-json-parse-with-source` (source-text access, Richard Gibson), which is at **Stage 4 / finished**, an unrelated capability. Do not plan on a native streaming JSON API. `{https://github.com/tc39/proposal-json-parse-with-source and tc39/proposals finished-proposals.md via search, accessed 2026-08-01, confidence: medium (absence evidenced by one search pass), class: version}`

### Q4 — NDJSON / JSON Lines

26. JSON Lines is **the default shape for log, event and bulk-export pipelines** and is used as a primary interchange format by Elasticsearch, MongoDB, BigQuery, Snowflake, Spark, Splunk, Datadog and the ML-dataset ecosystem (OpenAI fine-tuning, Hugging Face, Vertex AI, SageMaker) — enough reach that a business-data tool that rejects it will be handed one. `{clickhouse.com/resources/engineering/what-is-ndjson and ndjson.com/history via search, ClickHouse/ndjson.com, accessed 2026-08-01, confidence: medium (vendor-adjacent secondary sources), class: pattern}`
27. NDJSON and "JSON Lines" have been **reconciled into one format by their respective authors**, so supporting one supports both; the competing IANA-standardised JSON-Seq failed to gain adoption. `{ndjson.com/history via search, accessed 2026-08-01, confidence: low-medium, class: pattern}`
28. **No library is needed**: the format's own constraint that each JSON value occupy exactly one line makes split-on-newline-then-`JSON.parse`-per-line correct, and **jsonrepair already lists "newline-delimited JSON converted to arrays" as a built-in repair**, so an NDJSON file that also has LLM damage is covered by the same pass. `{https://github.com/josdejong/jsonrepair, GitHub, accessed 2026-08-01, confidence: medium, class: pattern}`

### Q5 — nested JSON preview

29. **json-formatter-js 2.5.23** (published 2025-03-03, MIT, **~3.25 KB gzipped, zero dependencies, ESM entry**) is the only framework-free collapsible-tree component in the candidate set that is small enough to inline without thought — but the repo shows **0 commits in the last 12 months** and was last pushed 2025-03-03, so it is quiet (npm `modified` 2026-01-15 indicates registry-side metadata change, not a release). `{npm-registry + gh-api mohsen1/json-formatter-js + bundlephobia, accessed 2026-08-01, confidence: high, class: version|ecosystem}`
30. **vanilla-jsoneditor 3.13.0 (2026-07-24, ISC)** is the most actively maintained option — repo (josdejong/svelte-jsoneditor) pushed 2026-07-24 with **35 commits in the last 12 months** — but it weighs **~347 KB gzipped with 26 dependencies**, which is a heavy tax on a single-file artefact for what is otherwise a preview panel. `{npm-registry + gh-api josdejong/svelte-jsoneditor + bundlephobia, accessed 2026-08-01, confidence: high, class: version|ecosystem|performance}`
31. **`jsoneditor` (the older non-Svelte package) is still alive at 10.4.3, 2026-04-01, Apache-2.0** with 220 published versions — a fallback, not a first choice. `{npm-registry/jsoneditor, npm, 2026-04-01, accessed 2026-08-01, confidence: high, class: version|licence}`
32. **@textea/json-viewer 4.0.1 (2024-12-15, MIT, ~10.97 KB gz, 3 deps)** carries React as a peer requirement — framework lock-in, and its last release is ~20 months old. `{npm-registry + bundlephobia, accessed 2026-08-01, confidence: medium-high, class: version}`
33. **react-json-view is dead**: 1.21.3 published **2021-03-09** (5.4 years), MIT, plus React lock-in. `{npm-registry/react-json-view, npm, 2021-03-09, accessed 2026-08-01, confidence: high, class: ecosystem}`

### Q6 — flattening nested JSON to a table

34. **`flat` flattens arrays as objects by default**, producing index-suffixed keys (`a.0`, `a.1`) with **`.` as the default delimiter**, and offers `safe: true` to leave arrays intact, `maxDepth` to cap nesting, `transformKey`, and a reversible `unflatten` — the round-trip guarantee is documented. `{https://raw.githubusercontent.com/hughsk/flat/master/README.md, GitHub, accessed 2026-08-01, confidence: high, class: pattern}`
35. `flat` is **6.0.1, published 2023-09-19 (~2.9 years old), BSD-3-Clause, ~0.78 KB gzipped, zero dependencies**; the repo was pushed 2026-03-19 but shows only **2 commits in the last 12 months** — stable-and-finished rather than abandoned, but do not expect fixes. `{npm-registry + gh-api hughsk/flat + bundlephobia, accessed 2026-08-01, confidence: high, class: version|ecosystem}`
36. **csv42 makes the opposite array choice from `flat`**: its README states that with `flatten` true (the default) "plain, nested objects will be flattened in multiple CSV columns, and **arrays and classes will be serialized in a single field**" — arrays become one JSON-string cell, they are neither index-expanded nor exploded into rows. Its documented header example is `id,name,address.city,address.street`, dot notation, no bracket notation anywhere. `{https://raw.githubusercontent.com/josdejong/csv42/main/README.md, GitHub, accessed 2026-08-01, confidence: high, class: pattern}`
37. csv42 is **5.0.3, published 2024-11-05 (~21 months old), ISC, ~1.98 KB gzipped, zero dependencies**, and its own README's "2 KB gzipped with everything included" claim matches Bundlephobia's measurement independently; the repo was last pushed 2025-04-02 with **0 commits in the last 12 months** — dormant. `{npm-registry + gh-api josdejong/csv42 + bundlephobia + README, accessed 2026-08-01, confidence: high, class: version|licence|ecosystem}`
38. **json2csv separates the two array semantics into two explicit transforms**: a `flatten` transform for nested objects (configurable separator) and an **`unwind` transform that emits one row per array element** — i.e. the established tool treats explode/unwind as an opt-in user decision, not a default. `{https://github.com/juanjoDiaz/json2csv, GitHub, accessed 2026-08-01, confidence: medium (README summary, transform defaults not read in detail), class: pattern}`
39. json2csv is **maintained and browser-ready**: `@json2csv/plainjs` 7.0.7 published 2026-07-16, MIT, ~7.52 KB gzipped, repo pushed 2026-07-16 with **19 commits in the last 12 months**, and the repo ships a `dist/cdn` build; the project is split into `plainjs` / `node` / `whatwg` / `cli` / `transforms` / `formatters` so a browser build takes only `plainjs` + `transforms`. `{npm-registry + gh-api juanjoDiaz/json2csv + bundlephobia + README, accessed 2026-08-01, confidence: high, class: version|ecosystem|licence}`
40. **`dot-object` (2.1.5, 2024-04-19, MIT, ~1.84 KB gz)** is a dot-path get/set/pick utility, not a table flattener — useful for addressing `a.b.0.c` after flattening, but it does not decide array semantics for you. `{npm-registry + bundlephobia, accessed 2026-08-01, confidence: medium-high, class: version}`
41. **`flatten-json` is dead**: version 0.0.1 published **2013-09-01**, 3 versions total. `{npm-registry/flatten-json, npm, 2013-09-01, accessed 2026-08-01, confidence: high, class: ecosystem}`
42. **The semantic conclusion**: the convention across every maintained tool examined is **`.` as separator** and **dot-path keys for nested objects**; the divergence is entirely about arrays — `flat` index-suffixes them by default (column count = length of the longest array, so variable-length arrays produce a ragged, sparse column set), csv42 collapses each array into one JSON-string cell, and json2csv makes explode an explicit `unwind` step. There is no default that is right for both "join this with CSV" and "keep every element addressable". `{synthesis of #34, #36, #38, confidence: medium, class: pattern}`

## Candidate tables

### Tolerant parsing
| Package | Version / date | Licence | Size (gz) | Browser-viable | Maintained (commits last 12mo) | Notes |
|---|---|---|---|---|---|---|
| jsonrepair | 3.15.0 / 2026-07-03 | ISC | 2.88 KB, 0 deps | yes, UMD + ESM | yes (26) | 18 documented repair classes incl. truncation, fences, Python constants, NDJSON |
| best-effort-json-parser | 1.5.1 / 2026-06-26 | BSD-2-Clause | 1.81 KB, 0 deps | yes (no ESM entry flagged) | yes (23) | partial/streaming input; returns data parsed so far |
| partial-json | 0.1.7 / 2024-05-14 | MIT | 1.52 KB, 0 deps | yes | barely (1) | no release in 2 yrs |
| json5 | 2.2.3 / 2022-12-31 | MIT | 9 KB | yes | no (0) | permissive *dialect*, not a repairer; cannot fix truncation |
| dirty-json | 0.9.2 / 2020-08-28 | **AGPL-3.0** | unknown | unknown | no (repo not found at guessed URL) | licence disqualifies |
| untruncate-json | 0.0.1 / 2019-11-10 | MIT | unknown | unknown | no | 3 versions ever |

### Streaming / large JSON
| Package | Version / date | Licence | Size (gz) | Browser-viable | Maintained | Notes |
|---|---|---|---|---|---|---|
| @streamparser/json | 0.0.22 / 2025-01-26 | MIT | 5.62 KB, 0 deps | yes, ESM | repo very active (42) but no release in 18mo | only credible browser streaming parser here |
| stream-json | 3.5.0 / 2026-07-07 | BSD-3-Clause | unknown | Node-stream shaped | yes | wrong runtime shape |
| oboe.js | 2.1.7 / 2024-09-25 | "BSD" | unknown | yes | near-dormant | |
| clarinet | 0.12.6 / 2023-08-24 | BSD-2-Clause | unknown | yes | no (0) | |
| native `JSON.parse` | — | — | 0 | yes | — | sync, blocks main thread; V8 string cap 536,870,888 chars |

### Tree preview
| Package | Version / date | Licence | Size (gz) | Framework | Maintained | Notes |
|---|---|---|---|---|---|---|
| json-formatter-js | 2.5.23 / 2025-03-03 | MIT | 3.25 KB, 0 deps | none | quiet (0 commits) | smallest framework-free tree |
| vanilla-jsoneditor | 3.13.0 / 2026-07-24 | ISC | 346.8 KB, 26 deps | none (Svelte inside) | yes (35) | full editor; heavy |
| jsoneditor | 10.4.3 / 2026-04-01 | Apache-2.0 | unknown | none | yes (published Apr 2026) | older sibling, still shipping |
| @textea/json-viewer | 4.0.1 / 2024-12-15 | MIT | 10.97 KB, 3 deps | **React** | stale (~20mo) | |
| react-json-view | 1.21.3 / 2021-03-09 | MIT | unknown | **React** | dead | |

### Flattening
| Package | Version / date | Licence | Size (gz) | Browser-viable | Maintained | Array default |
|---|---|---|---|---|---|---|
| flat | 6.0.1 / 2023-09-19 | BSD-3-Clause | 0.78 KB, 0 deps | yes | frozen (2) | index-suffixed `a.0`; `safe:true` to preserve |
| csv42 | 5.0.3 / 2024-11-05 | ISC | 1.98 KB, 0 deps | yes, built for browser | dormant (0) | array → single JSON-string cell |
| @json2csv/plainjs (+transforms) | 7.0.7 / 2026-07-16 | MIT | 7.52 KB, 2 deps | yes, `dist/cdn` | yes (19) | `flatten` for objects, opt-in `unwind` = one row per element |
| dot-object | 2.1.5 / 2024-04-19 | MIT | 1.84 KB, 2 deps | yes | quiet | path utility, not a flattener |
| flatten-json | 0.0.1 / 2013-09-01 | BSD-2-Clause | unknown | unknown | dead | — |

## Leads worth chasing

- **jsonrepair issue #139 (open, 2025-01-27)** — concatenated JSON objects plus markdown wrapping needing iterative repair. If the tool must accept "whatever the user pasted out of a chat window", this is the residual gap and it may need a pre-pass (extract the largest fenced block, or repair-then-retry loop) rather than a library.
- **jsonrepair issue #170 (open, 2026-06-12)** — stack overflow on a specific escape pattern. A `try/catch` around jsonrepair is not enough; `RangeError` from recursion must also be caught. Worth reproducing against 3.15.0 before shipping.
- **@streamparser/json's 18-month release lag against a very active repo** — check whether the maintainer intends a release, or whether consumers are expected to build from source. Decides whether streaming is available at all in a no-build page.
- **json2csv `transforms` defaults** — read the docs site (juanjodiaz.github.io/json2csv) for the exact `flatten` separator default, `unwind` blank-out semantics, and whether `unwind` handles multiple parallel arrays. This is the closest thing to a reference implementation of the flatten/explode decision.
- **Worker-based parse** — no measured browser numbers were found; a 5-line measurement on a representative 100k-row file would be more decisive than more searching.
- The Python `json_repair` (mangiucugna) project appeared repeatedly and is the most-cited LLM-JSON-repair implementation overall; its issue tracker likely documents the *classes* of LLM breakage more thoroughly than the JS ecosystem does, even though the code is not usable here.

## Contradictions

- **GitHub licence detection vs README/npm for jsonrepair, csv42 and svelte-jsoneditor**: the GitHub API returns `NOASSERTION` for all three while npm and the READMEs say ISC. Resolved in favour of npm + README (two primary statements from the author against one automated detector).
- **@streamparser/json**: highest commit activity in the whole streaming set (42 commits/12mo, pushed 2026-07-31) but the newest published version is 0.0.22 from 2025-01-26. Repo activity and release activity disagree; a snapshot of either alone would mislead.
- **json-formatter-js**: npm `modified` timestamp is 2026-01-15 while the last actual release is 2025-03-03 and the repo has zero commits in 12 months. The npm modified field is not an activity signal.
- **csv42 array handling**: an earlier read of the repo landing page suggested arrays might be flattened into columns; the README text read directly states they are serialized into a single field. Resolved in favour of the direct README quote.

## Looked for and could not find

- **Any documented case of jsonrepair silently producing wrong data.** The evidenced failure mode across the issue tracker is throwing (parse errors, stack overflow), not corruption. This is a *negative* result from one issue-search pass over titles and bodies; it is not proof of absence, and the brief's premise that silent-wrong-data is jsonrepair's characteristic danger is **unsupported by what was retrievable**.
- **Any benchmark or head-to-head evaluation of JS tolerant-JSON parsers on LLM output.** Nothing with data exists in the retrieved surface; all comparison material is project self-description.
- **Measured browser numbers for `JSON.parse` on large files** (ms per MB, freeze thresholds, Worker vs main-thread). Only the theoretical V8 string ceiling was found, and from a single aggregated retrieval — the two-source bar is *not* met for claim #19/#20, so do not rest a recommendation on those numbers without a direct measurement.
- **Bundle sizes for stream-json, oboe, clarinet, jsoneditor, react-json-view, dirty-json, untruncate-json, flatten-json** — Bundlephobia returned no usable figures for these.
- **The dirty-json repository** — the guessed GitHub path 404s, so the abandonment claim rests solely on the npm publish date; the AGPL licence claim likewise rests on the npm `license` field alone and is not two-sourced.
- **Confirmation from the JSON Lines specification itself** that newlines cannot appear unescaped inside a JSONL record (the basis for claim #28 that split-and-parse is safe). Treat as a reasonable but unverified assumption.
- **A TC39 streaming JSON proposal** — searched and not found; only `proposal-json-parse-with-source` (Stage 4) exists, which does something else entirely.
