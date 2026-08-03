---
title: 'Story 4b — Month names in dates, German and English'
type: 'feature'
created: '2026-08-03'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: 'b06282bce31a29d3336abcb44aff724914a9a713'
context:
  - '_bmad-output/planning-artifacts/spikes/intl-month-names-2026-08-03/findings.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
  - '_bmad-output/implementation-artifacts/spec-4a-report-types.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CAP-9 remainder. A date written with a month name is `text`. The Source that opened the gate is a Microsoft 365 security export carrying `2. Aug. 2026` and `31. Juli 2026`; English is in scope from the start because the same portals ship both. Story 4a cut month names on the rule `typing.js` states — a calendar enters with the Source that needs it — and that Source now exists, which is the gate opening rather than a rule being broken.

**Approach:** **One** date candidate, over the union of both vocabularies and all three orderings (`2. Aug. 2026`, `Aug 2, 2026`, `2 Aug 2026`), not a reading select nobody can answer. The month vocabulary is **derived from `Intl` in format context** — `formatToParts` of a whole date, never `{month:'short'}` standalone — the same discipline `numberCandidates` already applies through `Intl.NumberFormat`, and the measured table is committed as a **frozen fixture** so a future ICU change is a failing test rather than a column that silently falls back to text.

## Boundaries & Constraints

**Always:**

- **The month table is derived, never written down.** From `Intl.DateTimeFormat(locale, { day, month, year, timeZone: 'UTC' })` via `formatToParts`, taking the `month` part of a whole date. Measured 2026-08-03: in German short **eleven of twelve** entries differ between format context and standalone, only `Mai` coincides — a table built the easy way misses both of the owner's values. `timeZone: 'UTC'` is part of the derivation, not a detail: without it the table becomes a property of where the runner stood.
- **A set of accepted spellings per month, not one exact string.** Forced by the locales already in scope, independently of drift: en-US abbreviates September to `Sep`, en-GB to `Sept`, and German writes `Sept.` — three spellings of one month. Normalization is case-folding plus a dropped trailing `.`, so an exporter writing `AUG` where CLDR says `Aug.` is not a second vocabulary. Measured: **34 distinct spellings, 0 collisions**, so one candidate is sound.
- **The locale list is `de-DE`, `en-US`, `en-GB`,** declared beside `NUMBER_LOCALES` and under the same rule: a locale enters with a Source that needs it.
- **A locale the engine falls back on is refused, loudly.** A missing locale hands back an English table under a German tag and every value in it looks plausible and is wrong. `resolvedOptions().locale` is checked per formatter; the failure is an empty-is-the-rule gap function with a test, the shape `canonicalTypeGaps` and `scorableTypeGaps` already have.
- **Three engines, not two.** AD-27 puts `core/` under Vitest with `environment: 'node'`, so Node's ICU is what the unit tests see. Node 26.5.1 (ICU 78.3), Chromium 151 and Firefox 153 agree on all 72 cells today; the frozen fixture is what keeps that honest.
- **English ordinal suffixes are read** (`Aug 2nd, 2026`) — the project owner's decision of 2026-08-03. `st|nd|rd|th` is stripped off the day digits and **not** checked against the number: it carries nothing the digits do not, so `2th` reads as the 2nd and no wrong date can come of it. This is the one rule in the story that `Intl` will never justify, and it is marked as such where it lives.
- **`Intl` supplies the strings and does not decide the locale** (measured-constraints). The union vocabulary is admissible precisely because the value's own month name identifies its shape — no value parses under two orderings and yields two different dates.
- **Story 4a's width strictness does not bind here.** It exists so two *numeric* patterns cannot agree on the values that distinguish them; a month name has no competing pattern, so a one- or two-digit day is safe.
- Nothing here converts a value (AD-21, AD-22). The display locale never reaches a Table or a Recipe.
- **Detection cost is measured, not estimated.** Before/after at the NFR-3 shape (100,000 × 20) on a report-shaped column mix, alternating order, best of three — the practice the two-digit-mirror entry already set. The number goes in the `typing.js` header and folds into the open detection-cost ledger entry.

