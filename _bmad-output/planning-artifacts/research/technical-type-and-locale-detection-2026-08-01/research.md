---
title: 'Technical research: Type and locale detection, and the smaller stack decisions'
type: 'technical'
topic: 'R5 — type and locale detection on import, the Recipe comparison value, and the CSS approach'
decision: 'How querbeet detects and reports type/locale ambiguity per column, which parser carries it, how the confirmed decision is recorded, what type a comparison value has in a Recipe, and which CSS approach inlines into one HTML file'
source: 'native run (deep-research harness, three passes)'
status: complete
preset: 'standard'
validation: 'adversarial, 3-vote'
claims: {adjudicated: 53, confirmed: 34, refuted: 19}
created: '2026-08-01'
updated: '2026-08-01'
---

# Technical research: Type and locale detection, and the smaller stack decisions

**Decision this research serves:** how querbeet proposes a type and locale per column, how it
*reports* an ambiguity it cannot resolve (PRD FR-9), which parser executes the decision under the
single-file `file://` gate, how the confirmed decision travels to a Consumer (FR-21), what type a
Filter Step's comparison value has in an LLM-authored Recipe (FR-14, FR-28), and which CSS
approach survives being inlined into one HTML file.

## Executive summary

**The requirement that gave R5 its name has no prior art, and that is the finding.** Every import
engine checked — DuckDB, Power Query, LibreOffice Calc, Frictionless — resolves locale ambiguity
**silently**. None emits a warning, a confidence value or a second-reading flag; a grep of DuckDB's
auto-detection page finds the word "warn" zero times [1]. What exists to copy is not the *report*
but the *override*, and the best of those is Power Query's "Change Type → Using Locale", which asks
for a type and a locale in one action and writes the culture into the saved script [3][5].

| Question | Answer | Runner-up, and why it lost |
| --- | --- | --- |
| **Ambiguity detection** | Scan the **full column**, evaluate both readings as competing hypotheses, report the pair plus a count of decisive evidence and an explicit *no decisive evidence* state | DuckDB's fixed preference order — it turns an unresolvable ambiguity into a silent winner, which FR-9 forbids |
| **Number parsing** | Derive separators at runtime from `Intl.NumberFormat.formatToParts`, own the parser | `@internationalized/number` 3.6.7 — ready-made and gate-clean, but its size and bulk throughput are unmeasured |
| **Date parsing** | `date-fns` 4.4.0 `parse` with per-locale `match` | `d3-time-format` — smaller and stricter, but its locale is a hand-maintained definition object |
| **Recording the decision** | Per column: `{type, decimalChar, groupChar, dateFormat, missingValues, keepOriginal}` — Table Schema's shape minus its two defects | CSVW's `format` object — expresses the same thing through a 2015 Recommendation with a heavier document model |
| **Comparison value** | A **JSON number** in canonical machine form; a string only for genuinely textual comparisons | Always-a-string-in-canonical-form — equivalent except on precision, and it is what a Recipe should fall back to above 2⁵³ |
| **CSS** | Tailwind v4 with `preflight.css` omitted from the split import | Hand-written scoped CSS — closer than it looks; see D5 for the condition that flips it |

Four things drive those answers.

**1. Every engine samples, and sampling is where the decisive signal goes missing.** DuckDB reads
20,480 rows by default (2,048 in its first pass), Power Query inspects 200 and Frictionless 100
[1][2][4][8]; Arquero's 1,000 comes from R1. Frictionless issue #1689 is a reproduction on a 2 GB file: a field of
mostly `0` with rare floats was typed integer because the floats fell outside the 100-row sample
[10]. The signal that actually resolves `03/04/2025` — a day value above 12 — is decisive *only
within the window scanned*. querbeet's columns are at most 100,000 rows and the scan is a column
walk; **there is no reason to sample and one strong reason not to.**

**2. No parsing library infers a format from the data — every one of them requires the caller to
supply the pattern.** `date-fns` takes a required format argument, Luxon's `fromFormat` takes one,
Day.js takes one, d3's parser takes a specifier and returns `null` on any mismatch [16][17][18][19].
The consequence is structural, not incidental: **the candidate-enumeration loop is querbeet's own
code in every case**, and the library is only the per-candidate executor. Throughput must therefore
be budgeted as *rows × columns × candidates tried*, not *rows × columns*. d3's documentation states
the design outright — "If a more flexible parser is desired, try multiple formats sequentially until
one returns non-null" [19] — which is exactly the elimination loop D1 needs.

**3. The comparison value should be a number, and this overturns the research plan's lean.** The
plan's R5 sub-questions reason that a locale-parsed string is "the only one that keeps a Recipe
portable across locales".
The opposite holds: a JSON number needs no locale to be read correctly anywhere, while a string
re-imports into the `value` field the exact defect R1 and R3 already measured — an anchored regex
reading `.` as a decimal point. The vendors' own framing agrees on direction: Anthropic's worked
example treats `2` as the target and `"2"` as *the incompatible type* [22]. And the shape that
produced the FR-28 spike's four-to-one split is documented, unprompted, as Microsoft's own reference
schema for exactly querbeet's `column`/`operator`/`value` step — with `value` typed
`anyOf[string, number, object]`, no discriminator, no description [20].

**4. The no-fetch gate separates nothing in the CSS field, so size and reset behaviour decide.**
Measured against the published npm tarballs: **not one candidate contains an `@font-face` rule, and
every `url()` in every candidate resolves to a `data:` URI** [M1]. What does discriminate is the
plan's own freshness gate — Pico 2.1.1 is 16 months old, Bulma 15, Simple.css 14, Water.css **59**
— and one measurement that reframes the question: `tailwindcss/utilities.css` as published is
**21 bytes**. Every utility is generated from querbeet's own markup at build time, so Tailwind's
inlined cost is a function of the app, not of the package [M1].

**The largest caveat is stated up front:** the load-bearing UX question — how to word and score an
ambiguity report for a non-specialist — has **no prior art at all**, because no tool reports one.
That part of FR-9 is design work this research can inform but not settle.

---

## D1 — Ambiguity detection and reporting

### The prior art resolves silently, and names it as a preference

DuckDB documents the ambiguous case and its own answer to it, verbatim: "the date `01-02-2000` can
be parsed as either January 2nd or February 1st… if we later encounter the date `21-02-2000` then we
know that the format must have been DD-MM-YYYY"; and then, decisively, "**If the ambiguities cannot
be resolved by looking at the data the system has a list of preferences for which date format to
use.** If the system chooses incorrectly, the user can specify the `dateformat` and
`timestampformat` options manually" [1]. The documented preference order is ISO 8601, `%y-%m-%d`,
`%Y-%m-%d`, `%d-%m-%y`, `%d-%m-%Y`, `%m-%d-%y`, `%m-%d-%Y` — **day-first silently beats month-first**
[1]. A verifier grepped the page: "warn" occurs zero times.

