---
title: 'Technical research: File formats and parsing'
type: 'technical'
topic: 'File formats and parsing for querbeet (CSV, JSON, XLSX, Parquet)'
decision: 'Which browser-side libraries and strategies for reading and writing CSV, JSON, XLSX and possibly Parquet in a single-HTML no-backend app'
source: 'native run (deep-recon)'
status: complete
preset: 'standard'
validation: 'normal'
claims: {verified: 20, unverified: 2, overturned: 1}
created: '2026-08-01'
updated: '2026-08-01'
---

# Technical research: File formats and parsing

**Decision this research serves:** Which browser-side libraries and strategies for reading and writing CSV, JSON, XLSX and possibly Parquet in a single-HTML no-backend app — and whether Parquet stays in scope at all.

## Executive summary

**The whole file-handling stack costs about 64 KB gzipped, and Parquet stays in scope.**

| Job | Pick | Gzipped | Licence |
| --- | --- | --- | --- |
| CSV | PapaParse 5.5.4, `dynamicTyping: false` | 7,076 B | MIT |
| Encoding | none — `TextDecoder` BOM sniff + strict-UTF-8 probe | 0 B | platform |
| XLSX write | write-excel-file 4.1.1 | 19,132 B | MIT |
| XLSX read | read-excel-file 9.3.5 | 15,254 B | MIT |
| JSON repair | jsonrepair 3.15.0 (only on `JSON.parse` failure) | 2,890 B | ISC |
| JSON preview | json-formatter-js 2.5.23 | 3,250 B | MIT |
| JSON flatten | own code — no library's default fits | — | — |
| Parquet export | hyparquet-writer 0.16.3 | 17,239 B | MIT |

Three findings drive that answer.

**1. German number formats break default type inference, in every library, silently.** PapaParse's `dynamicTyping` turns the string `1.234` into the number **1.234** — wrong by a factor of a thousand, with no error — while leaving `1.234,56` as a string in the same column. Measured against the released 5.5.4, not inferred. R1 measured Arquero doing exactly the same thing. Two libraries, one identical bug, because both use an anchored regex that reads `.` as a decimal point. **Switch automatic typing off everywhere and own the German parser.**

**2. SheetJS is the expensive default, and the MIT alternative beats it on every axis that matters here.** SheetJS CE is 334 KB gzipped, puts bold headers and conditional formatting behind an unpriced Pro licence, has shipped no release in two years and no commit in six months. `write-excel-file` + `read-excel-file` are 34 KB together, MIT throughout, include styling and conditional formatting free, and their output was verified with an independent reader: umlauts, the euro sign, leading zeros, real numbers with German format codes, real dates, bold headers and column widths all correct. Weighted matrix: **88 versus 61**. SheetJS remains the runner-up and wins if legacy `.xls`/`.xlsb`/`.ods` must be read — the pair cannot do that at all.

**3. Parquet was expected to be dropped. It should not be.** `hyparquet-writer` is pure JavaScript with no WebAssembly, bundles to 17 KB, and files it wrote were read correctly by **pyarrow 25, DuckDB 1.5.5 and Polars 1.43.2** across three codecs. It writes 100k rows in 273 ms. The library that would have failed the gate, `parquet-wasm`, carries a 6.5 MB WASM payload and fetches it at runtime.

**The biggest caveat**, and it is a real one: **every performance number in this report is from Node, not a browser.** Writing xlsx takes **~3.3–3.4 seconds** at 100k rows — long enough to freeze a tab, so it needs a Web Worker. R2, which ran in parallel with this research, has since measured that a **classic Worker constructed from a `blob:` URL does work from a `file://` page** in both Chromium 150 and Firefox 153, so that is viable [R2]. What remains open is narrower: whether `read-excel-file`'s *internal* worker is constructed in a way that survives `file://`. Its own README contradicts itself on whether it uses one at all.

One secondary caveat: `hyparquet-writer` ships ESM only, so **Parquet is the dependency that turns the build step from optional into required**. Everything else here ships a ready-made UMD bundle.


---

## D1 — CSV parsing

### Recommendation

**PapaParse 5.5.4, with `dynamicTyping` switched off.** It is the only candidate in the field that combines a 2026 release, an MIT licence, a single self-contained UMD file that inlines into one HTML page, semicolon in its default delimiter-guess set, and documented hooks for the preamble problem. It is roughly twice as slow as the current speed leaders, and at the target scale that does not matter.

### Maintenance and footprint

PapaParse's latest release is **5.5.4, published 2026-06-19** [1][2], MIT-licensed [1]. The release history shows a low-tempo, bursty maintenance pattern rather than either vigour or abandonment: a 22-month gap between 5.4.1 (March 2023) and 5.5.0 (January 2025), then four releases in five months, then 5.5.4 [1][2]. The commit log tells the more important story — the thirteen most recent commits span roughly eighteen months and come from many different community authors, merged by `pokoli` and `dboskovic`; the repository owner `mholt` does not appear among them [3]. Only **three** of those commits fall inside the last twelve months, so the tempo is low. This is a maintained-by-committee project, which is a durability signal in both directions: no single point of failure, but also no one driving.

Measured from the jsDelivr artefact: `papaparse.min.js` 5.5.4 is **19,476 bytes raw / 7,076 bytes gzipped** [9]. It is a single UMD file with no dependencies, so inlining it into one HTML file needs no build step.

An open-issue **trend** could not be retrieved — only a snapshot: the GitHub API reports **224 open issues and pull requests combined** [6], and the two could not be separated within budget. Treat the maintenance judgement above as resting on release and commit history, not on issue dynamics.

### Delimiter detection — better than its source code suggests

With `delimiter` left blank, PapaParse guesses from `delimitersToGuess`, whose default is `[',', '\t', '|', ';', Papa.RECORD_SEP, Papa.UNIT_SEP]` — **semicolon is in the default set** [4]. The algorithm parses a preview of 10 rows per candidate, scores by field-count consistency (`delta`) and average field count, requires `avgFieldCount > 1.99`, and falls back to `Papa.DefaultDelimiter = ','` [5].

Reading that `avgFieldCount > 1.99` gate suggests several failure modes — a preamble before the header consuming the 10-row sample, two-column files sitting exactly on the threshold, single-column files failing entirely. **Executing the released build refutes most of them.** Against the `papaparse@5.5.4` artefact from jsDelivr — identified by its exact byte count, 19,476 — under Node v26.5.0, script and raw output preserved in `imports/` [M1]:

| Input | Guessed delimiter | Correct? |
| --- | --- | --- |
| German file with a 3-line preamble before the header | `;` | yes |
| Two-column semicolon file | `;` | yes |
| Semicolon file whose values contain decimal commas (`1,50`) | `;` | yes |
| Genuine single-column file | `,` | n/a — and it reports `UndetectableDelimiter` as an explicit error |

So the guesser handles the German cases that matter, and where it genuinely cannot decide it **says so** rather than failing silently — the error object carries `code: "UndetectableDelimiter"` [M1]. That error is the hook for a UI prompt.

One caveat with a shelf life: commit #1128, *"fix guess delimiter by row consistency before field count"*, landed on master on 2026-07-03, **after** 5.5.4 shipped [3]. The guesser is being actively reworked; the behaviour measured above is 5.5.4's, not master's.

### Header detection — absent, and known to be absent

PapaParse does **not** detect which row is the header. `header: true` means only that the first row of parsed data is interpreted as field names [4]. This is an acknowledged gap, not an oversight: issue #1121, *"[Feature] Add automatic header detection"*, was opened 2026-05-10 and remains open [6].

Two documented workarounds exist — `skipFirstNLines` and `beforeFirstChunk` [4] — but both require the caller to already know how many rows to skip. **Header-row detection is application code that must be written, not a library feature to configure.** The measurement above confirms the two interact correctly: with `skipFirstNLines: 3` the preamble file parses with the right delimiter and the right field names [M1].

### `dynamicTyping` silently corrupts German numbers — measured

This is the load-bearing finding of the dimension. `dynamicTyping` is documented only as converting "numeric and boolean data … to their type", with no locale awareness mentioned anywhere [4]. The actual test in source is a single regex, `/^\s*-?(\d+\.?|\.\d+|\d+\.\d+)([eE][-+]?\d+)?\s*$/`, feeding `parseFloat` [5].

Executed against 5.5.4 with a German cost-centre table [M1]:

| Input string | `dynamicTyping: true` result | Verdict |
| --- | --- | --- |
| `1.234` (thousands separator) | `1.234` **as a number** | **silently wrong by a factor of 1000** |
| `1.234,56` | `"1.234,56"` as a string | left alone |
| `1.234.567` | `"1.234.567"` as a string | left alone |
| `0123` (cost centre) | `123` as a number | leading zero lost |

The damage pattern is worse than uniform corruption would be: **within a single column**, four-digit values silently become wrong numbers while values carrying a decimal comma stay strings. The result is a mixed-type column that no downstream type check will flag, because some of it is genuinely numeric.