**Ask First:**

- Widening the vocabulary beyond `Intl` for anything other than the ordinal suffix already decided — a hand-written spelling is exactly what the derivation discipline exists to keep out.
- Adding a fourth locale, or a month name inside `DATETIME_PATTERNS`.
- Any change to the shape or ordering of the existing fourteen date candidates.

**Never:**

- **A two-digit year with a month name.** `Intl` with `year: 'numeric'` produces none, so the shape has no derivation behind it and would reopen the century question where no Source has shown it. Ledger entry, with the reason.
- **A month name in a datetime.** `2. Aug. 2026 14:30` stays text this story; `DATETIME_PATTERNS` is untouched. Ledger entry.
- **A date library.** Luxon was measured at 356 ms per 100,000 values *per candidate* (~7 s for a 100k × 20 Source) and Day.js silently returns Invalid Date when a plugin is unregistered.
- A reading select between the three orderings, or between German and English — 34 spellings, 0 collisions, so there is no question to ask, and an ambiguity between readings that mean the same thing is not an ambiguity.
- ISO week dates, quarters and period labels — cut before this story and not reopened.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Owner's Source, German short | `2. Aug. 2026`, `31. Juli 2026`, `1. Sept. 2026` | `date`, format `month name`, `settled`, all parsed | N/A |
| German long | `2. August 2026`, `31. Juli 2026` | same | N/A |
| en-US | `Aug 2, 2026`, `March 3, 2026` | same | N/A |
| en-GB | `2 Aug 2026`, `2 Sept 2026` | same — `Sept` and `Sep` are both September | N/A |
| Ordinal suffix (owner decision) | `Aug 2nd, 2026`, `Jan 1st, 2026`, `May 3rd, 2026` | read; suffix stripped, not validated | N/A |
| Case and a lost point | `AUG 2, 2026`, `2 aug 2026` | read — normalization is case-fold + dropped trailing `.` | N/A |
| Mixed locale in one column | `2. Aug. 2026` beside `Aug 2, 2026` | both read under the one candidate, `settled` — not an ambiguity | N/A |
| Not a date | `Rechnung Mai 2026`, `Mai`, `2 Aug` | unparsed; day/year tokens must be 1–2 and exactly 4 digits | counts as unparsed, no verdict change |
| Two-digit year | `2. Aug. 26` | unparsed (text) | ledger entry, not a silent read |
| Impossible day | `31. Feb. 2026`, `32 Aug 2026` | unparsed — `isRealDate` decides, as for every other pattern | N/A |
| No contest with numeric patterns | `2. Aug. 2026` scored against `dd.MM.yyyy` | numeric candidates read nothing, so `settled` rather than a spurious ambiguity | N/A |
| Below threshold | 5 month-name dates in 100 text values | `text`, hit rate reported | N/A |
| ICU moves under us | derived table ≠ frozen fixture | **unit test fails, naming the month and both spellings** | this is the point of the fixture |
| Engine lacks a locale | `resolvedOptions().locale` ≠ requested | gap function non-empty → test fails | never a silent English table |

</frozen-after-approval>

## Code Map

