---
title: 'Story 4a — Typing reaches the types a report actually holds'
type: 'feature'
created: '2026-08-02'
status: 'in-review'
review_loop_iteration: 3
baseline_commit: '7183651ab02fc630fe1f8e775a186a9c13c8bac8'
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
  - '_bmad-output/implementation-artifacts/spec-4-xlsx-parquet-sources.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Detection reaches three types — text, number, date — so a timestamp, a clock time, a `ja`/`nein` flag, a margin and an amount out of any ERP export are `text`, and the same table is typed as XLSX and untyped as CSV (CAP-9 remainder). Separately, a 19-digit order number is reported as `number`, settled, and loses its last digits at story 6's conversion — the C-10 defect, arriving through the text path story 4 already guards from the Parquet side.

**Approach:** Six pieces in the order their risk falls: (1) the `MAX_SAFE_INTEGER` guard for the text path, (2) datetime from text, (3) time from text — which extends AD-21 by a representation for a clock with no date and uses story 3's unresolved machinery for the clock-time/duration ambiguity, (4) boolean from text, (5) numbers carrying a percent or currency affix, (6) accounting negative forms. Every new type enters `core/types/catalog.js`, the single declaration story 4 established, and becomes settable there. Nothing here converts a value; story 6 owns that (AD-21, AD-22).

## Boundaries & Constraints

