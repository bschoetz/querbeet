---
title: 'Story 4a — Typing reaches the types a report actually holds'
type: 'feature'
created: '2026-08-02'
status: 'ready-for-review'
review_loop_iteration: 0
baseline_commit: '7183651ab02fc630fe1f8e775a186a9c13c8bac8'
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
  - '_bmad-output/implementation-artifacts/spec-4-xlsx-parquet-sources.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Detection reaches three types — text, number, date — so a timestamp, a clock time, a `ja`/`nein` flag, a margin and an amount out of any ERP export are `text`, and the same table is typed as XLSX and untyped as CSV (CAP-9 remainder). Separately, a 19-digit order number is reported as `number`, settled, and loses its last digits at story 6's conversion — the C-10 defect, arriving through the text path story 4 already guards from the Parquet side.

**Approach:** Six pieces in the order their risk falls: (1) the `MAX_SAFE_INTEGER` guard for the text path, (2) datetime from text, (3) time from text — which extends AD-21 by milliseconds since midnight and uses story 3's unresolved machinery for the clock-time/duration ambiguity, (4) boolean from text, (5) numbers carrying a percent or currency affix, (6) accounting negative forms. Every new type enters `core/types/catalog.js`, the single declaration story 4 established, and becomes settable there. Nothing here converts a value; story 6 owns that (AD-21, AD-22).

## Boundaries & Constraints