- `core/types/typing.js:146-194` — `DATE_PATTERNS` (14 entries, `freezeDeep`) and `dateCandidates()`. The new candidate is appended here; its `separator` is `' '`, which is what makes the narrowing work.
- `core/types/typing.js:124` — `NUMBER_LOCALES`; the month locale list is declared beside it, under the same stated rule.
- `core/types/typing.js:347-378` — `MARKS` (derived from `DATE_PATTERNS` separators, number separators, `TIME_SEPARATOR`, `AFFIXES`) and `marksPresent`. A `' '` separator joins `MARKS` **by derivation, with no edit**, and narrows the candidate to columns that contain a space — the same arithmetic every other narrowing here is.
- `core/types/typing.js:616-639` — `readsAsDate(text, candidate)`: splits on `separator`, requires exactly three parts, fixed widths, then `isRealDate`. The month-name branch lives here.
- `core/types/typing.js:607-614` — `isRealDate(year, month, day)`, reused unchanged (leap years included).
- `core/types/typing.js:905-916` — `canonicalTypeGaps()`, and `:1422-1427` `scorableTypeGaps()`: the "empty is the rule and a test asserts it" shape the month-table invariants must copy.
- `core/types/typing.js:1140` — `datePatterns = DATE_PATTERNS.filter((p) => present.has(p.separator))`; the narrowing the new candidate rides on, unedited.
- `core/types/typing.js:1329-1351` — `shortYearVerdict` / `:1274` `dayIndex`: reached only for `shortYear` candidates. Confirm the month-name candidate cannot reach them (it splits on space; `isTwoDigitTriple` never matches).
- `core/types/typing.js:1373-1382` — `candidatesFor(DATE)` returns `DATE_PATTERNS` whole; the re-score path and the UI select pick the new candidate up with no edit.
- `core/exec/source-store.js:604-616` — `resolveFormat` validates a chosen format against `candidatesFor(type)` by `format.pattern ?? format.locale`. Derived — no edit — but the pattern string must be unique and stable.
- `ui/SourcesPane.vue:235-251` — `patternLabel` is a **string transform** (`dd`→`TT`, `yyyy`→`JJJJ`, `yy`→`JJ`), and `NUMBER_LABEL` beside it is the existing map-for-a-named-reading. A candidate not spelled in field letters needs its German word from a map, not from the transform.
- `ui/SourcesPane.vue:262-263` — `readingLabel` routes ambiguity alternatives through the same label path; `:278` `formatChoices = candidatesFor`, `:938,953-956` the option list. Generated — no edit.
- `ui/type-labels.js:30` — `typeLabelGaps()`: types only. New patterns need **no** entry; the pattern-side gap is the new one this story adds.
- `core/types/typing.test.js:82-242` — the `dates` block, and where the new block belongs.
- `core/types/typing.test.js:1065-1085` — asserts the exact 14-entry pattern list in order. **Must be extended.**
- `core/types/typing.test.js:1088-1097` — the yy-mirror invariant over every non-`shortYear` candidate. **Must be scoped to candidates that carry an `order`**, with the reason stated (a mirror is owed to a numeric year field; `Intl` produces none here).
- `core/types/typing.test.js:988-1005` — walks candidates building synthetic values from `separator` + `order` + `dayIndex`. **Same scoping**, same reason.
- `core/types/typing.test.js:1752-1763` — freeze test over `dateCandidates()` and every `candidatesFor(...)`; the new candidate must survive `freezeDeep`.
- `ui/SourcesPane.test.js:422` — hardcodes all 14 German option texts and asserts no `d`/`y` letter survives. **Must be extended.**
- `tests/fixtures/generate.mjs:1-40` — the fixture precedent: bytes are committed only when no in-repo writer can produce them. A month table is plain data, so it is committed as a module beside `typing.test.js`, not under `tests/fixtures/`.
- `_bmad-output/planning-artifacts/spikes/intl-month-names-2026-08-03/measurements.json` — `union.spellingsByMonth` (12 keys, 34 spellings) and `engines[].identity`; the source of the frozen fixture's contents and of the engine stamps in its header.
- `_bmad-output/implementation-artifacts/deferred-work.md:7` (`## Open`) — where the new entries go, above `## Closed` at `:98`; `:68-76` is the open detection-cost entry this story's measurement folds into.

## Tasks & Acceptance

**Execution:**