This has been known and declined since 2014 — issue #143, *"Numeric value with comma (European-formatted numbers)"*, was labelled `deferred` and closed 2014-12-28 without locale support [6]. That issue is 11½ years old and is cited only as evidence the request was made and refused; the current-version evidence is the executed measurement.

**Implication for implementation:** `dynamicTyping` stays **off**. Values arrive as strings and a purpose-written German number parser converts them. PapaParse does per-column typing via an object or function [4], but there is no reason to use it — the conversion logic has to be written either way.

This is the second library in this project found to corrupt German numbers through default type inference. It should be treated as the rule, not the exception: **no CSV/dataframe library's default type inference is safe for German data.**

### Scale and streaming

Streaming is available via `step` (per row) and `chunk` (per file chunk), with `parser.pause()`/`resume()` available outside workers only, and `worker: true` documented as keeping "your page reactive, but may be slightly slower" [4] — the maintainers position workers as a responsiveness feature with a throughput cost, not a speed feature.

The only methodologically transparent throughput numbers found are from uDSV's benchmark: on a 17 MB / **100k row** / 12-column dataset, PapaParse reached 1.13M rows/s untyped and 454K rows/s typed, on a Ryzen 7 laptop under **Node v24.1.0, not a browser, and without a worker** [7]. Extrapolated, 100k rows is roughly 0.1–0.25 s. A second source, LeanyLabs, ranks PapaParse fastest of all parsers it tested [8] — but publishes no date, no hardware, no Node version and no numbers outside charts, and its candidate set predates uDSV entirely. Confidence low; cited only because it contradicts.

**No browser-side timing or memory figure for PapaParse at any scale was found, from any source.** Every number above is Node. At the target scale the margin is wide enough that this gap is unlikely to change the decision, but it is a real gap.

### Live defects worth knowing

Verified open as of 2026-08-01 [6]:

- **#1132** (opened 2026-07-27) — *"Four streaming defects: chunk-boundary UTF-8 corruption, cached line-ending guess, header dedupe on resume, and no backpressure under `pause()`"*. Chunk-boundary UTF-8 corruption hits umlauts specifically, and only in streaming mode. Only the title was read, not the thread.
- **#1122** (opened 2026-05-27) — `worker: true` returns malformed results in Vite production builds. Bundler-specific; a bundler-free single HTML file is probably unaffected.
- **#761** (opened 2020-01-30, still open, updated 2026-03-17) and **#1029** (opened 2023-11-08, still open) — both in the `transformHeader` path, which is exactly what you would use to normalise German column names.

Fixed and therefore *not* current pain: UTF-8 BOM handling and duplicate-header renaming (5.4.0, 2023-03), BOM stripping from column keys (2025-05), duplicate-counting infinite loop (2025-05) [2][3].

### The field, and why it does not change the answer

| Library | Latest | Date | Licence | Gzipped | Note |
| --- | --- | --- | --- | --- | --- |
| **PapaParse** | 5.5.4 | 2026-06-19 | MIT | 7,076 B (measured) | delimiter guess + streaming + worker |
| uDSV | 0.7.3 | 2025-07-06 | MIT | 2,642 B (measured) | pre-1.0, no release in 13 months |
| csv-parse | 7.0.1 | 2026-07-02 | MIT | unknown | most recently released |
| web-csv-toolbox | 0.15.0 | 2025-12-25 | MIT | unknown | pre-1.0 |
| csv42 | 5.0.3 | 2024-11-05 | **absent from manifest** | unknown | licence must be checked in-repo |
| d3-dsv | 3.0.1 | 2021-06-05 | ISC | 1,535 B (measured) | 5 years since publish; no detection, no streaming |

Versions and licences from the npm registry [1]; sizes measured from jsDelivr [9]. In uDSV's own benchmark PapaParse is about 2× behind the leaders and degrades ~3× on quote-heavy input [7] — the author of the winning library ran it, so treat the ranking with the corresponding discount. At 100k rows every candidate finishes in well under a second; the gap is not decision-relevant. What is decision-relevant is that PapaParse is the only one with a 2026 release, a settled licence, delimiter guessing, streaming, and preamble hooks all at once.

---

## D2 — Character encoding

### Recommendation

**No detection library. Use the platform.** BOM sniff, then a strict UTF-8 validity probe, then fall back to `windows-1252`, with a user-visible override. Zero bytes of dependency, and the one thing a heuristic detector would add — distinguishing Windows-1252 from ISO-8859-1 — turns out to be a problem that does not exist in a browser.

### The finding that collapses the dimension

The WHATWG Encoding Standard makes `windows-1252` a **required** encoding and then closes the set: *"User agents must not support any other encodings or labels"* [10]. So `new TextDecoder('windows-1252')` is guaranteed in every conforming browser — decoding CP1252 needs no library at all.

More consequentially: `iso-8859-1`, `latin1`, `l1`, `cp819`, `csisolatin1`, `us-ascii` and `ascii` are all **labels for the windows-1252 decoder** in the standard [10]. There is no separate ISO-8859-1 decoder in a browser. The classic "is this 1252 or 8859-1?" discrimination — the hardest thing a charset detector does, and the thing it does worst — is therefore **unreachable and irrelevant here**. The only question left is binary: *is this valid UTF-8, or is it not?*

That is a validation question, not a classification question, and the platform answers it. `TextDecoder` with `{fatal: true}` throws a `TypeError` on malformed input instead of substituting U+FFFD [11], which makes "try strict UTF-8, catch, fall back" a working probe. The mechanism is sound because UTF-8 is self-validating: arbitrary Windows-1252 German text (`ä` = 0xE4 followed by an ASCII letter) is overwhelmingly invalid UTF-8. **No source quantifying the false-accept rate was found**, so the magnitude of "overwhelmingly" is asserted from the encoding's structure, not measured.

Note the asymmetry for the export side: `TextEncoder` is UTF-8-only by specification [10]. Writing CP1252 output *would* need a library — but there is no reason to write anything but UTF-8.

### BOM

The standard defines a normative BOM sniff over exactly three marks — `EF BB BF` (UTF-8), `FE FF` (UTF-16BE), `FF FE` (UTF-16LE) — and gives the BOM **priority over any declared label**, with the stated rationale that "a byte order mark has priority over a label as it has been found to be more accurate in deployed content" [10]. The spec itself endorses BOM sniffing as the most reliable available signal.

What fraction of real-world CSV files carry a BOM could not be established from any source. Files without one are the case the probe exists for.

### What Excel actually writes — and why you must not rely on it

This is the weakest evidence in the dimension, and it deserves to be flagged rather than smoothed over.

**Microsoft's own file-format documentation says nothing at all about character encoding or byte order marks for any CSV variant** [12]. It describes "CSV (comma delimited)", "CSV (Macintosh)" and "CSV (MS-DOS)" purely by target operating system. That Microsoft ships three OS-targeted CSV variants is itself the strongest primary-source hint that the plain variant writes the Windows ANSI code page — 1252 in German locales — but Microsoft never says so.

The claim that German Excel's plain CSV export is Windows-1252 therefore rests entirely on consistent secondary testimony, not on a vendor statement. Likewise the claim that the "CSV UTF-8" option writes a BOM: two independent third-party accounts support it, one with hex evidence [16], but no Microsoft source does.

**Design consequence:** the encoding strategy must not be built on an assumption about what Excel promises, because Excel promises nothing. This is an argument *for* the probe-and-fallback approach and *against* any scheme that branches on a filename or a user's stated tool. Current Microsoft Q&A threads reinforce it — users report the "CSV UTF-8" path writing UTF-16 on macOS, which is why the UTF-16 BOM branch is not optional.

### Why the detector libraries lose

| Candidate | Browser-viable | Size | Licence | Maintenance | Accuracy evidence |
| --- | --- | --- | --- | --- | --- |
| **`TextDecoder` (BOM + `fatal` probe + 1252 fallback)** | native, spec-guaranteed | **0 B** | platform | Living Standard, updated 2026-05-21 | mechanism is spec-grade; no number |
| chardet 2.2.0 | yes (`browser` field, zero deps) | 179 KB unpacked; gzipped unknown | MIT | active, 2026-06-20 | none measured |
| jschardet 3.1.4 | yes (published browser build) | 1.32 MB unpacked; gzipped unknown | **LGPL-2.1+** | stable release 22 months old; 4.0.0-rc.1 on 2026-07-27 | none measured |
| detect-character-encoding | **no** — native Node addon | 21.7 MB | BSD-2 | 2024-01 | n/a |
| iconv-lite 0.7.3 | converter, not detector | 344 KB unpacked | MIT | active, 2026-07-03 | n/a |

Versions, dates, licences and unpacked sizes from the npm registry [13][14]. Three things sink the library route:

1. **The one job they would do is already done.** With ISO-8859-1 collapsed into windows-1252 by the spec, a detector contributes nothing the `fatal` probe does not.
2. **No measured accuracy exists for any of them** on short Western-European text — at any length, for any encoding pair. Every retrieved statement is qualitative. Meanwhile the chardet lineage has documented failures in exactly the dangerous direction: python-chardet issue #185, *"1 sentence utf-8 detected as Windows-1252"* [15]. A detector that misreads short UTF-8 as CP1252 is strictly worse than the probe, which cannot make that error.
3. **jschardet is LGPL-2.1+** [14]. The relinking obligation is the awkward case for a single inlined HTML file. chardet is MIT and would be the pick if a detector were needed — it is not.

One lead left open: jschardet 4.0.0-rc.1 landed 2026-07-27, five days before this research. What it changes is unexamined. It does not affect the recommendation, since the argument against detectors is structural rather than about any one library's quality.

### Open

- The `File` → bytes → chunked `TextDecoder({stream: true})` pattern at ~100k rows was not researched — budget ran out. Low risk (the streaming decode mode is specified [10]), but unverified.
- The `€` sign at byte 0x80 is the one German business character living in the exact range where CP1252 and ISO-8859-1 diverge. It belongs in the test fixtures.
- PapaParse passes its `encoding` option through to the FileReader API [4], which means the decode decision can be made before PapaParse ever sees the text — decode to a string yourself, then hand PapaParse the string.

---

## D3 — XLSX read and write

### Verdict

**`write-excel-file` 4.1.1 + `read-excel-file` 9.3.5** — MIT, 34 KB gzipped for the pair, cell styling and conditional formatting included rather than paywalled, and output verified against a reference reader to be correct for German data.

**Runner-up: SheetJS Community Edition 0.20.3.** It wins instead if legacy formats must be read — `.xls`, `.xlsb`, `.ods` — which the pair cannot do at all, or if one 334 KB dependency from an established vendor is preferred over two 17 KB ones from a single author.

### The requirements frame

Hard gates, all four of which every candidate must pass: usable in a browser without Node polyfills; CDN-loadable or inlinable into one HTML file; licence permitting free unrestricted commercial use; and xlsx read **and** write.

| Criterion | Weight | Why |
| --- | --- | --- |
| German-Excel output fidelity | 25 | The deliverable is a file an office user opens in Excel and hands on. Umlauts, real numbers, real dates, leading zeros. |
| Footprint in a single HTML file | 20 | Every byte competes with the rest of the app in one file. |
| Maintenance / five-year regret | 20 | No vendor to escalate to; a dead library is a rewrite. |
| Capability breadth | 15 | Styling, formats, multiple sheets, and which input formats can be read. |
| Integration friction | 10 | UMD versus a required bundler; worker requirements. |
| Paywall exposure | 10 | Whether the needed features cost money. |

### The matrix

Scored 1–5; the weighted total is out of 500, shown as a percentage.

| Criterion | Weight | **write/read-excel-file** | SheetJS CE | ExcelJS | @office-kit/xlsx |
| --- | --- | --- | --- | --- | --- |
| German-Excel fidelity | 25 | **5** (measured) | 4 (data yes, no bold headers) | 4 (unverified) | 3 (unverified) |
| Footprint | 20 | **5** (34 KB gz) | 1 (334 KB gz) | 2 (unknown, Node-shaped) | 2 (no bundle exists) |
| Maintenance | 20 | 4 (weekly releases, single author) | 2 (no release 2 yr, no commit 6 mo) | 1 (dormant 2.5 yr) | 2 (3 months old, pre-1.0) |
| Capability breadth | 15 | 3 (xlsx only) | **5** (xls, xlsb, ods, csv, …) | 3 | 4 |
| Integration friction | 10 | 4 (UMD; read-side worker unverified) | **5** (one script tag) | 2 (polyfills likely) | 1 (bundler required) |
| Paywall exposure | 10 | **5** (MIT throughout) | 2 (styling is Pro, quote-only) | 5 | 5 |
| **Weighted total** | | **88** | 61 | 55 | 55 |

Re-weight it if the priorities differ. The result is not close, and it is robust: SheetJS only overtakes if capability breadth is weighted above roughly 45, i.e. if reading legacy formats becomes a primary requirement rather than a nice-to-have.

### Measured footprints

Every figure below was obtained by downloading the artefact and compressing it, not from a claim:

| Package | Version | File | Raw | Gzipped |
| --- | --- | --- | --- | --- |
| write-excel-file | 4.1.1 | `bundle/write-excel-file.min.js` (UMD) | 70,844 B | **19,132 B** |
| read-excel-file | 9.3.5 | `bundle/read-excel-file.min.js` (UMD) | 52,613 B | **15,254 B** |
| **the pair** | | | 123,457 B | **34,386 B** |
| SheetJS CE | 0.20.3 | `dist/xlsx.full.min.js` | 951,904 B | **~334,000 B** |
| @office-kit/xlsx | 0.9.0 | no usable browser bundle exists | — | — |

Sources [31][34][35][36]. Both UMD bundles expose a global (`writeXlsxFile`, `readXlsxFile`) and contain zero `require(` and zero `process.` references — they load in a plain HTML page with no bundler and no Node polyfills [34][35]. The gzip figure for SheetJS differs by 770 bytes between the two rounds that measured it; the raw byte count is identical, so it is a compression-level artefact. Treat it as ~334 KB, not an exact number.

### What was measured

`write-excel-file` 4.1.1 was installed from npm and run under Node v26.5.0; the output was read back with **openpyxl 3.1.5** as an independent reference implementation. Script, verification code and raw output are in `imports/` [M2]. Results:

| Check | Result |
| --- | --- |
| Umlauts (`Bürobedarf Süd`, `Möbel`, `Straßenreinigung`) | intact, UTF-8 in `sharedStrings.xml` |
| Euro sign in a header | intact |
| Leading zeros (`0123` cost centre) | **preserved** — written as text, not coerced |
| Numbers | real `float`/`int`, not strings |
| Number format codes | `#,##0.00` and `#,##0` present on the cells |
| Dates | real `datetime`, format `dd.mm.yyyy` |
| Bold header row | applied |
| Column widths | all five applied as specified |
| 100k-row file | valid; 100,001 rows read back |

This closes the "opens cleanly in Excel" requirement on everything that is testable without Excel itself. Format codes are stored locale-neutrally and Excel renders them per the user's regional settings, so a German user sees a decimal comma from `#,##0.00` — that last step was not verified against a real Excel install and remains the one untested link.

**Two traps found by running it:**

1. **`filePath` is a silent no-op.** The README documents `writeXlsxFile(data, { filePath })`, but in 4.1.1 the Node entry returns a writer object `{toBuffer, toStream, toFile}` and the `filePath` option is accepted and ignored — no file, no error, no warning. The browser entry's `fileName` is a different code path, but the episode shows the documentation drifts from the code. Verify options actually took effect rather than trusting the README.
2. **No `<dimension>` element** is written into the worksheet XML — confirmed by inspecting `xl/worksheets/sheet1.xml` directly [M2]. Excel tolerates this, but `openpyxl` in read-only mode reports `max_row = None`. Any consumer relying on the declared sheet dimension gets nothing.

**Scale — the number that changes an implementation decision:** writing 100,000 rows × 5 columns took **3,296 ms and 3,445 ms** on two runs, producing 3,340,462 bytes both times [M2]. Call it ~3.3–3.4 seconds. That is roughly **twelve times slower than writing comparable data as Parquet** (see D5) and far too long to run on the main thread. The xlsx export path needs a Web Worker or, at minimum, a progress indicator — this is the one place in the whole file-handling story where a worker is genuinely warranted.

### Why SheetJS lost, and why it is still the runner-up

SheetJS CE is Apache-2.0 and technically excellent, and it reads formats nothing else here touches. Three things cost it the decision.

**Footprint.** `xlsx.full.min.js` measures **951,904 bytes raw / ~334 KB gzipped** [31]. The smaller `xlsx.mini.min.js` is not an option: SheetJS's own documentation says it drops "CSV and SYLK encodings (directly affecting users outside of the United States)" [28a] — the size-optimisation trap for exactly this project's users.

**Styling is behind a paywall.** Number formats (the cell `z` property) and column widths *are* in CE [28]. But all cell styling — bold headers, fills, borders, fonts — plus conditional formatting and "international locale support" are Pro, and Pro has **no published price**; the page says "inquire" [29]. A bold header row is not available in CE at any effort level. The MIT alternative ships both bold headers and conditional formatting for free.

**The project is quieter than it first appears.** Round 1 read master commits into February 2026 as ongoing activity. Round 2 corrects that: **2026-02-09 is the newest commit**, so master has been silent for about six months, and no tag newer than **v0.20.3 (2024-07-18)** exists [30]. The `cdn.sheetjs.com/xlsx-latest` alias was downloaded and its embedded version string grepped — it still reads `0.20.3`, so nothing newer is hiding behind the "latest" path [31]. The documentation site was still being edited on 2026-03-23, so someone is present [38]. **No vendor statement explaining the gap could be found**: the Gitea releases API and issue pages both refuse anonymous access. The honest description is *no release in two years, no commit in six months, cause unknown* — weaker than "actively developed but unreleased".