**Always:**
- **Catalogue only:** `time` and `duration` are new records in `core/types/catalog.js`; `datetime` and `boolean` flip `settable: true` there. `native` flags stay as they are — no reader declares `time` or `duration`, and the adapters are untouched.
- **(1) Overflow guard:** a value that reads as a number under a candidate but whose integer digits (sign and grouping stripped) exceed `Number.MAX_SAFE_INTEGER` — compared as digits, never through a float round trip — disqualifies the number reading for the **whole column**, exactly as one leading zero does: the digits are the information, and a column of order numbers is not half numeric.
- **(2) Datetime candidates**, a closed list this story: `yyyy-MM-ddTHH:mm` with optional `:ss`, optional `Z` / `±HH:mm` / `±HHmm`; `yyyy-MM-dd HH:mm(:ss)`; `dd.MM.yyyy HH:mm(:ss)`; `dd.MM.yy HH:mm(:ss)`. **A fractional second of 1–9 digits is optional on every one of them, alongside seconds** — not on the ISO candidate alone. `2026-02-13 15:57:35.4616727` is what SQL Server `datetime2(7)` and .NET write into a CSV, and a space instead of a `T` must not be the difference between a typed column and text. Nine digits is exactly the representation's resolution, so the cap is the representation rather than an arbitrary limit; a tenth digit is not readable. The `MM/dd` datetime mirror is deliberately absent — a candidate enters with a real Source that needs it, the same rule `NUMBER_LOCALES` already follows.
- **Century rule (spec-owned, not code-chosen):** a two-digit year `yy` reads as `20yy` for `00–29` and `19yy` for `30–99` — Excel's fixed pivot, so the office ecosystem querbeet replaces agrees with it. Never a sliding window: a Recipe re-run in a later year must read the same date. Applies to `dd.MM.yy` (new date pattern) and `dd.MM.yy HH:mm(:ss)`.
- **(3) Time and duration:** `time` is `HH:mm(:ss)`, hours 00–23 (1 or 2 digits), minutes/seconds two digits ≤ 59; `duration` is the same shape with hours unbounded (any digit count). Every time-readable value is duration-readable, so: a value at or past `24:00` is exclusive evidence and settles the column as `duration` through story 3's decisive machinery; a column where nothing passes `24:00` is `unresolved` between the two — the user answers via the type select, and no default is picked quietly.
- **AD-21 is amended** (task, planning artifact) and the resolution is **nanoseconds, held as `BigInt`, in all four temporal types**: a date column holds UTC-midnight epoch nanoseconds, a datetime column UTC epoch nanoseconds, a time column nanoseconds since midnight, a duration column plain nanoseconds. **One unit for all four, deliberately** — a split rule would make a date-against-datetime join a unit conversion, which is the class of error AD-21 exists to prevent. `BigInt` rather than `Number` because 100-nanosecond ticks are already past `Number.MAX_SAFE_INTEGER` today (`1,77e16` against `9,007e15`); microseconds are the last exact `Number` and cover only six of `datetime2(7)`'s seven digits, so they would buy the same architectural change for an answer that is still wrong. The cost is named rather than discovered: `BigInt` and `Number` do not mix in arithmetic, so the `TableEngine` adapter absorbs it (AD-19) and story 14's serializer spells it out, because JSON has no `BigInt`.
- **(4) Boolean pairs:** `true`/`false`, `wahr`/`falsch`, `ja`/`nein` (word pairs case-insensitive, so German Excel's `WAHR`/`FALSCH` is the same pair), `1`/`0`. A pair never mixes with another — `ja` beside `false` is text. **The 1/0 rule:** `1`/`0` is also a perfectly good number, so a column readable as both proposes `number` — the reading that loses less — and `boolean` stays one settable choice away. Word pairs propose `boolean` outright.
- **(5) Affix:** recognized affixes are `%`, `€`, `$` — decisive markers with no second reading; prefix or suffix, with or without one space. The stored number is the number in the field (`12,5` for `12,5 %`, never `0,125`); the affix rides on the column record as a property and never alters a cell. Every parsed value must carry the column's one affix — a bare number in an affixed column counts unparsed. A column mixing two affixes is `text` plus a warning naming both; the number in front carries only the ordinary de/en question.
- **(6) Accounting signs:** `(1.234,56)` and `1.234,56-` read as negative numbers under both locales, combinable with an affix; a value carrying two sign marks is unreadable. The sign is part of the one reading rule in `typing.js` that story 6 converts with — stripping parentheses without carrying the sign flips the value, and that is the one wrong-number defect this story can produce.
- **Cross-kind proposal:** kinds are scored independently, the highest hit rate at or above the 0.9 threshold proposes; a tie goes to `number`. AD-13 holds: codes from `core/`, German only in `ui/`, and a type without a German word is a failing test.

**Ask First:** any candidate, pair or locale beyond the lists above (month names, space grouping, a fifth boolean pair); changing the catalogue record shape beyond adding records and flipping flags; any new dependency.

**Never:** converting values (story 6 — AD-21, AD-22); writing affixes back on export (story 13); Recipe serialization (story 14); touching `adapters/` — Parquet `TIME` stays a refused declaration; sampling (CAP-9); a sliding century window. Deliberately out and already recorded in `deferred-work.md`: space grouping (open entry), month names, exponential notation, ISO weeks/quarters, `integer` as a type (closed triage entry) — no new entries needed.

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
| German datetime | `31.12.2025 14:30` | `datetime`, settled | N/A |
| Two-digit year | `31.12.25` | `date`, `dd.MM.yy`, century rule → 2025 | N/A |
| Century pivot | `01.01.29` / `01.01.30` | 2029 / 1930 | N/A |
| Clock times only | `08:15`, `17:20` | `unresolved` — time vs. duration, gate blocked until the user chooses | N/A |
| Duration evidence | same column plus `36:15` | `duration`, decisive, count named | N/A |
| Not a time | `24:00`, `12:60` | `24:00` duration-only evidence; `12:60` reads as neither | N/A |
| German boolean | `ja`, `Nein`, `k.A.` | `boolean`, `ja/nein` pair, `k.A.` missing | N/A |
| German Excel boolean | `WAHR`, `FALSCH` | `boolean`, `wahr/falsch` pair — case-insensitive | N/A |
| Pairs mixed | `ja`, `false` | `text` — a pair never mixes with another | N/A |
| Numeric boolean | `1`, `0` only | proposed `number`; `boolean` settable | N/A |
| Percent | `12,5 %`, `80%` | `number`, affix `%`, stored text unchanged | N/A |
| Currency prefix | `$1,234.56` (en) | `number`, affix `$` | N/A |
| Mixed affixes | `12 €` and `12 $` | `text` + warning naming both | warning diagnostic |
| Bare value in affixed column | `12,5 %`, `13` | `13` counts unparsed | `typing.unparsed_values` |
| Accounting negatives | `(1.234,56)`, `1.234,56-` | read as negative numbers, one warning-free column | N/A |
| Double sign | `(1.234,56-)` | unreadable, counts unparsed | N/A |
| Regressions | leading zero, `1.23.456`, de/en ambiguity | behave exactly as story 3 shipped them | N/A |

</frozen-after-approval>

## Code Map

- `core/types/catalog.js:39-45` — `TYPES`: add `time`, `duration` (`settable: true`, `native: false`); flip `settable` on `DATETIME`/`BOOLEAN`. `canonicalTypeGaps` filters on `native`, so no `CANONICAL` entry is owed. `catalog.test.js` pins flags.
- `core/types/typing.js` — the whole story lives here. `hasLeadingZero:226` (overflow guard lands beside it, same column-level disqualification); `DATE_PATTERNS:100` (+ `dd.MM.yy`); `readsAsNumber:198` (affix/accounting wrap around it, grouping strictness untouched); `readsAsDate:243` (width table gets the 2-digit year); `marksPresent:161`/`MARKS:141` (derived — new separators/affixes must feed it, or narrowing silently disables candidates); `score:339`/`exclusive:357` (reused verbatim for time-vs-duration); `detectColumn:403` competition at `:439-465` generalizes from two kinds to five; `candidatesFor:524` + `bestFormat:535` learn `datetime` patterns and `boolean` pairs (`time`/`duration` carry no format → `[]`); `scoreColumn:546` re-scores every new kind and carries the affix property.
- `core/types/typing.test.js` — matrix rows above, per piece; regression block for story 3 verdicts.
- `core/exec/source-store.js:36` — `typingDiagnostics`: new warning `typing.mixed_affixes`; the time/duration unresolved state emits its own code (`typing.ambiguous_kind`, alternatives `[time, duration]`) rather than overloading `typing.ambiguous_locale`. `resolveFormat:535` keys on `pattern ?? locale` — boolean pairs and datetime patterns need a key each. `setColumnTyping:560` needs no change: settability comes from the catalogue.
- `ui/type-labels.js:14` — `Uhrzeit`, `Dauer`; completeness test `typeLabelGaps` already bites.
- `ui/SourcesPane.vue:201-215` — `readingLabel`/`NUMBER_LABEL` learn datetime/boolean format labels; ambiguity sentences `:233-270` word the time/duration question as type, not reading; the card shows a column's affix. `ui/SourcesPane.test.js` covers wording + affix render.
- `tests/e2e/typing.spec.js` — one journey: CSV with timestamp, clock-time, ja/nein, percent, accounting columns → proposals on the cards, resolve time vs. duration, confirm, gate opens.
- `_bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md:168` — AD-21 amendment (time/duration representations).
- `_bmad-output/implementation-artifacts/deferred-work.md:14-17` — close the sub-millisecond entry with the AD-21 decision.

## Tasks & Acceptance

**Execution:**
- [x] `ARCHITECTURE-SPINE.md` — amend AD-21: time = ms since midnight, duration = ms; resolution stays milliseconds.
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

**Acceptance Criteria:**
- Given the type vocabulary, when `time` and `duration` are added, then they are declared in `core/types/catalog.js` and nowhere else — no second list anywhere restates the types.
- Given a column of clock times with no value past 24:00, when detection runs, then the Source cannot be confirmed until the user chooses `Uhrzeit` or `Dauer` — the gate blocks on `unresolved` exactly as for the locale case.
- Given an affixed column with a user-overridden reading, when `setColumnTyping` re-scores it, then the affix property survives on the record.
- Given the story-3 test suite, when this story lands, then every existing verdict, count and diagnostic is unchanged.
- Given `npm run verify`, then lint, both Vitest projects and Playwright (Chromium + Firefox, `file://`) pass.

## Spec Change Log

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

- **Why `duration` is a type:** the time/duration ambiguity is only reportable if both answers are choosable — an unresolved verdict whose alternatives include something the type select cannot offer would be a question with no answer. Representation is cheap: plain milliseconds, same amendment.
- **Why the overflow guard disqualifies the column** rather than counting single values unparsed: same reason as the leading zero — the column *is* identifiers, and a proposal of `number` at 98 % readable would invite confirming precision loss on the remaining 2 %.
- **Why the affix is a record property, not part of the format:** the format answers "which locale reads the digits"; the affix answers "what unit rides on the column" — story 13 writes it back on export, story 14 serializes it, and neither wants it entangled with locale resolution.

## Verification

**Commands:**
- `npm run lint` — clean; `core/` stays DOM-free.
- `npm test` — both Vitest projects; the new matrix green, story-3 suite untouched.
- `npm run test:e2e` — builds `dist/`, both engines from `file://`.