- [x] `core/types/typing.js` — declare the month locale list beside `NUMBER_LOCALES`; derive the month table (and the day's trailing literal) from `Intl` in format context, with `timeZone: 'UTC'`, a per-formatter `resolvedOptions().locale` check, and normalization = case-fold + dropped trailing `.` — the derivation, not a list.
- [x] `core/types/typing.js` — export the empty-is-the-rule invariants beside `canonicalTypeGaps` / `scorableTypeGaps`: spellings that mean two months, and locales the engine fell back on.
- [x] `core/types/typing.js` — append the single month-name candidate to `DATE_PATTERNS` with `separator: ' '`, and add its branch to `readsAsDate`: three whitespace-separated tokens, exactly one of them a month name, the month's index deciding the ordering (0 → month-day-year, 1 → day-month-year, 2 → refused, no locale in scope writes it), year exactly four digits, day 1–2 digits with an optional ordinal suffix and an optional derived trailing literal, then `isRealDate`.
- [x] `core/types/typing.js` — amend the `DATE_PATTERNS` docblock: month names are no longer "deliberately absent", and record *why* the derivation is in format context (eleven of twelve German short entries differ) and that the ordinal suffix is the one hand-written rule and whose decision it was.
- [x] `core/types/month-names.frozen.js` (new, imported only by the test) — the 2026-08-03 measurement as a literal: 34 spellings by month, the normalization rule, and the three engine identity stamps in the header so a failure names what moved.
- [x] `core/types/typing.test.js` — a `piece 7 — month names` block covering every row of the I/O matrix; extend the 14-entry pattern list; scope the yy-mirror and `dayIndex` walks to candidates carrying an `order`, with the reason in a comment; assert the derived table equals the frozen fixture and both gap functions are empty.
- [x] `ui/SourcesPane.vue` — give a named reading its German word from a map consulted before `patternLabel`, with an explicit entry for the existing `ISO 8601` too (its German word is the standard's name, and saying so is what makes the map honest).
- [x] `ui/SourcesPane.test.js` — extend the option-text list; add a gap test asserting every candidate whose pattern carries no field letter has a German entry.
- [x] `tests/e2e/typing.spec.js` — one e2e case: a CSV column of `2. Aug. 2026` typed as `Datum` through the real pane and confirmed.
- [x] measurement — run detection before/after at the NFR-3 shape on a report-shaped column mix, alternating order, best of three; put the ratio in the `typing.js` header beside 4a's figures.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` — append under `## Open`: two-digit year with a month name; month name in a datetime; the ordinal-suffix rule as the one un-derived entry, so a later reader can find why it is there. Fold the measured cost into the `:68` entry.

**Acceptance Criteria:**

- Given a column of `2. Aug. 2026` and `31. Juli 2026`, when `detectColumn` runs, then the record is `type: date`, `verdict: 'settled'`, `format.pattern` the month-name candidate, and every value parsed.
- Given the month table derived at runtime, when it is compared to the frozen fixture, then they are equal spelling for spelling — and when they are not, the test names the month and both spellings.
- Given the type select in the pane, when a user opens the reading select for a date column, then the month-name reading is offered with a German word and no option text contains a `d` or a `y` field letter.
- Given a column already typed by the existing fourteen candidates, when the story lands, then its verdict, format and counts are unchanged — the story-3 and story-4a regression blocks stay green.
- Given `npm run verify`, when it runs on the finished story, then lint, unit and e2e all pass.

## Spec Change Log

### 2026-08-03 — as built

No Boundary was renegotiated and no Ask First was taken. Four things are worth
recording because a later reader would otherwise have to re-derive them.

**The candidate's pattern string is `month name`.** It is what the I/O matrix
already called it ("format `month name`"), it is unique and stable, and
`resolveFormat` keys on it with no edit. It is the second candidate in the file
that is *named* rather than spelled — `ISO 8601` is the first — which is what the
UI map below exists for.

**`namedReadingGaps()` is exported from a plain `<script>` block inside
`SourcesPane.vue`, beside the `<script setup>` one.** The map itself is where the
spec puts it, in the component. The invariant over it had to be importable, and
`<script setup>` compiles into a `setup()` body and can export nothing — an
invariant nothing can import is one no test can observe, which is the state
`typeLabelGaps()` exists to keep out of a release. The alternative was moving the
map to `ui/type-labels.js`, which would have split it from `NUMBER_LABEL` beside
it for no gain.

**The two invariants that had to be scoped are scoped to `candidate.order`, not
to `candidate.monthName`.** The yy-mirror walk and the `dayIndex` walk both ask a
question only a candidate with a declared part order has — "which fixed position
holds the day", "what is this pattern's two-digit truncation". Scoping on the
positive property means the *next* candidate that reads its own ordering out of a
value is covered by the same reason rather than by a second exemption.

**Self-review by mutation: nine mutations, seven killed, two shipped green.**
Standalone instead of format context (11 cases), the deleted `resolvedOptions`
check, a dropped ordinal suffix, an unchecked day trailer, a loosened year
width, an `order` on the month-name candidate, and a respelled month each fail
exactly the case that names them. **Two did not, and are recorded rather than
patched:** refusing a month name at position 2, and refusing a value with two
month names. Both are structurally redundant — with three tokens, either shape
leaves a month name where the day test or the four-digit year test looks, so the
value is refused a second time whatever the explicit rules do. They stay as the
candidate's stated contract (the year is the last token; the month is one of the
first two), because the day the year test is widened — a two-digit year has a
ledger entry — is the day the contract stops being implied. Both the code and
the test now say the case is not evidence for the branch.

**`monthLocaleGaps()` takes an optional locale list, and the parameter is the
point.** On an engine that has all three locales the gap is empty whether the
`resolvedOptions().locale` check exists or not, so deleting the check passed
every other case in the suite. Handed `['xx-YY']` — which `Intl` resolves to the
default locale rather than refusing — it must report both widths. Same argument
as `dayIndex`'s export in story 4a: a derivation nothing can observe is one a
mutation can delete.

**Detection cost, measured rather than estimated:** Mix A (report-shaped),
100,000 × 20, four paired runs in alternating order, best of three per run —
**2.40/2.40/2.45/2.42 s before against 2.52/2.52/2.54/2.54 s after, about
+4.5 %**. One candidate cost nearly twice what `yy-MM-dd` did (+2.5 %) and the
reason is the *separator*: `MARKS` grew from eight marks to nine, and a space is
the mark an ordinary report column is least likely to lack, so `marksPresent`
skips this candidate almost nowhere. The finding that sharpens the ledger entry
is that cost is per candidate **per column it is not skipped on**, not per
candidate.

## Design Notes

**Why one candidate, and why a space is its separator.** All three shapes are exactly three space-separated tokens, and the month name's position identifies the shape inside every value:

```
'2. Aug. 2026'   -> ['2.',  'Aug.', '2026']  month at 1 -> day month year
'Aug 2, 2026'    -> ['Aug', '2,',   '2026']  month at 0 -> month day year
'2 Aug 2026'     -> ['2',   'Aug',  '2026']  month at 1 -> day month year
'Aug 2nd, 2026'  -> ['Aug', '2nd,', '2026']  ordinal stripped off the day
```

Declaring `separator: ' '` is not a trick: it is true of the shape, and it buys the narrowing for free, because `MARKS` is derived from the separators and `marksPresent` already skips candidates a column cannot match. A column of numbers or numeric dates never scores the month candidate at all.

**The day's trailing literal is derived too.** `formatToParts` gives the literal after the `day` part — `". "` for de-DE, `", "` for en-US, `" "` for en-GB — trimmed to `{'.', ',', ''}`. Writing those two punctuation marks by hand would be the same mistake as a hand-written separator table one screen up.

**What the permissiveness costs, named rather than discovered.** `2nd. Aug. 2026` reads, and no exporter writes it. Refusing it would cost a rule and buy no correctness, because the date it yields is right either way — which is exactly the argument story 4a's width strictness rests on in reverse, and the story says so.

## Verification

**Commands:**

- `npx vitest run --project core core/types/typing.test.js` — expected: green, including the frozen-fixture and gap assertions.
- `npm test` — expected: green, both projects; the story-3 and story-4a regression blocks unchanged.
- `npm run lint` — expected: clean, no dependency-direction violation from `core/`.
- `npm run verify` — expected: lint + unit + e2e green.
- `node _bmad-output/planning-artifacts/spikes/intl-month-names-2026-08-03/run-spike.mjs` — expected: still 0 disagreements; re-run it if the fixture assertion ever fails.