**Always:**
- **Catalogue only:** `time` and `duration` are new records in `core/types/catalog.js`; `datetime` and `boolean` flip `settable: true` there. `native` flags stay as they are — no reader declares `time` or `duration`, and the adapters are untouched.
- **(1) Overflow guard:** a value that reads as a number under a candidate but whose integer digits (sign and grouping stripped) exceed `Number.MAX_SAFE_INTEGER` — compared as digits, never through a float round trip — disqualifies the number reading for the **whole column**, exactly as one leading zero does: the digits are the information, and a column of order numbers is not half numeric.
- **(2) Datetime candidates**, a closed list this story: `yyyy-MM-ddTHH:mm`; `yyyy-MM-dd HH:mm`; `dd.MM.yyyy HH:mm`; `dd.MM.yy HH:mm`. **Four things are optional on every one of them, not on the ISO candidate alone:** seconds; a fractional second of 1–9 digits alongside seconds, written with `.` or `,`; a zone offset `Z` / `±HH:mm` / `±HHmm` / `±HH`; and a one- or two-digit hour. The clock behind a date is **never narrower** than the clock standing alone — an hour is not two-digit in one position and one-or-two in the other. It is deliberately *wider*: the fraction and the zone offset belong to a datetime and not to a bare clock, because `time` is `HH:mm(:ss)` and stays that. "Never narrower" is the invariant a test must pin in **both** directions — that the standalone reader refuses nothing the datetime reader accepts in the shared part, and that the extra part is exactly fraction and zone.
- **Why each of those is in the list, since each was a real column that read as text:** `2026-02-13 15:57:35.4616727` is SQL Server `datetime2(7)` and .NET; `2026-02-13 15:57:35.461+02:00` is Postgres `timestamptz`; `31.12.2025 9:05` is an ordinary German export; `2025-12-31t14:30:00z` and `…+02` are legal ISO 8601. **A candidate named `ISO 8601` must accept ISO 8601** — naming a strict subset after the standard puts the same lie in the reading select that spelling it as a pattern would. Nine fractional digits is exactly the representation's resolution, so the cap is the representation rather than an arbitrary limit; a tenth digit is not readable. The `MM/dd` datetime mirror stays deliberately absent — a candidate enters with a real Source that needs it, the same rule `NUMBER_LOCALES` already follows.
- **Century rule (spec-owned, not code-chosen):** a two-digit year `yy` reads as `20yy` for `00–29` and `19yy` for `30–99` — Excel's fixed pivot, so the office ecosystem querbeet replaces agrees with it. Never a sliding window: a Recipe re-run in a later year must read the same date. Applies to `dd.MM.yy` (new date pattern) and `dd.MM.yy HH:mm(:ss)`.
- **Three two-digit parts settle nothing.** A `dd.MM.yy` column in which **every** value has all three parts two-digit — `01.02.03`, `04.05.06` — is `unresolved`, not `settled`: it can be a date, and nothing in the column decides whether it is one. Version numbers, chapter numbers and part numbers have exactly this shape, and before this story they read as `text`; a settled date is a *worse* answer than the one they used to get. The user chooses date or text and the gate stays shut until they do — story 3's machinery, on the case it was built for. **Two things settle such a column, and both are evidence in the values rather than a preference:** a day past twelve settles it as a date, because `31` is no month and no version number counts that way by accident — which is why `31.12.25`, the shape the owner actually asked for, is unaffected; and a triple that cannot be a date at all settles it as text, because `01.13.03` is a version number and nothing else. Only triple-shaped values are asked this question, so one stray word beside twenty real dates is still twenty dates and one unparsed value.
- **(3) Time and duration:** `time` is `HH:mm(:ss)`, hours 00–23 (1 or 2 digits), minutes/seconds two digits ≤ 59; `duration` is the same shape with hours unbounded (any digit count). Every time-readable value is duration-readable, so: a value at or past `24:00` is exclusive evidence and settles the column as `duration` through story 3's decisive machinery; a column where nothing passes `24:00` is `unresolved` between the two — the user answers via the type select, and no default is picked quietly.
- **AD-21 is amended** (task, planning artifact) and the resolution is **nanoseconds, held as `BigInt`, in all four temporal types**: a date column holds UTC-midnight epoch nanoseconds, a datetime column UTC epoch nanoseconds, a time column nanoseconds since midnight, a duration column plain nanoseconds. **One unit for all four, deliberately** — a split rule would make a date-against-datetime join a unit conversion, which is the class of error AD-21 exists to prevent. `BigInt` rather than `Number` because 100-nanosecond ticks are already past `Number.MAX_SAFE_INTEGER` today (`1,77e16` against `9,007e15`); microseconds are the last exact `Number` and cover only six of `datetime2(7)`'s seven digits, so they would buy the same architectural change for an answer that is still wrong. The cost is named rather than discovered: `BigInt` and `Number` do not mix in arithmetic, so the `TableEngine` adapter absorbs it (AD-19) and story 14's serializer spells it out, because JSON has no `BigInt`.
- **(4) Boolean pairs:** `true`/`false`, `wahr`/`falsch`, `ja`/`nein` (word pairs case-insensitive, so German Excel's `WAHR`/`FALSCH` is the same pair), `1`/`0`. **A pair never mixes with another, and the rule is unconditional rather than scored** — a column in which values read under two different pairs is not a boolean column at whatever ratio: `boolean` is disqualified for the **whole** column, the column is `text`, and a warning names both pairs, exactly as two affixes do. Nineteen `ja` beside one `false` is the same finding as one beside one; a threshold would make the guarantee true at 50/50 and false at 95/5, and "a pair never mixes" is either a rule or it is a tendency. The `1`/`0` pair takes part in this like any other, so `1`, `0` beside `ja` disqualifies `boolean` while the number reading of `1` and `0` is untouched and `ja` counts unparsed. **The 1/0 rule:** `1`/`0` is also a perfectly good number, so a column readable as both proposes `number` — the reading that loses less — and `boolean` stays one settable choice away. Word pairs propose `boolean` outright.
- **(5) Affix:** recognized affixes are `%`, `€`, `$` — decisive markers with no second reading; prefix or suffix, with or without one space. The stored number is the number in the field (`12,5` for `12,5 %`, never `0,125`); the affix rides on the column record as a property and never alters a cell. Every parsed value must carry the column's one affix — a bare number in an affixed column counts unparsed. A column mixing two affixes is `text` plus a warning naming both; the number in front carries only the ordinary de/en question.
- **(6) Accounting signs:** `(1.234,56)` and `1.234,56-` read as negative numbers under both locales, combinable with an affix; a value carrying two sign marks is unreadable. The sign is part of the one reading rule in `typing.js` that story 6 converts with — stripping parentheses without carrying the sign flips the value, and that is the one wrong-number defect this story can produce. **Because it is that, the two accounting forms need column-wide evidence and are not read off a single value:** the parenthesis and trailing-minus forms count only in a column where at least one value carries a decimal or grouping mark under the candidate being scored. `4711-` is an ERP part number and `(1)` is a footnote marker, and both would otherwise be settled, fully-readable negative numbers — a *wrong* number, which is worse than an untyped column and is exactly why the leading-zero guard and the overflow guard already judge the whole column on one value. A column of `(500)` and `(750)` with nothing else in it is therefore `text`; the cost is named rather than discovered, and it is the same trade those two guards already make. The ordinary leading `-` is unaffected — `-500` is not an accounting form and needs no column to vouch for it.
- **Cross-kind proposal:** kinds are scored independently and the highest hit rate at or above the 0.9 threshold proposes. **A tie goes to the kind declared first, and the declaration order is the rule** — `number`, `date`, `datetime`, clock, `boolean` — so "a tie goes to `number`" is what that order produces while a number reading is in the running, and the order still answers the case where it is not (a leading zero, an overflow or two affixes disqualify the number reading, and something has to break the tie among what is left). The order is the rule because a tie means the values do not distinguish the kinds, so the only honest tie-break is a stated preference rather than a computed one. AD-13 holds: codes from `core/`, German only in `ui/`, and a type without a German word is a failing test.

**Ask First:** any candidate, pair or locale beyond the lists above (month names, space grouping, a fifth boolean pair); changing the catalogue record shape beyond adding records and flipping flags; any new dependency.

**Never:** converting values (story 6 — AD-21, AD-22); writing affixes back on export (story 13); Recipe serialization (story 14); touching `adapters/` — Parquet `TIME` stays a refused declaration; sampling (CAP-9); a sliding century window. Deliberately out and recorded elsewhere: **month names are story 4b** (`stories.yaml`), opened by a real Source after this story was cut — the same rule `NUMBER_LOCALES` follows; space grouping is an open `deferred-work.md` entry, still waiting on one; exponential notation, ISO weeks/quarters and `integer` as a type are cut in that file's closed triage entry.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 19-digit order number | `1234567890123456789` | column stays `text` — digits are the information | N/A |
| Overflow with grouping | `9.007.199.254.740.993` (de) | number reading disqualified, `text` | N/A |
| ISO datetime | `2025-12-31T14:30:00Z`, offsets, fractions | `datetime`, settled | N/A |
| ISO with space | `2025-12-31 14:30:00` | `datetime`, settled | N/A |
| SQL Server `datetime2(7)` | `2026-02-13 15:57:35.4616727` | `datetime`, settled — space and seven digits both carried | N/A |
| Fraction on a German shape | `31.12.2025 14:30:00.123` | `datetime`, settled | N/A |
| Fraction past the resolution | one `…35.4616727891` (10 digits) among nine readable | not readable — counts unparsed, column stays `datetime` | `typing.unparsed_values` |
| Postgres `timestamptz` | `2026-02-13 15:57:35.461+02:00` | `datetime`, settled — offset carried on the space form | N/A |
| One-digit hour behind a date | `31.12.2025 9:05` | `datetime`, settled — same clock the `time` reader accepts | N/A |
| Legal ISO the candidate refused | `2025-12-31t14:30:00z`, `…T14:30:00+02`, `…,461Z` | `datetime`, settled — the candidate is named for the standard | N/A |
| Three two-digit parts | `01.02.03`, `04.05.06`, `07.08.09` | `unresolved` between `date` and `text`; gate shut until chosen | N/A |
| Two-digit year that settles itself | `31.12.25`, `01.03.26` | `date`, `dd.MM.yy` — `31` is no month, so the column decides | N/A |
| German datetime | `31.12.2025 14:30` | `datetime`, settled | N/A |
| Two-digit year | `31.12.25` | `date`, `dd.MM.yy`, century rule → 2025 | N/A |
| Century pivot | `01.01.29` / `01.01.30` | 2029 / 1930 | N/A |
| Clock times only | `08:15`, `17:20` | `unresolved` — time vs. duration, gate blocked until the user chooses | N/A |
| Duration evidence | same column plus `36:15` | `duration`, decisive, count named | N/A |
| Not a time | `24:00`, `12:60` | `24:00` duration-only evidence; `12:60` reads as neither | N/A |
| German boolean | `ja`, `Nein`, `k.A.` | `boolean`, `ja/nein` pair, `k.A.` missing | N/A |
| German Excel boolean | `WAHR`, `FALSCH` | `boolean`, `wahr/falsch` pair — case-insensitive | N/A |
| Pairs mixed | `ja`, `false` | `text` — a pair never mixes with another | warning naming both pairs |
| Pairs mixed at a majority | nineteen `ja`, one `false` | `text` — the rule is unconditional, not scored | warning naming both pairs |
| Numeric pair beside a word pair | nineteen `1`/`0`, one `ja` | `boolean` disqualified; `number` still reads the nineteen, `ja` unparsed | warning + `typing.unparsed_values` |
| The same three cells and nothing else | `1`, `0`, `ja` | `text` — `boolean` is disqualified and the number reading covers 2 of 3, under the 0.9 threshold | warning naming both pairs |
| Numeric boolean | `1`, `0` only | proposed `number`; `boolean` settable | N/A |
| Percent | `12,5 %`, `80%` | `number`, affix `%`, stored text unchanged | N/A |
| Currency prefix | `$1,234.56` (en) | `number`, affix `$` | N/A |
| Mixed affixes | `12 €` and `12 $` | `text` + warning naming both | warning diagnostic |
| Bare value in affixed column | one `13` among twenty `12,5 %` | `13` counts unparsed | `typing.unparsed_values` |
| Accounting negatives | `(1.234,56)`, `1.234,56-` | read as negative numbers, one warning-free column | N/A |
| Accounting form with no column evidence | `4711-`, `4712-` — and `(1)`, `(2)`, `(3)` | `text` — no value in the column carries a decimal or grouping mark, so neither form is an accounting sign | N/A |
| Accounting column that vouches for itself | `(1.234,56)`, `(500)` | both negative — one value carrying grouping is the column's evidence | N/A |
| Ordinary leading minus | `-500`, `-750` | negative numbers — not an accounting form, needs no column evidence | N/A |
| Double sign | `(1.234,56-)` | unreadable, counts unparsed | N/A |
| Regressions | leading zero, `1.23.456`, de/en ambiguity | behave exactly as story 3 shipped them | N/A |

</frozen-after-approval>

## Code Map

Line anchors are as shipped after review round 3.

- `core/types/catalog.js:45` — `TYPES`: `time`, `duration` (`settable: true`, `native: false`); `settable` flipped on `DATETIME`/`BOOLEAN`. `canonicalTypeGaps` filters on `native`, so no `CANONICAL` entry is owed. `catalog.test.js` pins the flags and that no reader may declare a clock.
- `core/types/typing.js` — the whole story lives here. `DATE_PATTERNS:116` (+ `dd.MM.yy`); `DATETIME_PATTERNS:170` (four candidates, everything optional on every one of them); `BOOLEAN_PAIRS:186` (+ `BOOLEAN_TOKEN_MAX` derived from it); `CLOCK_CANDIDATES:212` (two candidates of one kind, so `score`/`exclusive` answer time-vs-duration verbatim); `AFFIXES:222`; `MARKS:252` (derived — `:` and the affixes feed it, or narrowing silently disables candidates); `peelWrappers:357` (the sign and the unit, from the outside in, in either order — the sign counted and carried) gated by `carriesAccountingEvidence:412`, so the two accounting forms are read only where the column vouches for them; `numberParts:444`, **exported for story 6**, returning `{ digits, fraction, negative }` — enough to rebuild the value, which is what the export is for; `readsAsNumber:476`, `exceedsSafeInteger:492` (integer digits, never a float round trip) and `hasLeadingZero:507`, which peels the accounting spellings unconditionally because it hunts hidden zeros rather than proposing a reading; `readsAsDate:525` (width table gets the 2-digit year); `readsAsClockTime:587`/`readsAsDateTime:602` (one clock, never narrower behind a date, wider by exactly fraction and zone); `affixScan:635`; `detectColumn:810`, `mixedBooleanPairs:884` disqualifying the boolean kind unconditionally at `:941`, and `found:957` — the closure that merges both column-wide findings into every post-scan return, so the field cannot be carried on one route and forgotten on another; `shortYearVerdict:1065` (three two-digit parts settle nothing); `candidatesFor:1101` + `bestFormat:1165` learn datetime patterns and boolean pairs, and `bestFormat` reads the column's unit before it ranks the readings; `scoreColumn:1177` re-scores every new kind and re-derives the affix and the accounting evidence together.
- `core/types/typing.test.js` — every matrix row above, per piece; regression block for story 3 verdicts; `scorableTypeGaps` and `canonicalTypeGaps` as the two completeness invariants; the carried sign in all four spellings and both nestings.
- `core/exec/source-store.js:41` — `typingDiagnostics` (exported, because story 14 will hand it a typing this file did not build): `typing.mixed_affixes` and `typing.mixed_boolean_pairs:89`, both reported whatever kind wins, and the kind-ambiguity state emitting `typing.ambiguous_kind` rather than overloading `typing.ambiguous_locale`. `resolveFormat:583` keys on `pattern ?? locale` and refuses a reading no candidate offers — with no early return for any type, since `bestFormat` already answers `null` where there are no candidates. `setColumnTyping:623` needs no change: settability comes from the catalogue.
- `ui/type-labels.js:15` — `Uhrzeit`, `Dauer`; completeness test `typeLabelGaps` already bites.
- `ui/SourcesPane.vue` — `patternLabel:238` gains `yy → JJ`; `readingLabel:262` learns datetime patterns and boolean pairs; `isKindQuestion:268`/`typeUndecided:275` put the placeholder on the **type** select *and* suppress the reading select while a kind question is open; `verdictText:331` words a kind question as a type and now returns `''` on a record whose evidence is absent or half-filled, the same hardening `typingDiagnostics` already had — a restored record with nothing to say renders nothing rather than throwing or printing a sentence with a hole in it; the German sentence for `typing.mixed_boolean_pairs:197` names both pairs and does not claim the column is read as text; the card shows a column's affix. `ui/SourcesPane.test.js` covers wording, both placeholders, the suppressed select, the affix render and the empty-evidence record.
- `tests/e2e/typing.spec.js` — four journeys: the ERP export (timestamp, clock-time, ja/nein, percent, accounting) resolving time vs. duration and opening the gate; duration settling itself beside a mixed-unit column; the timestamps SQL Server, Postgres and ISO 8601 actually write; and the version-number column that must be asked about rather than dated.
- `_bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md:168` — AD-21 amendment (nanoseconds as `BigInt`, one unit for all four temporal types).
- `_bmad-output/implementation-artifacts/deferred-work.md` — ten open story-4a entries: the Parquet reader's own rounding, the missing `MM.dd.yy` mirror, `shortYearVerdict`'s `dmy` assumption, fractional-part precision, negative durations, the unconditional mixed-affix rule, the boolean-pair narrowing (which reads with the detection-cost entry, not instead of it), and three from round 3 — the two-digit year reaching one separator and one order (with the unreachable `ymd` branch that follows from it), the legal ISO 8601 the `ISO 8601` candidate still refuses, and the zone offset that accepts hours no zone has.
- `_bmad-output/specs/spec-querbeet/stories.yaml` — story 14 gains the three record fields this story added (`affix`, `mixedAffixes`, `evidence.over`) plus the `BigInt` encoding, as things an older Recipe will lack.
- `README.md` — the story count, and a bullet for the types a report actually holds.

## Tasks & Acceptance

**Execution:**
- [x] `ARCHITECTURE-SPINE.md` — amend AD-21: nanoseconds as `BigInt` in all four temporal types (date, datetime, time, duration), one unit for all of them.
- [x] `core/types/catalog.js` + test — `time`, `duration`; settable flips.
- [x] `ui/type-labels.js` — `Uhrzeit`, `Dauer`.
- [x] `core/types/typing.js` + test — piece 1: overflow guard beside `hasLeadingZero`.
- [x] `core/types/typing.js` + test — piece 2: datetime candidates, `dd.MM.yy`, century rule.
- [x] `core/types/typing.js` + test — piece 3: time/duration with the unresolved machinery.
- [x] `core/types/typing.js` + test — piece 4: boolean pairs and the 1/0 rule.
- [x] `core/types/typing.js` + test — pieces 5+6: affix and accounting signs, five-kind competition.
- [x] `core/exec/source-store.js` + test — diagnostics (`typing.mixed_affixes`, `typing.ambiguous_kind`), format resolution for the new kinds, affix survives `setColumnTyping`.
- [x] `ui/SourcesPane.vue` + test — labels, ambiguity wording, affix on the card.
- [x] `tests/e2e/typing.spec.js` — the journey above, both engines.
- [x] `deferred-work.md` — close the sub-ms entry with the decision.
- [x] `core/types/typing.js` + `core/exec/source-store.js` + `ui/SourcesPane.vue` + tests — round 3: boolean contamination unconditional with `typing.mixed_boolean_pairs`; accounting signs gated on column evidence; `numberParts` returns the fraction.
- [x] `core/types/typing.js` + `ui/SourcesPane.vue` + tests — round 3: the forgotten `mixedAffixes` route, the unpinned `affix` suppression, the stale `peelSign` docblock, and the UI's unguarded `evidence` reads.
- [x] `ARCHITECTURE-SPINE.md`, `stories.yaml`, `README.md` — round 3: the amended AD-21 reaches the Conventions row and the story 3/4a/6 briefs; the README says what runs today.

**Acceptance Criteria:**
- Given the type vocabulary, when `time` and `duration` are added, then they are declared in `core/types/catalog.js` and nowhere else — no second list anywhere restates the types.
- Given a column of clock times with no value past 24:00, when detection runs, then the Source cannot be confirmed until the user chooses `Uhrzeit` or `Dauer` — the gate blocks on `unresolved` exactly as for the locale case.
- Given an affixed column with a user-overridden reading, when `setColumnTyping` re-scores it, then the affix property survives on the record.
- Given `numberParts`, when it reads a value, then its return carries everything story 6 needs to rebuild that value — the integer digits, the fractional digits, and the sign — so that `12,5` and `12` are distinguishable in the return and no second parser is owed.
- Given a column in which values read under two different boolean pairs, when detection runs, then `boolean` is disqualified for the whole column and a warning names both pairs, at any ratio.
- Given a column whose only sign marks are parentheses or trailing minuses and in which no value carries a decimal or grouping mark, when detection runs, then no value reads as a negative number.
- Given the story-3 test suite, when this story lands, then every existing verdict, count and diagnostic is unchanged.
- Given `npm run verify`, then lint, both Vitest projects and Playwright (Chromium + Firefox, `file://`) pass.

## Spec Change Log

### 2026-08-03 — review round 3: the fix for round 2 left its own comment behind, and three rules the owner tightened

Three context-free layers ran again on `git diff 7183651..HEAD` — the same three that were not
exhausted after two rounds. Twenty-five claims; every one re-measured against the shipped tree
before triage, five rejected as measured non-defects or duplicates.

**The round-2 fix produced the round-2 defect one function to the left.** `peelSign` was replaced
by `peelWrappers`, and its entire docblock stayed behind — `typing.js:307-320` still reads "The
sign is returned, never discarded … story 6 converts through this same function precisely so the
peeling and the carrying cannot come apart", and it now sits directly above the JSDoc for
`peelAffix`, which peels no sign, counts no sign and returns no sign. Two docblocks on one
function, the stale one repeating the exact promise that round 2's change log calls "a reassuring
sign in front of a trap". The change log's own sentence "`peelSign` and `peelAffix` are gone as
separate passes" is also false: `peelAffix` is alive at `typing.js:325` and is called from inside
`peelWrappers`'s loop. Third round in which a prose claim about this file did not survive
measurement.

**`numberParts` is exported for story 6 and cannot serve story 6 — decided: widen the return.**
Measured: `numberParts('12,5', de)` → `{digits:'12', negative:false}`, and `numberParts('0,5',
de)` is byte-identical to `numberParts('0', de)`. The fraction is discarded outright, so story 6
cannot rebuild a value from the return and must write the second parser the export exists to
prevent. `.negative`, the round's headline fix, has no production consumer at all: it is read
only inside `numberParts` and in tests, while the one production caller reads `.digits`. The
owner's choice is to widen the return so it carries the integer digits, the fractional digits and
the sign — the contract is cheapest to fix before story 6 exists, and correcting the docblock
instead would have left the export buying nothing.

**Two frozen rules were tightened by the owner, both because a threshold was standing where a
rule was claimed.**

(1) *Boolean contamination is now unconditional.* Measured: `[...19× 'ja', 'false']` was
`boolean`, `ja/nein`, `decisive`, one unparsed, while the frozen block said "a pair never mixes
with another — `ja` beside `false` is text" and the sibling affix rule one paragraph away is
genuinely unconditional. Two contaminations of identical shape got opposite answers, and the only
test was the 50/50 case. The guarantee is now what it claimed to be: two pairs present
disqualifies `boolean` for the whole column at any ratio, `text` plus a warning naming both,
mirroring the affix rule field for field.

(2) *The accounting sign now needs column-wide evidence.* Measured: `['4711-','4712-']` was
`number`, `settled`, 2 of 2 readable — −4711 and −4712 — and `['(1)','(2)','(3)']` was −1, −2 and
−3. An ERP part number and a footnote marker became confident negatives. The one rule the story
names as "the one wrong-number defect this story can produce" had the loosest guard in the file:
the only rule applied per value, where the leading-zero guard and the overflow guard both
disqualify the whole column on a single value precisely because a wrong number is unrecoverable.
The parenthesis and trailing-minus forms now count only where some value in the column carries a
decimal or grouping mark. The ordinary leading minus is untouched.

**A field forgotten on one of three sibling routes, in the commit that added the helper written to
stop that.** `detectColumn`'s short-year `unresolved` return omits `mixedAffixes` where both its
siblings pass it: measured, `[...18× '01.02.03', '12 €', '12 $']` returns `mixedAffixes: null`
while the four-digit twin and the short-year *text* twin both return `['€','$']`. `record()`
exists by its own comment because "spelling the shape out at each of them is how a field gets
forgotten on one route and carried on another", and round 2's change log claims this loss was
already closed.

**The amended AD-21 did not reach the two documents that carry it out.**
`ARCHITECTURE-SPINE.md:240` still says a date is "UTC-midnight epoch **milliseconds** in a Table
(AD-21)", seventy lines below the AD-21 body this story rewrote to nanoseconds as `BigInt` — the
load-bearing document contradicting itself on the one decision the story renegotiated. And
`stories.yaml:185` still briefs **story 6, the story that performs the conversion**, with "epoch
ms (AD-21)"; story 4a's own entry at `:82` still says a clock time needs "milliseconds since
midnight". Story 14's brief was updated in this diff; story 6's was not. Round 2's boast about
fixing "milliseconds in three places" covered this spec file only.

**One mutation survives and one guard shipped half.** Removing the `affix: type === NUMBER ? affix
: null` suppression leaves 351 of 351 tests green — measured — so a date column carrying one
`12 €` could render `Einheit: €` under a card typed `Datum` with nothing to catch it. And
`source-store.js` gained `evidence ?? null` in this diff, explicitly because a restored record
with no evidence "would take the whole read down here", while `SourcesPane.vue:305/313/177`
dereference `evidence.alternatives`, `decidedBy` and `contested` unguarded on the same records.

**Rejected after measurement, so the next round does not re-raise them.** `bestFormat` returning a
candidate that reads nothing is the documented design, not a defect — the counts then report 0 of
N, which is the honest answer its own docblock argues for. The `typing.unparsed_values` wording
"unter dem gewählten Typ" is a recorded round-1 decision and is true for every column. The
hard-coded 2.08 s → 3.96 s figure is complained about in the sentence that already says the
absolutes are hardware and the ratio is the finding.

**Deferred with entries rather than fixed:** the two-digit year exists on `.` and `dmy` only, so
`31/12/25` and `31-12-25` are `text` while their four-digit twins are dates — and
`readsAsDate`'s `ymd`+`shortYear` branch is therefore unreachable; the candidate named `ISO 8601`
still refuses `2025-12-31T24:00:00Z`, basic format, week dates and ordinal dates; and the zone
offset accepts `+23:59` where no zone passes ±14:00. All three widen or bound a frozen list and
are Ask First.

**The owner's three named open risks, re-measured.** `peelWrappers` holds: `1.234,56-€`,
`€-1.234,56`, `-€ 1.234,56`, `€(1.234,56)` and `1.234,56 €-` all read as −1234 while
`(1.234,56)-` and `-(1.234,56)` are refused, so order-independence is real and the two-mark rule
is its only boundary. `01.13.03` → `text` reproduces exactly as reported. The `numberParts`
contract risk was real and is the sharper finding above.

**Known-bad state avoided.** Story 6 briefed in three documents with the unit its own architecture
decision overturned, converting through an exported parser that cannot rebuild the values it
reads; and a part-number column silently reported as fully-readable negative numbers by the one
rule the story calls its worst case.

**KEEP.** Everything the three rounds established: the nanosecond representation, the
digit-comparing overflow guard, the restructured clock reader and its never-narrower invariant,
the two-digit-triple question with both settling mechanisms, the order-independent `peelWrappers`
loop and its two-mark rule, the four boolean pairs, the affix scored as a candidate, and the
type-select placeholder.

### 2026-08-03 — review round 3, as built: one closure instead of three careful returns, and a matrix row of mine that was wrong

**The forgotten field was fixed by removing the way it can be forgotten.** Rather than adding
`mixedAffixes` to the one return that lacked it, `detectColumn` gained `found:957` — a closure
that merges both column-wide findings into every post-scan return. `record()`'s comment said
spelling the shape out at each return "is how a field gets forgotten on one route and carried on
another", and the round that added the helper proved it on its own commit; now there is one
spelling and the routes differ only in what they override. `mixedBooleanPairs` was born into that
closure rather than threaded through the returns after it.

**The accounting evidence travels the route the affix already travels.** The column's marks reach
the per-value reader through `readerFor(type, affix, present)` and a fourth `accounting` argument
on `numberParts`, the same way the column's one affix already reached it — no module state, no
second route, and the detection path and `scoreColumn` agree by construction rather than by two
matching edits. `hasLeadingZero` deliberately keeps peeling the accounting spellings
unconditionally: it hunts hidden zeros rather than proposing a reading, so peeling less would
only bury them.

**`numberParts`'s new `accounting` argument defaults to `false`, and that is a behaviour change
for a direct caller.** `numberParts('(1.234,56)', de)` now returns `null` where it returned a
negative. That is the honest default — a caller with no column behind it cannot invent an
accounting column — but it is a fact about the exported contract story 6 will meet, so it is
recorded here rather than left in a docblock.

**A row in my own I/O matrix was wrong and is corrected.** I specified `1`, `0`, `ja` as three
cells with the outcome "`number` still reads `1`/`0`, `ja` unparsed". Measured before *and* after
the change: that column is `text`, because the number reading covers 2 of 3 = 0.667, under the
frozen 0.9 threshold. The row now carries both cases — nineteen numbers and one `ja` for the
outcome I meant, and the three-cell column for what those three cells actually do. Same class as
round 2's `12,5`, `13` correction: a matrix row written to illustrate a rule, stating a hit rate
its own cells cannot produce. The implementer flagged it rather than adjusting the threshold to
match my sentence, which is the right way round.

**Verified after the change**, not asserted: `npx eslint .` clean; `npx vitest run` 365 tests
across 11 files, from a baseline of 351; `npx playwright test` 111 passed, 1 skipped. Three
mutations were run and each now fails — the `affix` suppression on non-number kinds (1 failure),
the unconditional boolean disqualification (2), and the accounting evidence gate (2).

### 2026-08-02 — review round 2: the sign that was not carried, and two frozen sentences of mine that were false

**The worst finding is the one the story named as its own worst case, arriving through the door nobody watched.** `numberParts` peels an ordinary leading minus and does not carry it: `-1.234,56` returns `{ digits: '1234', negative: false }`. Detection is unaffected, because it only counts what reads — but the doc comment directly above says "the sign is returned, never discarded. Stripping the parentheses and dropping what they meant is the one wrong-number defect this story could produce", and it says story 6 converts through this function "precisely so the peeling and the carrying cannot come apart". That function is **not exported**, so story 6 cannot reach it, and **no test asserts `negative` at all** — not for the plain minus, and not for the parenthesised and trailing-minus shapes that do compute it correctly. A trap with a reassuring sign in front of it is worse than an absent guard.

**A second sign shape fails outright.** `-$1,234.56` reads as `text` while its suffix twin `-1.234,56 €` reads as a number — measured. `peelSign` handles only parentheses and a trailing minus, and `peelAffix` then wants the affix at the very start of what is left. Excel's own default rendering of a negative currency amount is the prefix form, so the story's flagship "amount out of any ERP export" case fails on one of its two spellings.

**Two sentences in the Frozen block were mine and were false; both are corrected here rather than defended.** (1) "The clock behind a date must read *exactly* what the clock reads standing alone" — the datetime clock is a deliberate superset, because a fraction and a zone belong to a datetime and not to a bare `HH:mm(:ss)`. `08:15:30.123` standing alone is `text`, measured, and that is correct. The invariant that was actually meant is **never narrower**, and the test written to guard the symmetric claim only pinned the direction in which it held — coverage-shaped, and false. (2) "A tie goes to `number`" is only what the declaration order produces while a number reading is in the running; where a leading zero, an overflow or two affixes disqualify it, the frozen rule had no answer and the code quietly supplied one. The order is now the stated rule, with the reason: a tie means the values do not distinguish the kinds, so the only honest tie-break is a declared preference rather than a computed one.

**Silent losses of a warning, both measured.** A column of eighteen German dates plus `12 €` plus `12 $` proposes `date` with `mixedAffixes: null` — the two-units finding disappears whenever any other kind clears the threshold, and the two amounts survive only as an anonymous unparsed count. And an `unresolved` date-or-text column renders **two** placeholder selects, where answering the *reading* select settles the column as `date` and opens the gate: `over: 'kind'` exists precisely so the card cannot point at a control that fails to answer the question, and here it points at one that answers it wrongly.

**Three claims in the prose did not reproduce, one of them inside the paragraph that exists to be honest about numbers.** `MARKS` grew from **4 to 8**, not "five to nine" — recomputed from the sources — and that sentence sits three lines from a correction of story 3's stale timing. The ledger's `03.04.25` entry says the column "is settled silently"; measured, it is `unresolved` with alternatives `['date','text']`, which is a narrower and different finding. And an I/O matrix row of mine specified `12,5 %`, `13` as two cells, where the hit rate is 0.5 and the column is `text` with nothing unparsed — corrected to twenty values and one bare number.

**Four mutations survive the suite**, each reported with the mutation that proves it: the affix-aware `bestFormat` (remove it and an affixed column retyped to `Zahl` reports 0 of 2 readable), the mixed-affix disqualification (every fixture is below the threshold anyway, so the rule is never what produces `text`), the overflow guard's grouping strip (keep the separators and ordinary 13-digit grouped amounts drop to `text`), and the zone offset's minute bound (`+02:99` becomes a settled instant).

**Known-bad state avoided.** Story 6 inheriting a sign-dropping parser blessed by a comment that told its author not to worry; and a Source card inviting a user to answer "Datum oder Text?" in a control that can only say "Datum".

**KEEP.** Everything the last two rounds established: the nanosecond representation, the digit-comparing overflow guard, the restructured clock reader, the two-digit-triple question and its two settling mechanisms, the four boolean pairs, and the type-select placeholder.

### 2026-08-02 — review round 2, as built: the sign now travels, and one nesting rule was replaced by none

**The sign is counted and carried in one place, and that place is exported.** `peelSign` and `peelAffix` are gone as separate passes; `peelWrappers` peels both from the outside in until nothing more peels, and `numberParts` — now `export`ed — returns `{ digits, negative }`. Three spellings say negative and each is one sign mark: parentheses, a trailing minus, and an ordinary leading minus, which is the one that was being dropped under a comment promising it was not. Two marks is still not a number, and the leading minus joining the rule is what makes `-1.234,56-` and `(-1.234,56)` refusals rather than accidents.

**The nesting rule was not fixed, it was removed.** `-$1,234.56` (Excel's own negative dollar) failed while `-1.234,56 €` read, because the sign was peeled strictly outside the affix. Rather than enumerate the nestings someone thought of, the loop runs until neither a sign nor an affix is on either end — so `$-1,234.56`, `€ (1.234,56)`, `(1.234,56 €)` and `1.234,56 €-` all read, and the composition is order-independent by construction. It terminates because every branch shortens the body or claims the one affix.

**Two findings that were being lost, both kept now.** The mixed-affix warning survives whatever kind wins the column — eighteen German dates beside `12 €` and `12 $` are still a date column with two amounts nobody can add up in it — and its German sentence no longer claims the column is read as text, because sometimes it is not. It still ends where its condition ends: a user who chooses `number` has closed the question, and what the choice costs is the unparsed count. And an `unresolved` date-or-text column no longer renders a second placeholder: the reading select is suppressed while a kind question is open, because answering it sent `{type:'date', format}` and opened the gate on the question it was supposed to be asking.

**`resolveFormat` had the same hole twice.** Round 1 closed the early return for `time`/`duration`; the one for `text` was still there, so `{type:'text', format:{pattern:'nonsense'}}` was accepted in silence. Both are gone: `bestFormat` already answers `null` for a type with no candidates, so no type needs a special case.

**Three numbers in the prose were wrong and are corrected.** `MARKS` grew from **four to eight** (`. / - ,` plus `: % € $`), recomputed from the sources — and that sentence sat inside the paragraph headed "THE NUMBER HERE IS THE HONEST ONE". The ledger's `03.04.25` entry claimed the column "is settled silently"; measured, it is `unresolved` between `date` and `text`, so the entry is restated as the narrower finding it actually is — a *settled* two-digit-year column never faces the day-month ordering question its four-digit twin does. And the ledger's performance entry had grown a `measured:` key no other entry has, which `bmad-loop-sweep` parses; it is folded back into `evidence:`.

**Four mutations that survived now fail**, each with the case that names it: affix-aware `bestFormat`, the mixed-affix disqualification (with a fixture where the dominant unit *does* clear 0.9 — nine `12 €` and one `12 $`), the overflow guard's grouping strip (pinned in the direction that must not trip: thirteen grouped digits stay a number), and the zone offset's minute bound. The "never narrower" invariant is pinned in both directions, including that the datetime clock is wider by exactly fraction and zone and nothing else.

**Deferred rather than fixed, each with an entry:** fractional-part precision loss (the Frozen block scopes the guard to integer digits, so code matches spec and widening it is the owner's); negative durations (`-01:30`, waiting on a Source exactly as space grouping is); `shortYearVerdict`'s `dmy` assumption (a guard for a candidate that does not exist is a guard nobody can test); and the boolean-pair narrowing, which the owner decided is not this story's — the argument is good and the win is unmeasured, and no route out of detection's cost gets chosen by feel.

### 2026-08-02 — review round 1: what three layers found, and the one answer that was worse than the question

**The finding that mattered most is a regression in honesty.** `['01.02.03', '04.05.06', '07.08.09']` read as `date`, `dd.MM.yy`, **`settled`** — measured. Version numbers, chapter numbers and part numbers became confirmed dates with no question raised. Before this story they were `text`, so the two-digit year the owner asked for bought a *worse* answer than the one those columns already had. Put to the owner with three options; he chose the one that uses the machinery already in the file: a `dd.MM.yy` column whose values are **all** three-part two-digit is `unresolved`, and the person decides. `31.12.25` is untouched, because `31` is no month and the column settles itself.

**Three more shapes read as text, all of them the owner's own bug one field further right.** The last renegotiation fixed a fractional second on the space-separated form and left everything else on that form alone: `2026-02-13 15:57:35.461+02:00` (Postgres `timestamptz`) had no offset, `31.12.2025 9:05` had no one-digit hour — while `9:05` standing alone read perfectly well as a time. And the candidate *named* `ISO 8601` refused lowercase `t`/`z`, a two-digit offset `+02`, and the comma decimal the standard allows. Naming a strict subset after a standard puts the same lie in the reading select that the code comment says spelling it as a pattern would. All four are now in the Boundaries as one closed list, with each shape's real-world producer named beside it, so the next reader does not have to rediscover why a line is there.

**What was amended.** Both changes are inside the Frozen block and both are the owner's: the datetime candidate list gained optional seconds, fraction (`.` or `,`), zone offset and one-or-two-digit hour on *every* candidate rather than on ISO alone; and the century rule gained the all-two-digit `unresolved` rule.

**Known-bad state avoided.** A tool whose stated purpose is to stop reports being untyped, silently typing a column of version numbers as dates — and doing it in the same release that taught it to read timestamps.

**Outside the Frozen block, fixed in this round rather than renegotiated:** the spec still said milliseconds in three places after the last amendment, including a ticked task, so a reader landing on the task list got the overturned answer. The mixed-affix warning survived a retype to `number` and then told the user the column is read as text while the card said `Zahl`. `BOOLEAN_TOKEN_MAX` was hand-set to 6 in a file whose stated discipline is to derive such limits. `typingDiagnostics` dereferenced `evidence.over` unguarded, which a restored Recipe could reach. `resolveFormat` swallowed a nonsense reading for `time`/`duration` where every other type refuses one. And three changed behaviours had no test observing them, including the German precision sentence, which could be reverted to its false wording with the suite green.

**Measured, not optimised: detection got ~1.9× slower.** 2.08 s → 3.96 s at the NFR-3 shape of 100,000 × 20, so the module header's own "991 ms" claim is stale. Boolean pairs are scored on every column, `affixScan` adds passes, and `marksPresent`'s early break is now effectively unreachable because `MARKS` grew. The number is corrected and the measurement goes to the open ledger entry; it is **not** optimised here, because the owner decided on 2026-08-02 that a committed measurement harness comes before any optimisation of detection.

**A wording error of mine in the Frozen block, corrected after implementation.** The rule was first written as "every value has all three parts two-digit … and one part that is not two-digit — `31.12.25`, where `31` is no month — settles it as a date". That is self-contradictory: `31` *is* two-digit, so on a literal reading `31.12.25` would have been unresolved as well, which is the opposite of what the owner chose. The implementer read the justification rather than the letter and built the two mechanisms the justification actually names — a day past twelve settles it as a date, a triple that cannot be a date settles it as text — then flagged the conflict instead of quietly picking one. The Boundaries now say that. The option the owner selected already named both mechanisms, so this corrects prose to match approved intent rather than changing the intent.

**KEEP.** The nanosecond representation and its whole rationale; the digit-comparing overflow guard; the time-against-duration question answered by story 3's decisive machinery; the four boolean pairs; the affix scored as a candidate rather than asserted from the first symbol seen; the type-select placeholder that keeps a kind ambiguity answerable.

### 2026-08-02 — review round 1, as built: three readings the Frozen block left open

The two amendments above were implemented as written. Three points in them admit more than one reading, and each was resolved in the direction that questions more and decides less. Recorded so the owner can overrule any of them cheaply.

**"All three parts two-digit" is read as *value* shape, not character width.** Taken literally the phrase is trivially true of every `dd.MM.yy` value — the pattern already demands three two-digit parts — which would make `31.12.25` unresolved too, and the Boundaries say in the same breath that it is not. The operative test implemented is the one the spec's own justification names: **a triple whose day is past twelve** (`31` is no month) cannot be read as a triple of month-sized components and settles the column as a date. That is FR-9's "day above 12" evidence, one question further out.

**"One value that cannot be a date settles it the other way" is the mirror of that, and it settles it as `text`.** `01.13.03` is a fine version number and no date at all, so it is exclusive evidence pointing the other way — the column is `text`, `settled`, and immediately confirmable rather than a date with a question mark on it. The two clauses are therefore symmetric, which is what makes the third state — neither kind of evidence — the honest `unresolved`.

**Only triple-shaped values are asked.** A column carrying `demnächst` beside twenty dates is twenty dates and one unparsed value, exactly as story 3 counts it; the version hypothesis needs version-shaped values to stand on. Without this the threshold rule would have been overturned for one pattern only.

**Two mechanical consequences, decided rather than asked.** The date-or-text question reuses `evidence.over: 'kind'` and `typing.ambiguous_kind` verbatim — the alternatives are types, the answer is the type select, and the placeholder that keeps a kind ambiguity answerable was already there. And `typing.unparsed_values` no longer says "unter der gewählten Lesart": `time` and `duration` have no reading, so on those columns the sentence sent the user looking for a control that is not rendered. It says "unter dem gewählten Typ", which is true for every type.

**The mixed-affix warning now ends where its condition ends.** It survived a retype to `number`, so the card showed `Zahl` and `Einheit: €` over a warning still claiming the column is read as text, with the `$` values unparsed and unmentioned. `scoreColumn` no longer carries it: a choice made is a question closed, and what the choice costs is the unparsed count, which is reported either way. Handing the column back to detection brings the finding back, because the finding was the column's and never the user's.

### 2026-08-02 — renegotiated by the project owner, after dev: the representation is nanoseconds

**Triggering finding.** The owner brought a CSV of his own carrying `2026-02-13 15:57:35.4616727` — SQL Server `datetime2(7)`, 100-nanosecond ticks — and said milliseconds were too little. Measured against the shipped `detectColumn`, the value was worse off than that: it read as **`text`**. The Frozen block allowed a fractional second on the ISO candidate alone, and the implementation followed it exactly, so a space instead of a `T` was the difference between a typed column and an untyped one. `2026-02-13 15:57:35.461` was text for the same reason. That is the story's own premise failing on its own terms — the asymmetry this story exists to close, reappearing one shape further in.

**What was amended, both inside the Frozen block.** (1) A fractional second of 1–9 digits is now optional on **every** datetime candidate alongside seconds, not on ISO alone. (2) AD-21's resolution changes from milliseconds to **nanoseconds held as `BigInt`**, in all four temporal types.

**Why `BigInt`, and why not the cheaper answers.** Measured: 100-nanosecond ticks for a 2026 instant are `1.77e16` against `Number.MAX_SAFE_INTEGER`'s `9.007e15` — already past it, so ticks are not a `Number` at all. Microseconds are the last resolution a `Number` holds exactly (through 2255) and cover six of the seven digits, which is the same amendment for a value that is still rounded. Two cheaper options were put to the owner and declined: leaving a column with more than three fractional digits as `text`, on the same logic as the 19-digit order number, and keeping milliseconds with the loss named per column.

**Why one unit for all four types** rather than nanoseconds for datetime and milliseconds for a date: a split rule turns a date-against-datetime join into a unit conversion, which is precisely the class of error AD-21 was written to prevent. Decided here rather than asked, because it follows from the amendment and its own rule.

**Known-bad state avoided.** A `datetime2(7)` column read as text in a tool whose stated purpose is to stop reports being untyped — and, once typed, a confirmed timestamp silently exported four digits shorter than it arrived.

**What it costs, and where that is written down.** `BigInt` and `Number` do not mix in arithmetic, so a mean over a temporal column throws rather than coerces: the `TableEngine` adapter absorbs it under AD-19, and story 14's canonical serializer spells the encoding out because JSON has no `BigInt`. Both are named in AD-21 rather than left for story 6 and story 14 to discover. Nothing in this story converts a value, so no code here holds a `BigInt` yet.

**KEEP.** Everything else the implementation landed: the digit-comparing overflow guard, the time-against-duration question answered by story 3's own machinery, the four boolean pairs, the affix scored as a candidate, and the type-select placeholder that keeps a kind ambiguity answerable.

### 2026-08-02 — five things decided during dev, without the owner

The project owner was away. None of these touches the Frozen block; each is recorded so it can be overruled cheaply.

**The ISO datetime candidate is named `ISO 8601`, not spelled as a pattern.** The Boundaries describe it as one candidate accepting optional seconds, an optional 1–9 digit fraction and `Z` / `±HH:mm` / `±HHmm`. That is a family, not a shape, so writing the key as `yyyy-MM-dd'T'HH:mm:ss` would put a lie in the Lesart select — and the German field-letter rendering (`JJJJ-MM-TTTHH:mm:ss`) is unreadable besides. The other three keep their pattern spelling and render as `JJJJ-MM-TT HH:mm`, `TT.MM.JJJJ HH:mm`, `TT.MM.JJ HH:mm`.

**A kind ambiguity marks its evidence, a reading ambiguity does not.** The time-against-duration verdict carries `evidence.over: 'kind'`; a locale or pattern ambiguity keeps exactly the evidence shape story 3 shipped, field for field. The asymmetry is deliberate: the story-3 suite asserts that object whole (`toEqual({ alternatives: [...] })`), and "every existing verdict, count and diagnostic is unchanged" is an acceptance criterion. `over` is what lets `core/exec` pick `typing.ambiguous_kind` over `typing.ambiguous_locale` and lets the pane put the placeholder on the **type** select rather than the reading select — without it the card would point at a control that cannot answer the question.

**The type select gets the same placeholder the reading select has.** An unresolved clock column is proposed as `duration` (alphabetical tie-break inside `score`), and a select already displaying `Dauer` fires no change event when `Dauer` is chosen — so the gate would have stayed shut for good. Same trap, same fix, third control.

**The affix is scored as a candidate, not asserted from the first symbol seen.** The Boundaries say every parsed value must carry the column's one affix. Read literally, one stray `1.000,00 €` in a thousand plain numbers makes the column an affixed one and the other 999 unparsed. So the bare reading and each present affix are scored and the one covering more values wins; the stray then counts as the one unparsed value it is. On the re-score path the scan runs over *every* number reading rather than the chosen one, or overriding a percent column from German to English digits would take the percent sign off it.

**Two observations recorded in `deferred-work.md` rather than acted on.** A two-digit year has no `MM.dd.yy` mirror, so `03.04.25` is settled silently where `03.04.2025` would be an open question — widening a frozen candidate list is an Ask First. And the unconditional mixed-affix rule takes a whole column to `text` over two mistyped cells; the conservative answer is never wrong, only sometimes blunt, and softening it is a Boundaries change.

## Design Notes

- **Why `duration` is a type:** the time/duration ambiguity is only reportable if both answers are choosable — an unresolved verdict whose alternatives include something the type select cannot offer would be a question with no answer. Representation is cheap: plain nanoseconds, the same unit as the other three and the same amendment.
- **Why the overflow guard disqualifies the column** rather than counting single values unparsed: same reason as the leading zero — the column *is* identifiers, and a proposal of `number` at 98 % readable would invite confirming precision loss on the remaining 2 %.
- **Why the affix is a record property, not part of the format:** the format answers "which locale reads the digits"; the affix answers "what unit rides on the column" — story 13 writes it back on export, story 14 serializes it, and neither wants it entangled with locale resolution.

## Verification

**Commands:**
- `npm run lint` — clean; `core/` stays DOM-free.
- `npm test` — both Vitest projects; the new matrix green, story-3 suite untouched.
- `npm run test:e2e` — builds `dist/`, both engines from `file://`.