One more SheetJS constraint worth recording: **its streaming writers do not emit xlsx.** `XLSX.stream.to_csv`/`to_html`/`to_json` exist; there is no streaming xlsx writer, and the docs state flatly that "NodeJS streaming APIs are not available in the browser" [38]. Writing 100k rows to xlsx always builds the entire workbook and the entire output in memory. The vendor's two documented levers for large data are `dense: true` (arrays-of-arrays worksheets, introduced to work around Chrome performance regressions) and Web Workers [28][38]. **No measured browser-side figure for SheetJS at ~100k rows exists**, from the vendor or anyone else.

### The rest of the field

**ExcelJS is dormant.** Stable 4.4.0 published 2023-10-19, last default-branch commit 2024-01-12, 798 open issues, not archived, MIT [32][33]. Two sources disagree on whether it works in a browser at all — its marketing site says "Node.js & Browser", secondary accounts say Node-only — and the question is moot while the project is asleep. It also carries a documented scale failure: issue #2299 reports corrupt output above ~47,500 rows, apparently size-driven rather than row-driven [39] (closed 2023-07-04; whether it was fixed or closed as user error was not established).

**`@office-kit/xlsx` and `xlsx-kit` are one package, not two.** Round 1 counted them as two new MIT contenders; the jsDelivr file listings are structurally identical (220 files each, byte-identical type definitions), the old repository 404s, and both trace to the same sole author [36][37]. It is real engineering — 662 commits, 342 test files, read/write/styles/charts/streaming [37] — but it is disqualified here on shape rather than quality: **ESM-only with no root export** (jsDelivr's auto-bundler returns *"Couldn't find the requested file."*), so a bundler is mandatory; a declared **Node 22+ floor**; pre-1.0 at three months old; effectively one maintainer [36][37]. Its own README concedes the case: *"Read simple xlsx in the browser → `read-excel-file` is excellent."* [36]

### What the pick actually gives you

`write-excel-file` documents, and this research verified where marked: number formats per cell and per column as raw Excel codes ✓measured; `Date` cells with a mandatory `format` ✓measured; `fontWeight: 'bold'`, `backgroundColor`, per-side border colours, horizontal and vertical alignment, `wrap`, and `columnSpan` for merges; column widths in characters ✓measured; multiple sheets; and **conditional formatting** — a paid feature on the SheetJS side [34]. Note two v4 behaviour changes: it no longer bolds the header row by default and no longer applies a default width to date columns, so both must now be set explicitly.

`read-excel-file` reads arbitrary sheets with **no schema required** — the default export returns every sheet as `[{ sheet, data }]` and schema parsing is a separate, optional step [35]. Its own published read benchmark gives two result columns for 1 MB / 10 MB / 50 MB files — 0.1/0.5/2.6 s and 0.1/0.6/3.0 s — without labelling which is the browser run; conditions are unstated and it is vendor self-measurement. Treat it as an order of magnitude, not a number, and do not attribute either column to the browser.

### The open risk on the read side — smaller than it first looked

An earlier reading of this had `read-excel-file` 9.x unconditionally spawning a Web Worker internally. **That overstates what the README supports, because the README contradicts itself** [35]:

- Its v9 migration notes, live text: *"Renamed the default export `read-excel-file` to `read-excel-file/browser`, and it uses Web Workers now."*
- Its `## Worker` section carries the opposite as an **HTML comment**: *"XML parser currently doesn't use 'workers' and hence it 'blocks' the main thread"*, immediately followed by a comment labelled *"Previous inaccurate statement"* retracting the claim that all exports use a worker under the hood.
- Its live prose says unzipping is *"conditionally asynchronous in web browsers (only for .xlsx files larger than 512 KB)"* and recommends the caller run the library in their own worker.

`worker-f` is a real dependency, so something does construct a worker — most plausibly the unzip step, not the XML parse. **Reading the source is the only way to settle it; the README cannot.**

What this is no longer is a hard gate on the platform. R2's parallel research measured the `file://` boundary directly in Chromium 150 and Firefox 153: a **classic Worker from a `blob:` URL works** in both, a module Worker from a blob URL works only in Firefox, and `new Worker('./sibling.js')` fails in both [R2]. So workers are available from a double-clicked file — the question is only whether this library happens to construct one the surviving way.

Two documented escape hatches exist if it does not: the **`read-excel-file/web-worker` export path**, which spawns no workers and is designed to be run inside one you construct yourself, and version 8.x. Neither has been tested.

### Excel's repair prompt — real, with known causes

The "we found a problem with some content" dialog is documented in issue trackers with identified causes, though the SheetJS evidence is roughly seven years old and flagged as such. Two causes were confirmed from maintainer responses: **a cell string exceeding Excel's 32,767-character limit** (SheetJS #1537), and **a corrupted library payload** — SheetJS #1652 turned out to be a server mangling `xlsx.full.min.js` in delivery [39], so the library then emitted structurally invalid XML. That second one is directly relevant to inlining a large minified library into one HTML file: **corrupt the payload and you get a repair prompt, not a load error.** A later commenter on #1537 reports the same dialog on a three-cell export, so the 32,767 limit does not explain every instance.

No such report exists for `write-excel-file` or `read-excel-file` — but they have a far smaller installed base than SheetJS, so silence there is weak evidence, not a safety signal.

### Reversibility

Both candidates consume and produce arrays of arrays [34][35]. A thin adapter with `readWorkbook(file) → sheets` and `writeWorkbook(sheets, options) → Blob` isolates the choice behind roughly fifty lines, and swapping in SheetJS later is under a day's work. Given that the pick rests on a single-author project, that seam is worth building on day one rather than retrofitting.
---

## D4 — JSON: repair, preview, flattening

### Recommendation

Three separate picks, because these are three separate problems:

| Job | Pick | Size (gz) | Licence |
| --- | --- | --- | --- |
| Tolerant parsing | **`JSON.parse` first, `jsonrepair` 3.15.0 only on failure** | 2.88 KB | ISC |
| Nested preview | **`json-formatter-js` 2.5.23** | 3.25 KB | MIT |
| Flattening to a table | **write it** — no library's default fits | — | — |

Total dependency cost for the JSON path: about 6 KB gzipped.

### Tolerant parsing — jsonrepair, with a caveat about *how* it fails

jsonrepair is at **3.15.0, published 2026-07-03** [17], ISC-licensed per both the README and the npm manifest [17][18]. GitHub's licence detector reports `NOASSERTION` for it, which is a detector artefact rather than a competing claim — two author statements outweigh one automated scan. Maintenance is steady and low-volume: 26 commits in the twelve months to 2026-08-01, last push 2026-07-03, 2,390 stars, not archived [19]. It is **~7 KB minified / 2.89 KB gzipped with zero dependencies** and ships a UMD build for direct `<script>` use [20][18], so inlining is trivial.

The documented repair list covers every LLM-characteristic breakage worth naming — missing quotes and commas, missing closing brackets, **truncated JSON**, single and smart quotes, `/* */` and `//` comments, trailing commas, **fenced markdown code blocks**, ellipsis, JSONP wrappers, Python `None`/`True`/`False`, MongoDB types, and **NDJSON converted to an array** [18].

**The brief expected the danger to be silent corruption. The evidence does not support that.** An issue-tracker pass for wrong/incorrect/corrupt/silent output surfaced only *thrown* failures on 3.x: #170 (open, 2026-06-12) infinite recursion producing `Maximum call stack size exceeded` on a string followed by a backslash-escaped delimiter; #159 (open, 2026-03-28) refusing to repair a superfluous closing brace; #137 (open, 2025-01-12) "Unexpected character" on a complex nested structure [21]. The one silent-failure report, #102 ("strings with commas or apostrophes lacking a closing quote fail silently"), was opened 2023-10-09 and **closed 2024-02-09**, so it is not a live claim against 3.15.0 [21].

This is a negative result from a single search pass, not proof of absence — but it changes the integration shape. The realistic failure mode is a **throw**, and one of the throws is a `RangeError` from recursion, not a `SyntaxError`. A `try/catch` that only anticipates parse errors is not enough.

The residual real-world gap, from issue #139 (open, 2025-01-27): jsonrepair repairs **one document**, not several JSON objects concatenated together inside a markdown wrapper — the shape you get when a user pastes a whole chat reply [21]. If that input matters, it needs a pre-pass (extract the largest fenced block, or repair-then-retry), not a different library.

jsonrepair also ships a streaming transform, but it is written against **Node streams** and throws "Index out of range" when a single string or number exceeds `bufferSize` (default 65536) [18]. Not usable in a browser without a shim, and a hazard for long cell values. Ignore it.

### The alternatives, and why none of them wins

| Package | Latest | Date | Licence | Size (gz) | Commits/12mo | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **jsonrepair** | 3.15.0 | 2026-07-03 | ISC | 2.89 KB | 26 | pick |
| best-effort-json-parser | 1.5.1 | 2026-06-26 | BSD-2 | 1.81 KB | 23 | different job — partial input you are still receiving |
| partial-json | 0.1.7 | 2024-05-14 | MIT | 1.52 KB | 1 | frozen, no release in 2 years |
| json5 | 2.2.3 | 2022-12-31 | MIT | 9 KB | 0 | **a dialect, not a repairer** — cannot recover truncation |
| dirty-json | 0.9.2 | 2020-08-28 | **AGPL-3.0** | unknown | — | licence disqualifies; 6 years old |
| untruncate-json | 0.0.1 | 2019-11-10 | MIT | unknown | — | one trick, already in jsonrepair |

Versions, dates and licences from the npm registry; activity from the GitHub API; sizes from Bundlephobia [17][19][20].

Two distinctions worth keeping straight. **json5 is a permissive *grammar*, not a repair tool** — it accepts comments, trailing commas and unquoted keys by design, and rejects everything outside its grammar, so it cannot help with truncated or structurally broken output. **best-effort-json-parser solves the streaming case**: it returns whatever parsed so far from input still arriving. Neither overlaps jsonrepair's job.

**No head-to-head evaluation of JS tolerant-JSON parsers on LLM output exists** in the retrieved surface — every comparison is project self-description. "jsonrepair is best for LLM output" is unproven, merely unrefuted.

### Large JSON — and one thing not to wait for

The operative constraint is not a size ceiling but that **`JSON.parse` is synchronous and blocks the main thread**; the mitigation is a Worker, not a different parser. V8 caps a single string at 536,870,888 characters, orders of magnitude beyond anything 100k rows produces. Both figures come from **one aggregated retrieval and do not meet the two-source bar** — do not plan against them without measuring.

**There is no TC39 proposal for streaming `JSON.parse`.** A search of TC39 proposals surfaced only `proposal-json-parse-with-source` (Stage 4), which exposes source text and is an unrelated capability [22]. Do not design around a native streaming API arriving.

Of the streaming parsers, only **`@streamparser/json`** is a credible browser candidate (MIT, 5.62 KB gz, zero deps, ESM) — but its published version is **0.0.22 from 2025-01-26 while the repository has 42 commits in the last twelve months and was pushed 2026-07-31** [17][19]. Repository activity and release activity disagree by 18 months; a consumer of the published package gets 2025 code. `stream-json` (3.5.0, 2026-07-07) is maintained but Node-stream-shaped; `clarinet` is dormant (0 commits/12mo); `oboe.js` is near-dormant [17][19].

### NDJSON — support it, with no library

JSON Lines is the default shape for log, event and bulk-export pipelines and the primary interchange format for Elasticsearch, MongoDB, BigQuery, Snowflake, Spark and the ML-dataset ecosystem [23] — enough reach that a business-data tool will be handed one. NDJSON and "JSON Lines" have been reconciled into one format by their respective authors, so supporting one supports both [24].

The cost is near zero: the format's own constraint that each value occupies exactly one line makes split-on-newline-then-parse correct, and **jsonrepair already lists NDJSON-to-array as a built-in repair** [18], so a damaged NDJSON file is covered by the same pass. (The claim that a JSON value can never contain an unescaped newline follows from the JSON grammar but was not verified against the specification this round.)

### Nested preview

| Package | Latest | Date | Licence | Size (gz) | Framework | Commits/12mo |
| --- | --- | --- | --- | --- | --- | --- |
| **json-formatter-js** | 2.5.23 | 2025-03-03 | MIT | **3.25 KB**, 0 deps | none | 0 |
| vanilla-jsoneditor | 3.13.0 | 2026-07-24 | ISC | **346.8 KB**, 26 deps | none (Svelte inside) | 35 |
| jsoneditor | 10.4.3 | 2026-04-01 | Apache-2.0 | unknown | none | still shipping |
| @textea/json-viewer | 4.0.1 | 2024-12-15 | MIT | 10.97 KB, 3 deps | **React** | stale ~20 mo |
| react-json-view | 1.21.3 | 2021-03-09 | MIT | unknown | **React** | dead |

Sources as above [17][19][20].

The trade is stark: the actively maintained option costs **107× more gzipped bytes** than the quiet one, for what is a read-only preview panel. `json-formatter-js` at 3.25 KB with zero dependencies is the right size for the job even though it has had no commits in twelve months — a collapsible tree is a finished problem, and if it ever breaks, replacing 3 KB is cheap. `vanilla-jsoneditor` at 347 KB gzipped with 26 dependencies is a full editor and would dominate the entire bundle.

Note the metadata trap found here: `json-formatter-js` shows an npm `modified` timestamp of 2026-01-15 against a last release of 2025-03-03 and zero repository commits. **The npm `modified` field is not an activity signal.**

### Flattening — the finding is that there is no right default

This is the most consequential part of the dimension, and it is not a library choice.

Every maintained tool agrees on `.` as the separator and dot-path keys for nested objects. **They disagree completely about arrays**, and each disagreement is a deliberate design decision:

- **`flat`** index-suffixes them: `{a: [1,2]}` → `a.0`, `a.1` [25]. Column count equals the longest array in the file, so variable-length arrays produce a ragged, sparse column set.
- **`csv42`** serialises each array into **one JSON-string cell** — its README states that with `flatten` on, "plain, nested objects will be flattened in multiple CSV columns, and arrays and classes will be serialized in a single field" [26]. Addressable as text, not as data.
- **`@json2csv`** splits the two semantics into two transforms: `flatten` for nested objects, and an opt-in **`unwind`** that emits **one row per array element** [27].

There is no default that serves both "join this against a CSV" and "keep every element addressable". For a tool whose users click a pipeline together, **the array strategy has to be a visible choice at import time** — one JSON cell, indexed columns, or explode-to-rows — not a hidden library default that produces a surprising column count.

Given that, the flattening code is small enough to own: it is a recursive walk with a documented separator and a three-way array branch. The libraries are worth reading as reference implementations rather than depending on:

| Package | Latest | Date | Licence | Size (gz) | Commits/12mo | Array default |
| --- | --- | --- | --- | --- | --- | --- |
| flat | 6.0.1 | 2023-09-19 | BSD-3 | 0.78 KB | 2 | index-suffixed |
| csv42 | 5.0.3 | 2024-11-05 | **none declared** | 1.99 KB | 0 | single JSON-string cell |
| @json2csv/plainjs | 7.0.7 | 2026-07-16 | MIT | 7.52 KB | 19 | objects only; `unwind` opt-in |
| dot-object | 2.1.5 | 2024-04-19 | MIT | 1.84 KB | quiet | path utility, not a flattener |
| flatten-json | 0.0.1 | **2013-09-01** | BSD-2 | unknown | dead | — |

csv42's licence is worth a second look before use: **its npm manifest declares no licence at all**, neither at the package level nor per version — checked directly against the registry. Two researchers on this run reported it differently (one "ISC", one "absent"); the registry settles it, and the README would have to be read before depending on it.

`@json2csv/plainjs` is the only actively maintained one and ships a `dist/cdn` build [17][19][27]. If a dependency is preferred over owned code, it is the one — but its `unwind` semantics for multiple parallel arrays were not verified this round.

---

## D5 — Parquet export: the gate passes

### Verdict

**Parquet stays in scope.** `hyparquet-writer` 0.16.3 (MIT, published 2026-07-31) is pure JavaScript with no WebAssembly at all, bundles to **57,703 bytes minified / 17,239 bytes gzipped** as a self-contained IIFE [M3], and its output was verified to load correctly in pyarrow, DuckDB and Polars [M3]. This is not a marginal pass — it is roughly the size of PapaParse.

The plan expected this dimension to end in "drop Parquet". It does not.

### The evidence

`hyparquet-writer` 0.16.3 depends on exactly one package — `hyparquet` 1.27.1, same authors, zero dependencies — both MIT, corroborated by GitHub repository metadata and LICENSE files in the npm tarballs [40][41]. Maintenance is genuinely sustained rather than a favourable snapshot: **133 published versions of the reader since 2024-01-04** and 53 of the writer since 2025-03-26, with releases in every recent month [40].

**Snappy compression is implemented in-package** (`src/snappy.js`, ~6 KB, already inside the 17 KB gzip figure) and is the default; `UNCOMPRESSED` is available; every other codec is supplied by the caller as a **synchronous** function [44]. GZIP works today by passing `fflate`'s `gzipSync`, at +3,570 bytes gzipped. Note the synchronous requirement: the browser-native `CompressionStream('gzip')` is async and **cannot be dropped in**. ZSTD write has no evidenced pure-JS path — the companion `hyparquet-compressors` package is read-side and has not been published since 2025-03-20 [40][43].

### Interoperability — measured, not assumed

A writer that produces files other tools reject is a failed writer, so this was tested rather than researched. 100,000 rows × 5 columns (INT32, DOUBLE, STRING, TIMESTAMP, BOOLEAN with 33,334 nulls) were written from the published package and read back:

| Reader | Result |
| --- | --- |
| **pyarrow 25.0.0** | exact schema `id: int32, value: double, name: string, ts: timestamp[ms, tz=UTC], flag: bool`; null count 33,334 — read all three variants |
| **DuckDB 1.5.5** | `count=100000, min(id)=0, max(id)=99999, count(flag)=66666` — read all three variants |
| **Polars 1.43.2** | shape `(100000, 5)`, matching dtypes — read the SNAPPY and GZIP variants; **the uncompressed file was not put to Polars** |

pyarrow confirms the recorded codec as `GZIP` for the fflate-compressed file. The harness and raw output are preserved in `imports/parquet-roundtrip-harness.md` and `imports/parquet-measurements.txt` [M3].

Two corroborating signals: the **Apache Parquet project's own implementation-status page lists hyparquet** as a JavaScript implementation with per-feature support (page last modified 2026-07-07) [43], and hyparquet's test corpus contains 209 files including recognisable fixtures from Apache's own `parquet-testing` repository — it is tested against the ecosystem's reference corpus, not only against itself [41].

One timestamp nuance to check before shipping: the same column came back as `timestamp[ms, tz=UTC]` in pyarrow but naive `datetime[ms]` in Polars.

### Scale

100,000 rows × 5 columns: **273 ms SNAPPY** (2,321,579 bytes out, 54.2 MB heap delta) and **157 ms uncompressed** (3,600,536 bytes). Read-back with hyparquet: 116 ms. A second run of the same harness gave 258 / 159 / 115 ms, so treat these as ±6% [M3].

The GZIP path measured **354 ms** — but on a **three-column** file, not the five-column one used for the other two. It is not a like-for-like codec comparison and should not be read as one [M3].

These are **Node numbers, not browser numbers** — same V8 engine and the same pure-JS code path with no Node built-ins in the export path, so browser timings should be the same order, but no browser measurement exists and none was run. Flagged as the main unverified item in this dimension.

`parquetWriteBuffer` is **synchronous**, so even 258 ms blocks the main thread. Being dependency-free JS, it moves into a Web Worker cleanly, and a streaming `ParquetWriter` is also exported [44].

For perspective: writing the same order of data as **xlsx took ~3.3 seconds** (D3). Parquet is the cheapest export format this tool could offer, not the most expensive.

### What would have failed the gate

| Candidate | WASM payload | Verdict |
| --- | --- | --- |
| **hyparquet-writer 0.16.3** | **none** | 17,239 B gzipped — passes comfortably |
| parquet-wasm 0.7.2 | **6,494,208 B raw / 1,813,165 B gzip; 8,658,944 B as base64 inline** | fails on size, not capability |
| @duckdb/duckdb-wasm | 35.6–41.3 MB per variant | fails by two orders of magnitude |

`parquet-wasm` is a good library — MIT/Apache-2.0, actively maintained, supports ZSTD, Snappy, GZIP, Brotli and LZ4_RAW on write — that simply cannot meet the single-file constraint. By default it **fetches `parquet_wasm_bg.wasm` from the module's location at runtime**, which breaks a single-file build outright [42]; inlining via `initSync` is technically possible at the cost of an ~8.7 MB HTML file. Its README's "1.2 MB brotli" figure is best-case transfer size for a reader-only build compiled with a Rust toolchain, not the artefact size, and says nothing about inlining.

The rest of the field is not viable: **`apache-arrow` JS 21.2.0 does not write Parquet at all** — zero occurrences of "parquet" in its type definitions; it is Arrow IPC only [40]. `parquetjs` (last publish 2019-10-03) and `parquetjs-lite` (2020-04-22) are dead [40][41]. `@dsnp/parquetjs` 1.8.9 is alive but Node-shaped: 7.1 MB unpacked with 13 dependencies including `@aws-sdk/client-s3`, `thrift` and two WASM packages.

### Caveats on the pick

- **No UMD or IIFE artefact is published.** Both packages are `"type": "module"` with the entry pointing at raw ESM source and **no bundled artefact of any kind** — no `dist/`, nothing a `<script>` tag can load [42]. The 17,239-byte figure comes from bundling the published ESM with `esbuild --bundle --minify --format=iife`. **The Parquet path therefore requires a one-time build step**, unlike PapaParse, jsonrepair and write-excel-file, which all ship ready-made UMD bundles. A build is permitted by the project's constraints, but this is the dependency that turns it from optional into required.
- **Bus factor.** The writer has 59 stars and comes from a small organisation. The reader is better established at 842 stars. Neither has an independent maintainer base.
- **No third-party browser benchmark** of hyparquet-writer exists at any scale.
- Reader plus writer together bundle to 33,439 bytes gzipped, if reading Parquet is ever wanted too.

---

## Cross-dimension insights

Four things only the combination shows.

**1. Default type inference is the single biggest correctness risk in this whole project — and it is not one library's bug.** D1 measured PapaParse's `dynamicTyping` turning `1.234` into the number 1.234. R1 had already measured Arquero's `fromCSV` doing the same thing. Two independent libraries, two independent implementations, one identical failure: an anchored regex that treats `.` as a decimal point, applied to German data. The pattern will repeat in the next library too. **Treat every library's automatic type conversion as unsafe by default, switch it off wherever it can be switched off, and own the German number/date parser.** That parser is now a load-bearing component of the architecture, not a utility — and it is exactly what R5 is scheduled to design.

**2. The one thing that genuinely needs a Web Worker is xlsx export — and the platform now permits one.** The measured costs across this run and R1 line up starkly: the full transformation pipeline at 100k rows is 10.5 ms, Parquet export 273 ms, and xlsx export **~3,300 ms**. Only the last is long enough to freeze a tab.

R1 left open whether a worker could be created at all from a `file://` page. **R2 has since measured it and the answer is yes**, with a precise shape: a *classic* Worker from a `blob:` URL works in both Chromium 150 and Firefox 153; a *module* worker from a blob URL works only in Firefox; `new Worker('./sibling.js')` fails in both [R2]. So the xlsx export worker is buildable — construct it as a classic script from a blob URL, with the library inlined into the worker body rather than fetched.

What survives as open is narrower and belongs to one library: `read-excel-file` uses a worker somewhere internally (`worker-f` is a dependency) but its README contradicts itself about where, and if it constructs that worker by URL rather than from a blob it will fail from `file://`. That is a source-reading task, not a platform question.

**3. The single-HTML-file constraint is no longer free.** PapaParse, jsonrepair, write-excel-file, read-excel-file and json-formatter-js all ship ready-made UMD bundles that drop into a plain page. `hyparquet-writer` does not — it is ESM-only with no published UMD, and its attractive 17 KB figure exists only after bundling. So Parquet is the dependency that converts the build step from "allowed" to "required". That is compatible with the project's constraints, but it should be a conscious trade: **Parquet export costs a build step, not bytes.**

**4. Ejecting SheetJS shrinks the bundle by more than everything else combined.** The whole recommended stack — PapaParse 7 KB + jsonrepair 3 KB + json-formatter-js 3 KB + write/read-excel-file 34 KB + hyparquet-writer 17 KB — is about **64 KB gzipped**. SheetJS alone is 334 KB. The MIT pair is not merely cheaper; it makes every other dependency's size irrelevant, which is why none of the other choices in this report had to be argued on bytes.

---

## Recommendations

Each names its evidence basis. These feed the architecture spine (D1–D5 as component choices and operational constraints) and close the `idea.md` §9 open question on CSV encoding handling.

1. **CSV: PapaParse 5.5.4 with `dynamicTyping: false`, always.** Basis: measured against the released build. Read the file's bytes yourself, decide the encoding, decode to a string, and hand PapaParse the string — do not let it own the encoding decision. Surface its `UndetectableDelimiter` error as a UI prompt; it is the library telling you it needs help.

2. **Encoding: no library. BOM sniff → strict-UTF-8 probe → windows-1252 fallback → visible user override.** Basis: the WHATWG Encoding Standard, high confidence. The override is not optional politeness — it is the mitigation for the one thing this research could *not* establish, namely what Excel actually writes.

3. **XLSX: `write-excel-file` 4.1.1 + `read-excel-file` 9.3.5, behind a thin adapter.** Basis: measured output correctness plus measured footprint; the adapter is insurance against the single-author bus factor. Do not pass `filePath` and assume it worked. **Confidence caveat:** the read side uses a Web Worker somewhere internally and its README contradicts itself about where; whether that construction survives `file://` is unverified — see open question 1.

4. **JSON: `JSON.parse` first, `jsonrepair` 3.15.0 on failure — catching `RangeError` as well as `SyntaxError`.** Basis: the repair-class list is documented; the stack-overflow failure mode is an open issue against the current version. Support NDJSON with `split('\n')` and no library.

5. **JSON flattening: own the code, and make the array strategy a visible import-time choice.** Basis: three maintained libraries each chose a different array semantic, which is evidence that there is no safe default rather than evidence that one of them is right. Offer one-JSON-cell, indexed-columns, and explode-to-rows.

6. **Preview: `json-formatter-js` at 3 KB, not `vanilla-jsoneditor` at 347 KB.** Basis: measured sizes. Accept that it is quiet; a collapsible tree is a finished problem and 3 KB is cheap to replace.

7. **Parquet: keep it in scope, `hyparquet-writer` 0.16.3, Snappy default.** Basis: an original round-trip verified against pyarrow, DuckDB and Polars — the strongest evidence in this report. Budget a build step for it. **This overturns the research plan's expectation that Parquet would be dropped.**

8. **Run the xlsx export in a Web Worker, or show a progress indicator.** Basis: ~3.3 s measured. Construct it as a **classic script from a blob URL** with the library inlined into the worker body — that is the one worker shape R2 measured working from `file://` in both engines [R2]. This is the only place in the file-handling story where a worker is warranted on performance grounds.

---

## Open questions

| # | Question | What would answer it | Why it matters |
| --- | --- | --- | --- |
| 1 | **Answered by R2, not by this run.** A classic Worker from a `blob:` URL works from `file://` in Chromium 150 and Firefox 153 [R2]. What remains: does `read-excel-file` construct its internal worker in a way that survives `file://`? | Read the library's source, or load it from a real `file://` page | Decides whether the XLSX *import* path works at all in the target deployment, or needs the `/web-worker` export. |
| 2 | Do `write-excel-file`'s format codes render as German (decimal comma) in a real German Excel? | Open `imports/german-small.xlsx` in Excel with German regional settings | The last untested link in "opens cleanly in Excel". Format codes are stored locale-neutrally, so this is expected to pass — but expectation is not evidence. |
| 3 | Browser-side timings for anything in this report | Load the libraries in a page and time them | Every performance number here is Node. The margins are wide, but no browser measurement exists for PapaParse, SheetJS, write-excel-file or hyparquet-writer at any scale. |
| 4 | What encoding does German Excel actually write for plain CSV? | Save a CSV from a German Excel install and inspect the bytes | Microsoft documents nothing. The recommendation is built to survive not knowing, but a five-minute test would convert an assumption into a fact. |
| 5 | Does `jsonrepair` #170 (stack overflow) reproduce against 3.15.0? | A few minutes with the reported input | Decides whether `RangeError` handling is theoretical or necessary. |
| 6 | Is there a *synchronous* pure-JS ZSTD compressor for the browser? | Targeted search | Only needed if ZSTD-compressed Parquet is ever wanted; Snappy and GZIP are covered. |

Questions 2, 4 and 5 are cheap manual tests rather than research, and question 1 is now a source-reading task rather than a platform unknown. That is the honest shape of what remains: **public sources have been exhausted on these; a browser and a German Excel install have not.**

---

## Source appendix

| [n] | Supports | Publisher | Pub date | Accessed | Confidence |
| --- | --- | --- | --- | --- | --- |
| [1] | PapaParse and CSV-alternative versions, dates, licences | [npm registry](https://registry.npmjs.org/papaparse) | 2026-06-19 | 2026-08-01 | high |
| [2] | PapaParse release history and fixed defects | [GitHub releases feed](https://github.com/mholt/PapaParse/releases.atom) | 2026-06-19 | 2026-08-01 | high |
| [3] | PapaParse commit authorship; unreleased delimiter fix #1128 | [GitHub API](https://api.github.com/repos/mholt/PapaParse/commits) | 2026-07-03 | 2026-08-01 | high |
| [4] | PapaParse options: delimiter guessing, header, dynamicTyping, streaming, worker, encoding | [Papa Parse docs](https://www.papaparse.com/docs) | undated | 2026-08-01 | high |
| [5] | The FLOAT regex and `guessDelimiter` algorithm | [PapaParse source](https://raw.githubusercontent.com/mholt/PapaParse/master/papaparse.js) | master @ 2026-07-03 | 2026-08-01 | high |
| [6] | Open issues #1121, #1132, #1122, #761, #1029; closed #143 | [GitHub issues](https://github.com/mholt/PapaParse/issues) | 2026-07-27 | 2026-08-01 | high (metadata only) |
| [7] | CSV parser throughput at 100k rows | [uDSV benchmark](https://github.com/leeoniya/uDSV) | undated | 2026-08-01 | medium (run by the winner's author; Node) |
| [8] | Competing CSV speed ranking | [LeanyLabs](https://leanylabs.com/blog/js-csv-parsers-benchmarks/) | undated | 2026-08-01 | low (no date, hardware or numbers) |
| [9] | Measured CSV bundle sizes | [jsDelivr](https://cdn.jsdelivr.net/npm/papaparse@5.5.4/papaparse.min.js) | 2026-06-19 | 2026-08-01 | high (own measurement) |
| [10] | windows-1252 mandatory; iso-8859-1 is a label for it; BOM sniff and priority; TextEncoder is UTF-8-only | [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) | 2026-05-21 | 2026-08-01 | high |
| [11] | `fatal: true` throws on malformed input | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/TextDecoder) | undated | 2026-08-01 | medium (snippet, page not fetched) |
| [12] | Microsoft documents no code page for any CSV variant | [Microsoft Support](https://support.microsoft.com/en-us/office/file-formats-that-are-supported-in-excel-0943ff2c-6014-4e8d-aaea-b83d51d46247) | undated (Excel 2024/M365) | 2026-08-01 | high |
| [13] | chardet 2.2.0, MIT, browser field, zero deps | [npm registry](https://registry.npmjs.org/chardet) | 2026-06-20 | 2026-08-01 | high |
| [14] | jschardet 3.1.4, LGPL-2.1+, 4.0.0-rc.1 | [npm registry](https://registry.npmjs.org/jschardet) | 2024-09-30 (stable); rc 2026-07-27 | 2026-08-01 | high |
| [15] | Detectors misclassify short UTF-8 as Windows-1252 | [python-chardet issues](https://github.com/chardet/chardet/issues/185) | undated | 2026-08-01 | medium (surfaced via search) |
| [16] | Excel's "CSV UTF-8" writes a BOM | [John D. Cook](https://www.johndcook.com/blog/2019/09/07/excel-r-bom/) | 2019-09-07 | 2026-08-01 | medium (7 years old; second source concurs) |
| [17] | JSON-package versions, dates, licences | [npm registry](https://registry.npmjs.org/jsonrepair) | 2026-07-03 | 2026-08-01 | high |
| [18] | jsonrepair repair list, UMD build, ISC licence, Node-stream limitation | [jsonrepair repo](https://github.com/josdejong/jsonrepair) | 2026-07-03 | 2026-08-01 | high |
| [19] | Commit counts and push dates for the JSON candidates | [GitHub API](https://api.github.com/repos/josdejong/jsonrepair) | live | 2026-08-01 | high |
| [20] | Minified and gzipped sizes for JSON packages | [Bundlephobia](https://bundlephobia.com/api/size?package=jsonrepair) | live | 2026-08-01 | medium (single aggregator) |
| [21] | jsonrepair issues #170, #159, #137, #139; closed #102 | [GitHub issue search](https://github.com/josdejong/jsonrepair/issues) | 2026-06-12 | 2026-08-01 | medium |
| [22] | No TC39 streaming-JSON proposal exists | [TC39](https://github.com/tc39/proposal-json-parse-with-source) | live | 2026-08-01 | medium (absence from one pass) |
| [23] | NDJSON reach across data platforms | [ClickHouse](https://clickhouse.com/resources/engineering/what-is-ndjson) | undated | 2026-08-01 | medium (vendor-adjacent) |
| [24] | NDJSON and JSON Lines reconciled | [ndjson.com](https://ndjson.com/history) | undated | 2026-08-01 | low-medium |
| [25] | `flat` index-suffixes arrays; dot separator; reversible | [flat README](https://raw.githubusercontent.com/hughsk/flat/master/README.md) | 2023-09-19 | 2026-08-01 | high |
| [26] | csv42 serialises arrays into one field | [csv42 README](https://raw.githubusercontent.com/josdejong/csv42/main/README.md) | 2024-11-05 | 2026-08-01 | high |
| [27] | json2csv separates `flatten` from opt-in `unwind`; ships `dist/cdn` | [json2csv repo](https://github.com/juanjoDiaz/json2csv) | 2026-07-16 | 2026-08-01 | medium |
| [28] | SheetJS CE capabilities: cell `z`, dates/1900 epoch, dense mode | [SheetJS docs](https://docs.sheetjs.com/docs/csf/cell) | undated | 2026-08-01 | high |
| [28a] | Mini-build drops CSV/SYLK encodings, "directly affecting users outside of the United States" | [SheetJS standalone install docs](https://docs.sheetjs.com/docs/getting-started/installation/standalone) | undated | 2026-08-01 | high |
| [29] | Styling, conditional formatting and locale support are Pro; no published price | [sheetjs.com/pro](https://sheetjs.com/pro) | undated | 2026-08-01 | high |
| [30] | No SheetJS tag newer than v0.20.3; newest commit 2026-02-09 | [SheetJS Gitea API](https://git.sheetjs.com/api/v1/repos/sheetjs/sheetjs/tags) | 2026-02-09 | 2026-08-01 | high |
| [31] | Measured SheetJS bundle sizes; `xlsx-latest` still resolves to 0.20.3 | [SheetJS CDN](https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js) | 2024-07-18 | 2026-08-01 | high (own measurement) |
| [32] | XLSX-package versions, dates, licences, dependencies (write-excel-file 4.1.1 = 2026-06-08; read-excel-file 9.3.5 = 2026-07-28) | [npm registry](https://registry.npmjs.org/write-excel-file) | 2026-06-08 / 2026-07-28 | 2026-08-01 | high |
| [33] | ExcelJS dormancy: last commit, open issues, not archived | [GitHub API](https://api.github.com/repos/exceljs/exceljs) | 2025-01-21 | 2026-08-01 | high |
| [34] | write-excel-file UMD bundle, capabilities, v4 behaviour changes | [jsDelivr artefact + README](https://cdn.jsdelivr.net/npm/write-excel-file@4.1.1/README.md) | 2026-06-08 | 2026-08-01 | high |
| [35] | read-excel-file UMD bundle, schema-free reading, internal Web Worker, vendor benchmark | [jsDelivr artefact + README](https://cdn.jsdelivr.net/npm/read-excel-file@9.3.5/README.md) | 2026-07-28 | 2026-08-01 | high (benchmark: medium) |
| [36] | @office-kit/xlsx has no root export; Node 22+ floor; identical to xlsx-kit | [jsDelivr data API](https://data.jsdelivr.com/v1/packages/npm/@office-kit/xlsx@0.9.0?structure=flat) | 2026-07-12 | 2026-08-01 | high |
| [37] | @office-kit/xlsx commit count, contributors, test suite | [GitHub API](https://api.github.com/repos/office-kit/xlsx) | live | 2026-08-01 | high |
| [38] | No streaming xlsx writer; large-data levers; worker recipe; docs edited 2026-03-23 | [SheetJS docs](https://docs.sheetjs.com/docs/demos/bigdata/stream) | 2026-03-23 | 2026-08-01 | high |
| [39] | Excel repair-prompt causes: 32,767-char limit, corrupted payload; ExcelJS #2299 | [GitHub API](https://api.github.com/repos/SheetJS/sheetjs/issues/1537) | 2019-06-14 | 2026-08-01 | high (age flagged) |
| [40] | Parquet-package versions, dates, licences, dependency shapes, unpacked sizes | [npm registry](https://registry.npmjs.org/hyparquet-writer) | 2026-07-31 | 2026-08-01 | high |
| [41] | hyparquet repo activity, star counts, test corpus | [GitHub API](https://api.github.com/repos/hyparam/hyparquet-writer) | 2026-07-31 | 2026-08-01 | high |
| [42] | parquet-wasm WASM payload size; DuckDB-WASM sizes; hyparquet ships no UMD | [jsDelivr data API](https://data.jsdelivr.com/v1/packages/npm/parquet-wasm@0.7.2) | 2026-06-29 | 2026-08-01 | high (own measurement) |
| [43] | hyparquet listed as a JS Parquet implementation with per-feature support | [Apache Parquet](https://parquet.apache.org/docs/file-format/implementationstatus/) | 2026-07-07 | 2026-08-01 | high |
| [44] | Writer API surface; synchronous compressor contract; bundled Snappy | [hyparquet-writer published source](https://cdn.jsdelivr.net/npm/hyparquet-writer@0.16.3/src/write.js) | 2026-07-31 | 2026-08-01 | high |
| [M1] | PapaParse 5.5.4 German-number corruption, leading zeros, delimiter guessing | own measurement — `imports/verify-papaparse.mjs` | 2026-08-01 | 2026-08-01 | high |
| [M2] | write-excel-file 4.1.1 output correctness, 100k-row timing, `filePath` no-op | own measurement — `imports/verify-write-excel-file.mjs` + `.py` | 2026-08-01 | 2026-08-01 | high |
| [M3] | hyparquet-writer sizes, timings and pyarrow/DuckDB/Polars round-trip | own measurement — `imports/parquet-roundtrip-harness.md` | 2026-08-01 | 2026-08-01 | high |
| [R2] | `file://` capability probe: classic Worker from a `blob:` URL works in Chromium 150 and Firefox 153 | sibling run — [`technical-ui-framework-2026-08-01/research.md`](../technical-ui-framework-2026-08-01/research.md) | 2026-08-01 | 2026-08-01 | high (measured there, not here) |

---

## Staleness map

Freshness windows from the technical pack: version and compatibility claims 1 month · ecosystem signals 6 months · landscape 12 months · patterns 24 months.

| Re-check by | Claims | Why |
| --- | --- | --- |
| **2026-09-01** | Every version number in this report — PapaParse 5.5.4, write-excel-file 4.1.1, read-excel-file 9.3.5, jsonrepair 3.15.0, hyparquet-writer 0.16.3, chardet 2.2.0 | One-month window. `read-excel-file` shipped four releases in twelve days and `hyparquet-writer` two on 2026-07-31; these will be stale almost immediately. |
| **2026-09-01** | Measured bundle sizes | They are version-bound; a new release invalidates them. |
| **2027-02-01** | SheetJS release-gap status; ExcelJS dormancy; @office-kit/xlsx viability; jschardet 4.0.0 outcome; `@streamparser/json` release lag | Six-month ecosystem window. The SheetJS question is the one that could change a decision: a 0.21 release with styling in CE would reopen D3. |
| **2027-08-01** | The CSV/XLSX/Parquet landscape; the candidate fields themselves | Twelve-month window. |
| **2028-08-01** | Encoding strategy; flattening semantics; Excel repair-prompt causes | Two-year pattern window. The WHATWG findings are specification-grade and effectively durable. |

**Earliest re-check: 2026-09-01** — one month out, and it is only the version numbers. Nothing decision-shaped expires before February 2027.

Per the select shape's own rule: a selection report older than two quarters should be refreshed before anyone acts on it. For D2 and D3, that means **2027-02-01**. Refresh or Deepen on this run folder handles both.

---

## Verification note

A fresh-context citation-verification pass checked the load-bearing claims against their sources on 2026-08-01. Everything below is what it found and what was done about it — recorded rather than quietly patched, because the pattern matters more than the individual fixes.

**Nothing in D2 needed correcting.** All four WHATWG Encoding Standard claims verified verbatim, including the exact windows-1252 label list and the `TextEncoder` note. The SheetJS CE/Pro boundary in D3 also checked out cleanly against the vendor's own page, as did the ExcelJS dormancy metrics, the hyparquet version history, and every byte size in the report.

**One claim was contradicted and has been rewritten:** that `read-excel-file` 9.x unconditionally spawns a Web Worker internally. Its README carries both that statement *and* an explicit retraction of it, in a comment labelled "Previous inaccurate statement". The report cited the retracted side as settled fact. D3 now records the contradiction instead of resolving it, and the corresponding open question has been rescoped.

**Six numbers had drifted** between measurement and prose, all now corrected against the raw artefacts: the xlsx write timing (3,343 ms appeared nowhere in the saved output — the two recorded runs are 3,296 and 3,445 ms); the Parquet timings (the report quoted a superseded first run rather than the authoritative re-run); the GZIP Parquet timing, which was presented next to the others as a like-for-like comparison when its file has three columns and theirs have five; the claim that all three readers read all three Parquet variants, when Polars never saw the uncompressed file; jsonrepair's #102 close date; and PapaParse's open-issue count, which is 224 issues-and-PRs per the API rather than the ~190 stated.

**One internal contradiction was found and resolved:** two researchers reported csv42's licence differently. The npm registry declares none at all, at any level. The report now says so.

**Provenance was strengthened** on the PapaParse measurement, which previously did not record which build it had loaded. The harness now identifies the artefact by its exact byte count and prints the Node version.

The pass did not check: the uDSV and LeanyLabs benchmarks (already hedged in the text), the `@office-kit/xlsx` findings, the SheetJS repair-prompt issues (access-blocked), and the *bodies* of every issue cited — titles, states, dates and labels were verified via API, thread contents were not. Details drawn from issue bodies rest on the original researcher's reading.