Power Query's default is an environment lookup, not a decision: "When you create a new Excel workbook
that contains queries, Power Query uses the current operating system locale as the default locale",
governing "text, numeric, and date and time values" [3]. The Power BI documentation poses querbeet's
exact case — "is '3/4/2017' interpreted as 3 April or March 4?" — and answers it with a locale
dropdown, not a report [4]. LibreOffice parses under a Language combobox: "If Language is set to a
specific language, that language will be used when importing numbers" [7].

### The mechanism is negative elimination, not a confidence score

DuckDB's type detection removes candidates rather than scoring them: "If the conversion is
unsuccessful, the candidate type is removed from the set of candidate types for that column", over
the fixed set SQLNULL, BOOLEAN, TIME, DATE, TIMESTAMP, TIMESTAMPTZ, BIGINT, DOUBLE, VARCHAR, and
"Everything can be cast to VARCHAR, therefore, this type has the lowest priority" [1]. After the
sample, "the remaining candidate type with the highest priority is chosen". `sniff_csv()` returns
dialect, type and format columns and a ready-to-run prompt — **there is no confidence, score or
hit-rate column anywhere** [1].

Two scoping corrections a verifier established, both worth carrying: the candidate set is
user-extensible via `auto_type_candidates`; and a *different* sniffer phase — dialect detection —
does use argmax ("the detected dialect is the dialect that has (1) a consistent number of columns for
each row, and (2) the highest number of columns for each row") [1]. So "no scoring at all" must be
scoped to type detection.

**Frictionless is the only engine with a confidence knob, and it is the wrong shape for FR-9.**
`Detector.field_confidence` is "A number from 0 to 1 setting the infer confidence. If 1 the data is
guaranteed to be valid against the inferred schema", default 0.9 [8][9]. It is a *global tuning
threshold*, not a per-column reported score, and its documented gloss ("9 integers and one string →
integer") misdescribes the implementation: the code computes
`threshold = len(fragment) * (field_confidence - 1)` and selects with
`score >= max_score * field_confidence` — **relative candidate scoring, a candidate winning if it
comes within 90 % of the best candidate's score**, over a 100-row sample [9].

### Sampling is the failure mode to avoid, and one asymmetry is worth copying

| Engine | Rows sampled by default |
| --- | --- |
| DuckDB | 20,480 (`sample_size=-1` reads the whole file); first pass 2,048 |
| Arquero (given, R1) | 1,000 |
| Power Query | 200 |
| Frictionless | 100 |

Sources [1][2][4][8][9]. Frictionless #1689 is the reproduction [10].

**One asymmetry must not be flattened:** DuckDB fails *loudly* when a post-sample value violates the
sniffed type — `Conversion Error: CSV Error on Line: 5648 … date field value out of range` —
suppressible only with `ignore_errors=true` [1]. So "even DuckDB corrupts data by sampling" would be
an overreach. The defensible statement is narrower and worse: **in a fully ambiguous column, where
every day value is ≤ 12 and both readings parse cleanly, no error can ever fire in any of these
tools.** That is precisely the column FR-9 exists for.

### Which signals are decisive and which only shift a probability

This table is design guidance derived from the elimination mechanism above, not a quoted finding.

| Signal | Force | Why |
| --- | --- | --- |
| More than 3 digits after a `.` or `,` (`1.2345`) | **Decisive** — kills the thousands-separator reading | A group is exactly three digits by construction |
| Both `.` and `,` in one value (`1.234,56`) | **Decisive** — fixes both roles at once | The inner one is the group separator, the outer the decimal |
| A group of other than 3 digits (`1.23`, `12.3456`) | **Decisive against grouping** | Same reason |
| A day value > 12 | **Decisive** — kills MM/DD | No twelfth-plus month |
| A value > 31 in the first position | **Decisive** — kills both DMY and MDY | Leaves YMD |
| Every value has exactly 3 digits after the separator | **None** — this *is* the ambiguity | `1.234` reads both ways |
| Column name (`Betrag`, `Datum`, `Amount`) | Probabilistic | A hint for ordering candidates, never a resolution |
| Other columns in the same file agree | Probabilistic | Sources can mix locales *within* one file (FR-9) |
| The file's declared or sniffed encoding | Probabilistic | Windows-1252 correlates with a German export; R3 records that Microsoft documents **no** code page for plain CSV export |

The operational point: a decisive signal resolves the column, and its **absence is itself the
report**. That is the state no prior tool exposes, and the one FR-9 requires.

### The override to copy

Power Query's is the strongest: right-click a column header → **Change Type → Using Locale** → "select
a data type **and** locale" [3], and — the part that matters for FR-21 — the pair is serialized into
the script rather than kept as UI state: `Table.TransformColumnTypes(table, typeTransformations,
optional culture)`, e.g. `culture = "en-US"` [5]. Its worked example is querbeet's failure mode
exactly: UK `dd/mm/yyyy` read under `en-US` yields errors — "there's no month 22" [4].

A qualification a verifier insisted on: Power Query also offers four type-only commands with no
locale prompt, so it is false that it refuses a type without a locale. The accurate statement is
that **there is no locale-free parse** — a type-only change silently inherits a locale from a
three-level hierarchy (Change Type setting > Power Query > operating system) [3][4].

LibreOffice encodes field order in the type itself: Standard, Text, **Date (DMY)**, **Date (MDY)**,
**Date (YMD)**, US English, Hide — where Date (DMY) means "The imported data is assumed as Day, Month
and Year (in this order)", and *US English* forces dot-decimal parsing "irrespective of the locale
selected in the Locale combobox above" [7]. That per-column escape hatch is binary rather than a
full locale, but the idea — an explicit per-column override that beats the document default — is the
right one.

### Recommendation (D1)

**Scan the full column. Evaluate both readings as competing hypotheses. Report the pair with a count
of decisive evidence, and make "no decisive evidence found" an explicit, visible state rather than a
0 % confidence number.** Offer a per-column type+locale override modelled on Power Query's combined
dialog, and record the confirmed pair per column (D3).

FR-9's example wording — "Date, dd.mm.yyyy — 842 of 900 values readable" — is a *hit rate*, and it
answers a different question than ambiguity. Both are needed and they are not the same number:

- **Hit rate** answers "does this reading work at all?" — 842 of 900.
- **Decisive-evidence count** answers "could the other reading also be right?" — e.g. "137 values
  settle this" versus "**nothing in this column settles this**".

A column can have a 100 % hit rate under *both* readings. That is the case the report must name.

**Runner-up: DuckDB's priority-order fallback**, rejected because it converts an unresolvable
ambiguity into a silent winner — the exact behaviour FR-9 forbids. Its *elimination* mechanism is
worth copying; its *tie-break* is not.

**Do not copy Frictionless's `field_confidence`.** It is a global tuning knob, and its relative-scoring
implementation would report a number that means "this candidate came within 90 % of the best
candidate", which no non-specialist can act on.

---

## D2 — Parsing numbers and dates across locales

### The browser already ships the locale data, and it is free

`Intl.NumberFormat.prototype.formatToParts()` returns `{type, value}` tokens that expose the
separators as discrete strings: `group` — "The group separator string, such as `,`"; `decimal` —
"The decimal separator string, such as `.`" [11]. MDN's Baseline banner reads "Baseline Widely
available… It's been available across browsers since September 2019" [11], so it is usable from
`file://` with **zero bundled locale data and zero network access**.

Measured by a verifier (Node v26.5.0, ICU 78.3, `new Intl.NumberFormat(l).formatToParts(12345.6)`):

| Locale | group | decimal |
| --- | --- | --- |
| `de-DE` | `.` | `,` |
| `en-US` | `,` | `.` |
| `fr-FR` | **U+202F** (narrow no-break space) | `,` |
| `de-CH` | `'` | `.` |
| `es-ES` | `.` | `,` |
| `ar-EG` | U+066C | U+066B, Arabic-Indic digits |

**Four pitfalls narrow the technique without breaking it** [11][12][13]:

1. **The probe value matters.** `format(1000)` yields `"1000"` with only an integer part in `es-ES`
   and `pl-PL`. The probe needs ≥ 5 integer digits *and* a fraction; React Spectrum uses `1111.11`.
2. **`fr-FR`'s group separator is U+202F**, so `replace(/ /g,'')` misses it. The CLDR/ICU migration
   from U+00A0 to U+202F lands at different ICU versions per engine — **a parser must accept U+0020,
   U+00A0 and U+202F as one class.**
3. **Non-`latn` numbering systems need a digit transliteration map**, obtainable from a second format
   pass.
4. **There is no accessor.** It is probe-and-read; nothing exposes "give me the separators".

Also checked and dismissed: Firefox Bugzilla 1612379, a proposal to cut shipped ICU locales, is NEW,
deprioritised to P5, never implemented, and would have retained `de-DE`/`fr-FR`/`en-US` regardless
[14].

### The one number library that passes every gate

**`@internationalized/number` 3.6.7**, published **2026-05-28**, **Apache-2.0 verified in the
published tarball** (the PrimeVue guard passes: `package/LICENSE` is the literal Apache 2.0 text),
single dependency `@swc/helpers`, **237,370 B unpacked** [15]. Tarball inspection of all 27 files:
no locale-data directory, no CLDR JSON, and
`grep -nE "fetch\(|import\(|require\(|XMLHttpRequest"` over `dist/index.mjs` and `dist/private/*.mjs`
returns **zero matches**. The only Intl surface used is `Intl.NumberFormat`; the only hardcoded table
is `NUMBERING_SYSTEMS = ['latn','arab','hanidec','deva','beng','fullwide']`. **It parses, not merely
formats.**

**Its published size figure did not survive.** The docs claim "The entire library is 1.7 kB minified
and compressed with Brotli" [15]; that is a vendor self-report and it was **refuted 0-3** as a
verified number. A verifier measured the *unminified* ESM dist at 25.5 kB raw gzipping to
**6,641 B**, and flagged min+Brotli as needing a local build. Treat 1.7 kB as unconfirmed.

### The date library field

Every figure below is from the npm registry document and the published tarball, read 2026-08-01.

| Library | Version | Published | Licence | Parses? | Notes |
| --- | --- | --- | --- | --- | --- |
| **date-fns** | 4.4.0 | 2026-05-29 | MIT (LICENSE.md in tarball) | **Yes** | Zero runtime deps; no `fetch`/XHR/dynamic import in any shipped `.js`/`.cjs` |
| **Luxon** | 3.7.2 | 2025-09-05 | MIT | **Yes** | `fromFormat(text, fmt, {locale})`; precompiled parser path |
| **d3-time-format** | 4.1.0 | — | ISC | **Yes** | Strict; locale is a definition *object*, ~500 B of inert JSON for German |
| **Day.js** | 1.11.21 | 2026-05-26 | MIT | **Only with a plugin** | 3,049 B gzip core + 1,863 B gzip `customParseFormat` |
| **Temporal** | — | — | platform | **No** | Eliminated twice over; see below |

**date-fns 4.4.0** — `./parse` is a published export subpath; `ParseOptions` extends
`LocalizedOptions`, and locale `match` resolves month and day names [16]. One honest qualification a
verifier insisted on: there was a **20-month publish gap** between 4.1.0 (2024-09-17) and 4.2.0
(2026-05-18), then four releases in twelve days. This is "recently active", not "a demonstrated
cadence". Note also that the tarball's `package.json` carries no `license` key — MIT comes from the
registry document plus the bundled `LICENSE.md`.

**Luxon 3.7.2** — the control experiment is what makes it a genuine parse rather than a tag:
`fromFormat('Mai 25 1982','LLLL dd yyyy',{locale:'en-US'})` is invalid with reason "unparsable",
while the same input under `{locale:'de'}`… parses. The identical string flips purely by changing the
locale option [17]. It also ships a documented bulk path — `buildFormatParser(fmt, options)`, "used
to optimize cases where many dates need to be parsed in a specific format" — and precompilation is
real in the tarball (`RegExp` construction hoisted into the constructor). **But it is the slow one:
locally measured at 998 ms → 356 ms per 100,000 values with the precompiled parser, i.e. ~7 s for
100,000 × 20 single-threaded** [17]. That is what drops it to third.

**Day.js carries a silent-wrong-answer trap.** Without `customParseFormat` registered,
`dayjs('25.12.1995','DD.MM.YYYY')` returns *Invalid Date* — but `dayjs('12-25-1995','MM-DD-YYYY')`
returns **1995-12-25**: the format argument is **silently ignored** and Day.js falls through to its
native-Date path, which happens to be right for US order and wrong for everything else [18]. Locally
reproduced against 1.11.21. For a German-locale ETL tool that is disqualifying on its own. Whether
Day.js parses *localized month names* is genuinely unresolved — the strong claim was refuted 0-3
while a verifier's source reading showed localized `L`/`LL` tokens do resolve against the `de`
locale's `formats` — so it needs a local measurement before anyone relies on either behaviour.

**d3-time-format is the elegant one and the runner-up.** It parses via strptime-style specifiers, is
**strict** — "if the specified string does not exactly match the associated specifier, this method
returns null" — and takes its locale as a plain **definition object** (`{dateTime, date, time, periods,
days, shortDays, months, shortMonths}`), roughly 500 B of inert JSON for German, trivially inlined
[19]. Confirmed in the shipped implementation: `%B` → `parseMonth` built from `locale.months` via a
lookup map, so locale month names are genuinely consumed on the parse path. Its cost is that the
locale table is *yours to maintain* rather than the library's.

**Temporal is eliminated on two independent grounds, and this corrects the brief's own premise.**
`Temporal.PlainDate.from()` accepts only a Temporal instance, an RFC 9557 string, or a property bag;
the only option is `overflow`. There is no format or locale hook anywhere in the signature, so
`"31.12.2025"` produces a **RangeError**, not a reinterpretation. `toLocaleString()` exists for
localized output; **there is no inverse** [21]. Separately, MDN carries verbatim: "Limited
availability: This feature is not Baseline because it does not work in some of the most widely-used
browsers", and browser-compat-data gives Chrome 144, Edge 144, Firefox 139, Node 26.0.0, **Safari not
supported** — caniuse puts global support at 67.12 % [21]. The shipping versions are **144 and 139**,
not the "143+/143+" this research's own brief assumed.

### The cross-cutting finding

**No verified candidate infers a date format from the input string.** date-fns takes a required
format argument; Day.js's format argument is mandatory (a literal pattern, or a localized token plus
an explicitly named locale); Luxon's `fromFormat` requires `fmt` and `buildFormatParser` is bound to
exactly one format+locale; d3 is strict single-specifier and its docs prescribe trying formats
sequentially [16][17][18][19].

Two consequences, and both are architectural:

1. **The library choice does not reduce the ambiguity work.** The candidate-enumeration loop — try
   the German patterns, try the US patterns, count decisive hits — is querbeet's code in every case.
2. **Throughput must be budgeted as rows × columns × candidates tried.** Luxon's 356 ms per 100,000
   is *per candidate*; three candidates over 20 columns is a different order of magnitude than the
   raw figure suggests.

### Recommendation (D2)

**Numbers: derive `group` and `decimal` at runtime from `Intl.NumberFormat.formatToParts` with a
≥ 5-integer-digit, fractional probe, and hand-roll the parser around them.** It costs zero bytes,
zero locale data and zero fetches, and the four pitfalls above are all small and known.
**Runner-up: `@internationalized/number` 3.6.7** as a drop-in — it is gate-clean and it genuinely
parses, held back only because its real min+gzip cost and its bulk throughput are both unmeasured.
Every locale-data-bundling alternative loses on the single-file gate before size is even considered.

**Dates: `date-fns` 4.4.0 `parse`**, one call per candidate pattern, with only the locales actually
needed imported. **Runner-up: `d3-time-format`**, which is smaller, stricter and inlines its locale
as ~500 B of JSON — promote it if the tree-shaken cost of date-fns's locales turns out to be large,
which is exactly the number that was refuted and still needs measuring. **Luxon is third** on
throughput. **Day.js is rejected** on the silent-format-ignored trap. **Temporal is not an option.**

---

## D3 — Recording the confirmed type and locale

### Frictionless Table Schema is the right shape, and it has two documented defects

The `number` field descriptor records locale as **two independent per-field strings**, not as a tag
[24][25]:

- `decimalChar` — "A string whose value is used to represent a decimal point within the number. The
  default value is `.`."
- `groupChar` — "A string whose value is used to group digits within the number. **This property does
  not have a default value.** A common value is `,`."
- `bareNumber` — boolean, default `true`; "If false the contents of this field may contain leading
  and/or trailing non-numeric characters (which implementors MUST therefore strip)… Note that it is
  entirely up to implementors what, if anything, they do with stripped text."

**There is no `locale` property anywhere in the field descriptor.** Stable across v1 and v2; v2
extended `groupChar` to the `integer` type.

**Defect 1 — an omitted `groupChar` cannot be distinguished from "no grouping".** The spec withholds
a default and the reference implementation invents one (`group_char` "The default value is `''`")
[26]. querbeet must either give it an explicit default or make it required.

**Defect 2 — the reference implementation reproduces querbeet's own 1000× bug.** Issue #1005: a
schema declaring `decimalChar: ","` against data written with `.` raises no error and silently yields
`Decimal('1.234')`, while the reverse direction *does* error [27]. This is the same failure family
R1 measured in Arquero's `fromCSV` and R3 measured in PapaParse's `dynamicTyping`, arriving from a
third direction — **a declared-but-wrong locale is as dangerous as an inferred one.**

Dates are recorded as a per-field `format` with three modes [24][25]:

| Mode | Meaning |
| --- | --- |
| absent (default) | The ISO lexical form — `yyyy-mm-dd` for `date`, `hh:mm:ss` for `time`, XML Schema datetime for `datetime` |
| `<PATTERN>` | "Values in this field can be parsed according to `<PATTERN>`. `<PATTERN>` MUST follow the syntax of standard Python / C `strptime`" |
| `"any"` | "Any parsable representation of the value… An example is `dateutil.parser.parse`… **It is NOT RECOMMENDED to use `any` format as it might cause interoperability issues.**" |

**`format: "any"` is the anti-pattern named by the spec itself**, and its exemplar,
`dateutil.parser.parse`, defaults to `dayfirst=False` — so it reads `03/04/2025` as 3 April with no
ambiguity report. That is the behaviour FR-9 forbids, documented in the spec text rather than
inferred.

### CSVW expresses the same thing, through a heavier document

A direct fetch and grep of the metadata Recommendation (331,392 bytes) finds **`decimalChar` 0 hits,
`groupChar` 0 hits, `locale` 0 hits** [28]. §5.11.2 lists the complete datatype-description property
set — `base, format, length, minLength, maxLength, minimum, maximum, minInclusive, maxInclusive,
minExclusive, maxExclusive, @id, @type` — and delegates: `format` is "used when parsing a string
value as described in Parsing Cells in [tabular-data-model]". The delegated §6.4.2 then defines
`decimalChar` (default `.`), `groupChar` (default `null`) and `pattern` (UAX35) [29].

**Do not misread the zero hits.** `{"decimalChar": ",", "groupChar": "."}` inside a `format` object
*is* CSVW's answer; it simply lives one specification away. The source is a frozen W3C Recommendation
of 17 December 2015 with no CSVW 2.0 superseding it — stable rather than stale.

### Power Query's lesson is about scope, not mechanism

Recording the author's decision and shipping it with the document is established practice: "the
Power Query locale setting is kept as the locale specified by the author (or last person who saved
the document). This ensures consistent Power Query results regardless of your current operating
system locale settings" [3], corroborated by "if you move your query to a different location that
uses a different default culture, your query still uses the culture of the original location" [6].

But the widely-reported cross-machine breakage comes from the *same design's default*: the locale is
a **file-scoped value seeded once from the author's OS**, and the auto-generated "Changed Type" step
omits the `culture` argument, so the file faithfully applies a recorded-but-never-chosen culture
[3][5]. **That argues for per-column, not per-document.** FR-9 requires it anyway — columns within
one Source can carry different locales.

### Recommendation (D3)

Record **per column**, in the Recipe and in the FR-21 Input Contract:

```
{ type, decimalChar, groupChar, dateFormat, missingValues, keepOriginal }
```

Table Schema's field shape minus its two defects: **give `groupChar` an explicit default or make it
required**, and **never emit anything resembling `format: "any"`**. `dateFormat` in strptime syntax
matches both Table Schema and d3's specifier vocabulary, so it costs nothing to be compatible.
`keepOriginal` carries FR-9's "values that do not parse are marked as unparsed and remain
inspectable" — no consulted specification mandates retaining the original string anywhere, so this
one is querbeet's own.

**Runner-up: CSVW's `format` object**, which expresses the same information and is a frozen W3C
Recommendation, but reaches it through a two-document model with a heavier vocabulary than a Recipe
needs.

---

## D4 — The type of a comparison value in a Filter Step

### The shape that caused the split is documented as a vendor reference example

Microsoft's structured-outputs documentation ships a `strict: true` function-calling example of
**exactly querbeet's shape** — an array of conditions carrying column, operator and value — and types
the value as a non-discriminated union [20]:

```json
"value": { "anyOf": [
  { "type": "string" },
  { "type": "number" },
  { "type": "object", "properties": { "column_name": { "type": "string" } },
    "required": ["column_name"], "additionalProperties": false } ] }
```

No description, no discriminator, no per-column typing. **Strict mode still admits both `"1000"` and
`1000` for the same condition**, so the choice is left entirely to the model — and the doc's own
unsupported-keywords table forbids `pattern`/`format` on strings and `minimum`/`maximum` on numbers,
so a schema author has *fewer* tools than plain JSON Schema to narrow the branches [20].

OpenAI's guide confirms `anyOf` is in the supported subset with structural restrictions ("Root
objects must not be `anyOf` and must be an object"), and documents the union-with-`null` pattern
solely to emulate optional parameters. An exhaustive grep for "determinis"/"consistent"/"always
generate" over the raw page finds only the schema-adherence and key-order guarantees [23]. **A
`number | string` value is not a supported-and-safe schema; it is an unspecified one.** Silence, not
endorsement.

### The one mechanism that removes the ambiguity is one querbeet cannot use

Anthropic's strict tool use documents the fix and names querbeet's defect in the same page: "Setting
`strict: true` on a tool definition guarantees Claude's tool inputs match your JSON Schema by
constraining the model's token sampling to schema-valid outputs (a technique called
grammar-constrained sampling)", with the worked case "suppose a booking system needs `passengers:
int`. Without strict mode, Claude might provide `passengers: "two"` or `passengers: "2"`. With
`strict: true`, the response always contains `passengers: 2`" [22].

**querbeet structurally cannot invoke it.** A Recipe arrives by copy-paste from an arbitrary chat
session; there is no API call to attach a schema to. The mechanism can only be *imitated*: declare
one type in the FR-27 prompt block, and enforce it at ingest.

Note the direction of the vendor's framing, because it settles the plan's open question: **the number
is the target and the string is "the incompatible type"** [22].

### The format survey is one confirmed row and several corrected ones

Adversarial verification killed most of this survey — and the refutations produced better facts than
the claims did. Reported here with the distinction explicit.

**JsonLogic — confirmed (2-1), and the answer is a fourth category: *undefined*.** The specification
documents **no coercion rule of any kind** for `>`, `>=`, `<`, `<=` or the three-argument between
form; every coercion sentence on the page attaches to an equality operator ("Tests equality, with
type coercion" for `==`, "Tests strict equality" for `===`) [30]. The contrast is pointed: the same
site pins truthiness across interpreters ("JsonLogic has its own spec for truthy to ensure that rules
will run consistently across interpreters") and conspicuously does not pin comparison [31]. **And
there is no strict variant of any ordering operator** — `===`/`!==` exist, `>`/`>=`/`<`/`<=` have no
counterpart, so for a `gt` filter the rule author has no operator choice at all.

*From the refutation record, and more useful than the claim it killed:* the reference implementation
is `">": function(a, b) { return a > b; }` — bare JS. When **both** operands are strings, JS `>`
compares **lexicographically**. Measured in Node by a verifier: **`"900" > "1000"` is `true`, and
`"90" > "1000"` is `true`** — both numerically false. querbeet runs PapaParse with `dynamicTyping`
off, so **its columns are strings by default**. This is not a hypothetical failure mode; it is the
default one.

**MongoDB — the absolute was wrong, the behaviour holds.** "MongoDB enforces comparisons with
Comparison Query Predicate Operators only on documents where the BSON type of the target field
matches the query operand type through Type Bracketing" is verbatim [32], and a string bound against
numeric documents yields a **silent empty result, no error**. But "never coerced" is contradicted by
the page this one links to: "MongoDB treats some data types as equivalent for comparison purposes.
For instance, **numeric types undergo conversion before comparison**" [33]. So int32/int64/double/
decimal128 are one equivalence class; only number-versus-string is bracketed.

**Elasticsearch — the mechanism is real but the scope was wrong, and the truth is sharper.** The
`coerce` mapping parameter governs **indexing only**; the words "query" and "search" appear nowhere
on its page, and every example is a `PUT` [34]. *From the refutation record:* the query paths
**hardcode** coercion — `NumberFieldMapper`'s `INTEGER.termQuery` calls `parse(value, true)`, and
`rangeQuery` does the same — so a string bound **is** coerced at query time **regardless of the
field's `coerce` setting**. A field configured `"coerce": false` still accepts `"1000"` in a range
query. That is a stricter and more interesting fact than the original claim.

**OData — half true, and the failing half matters.** The ABNF is exact: no numeric production admits
`SQUOTE`, and `string = SQUOTE *( … ) SQUOTE` [35]. So `amount gt '1000'` parses via `string` and
`1000` cannot parse as a string. But "the type is fixed by its lexical form" fails, because the
*unquoted* form fixes only a **family**: `byteValue`, `sbyteValue`, `int16Value`, `int32Value`,
`int64Value`, `singleValue`, `doubleValue` and `decimalValue` all match `1000`, and single quotes are
also how `enum` literals are written. And the ABNF has no typing or coercion semantics at all —
`gtExpr = RWS "gt" RWS commonExpr` imposes no operand compatibility, so type checking is deferred
entirely to the service.

**Frictionless — the closest prior art, and it mandates a resolution** (from the first run,
confirmed 3-0, verbatim in both spec versions): "All constraints **MUST** be tested against the
logical representation of data, and the physical representation of constraint values **MAY** be
primitive types as possible in JSON, or represented as strings that are castable with the type and
format rules of the field" [24][25]. The permissiveness sits on MAY, the semantics on MUST. **The
real gap:** the spec says "castable with the type and format rules", but `decimalChar`/`groupChar`
are separate properties, *not* `format` — so whether `"1.234,56"` as a constraint string is cast with
the field's separators is unanswered, and #1005 shows the reference implementation mis-parsing in the
lenient direction [27].

**Not established, and not to be cited from this research:** GraphQL input coercion, Vega-Lite filter
transforms, RQL/JSON:API conventions and Sigma detection rules were never reached.

### What the LLM-behaviour literature does and does not support

The one paper in scope is Tam et al., *Let Me Speak Freely?* (arXiv:2408.02442v3, EMNLP Industry
Track) [36], and **both claims drawn from it were refuted** — one of them in a way that inverts the
lesson.

- **Key order is not a lever, and the paper says the opposite of what was claimed.** §4.1 verbatim:
  "we found that **100 % of GPT-3.5 Turbo JSON-mode responses placed the `answer` key before the
  `reason` key**, resulting in zero-shot direct answering instead of zero-shot chain-of-thought
  reasoning." The supplied schemas listed **`reason` first** in every appendix variant. So this is
  the model **violating** the supplied order, not obeying it. Any design that leans on schema key
  order to steer a model is leaning on something measured to fail.
- **The variance claim survives only in a narrower form.** §5.1 does report "significant improvements
  in average scores and lower standard deviations across different prompt perturbations" when the
  schema restriction is removed — but for **3 of 4** models, with one cell inverting
  (gpt-3.5-turbo YAML scored *higher* with schema). The refutation was on the framing "schema *shape*,
  not just presence": Table 1 is a presence-versus-absence ablation. And .txt's reproduction reports
  constrained generation matching or beating unstructured generation on all three tasks, attributing
  the original result to a prompt confound [37].

**Net:** there is no measured evidence that a union type specifically degrades output consistency.
The case against `anyOf` here rests on something simpler and firmer — **no vendor documents any rule
for which branch a model picks**, and the one documented determinism mechanism operates on a single
declared type.

### Recommendation (D4)

**`value` is a JSON number in canonical machine form — dot decimal, no grouping separators — for
numeric comparisons; a string only for genuinely textual ones.**

Three reasons, in order of force:

1. It is the type the one working determinism mechanism targets: the vendor's own example treats `2`
   as correct and `"2"` as the incompatible type [22].
2. **It is locale-free by construction, so it is *more* portable than a locale-parsed string, not
   less.** FR-9 already makes locale a property of the column's source parsing; putting locale into
   the comparison constant as well means a Consumer whose file is `1,234.56` inherits a bound written
   for `1.234,56`. **The research plan's premise — that only the string form keeps a Recipe
   portable — does not survive this.**
3. A JSON number cannot be ambiguous the way the string `"1.234"` is. The string form re-imports the
   defect R1 and R3 both measured into the `value` field.

**Runner-up: `value` always a string in a canonical machine format**, parsed by querbeet against the
column's confirmed type and locale. Its one real advantage is precision — a JSON number is an
IEEE-754 double in every JavaScript parser, so cent-exact currency beyond 2⁵³ or long numeric
identifiers used as bounds would need the string. **That is the single condition under which the
runner-up should be promoted.**

**Reject "typed per condition" outright.** It is the `anyOf` union under another name, and the Azure
finding shows that shape is what produced the split.

**Enforcement, and it is unbuilt today.** `proposed/columns.js` validates column *names* against the
propagated schema; nothing anywhere inspects a *value*, and `load-recipe.mjs` does `JSON.parse` and no
value typing. The fix has the same shape as the existing name check:

- accept a JSON number as-is;
- accept a string matching `-?\d+(\.\d+)?` by coercing it — **this alone converts four of the five
  measured authorings**, since `"1000"` is already canonical;
- **refuse anything carrying a grouping separator or a comma decimal** — `"1.234,56"`, `"1,000"` —
  by name, in the same place and message style as an unknown column, so a Consumer never silently
  inherits a differently-filtering Recipe.

`block-template.txt`'s only filter example is `{"column":"Region","op":"equals","value":"Süd"}` — a
text comparison, at both lines 74 and 128, with no numeric one anywhere. That is why five authors
guessed. **Add a numeric filter example the same day the rule is decided**, per the plan's own
condition.

---

## D5 — CSS approach

All figures measured locally from the published npm tarballs; full protocol and reproduction in
`imports/css-artefact-measurement-2026-08-01.md` [M1].

| Package | Version | Published | Licence | Artefact | raw | gzip ‑9 |
| --- | --- | --- | --- | --- | --- | --- |
| `tailwindcss` | 4.3.3 | 2026-07-16 | MIT | `theme.css` | 19,586 | 4,948 |
| | | | | `preflight.css` | 8,489 | 2,934 |
| | | | | **`utilities.css`** | **21** | 55 |
| `unocss` | 66.7.5 | 2026-07-07 | MIT | *(ships no stylesheet)* | – | – |
| `open-props` | 1.7.23 | 2026-01-31 | MIT | `open-props.min.css` | 29,566 | 7,664 |
| `@picocss/pico` | 2.1.1 | **2025-03-15** | MIT | `pico.min.css` | 83,319 | 11,630 |
| `bulma` | 1.0.4 | **2025-04-19** | MIT | `bulma.min.css` | 677,931 | 65,219 |
| `simpledotcss` | 2.3.7 | **2025-05-29** | MIT | `simple.min.css` | 9,429 | 2,790 |
| `water.css` | 2.1.1 | **2021-08-11** | MIT | `water.min.css` | 22,668 | 3,571 |
| `@vue-flow/core` | 1.48.2 | 2026-01-28 | MIT | `dist/style.css` | 3,930 | 906 |
| | | | | `dist/theme-default.css` | 3,470 | 718 |

**The no-fetch gate separates nothing.** Zero `@font-face` rules in any candidate, and every `url()`
resolves to a `data:` URI. Open Props' five apparent exceptions are `url(%23a)` fragment references
*inside* the `data:image/svg+xml` payload, verified by extracting the surrounding characters. Pico's
default sans stack is a system stack and pulls no web font. **Vue Flow's own two stylesheets contain
zero `@font-face` and zero `url()`** — which upgrades an earlier "absence of documentation, not
evidence" note into a measurement [M1].

**The plan's freshness gate does separate.** Against "released within the last 12 months": Pico is
16 months old, Bulma 15, Simple.css 14, **Water.css 59**. Only Tailwind, UnoCSS, Open Props and Vue
Flow pass.

**The 21-byte measurement reframes the size question.** `utilities.css` as published contains only a
layer declaration — every utility is generated from the app's markup at build time. So Tailwind's
inlined cost is a function of querbeet, not of the package; the fixed part is `theme.css` (19,586 B
raw, and v4 emits only the theme variables actually referenced, so even that is an upper bound). By
comparison a classless framework ships its whole stylesheet whether the app uses it or not: Pico
83 KB raw, Bulma 678 KB raw.

**Preflight can be removed cleanly, and this is the decisive documented fact.** `@import "tailwindcss"`
decomposes into three layer imports, and the docs' own instruction is "To disable Preflight, simply
omit its import while keeping everything else" [38]:

```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
/* @import "tailwindcss/preflight.css" layer(base);  ← deleted */
@import "tailwindcss/utilities.css" layer(utilities);
```

This matters because Preflight is a global element-selector reset (`margin: 0`, `padding: 0`,
`border: 0 solid` on **all** elements, unstyled headings, unstyled lists) and Tailwind's own
documentation records the collision with third-party stylesheets — "This can cause some unexpected
results when integrating certain third-party libraries, like Google maps for example", linking
`tailwindlabs/tailwindcss#484` [38]. The docs offer **two** remedies, disabling Preflight and
per-element overrides in `@layer base`; a claim that the override was the *prescribed* fix was
refuted 0-3 precisely because disabling is presented as a general solution. Applying the pattern to
`@vue-flow/core/dist/style.css` is inference in the same collision direction, not documented fact —
Vue Flow's docs issue no such warning.

**One caveat travels with the split import:** when importing the files individually, modifiers move
onto their respective imports — `source(…)` and `important` onto `utilities.css`,
`theme(static)`/`theme(inline)` onto `theme.css`, and `prefix(tw)` onto **both** [38].

**Vue Flow needs almost nothing from a framework anyway.** Only `style.css` (3,930 B) is required;
`theme-default.css` (3,470 B) is explicitly optional, and the documented theming surface is a set of
CSS custom properties — `--vf-node-color`, `--vf-box-shadow`, `--vf-node-bg`, `--vf-node-text`,
`--vf-handle`, `--vf-connection-path` — overridable globally or per element [39]. Node-graph theming
therefore needs no utility framework at all.

**UnoCSS is the near-miss.** It is fresh, MIT, ships no stylesheet, and its Vite/PostCSS path emits
static CSS at build time — but it "can run both at build time… and at runtime in the browser" via an
optional CDN runtime, and it ships a first-party **Web fonts** preset that by design pulls external
assets [40]. Both are opt-in and both must be *kept* opt-out under the `file://` gate. Its "Why
UnoCSS?" page contains no benchmark numbers and no output-size figures, so any UnoCSS byte cost in
this report would have been invented.

### Recommendation (D5)

**Tailwind CSS v4.3.3 with the three-line split import and `preflight.css` omitted, inlined at
build.** It is the only candidate that documents a first-class way to ship utilities without a global
reset, its output scales with the app rather than with the package, and the build path it needs
already exists from R2.

**Runner-up: hand-written CSS scoped to querbeet's own components**, with custom properties for
tokens — closer than the table suggests, because Vue Flow already speaks custom properties and R2
chose SFCs, so `<style scoped>` adds no dependency to a five-year artefact. **The condition that
flips it:** if the first real screens show the utility classes fighting the dense table and the
per-kind node forms rather than helping, drop Tailwind — nothing else in the stack depends on it.
Open Props (7,664 B gzip, fresh, MIT, all-`data:`) is the token layer for that path.

**Pico.css is dropped on a measured gate, not on taste:** 2.1.1 is 16 months old and fails the plan's
freshness requirement. Its design would have been the second objection — classless means it restyles
bare elements globally, the same failure mode as Preflight, with no documented opt-out equivalent to
deleting one import line. **Bulma is dropped on size** (678 KB raw, 65 KB gzip, more than twice
querbeet's entire built artefact in R2). **Water.css and Simple.css are dormant.**

---

## Verification note

Three passes, all adversarially verified at 3 votes per claim with 2 refutations required to kill.

| Pass | Sources | Claims extracted | Adjudicated | Confirmed | Refuted |
| --- | --- | --- | --- | --- | --- |
| 1 — ambiguity, parsing, metadata, filter values, CSS | 24 | 117 | 25 | 17 | 8 |
| 2 — date/number library field, filter formats, CSS | 19 | 90 | 15 | 12 | 3 |
| 3 — targeted re-verification of pass 2's unverified pool | *(reused)* | 13 | 13 | 5 | 8 |
| **Total** | **43** | **207** | **53** | **34** | **19** |

**A process failure worth recording, because it nearly hid a gap.** Pass 2 ranked all extracted
claims globally by importance and source quality and verified only the top 15 — and Gap A's claims
took every slot, so the filter-format and CSS claims were *fetched and then never adjudicated*. The
run reported "Gaps B and C produced no surviving claims", which reads as *nothing was found* but
actually meant *nothing was checked*. Pass 3 recovered them from the run journal and verified them
directly. **A ranked-top-N verification budget silently starves whichever angle ranks lowest; rank
within each angle, not across them.**

**Nineteen refuted claims, and four of them taught more than they cost.** The pattern is consistent:
the quote was verbatim and the *inference* overreached.

- The JsonLogic `==`/`===` claims died because they were about the wrong operator — and the
  refutation supplied the lexicographic `"900" > "1000"` measurement, which is the finding querbeet
  actually needed.
- The MongoDB claim died on "never coerced" — numeric BSON types *are* converted before comparison.
- The Elasticsearch claim died on scope — `coerce` is an indexing parameter — and the refutation
  found that query paths hardcode coercion regardless of the setting.
- The arXiv key-order claim died because it **inverted the paper's causality**: the model violated
  the supplied key order rather than following it.

Also corrected: the `@internationalized/number` "1.7 kB" figure is a vendor self-report and failed
verification; the Frictionless `field_confidence` claim was attributed to a page containing neither
"confidence" nor "0.9" (facts right, citation wrong, implementation misdescribed); and this
research's own brief was wrong that Temporal ships in Chromium/Firefox 143+ — it is 144 and 139, and
Safari does not ship it at all.

**Two findings rest on 2-1 votes**, both upheld with wording corrections: Power Query's locale dialog
and LibreOffice's date column types. **WebSearch budget was exhausted** during pass 3, so the
Anthropic and Tailwind rows have no independent third-party contradiction search behind them.

---

## What still needs a local measurement

None of these blocks a decision; each is a number that should exist before the code that depends on
it is written.

1. **Parser throughput at scale.** Nobody measured 100,000 × 20 through a `formatToParts`-derived
   parser or through `@internationalized/number`. The only datapoint in the whole field is Luxon at
   356 ms per 100,000 *per candidate pattern*, in Node. Budget as rows × columns × candidates.
2. **Do Chromium and Firefox return byte-identical separators for `de-DE` and `fr-FR`?** The only
   measurement is Node v26.5.0 / ICU 78.3. The U+00A0 → U+202F migration lands at different ICU
   versions per engine; if they disagree, the parser needs the normalisation class named in D2.
3. **The tree-shaken cost of date-fns's locales.** The claimed per-locale figure was refuted 0-3 and
   must not be quoted; the real number needs one Vite build importing `de` and `en-US`.
4. **Day.js's localized-token parsing** — unresolved between a refuted claim and contradicting
   source-level evidence. Only relevant if Day.js is reconsidered.
5. **querbeet's own Tailwind output size**, which is the only honest version of the D5 byte figure.
6. **`@internationalized/number`'s real min+gzip** through querbeet's build, replacing the vendor's
   1.7 kB.

**Not researched at all, and not to be assumed answered:** `chrono-node`, `any-date-parser`,
`d3-format`, `numbro`, `autonumeric`, `currency.js`, `dinero.js`; and the GraphQL, Vega-Lite, RQL /
JSON:API and Sigma rows of the filter-format survey. The first two matter most — they are the only
*inference* parsers in the field, and therefore the only candidates that could contradict D2's
cross-cutting finding that no library infers a format.

**And the one that is design work, not measurement:** how the ambiguity report should be worded and
scored for a German-speaking non-specialist. No tool reports ambiguity, so there is no UX prior art
to copy — only override prior art. Whether to show two candidate readings side by side with sample
values, a count of decisive-evidence hits, or a confidence percentage — and whether a percentage is
even honest when the evidence count is zero — is undecided. Frictionless's `field_confidence` is the
wrong model.

---

## Open questions this research raised

1. **Does the canonical-number rule generalise beyond numeric columns?** `{"op":"gt","value":"2025-12-31"}`
   is the next thing an LLM will guess at, and FR-9 detects date locale per column too. A decision
   covering only numbers leaves the same hole one column type over.
2. **Does querbeet need precision beyond an IEEE-754 double** — cent-exact currency above 2⁵³, or long
   numeric identifiers as filter bounds? That is the single condition that promotes the string
   runner-up, and it should be answered before the format is frozen.
3. **When a model emits `"1.234,56"`, refuse or normalise with a visible warning?** FR-9's own stance
   — report rather than resolve — argues for refusal, but refusal punishes the Consumer for the
   Author's model. This is a real UX question.
4. **Must the `value` type agree with the column's recorded type at load time** — is a JSON number on
   a text-typed column an error? This decides whether value validation is a standalone check or a
   second consumer of the propagated schema `columns.js` already walks.

---

## Sources

**[M1]** Local measurement, 2026-08-01 — npm registry documents and published tarballs for
`@picocss/pico`, `tailwindcss`, `unocss`, `open-props`, `bulma`, `water.css`, `simpledotcss`,
`@vue-flow/core`; raw and `gzip -9` sizes, `@font-face` and `url()` audit.
`imports/css-artefact-measurement-2026-08-01.md`, reproduction script `imports/measure.sh`.

Raw run artefacts: `imports/run-1-deep-research-2026-08-01.json`,
`imports/run-2-deep-research-2026-08-01.json`, `imports/run-3-verification-2026-08-01.json`.

1. DuckDB — CSV auto detection. https://duckdb.org/docs/current/data/csv/auto_detection
2. DuckDB — CSV import overview. https://duckdb.org/docs/current/data/csv/overview.html
3. Microsoft — Set a locale or region for data (Power Query).
   https://support.microsoft.com/en-us/office/set-a-locale-or-region-for-data-power-query-d42b9390-1fff-413f-8120-d7df0ced20b9
4. Microsoft Learn — Power Query data types. https://learn.microsoft.com/en-us/power-query/data-types
5. Microsoft Learn — `Table.TransformColumnTypes`.
   https://learn.microsoft.com/en-us/powerquery-m/table-transformcolumntypes
6. Microsoft Learn — How culture affects text formatting.
   https://learn.microsoft.com/en-us/powerquery-m/how-culture-affects-text-formatting
7. LibreOffice — Text Import dialog.
   https://help.libreoffice.org/latest/en-US/text/shared/00/00000208.html
8. Frictionless Framework — Detector class.
   https://framework.frictionlessdata.io/docs/framework/detector.html
9. Frictionless Framework — `detector.py`.
   https://github.com/frictionlessdata/frictionless-py/blob/main/frictionless/detector/detector.py
10. Frictionless — issue #1689 (sample-size mis-inference).
    https://github.com/frictionlessdata/frictionless-py/issues/1689
11. MDN — `Intl.NumberFormat.prototype.formatToParts()`.
    https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/formatToParts
12. V8 — `Intl.NumberFormat`. https://v8.dev/features/intl-numberformat
13. Mike Bostock — Localized number parsing.
    https://observablehq.com/@mbostock/localized-number-parsing
14. Mozilla Bugzilla 1612379. https://bugzilla.mozilla.org/show_bug.cgi?id=1612379
15. Adobe — `@internationalized/number`, and its npm registry document.
    https://react-aria.adobe.com/internationalized/number/ ·
    https://registry.npmjs.org/@internationalized%2Fnumber
16. npm registry — `date-fns` (document and 4.4.0 tarball). https://registry.npmjs.org/date-fns
17. Luxon — API docs and parsing manual. https://moment.github.io/luxon/api-docs/index.html ·
    https://raw.githubusercontent.com/moment/luxon/master/docs/parsing.md
18. Day.js — CustomParseFormat plugin and string+format parsing.
    https://day.js.org/docs/en/plugin/custom-parse-format · https://day.js.org/docs/en/parse/string-format
19. d3-time-format. https://d3js.org/d3-time-format ·
    https://github.com/d3/d3-time-format/blob/main/src/locale.js
20. Microsoft Learn — Azure OpenAI structured outputs.
    https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs
21. MDN — `Temporal.PlainDate.from()` and Temporal browser compatibility.
    https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainDate/from ·
    https://github.com/mdn/browser-compat-data · https://caniuse.com/temporal
22. Anthropic — Strict tool use.
    https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/strict-tool-use
23. OpenAI — Structured outputs guide.
    https://developers.openai.com/api/docs/guides/structured-outputs
24. Data Package — Table Schema (v2). https://datapackage.org/standard/table-schema/
25. Frictionless — Table Schema (v1). https://specs.frictionlessdata.io/table-schema/
26. Frictionless Framework — number field. https://framework.frictionlessdata.io/docs/fields/number.html
27. Frictionless — issue #1005 (silent decimalChar mis-parse).
    https://github.com/frictionlessdata/frictionless-py/issues/1005
28. W3C — Metadata Vocabulary for Tabular Data (Rec, 17 Dec 2015).
    https://www.w3.org/TR/tabular-metadata/
29. W3C — Model for Tabular Data and Metadata on the Web. https://www.w3.org/TR/tabular-data-model/
30. JsonLogic — operations reference. https://jsonlogic.com/operations.html
31. JsonLogic — truthy. https://jsonlogic.com/truthy.html
32. MongoDB — BSON type comparison order.
    https://www.mongodb.com/docs/manual/reference/bson-type-comparison-order/
33. MongoDB — `db.collection.find()`, Type Bracketing.
    https://www.mongodb.com/docs/manual/reference/method/db.collection.find/
34. Elasticsearch — `coerce` mapping parameter.
    https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/coerce
35. OASIS — OData 4.01 ABNF construction rules.
    https://docs.oasis-open.org/odata/odata/v4.01/os/abnf/odata-abnf-construction-rules.txt
36. Tam et al., *Let Me Speak Freely? A Study on the Impact of Format Restrictions on Performance of
    Large Language Models*, arXiv:2408.02442v3. https://arxiv.org/abs/2408.02442
37. .txt — *Say What You Mean: A Response to "Let Me Speak Freely"*.
    https://blog.dottxt.ai/say-what-you-mean.html
38. Tailwind CSS — Preflight. https://tailwindcss.com/docs/preflight
39. Vue Flow — Theming. https://vueflow.dev/guide/theming.html
40. UnoCSS — Why UnoCSS? https://unocss.dev/guide/why
