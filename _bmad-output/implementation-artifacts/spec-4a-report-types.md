---
title: 'Story 4a — Typing reaches the types a report actually holds'
type: 'feature'
created: '2026-08-02'
status: 'done'
review_loop_iteration: 4
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
- **(2) Datetime candidates**, a closed list this story: `yyyy-MM-ddTHH:mm`; `yyyy-MM-dd HH:mm`; `dd.MM.yyyy HH:mm`; `dd.MM.yy HH:mm`. **Four things are optional on every one of them, not on the ISO candidate alone:** seconds; a fractional second of 1–9 digits alongside seconds, written with `.` or `,`; a zone offset `Z` / `±HH:mm` / `±HHmm` / `±HH`, **bounded at ±14:00 — the same distance in both directions, and the symmetry is the rule rather than an approximation of one.** Everything past it is a typo read as a confident instant, which is the same reasoning as the minute bound, one field to the left, and it is stated here so the bound is the spec's rather than one the code invented. **The bound is a typo filter, not a zone table**, and that is why it does not cut asymmetrically although current zones would: the widest eastward offset is +14:00 (Line Islands) and the widest westward one is −12:00 (Baker Island), so an argument from *current* zones gives ±14:00 east and −12:00 west — but zones taken over their whole history run past that (tzdata carries Asia/Manila at −15:56 before 1844 and America/Anchorage at +14:00:24 before 1867, both from the date line moving rather than from a typo), so a rule cut that way would have to name its own exceptions. Two hours of westward slack is the price, named rather than discovered: `-13:00` reads and no zone has it. **`-00:00` is refused, and that one is the standard's own rule rather than this bound's** — ISO 8601 has no negative zero, because zero is not west of anything. (RFC 3339 borrows the spelling for "offset unknown", which is a different claim in a different standard and not one a `datetime` column can carry.) `+00:00`, `-00:01` and `Z` are unaffected. And a one- or two-digit hour. The clock behind a date is **never narrower** than the clock standing alone — an hour is not two-digit in one position and one-or-two in the other. It is deliberately *wider*: the fraction and the zone offset belong to a datetime and not to a bare clock, because `time` is `HH:mm(:ss)` and stays that. "Never narrower" is the invariant a test must pin in **both** directions — that the standalone reader refuses nothing the datetime reader accepts in the shared part, and that the extra part is exactly fraction and zone.
- **Why each of those is in the list, since each was a real column that read as text:** `2026-02-13 15:57:35.4616727` is SQL Server `datetime2(7)` and .NET; `2026-02-13 15:57:35.461+02:00` is Postgres `timestamptz`; `31.12.2025 9:05` is an ordinary German export; `2025-12-31t14:30:00z` and `…+02` are legal ISO 8601. **A candidate named `ISO 8601` must accept ISO 8601** — naming a strict subset after the standard puts the same lie in the reading select that spelling it as a pattern would. Nine fractional digits is exactly the representation's resolution, so the cap is the representation rather than an arbitrary limit; a tenth digit is not readable. The `MM/dd` datetime mirror stays deliberately absent — a candidate enters with a real Source that needs it, the same rule `NUMBER_LOCALES` already follows.
- **The datetime clock and the `ISO 8601` candidate each gain one thing the standard permits, because the sentence above is a rule and not an aspiration.** (1) **End-of-day `24:00`, on all four datetime candidates** — `2025-12-31T24:00:00Z` is legal and means the next day's midnight; the hour `24` is accepted only where minutes, seconds and any fraction are all zero, so `24:01` stays unreadable. **It belongs to the shared clock rather than to the ISO candidate**, and that is the deliberate half of this: the story committed to *one* datetime clock, never narrower than the clock standing alone, and a candidate that knows an hour another candidate refuses would be exactly the two-clocks-wearing-one-name situation round 1 removed. So `31.12.2025 24:00` and `2025-12-31 24:00` read as well. Basic format is the opposite case and is correctly gated on the ISO candidate: it is a *representation* of the whole value, not an hour. This is the **datetime** clock throughout: `time` remains 00–23 standing alone and `24:00` remains exclusive `duration` evidence, which is the machinery this story built and must not move. **What `24:00` means is a different calendar day** — `2025-12-31T24:00:00Z` is `2026-01-01T00:00Z` — and story 6 converts it, so a conversion that reads the date part and the hour independently is off by a day on exactly the values this admits. (2) **Basic format** — `20251231T1430`, with seconds, fraction and offset optional exactly as in the extended form. It is scoped to the form carrying `T`: a bare `20251231` is eight digits and belongs to the number reading, and turning order numbers into dates is the defect this story exists to prevent, one direction over. **Week dates (`2025-W01-1`) are not affected by this amendment at all** — the **Never** section below already names ISO weeks as cut, on a closed triage decision that a week is a period label rather than an instant. A candidate named for a standard must accept the standard *within the scope the story has*; it does not reopen what the scope excludes. Ordinal dates (`2025-001`) stay out and stay in the ledger: nothing has ever weighed them, they need no weekday arithmetic, and the reason they wait is that this story converts nothing.
- **Century rule (spec-owned, not code-chosen):** a two-digit year `yy` reads as `20yy` for `00–29` and `19yy` for `30–99` — Excel's fixed pivot, so the office ecosystem querbeet replaces agrees with it. Never a sliding window: a Recipe re-run in a later year must read the same date. **It applies to the two-digit mirror of every dmy and mdy four-digit pattern** — `dd.MM.yy`, `MM.dd.yy`, `dd/MM/yy`, `MM/dd/yy`, `dd-MM-yy`, `MM-dd-yy` — and to `dd.MM.yy HH:mm(:ss)`. Six four-digit patterns against one two-digit one was the century rule reaching German dot dates and nothing else, which is a separator deciding whether a rule applies; the symmetry is the rule. **`yyyy-MM-dd` gets its two-digit mirror `yy-MM-dd` as well, and the argument that first excluded it was exactly backwards.** That argument said `yy-MM-dd` and `dd-MM-yy` are the same six characters in the same three groups, so admitting it would make a dash column ambiguous three ways over a shape no exporter writes. Measured on the tree that shipped without it: `['25-12-31','25-01-15','25-06-30']` reads as `date` / `dd-MM-yy` / **`settled`** — 25 December **1931** — because `25` exceeds twelve and is therefore taken as decisive *day* evidence, while `MM-dd-yy` reads nothing and leaves no runner-up to argue with. Refusing the candidate did not make a truncated ISO date unreadable. It made it readable **as the wrong thing**, with no question raised and the gate open — the invisible wrong answer these Boundaries call the one kind this story keeps refusing. Ambiguity was never the danger here; it is the correct answer, and the machinery to report it has been in the file since story 3. With the mirror in, such a column reads under two candidates, neither excludes the other, and the person decides. The mirror is dash-only because `yyyy-MM-dd` is: a mirror is owed to a four-digit pattern that exists, and `yy/MM/dd` would be a new candidate rather than a reflection of one. `readsAsDate`'s `ymd` + `shortYear` branch becomes **reachable** with the mirror — it is what reads `yy-MM-dd` — and its ledger entry closes.
- **`dmy` is the declared preferred order for two-digit years, and a column that reads only under the other one is asked about rather than typed.** With both orders in the list, `31.12.25` and `01.13.03` become structurally identical: each is a date under exactly one order and nonsense under the other. No rule can tell a German date from a padded part number by looking at the values, because there is nothing there to tell them apart — so the tie-break is a stated preference, exactly as the cross-kind declaration order already is. `dd.MM.yy` and its **slash** twin settle their columns as before; a column whose only date reading is `MM.dd.yy`, `MM/dd/yy` or `MM-dd-yy` is **`unresolved` between `date` and `text`**, and the user answers. **The dash twin is the exception, and it is the `yy-MM-dd` mirror that makes it one:** `31-12-25` is 31 December 2025 under `dd-MM-yy` and 25 December 1931 under `yy-MM-dd`, both real dates, so `31` no longer decides anything — that column asks a *reading* question where its dot and slash twins do not. This is the price of the mirror rather than a flaw in the preference, and it is the right price: it is the same ambiguity that made `25-12-31` a silently wrong date, seen from the other end. The dash is where ISO lives, so the dash is where a two-digit year is genuinely undecidable.
  **Why a question and not a refusal, and why not a silent date.** A wrong *type* that the card shows and the type select reverses costs one click. A candidate that does not exist costs everything: the column reads `text`, which looks like an answer, and choosing `Datum` then offers no reading that fits — a mistake the tool does not let the user correct. That asymmetry is why the mdy mirrors are in the list at all. But a column of `01.13.03` typed as a settled date shows *nothing* on the card, and an invisible wrong answer is the one kind this story keeps refusing. Asking costs one click on a real American export and buys back both.
  A triple that reads as a date under **no** candidate still settles the column as `text` — `01.32.03` and `99.99.99` are unaffected, and that clause keeps its precedence over this one.
- **What the mdy mirrors cost, named rather than discovered:** `shortYearVerdict` decides date-against-version by asking whether any value's **day** exceeds twelve, and it takes that day from the first part — true for `dmy` and false for `mdy`, where the first part is a month that can never exceed twelve. The part order must come from the candidate rather than from `parts[0]`. **The reason first given for that was overtaken by the preferred-order rule above, one decision later, and is corrected here rather than left standing:** it said an `MM.dd.yy` column would otherwise report `unresolved` for ever, and under the preference such a column reports `unresolved` by design — the gate opens when the person answers, which is the point. What remains true is narrower and is the actual reason: the day test is the difference between a date and a version number, and reading a month where the day is meant is simply the wrong question, whatever the verdict downstream does with the answer. The consequence to be honest about: only a preferred candidate reaches the day test, so the order lookup's `mdy` and `ymd` answers are computed and can never change a verdict today. It stays derived from the candidate anyway — the day it would be hand-set to zero is the day the preference changes and nobody remembers this line.
- **A user's answer closes the question they answered, not one they were never asked.** With both orders in the list, a column like `03.04.25`, `05.06.25` carries **two** questions: the kind question (`date` or `text`, because three two-digit parts settle nothing) and, behind it, the ordering question its four-digit twin already asks. The kind question is asked first and the reading select stays suppressed while it is open. When the user then chooses `Datum`, the column must become `unresolved` **over the reading** rather than `settled` — the ordering question was never put to them, and answering it for them is the same defect as the settled version-number column this story opened with. A chosen type settles the column only where nothing else in it is still open. **This is a rule about types, not about dates**, and it was written from the date case only because that is where it was found: choosing `Zahl` on a column whose de-DE and en-US readings tie now returns `unresolved` over the reading too, where it used to settle silently on German. The number column is the common case in a report, so it is the one this rule earns its keep on — a reading picked for the user is a reading picked for every value in the column, and `1.234` is a thousand or one point two three four depending on an answer nobody gave.
- **Three two-digit parts settle nothing.** A `dd.MM.yy` column in which **every** value has all three parts two-digit — `01.02.03`, `04.05.06` — is `unresolved`, not `settled`: it can be a date, and nothing in the column decides whether it is one. Version numbers, chapter numbers and part numbers have exactly this shape, and before this story they read as `text`; a settled date is a *worse* answer than the one they used to get. The user chooses date or text and the gate stays shut until they do — story 3's machinery, on the case it was built for. **Two things settle such a column, and both are evidence in the values rather than a preference:** a day past twelve settles it as a date, because `31` is no month and no version number counts that way by accident — which is why `31.12.25`, the shape the owner actually asked for, is unaffected; and a triple that cannot be a date under **any** candidate settles it as text, because `01.32.03` is a version number and nothing else. That example used to be `01.13.03`, and it stopped being true the moment `MM.dd.yy` joined the list: 13 January 2003 is a reading that value genuinely has. The rule survived the amendment, its example did not — and `01.13.03` is now caught one clause later, by the preferred-order rule above, which asks about it rather than typing it. Only triple-shaped values are asked this question, so one stray word beside twenty real dates is still twenty dates and one unparsed value.
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
| Two-digit year | `31.12.25`, `01.03.26` | `date`, `dd.MM.yy`, century rule → 2025 — **`decisive`**, because `31` is no month and that is a count worth naming; the card renders the sentence | N/A |
| Century pivot | `01.01.29` / `01.01.30` | 2029 / 1930 | N/A |
| Two-digit year on the other separators | `31/12/25`, `01/03/26` | `date`, `dd/MM/yy`, `decisive` — the century rule is not a separator's privilege | N/A |
| The same shape on the dash, where `yy-MM-dd` exists | `31-12-25`, `01-03-26` | `date`, **`unresolved` over the reading** (`dd-MM-yy` \| `yy-MM-dd`) — 31 December 2025 and 25 December 1931 are both real dates, and `31` no longer decides anything the mirror does not also read. The kind question is closed; the ordering one is not | N/A |
| Truncated ISO date | `25-12-31`, `25-01-15`, `25-06-30` | `date`, **`unresolved` over the reading** (`dd-MM-yy` \| `yy-MM-dd`) — before the mirror this was `date` / `dd-MM-yy` / `settled`, which is 25 December **1931** with no question raised | N/A |
| The same shape on the slash | `25/12/31`, `25/01/15`, `25/06/30` | `date`, `dd/MM/yy`, `settled` — 25 December 2031. The mirror is owed to a four-digit pattern that exists and there is no `yyyy/MM/dd`, so this is residue with a ledger entry rather than a case this decision covers | N/A |
| A dash column only `yy-MM-dd` reads | `40-12-31`, `55-06-30` | `date`, `yy-MM-dd`, **`unresolved` between `date` and `text`** — the mirror carries no `preferred` flag, so it is asked about exactly as an mdy mirror is | N/A |
| Two-digit year, American order | `12/31/25`, `03/04/25` | `unresolved` between `date` and `text` — the only reading is the non-preferred order, so the user answers; choosing `Datum` then settles it on `MM/dd/yy` in one click | N/A |
| Padded part numbers, same shape | `01.13.03`, `02.14.04`, `03.15.05` | `unresolved` between `date` and `text` — identical treatment, because the values are identical in kind | N/A |
| A triple with no reading at all | `01.02.03`, `01.32.03`, `04.05.06` | `text`, `settled` — no candidate reads `01.32.03`, and that clause keeps its precedence | N/A |
| Unpadded version numbers | `1.2.3`, `1.13.3`, `2.0.1` | `text` — not triple-shaped, untouched by all of this | N/A |
| Both questions on one column | `03.04.25`, `05.06.25` | `unresolved` over the **kind** first; after the user chooses `Datum`, `unresolved` over the **reading** (`dd.MM.yy` against `MM.dd.yy`) — never `settled`, and no reading is written onto the record either | N/A |
| The same rule on a number column | `1.234`, `5.678`, user chooses `Zahl` | `unresolved` over the **reading** (`de-DE` against `en-US`), gate shut — `bestFormat` answers `null`, because a thousand and one-point-two-three-four are different numbers and nobody said which | N/A |
| The same rule, reading named | `1.234`, `5.678`, user chooses `Zahl` **and** `Deutsch` | `settled`, 2 of 2 — a chosen type settles the column wherever nothing else in it is open | N/A |
| A boolean column the rule already disqualified | `ja`, `false`, user chooses `Boolescher Wert` | `settled` on `true/false`, 1 of 2 — the pair is a property picked like the affix (most values, ties to the pair declared first), never a reading question, because a pair never mixes and neither answer would make this a boolean column | N/A |
| ISO end of day | `2025-12-31T24:00:00Z` | `datetime`, settled — legal ISO, means the next midnight | N/A |
| Not the end of day | `2025-12-31T24:01:00Z` | not readable — hour 24 only with a zero clock | `typing.unparsed_values` |
| `24:00` standing alone | `08:15`, `24:00` | `duration`, decisive — unchanged, the clock machinery does not move | N/A |
| ISO basic format | `20251231T1430`, `20251230T0915` | `datetime`, settled | N/A |
| Basic format without the `T` | `20251231`, `20251230` | `number` — eight digits are a number, not a date | N/A |
| Zone offset at the edge | `…T14:30:00+14:00` | `datetime`, settled — the widest offset any zone has | N/A |
| Zone offset past the edge | `…T14:30:00+14:01`, `…+23:59` | not readable | `typing.unparsed_values` |
| Zone offset the standard itself refuses | `…T14:30:00-00:00` | not readable — ISO 8601 has no negative zero. `+00:00`, `-00:01` and `Z` read | `typing.unparsed_values` |
| The westward slack the symmetric bound buys | `…T14:30:00-13:00` | `datetime`, settled — no zone has it, and the bound is a typo filter rather than a zone table | N/A |
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

Line anchors are as shipped after the 2026-08-03 amendments, **re-measured against the file
rather than adjusted**. Before this round every anchor for `typing.js` except `DATE_PATTERNS` was
wrong by exactly four lines — the signature of a list edited once and a map corrected by arithmetic
instead of by looking. The rule that follows from it: an anchor is read out of the file at the end
of the round, never carried forward with a delta applied.

- `core/types/catalog.js:45` — `TYPES`: `time`, `duration` (`settable: true`, `native: false`); `settable` flipped on `DATETIME`/`BOOLEAN`. `canonicalTypeGaps` filters on `native`, so no `CANONICAL` entry is owed. `catalog.test.js` pins the flags and that no reader may declare a clock.
- `core/types/typing.js` — the whole story lives here. `freezeDeep:140` (a candidate list is a rule, so the array *and* its entries *and* their nested `date` objects are frozen — every one of these lists is exported, and `preferred` lives on the list because "there is no second list", so a writable list was that argument's one hole); `DATE_PATTERNS:176` (seven four-digit patterns against seven two-digit mirrors, `yyyy-MM-dd`'s being `yy-MM-dd` and dash-only; the three dmy mirrors carry `preferred: true`, which is where the two-digit tie-break is declared, and `yy-MM-dd` deliberately does not carry it); `dateCandidates:194`; `DATETIME_PATTERNS:265` (four candidates, everything optional on every one of them); `BOOLEAN_PAIRS:281` (+ `BOOLEAN_TOKEN_MAX:292` derived from it); `CLOCK_CANDIDATES:307` (two candidates of one kind, so `score`/`exclusive` answer time-vs-duration verbatim); `AFFIXES:317`; `MARKS:347` (derived — `:` and the affixes feed it, or narrowing silently disables candidates); `peelWrappers:452` (the sign and the unit, from the outside in, in either order — the sign counted and carried) gated by `carriesAccountingEvidence:507`, so the two accounting forms are read only where the column vouches for them; `numberParts:539`, **exported for story 6**, returning `{ digits, fraction, negative }` — enough to rebuild the value, which is what the export is for; `readsAsNumber:571`, `exceedsSafeInteger:587` (integer digits, never a float round trip) and `hasLeadingZero:602`, which peels the accounting spellings unconditionally because it hunts hidden zeros rather than proposing a reading; `readsAsDate:620` (width table gets the 2-digit year; its `ymd`+`shortYear` branch is what `yy-MM-dd` now takes, and the comment records that it was kept through the rounds it was unreachable rather than deleted to reach coverage); `DATETIME_CLOCK:680` / `BASIC_CLOCK:693` / `BASIC_DATE:699` / `OFFSET_MAX_MINUTES:723` / `readsAsOffset:734` (symmetric ±14:00 as a typo filter rather than a zone table, `-00:00` refused because the standard refuses it) / `readsAsEndOfDay:746` and `readsAsClockTime:760`/`readsAsDateTime:778` (one clock validated in one place, never narrower behind a date, wider by exactly fraction, zone and end-of-day `24:00`; basic format read as a pair so the standard's no-mixing rule holds, and the basic *date* scoped to the ISO candidate); `affixScan:822`; `ambiguity:982` — the one place a verdict is decided, for detection and a re-score alike; `detectColumn:1031`, `mixedBooleanPairs:1105` disqualifying the boolean kind unconditionally, and `found:1186` — the closure that merges both column-wide findings into every post-scan return, so the field cannot be carried on one route and forgotten on another; `dayIndex:1274` (**exported**, because no column reaches its `mdy` or `ymd` answer through `detectColumn` and a derivation nothing can observe is one a mutation can delete) + `shortYearVerdict:1329` (three two-digit parts settle nothing; the *text* test asks the whole candidate list and the *day* test asks the winning candidate, and a day past twelve settles the column only under the preferred order — text first, then the preference, then the day, in that order and not another); `candidatesFor:1373`; `booleanReadings:1454` + `readingsFor:1490` (what narrows and what deliberately does not: `number` for correctness, `boolean` because a pair never mixes so there is no reading question between two of them, `date`/`datetime` not at all — a candidate whose separator the column lacks reads nothing, and `ambiguity` already treats a runner-up that reads nothing as no contest); `bestFormat:1518`, which reads the column's unit before it ranks the readings and answers `null` where the column names no reading at all; `scoreColumn:1550` re-scores every new kind, re-derives the affix and the accounting evidence together, is `settled` **only where nothing else in the column is open**, and writes **no format** where it comes back `unresolved` — a reading nobody chose is not put on the record story 14 serializes; `unresolvedColumns:1672`, where the verdict alone is the test.
- `core/types/typing.test.js` — every matrix row above, per piece; regression block for story 3 verdicts; `scorableTypeGaps` and `canonicalTypeGaps` as the two completeness invariants; the carried sign in all four spellings and both nestings.
- `core/exec/source-store.js:41` — `typingDiagnostics` (exported, because story 14 will hand it a typing this file did not build): `typing.mixed_affixes` and `typing.mixed_boolean_pairs:92`, both reported whatever kind wins, and the kind-ambiguity state emitting `typing.ambiguous_kind` rather than overloading `typing.ambiguous_locale`. The unresolved test is the **verdict alone**, as in `unresolvedColumns` — a chosen type is no longer an exemption, because a choice can close the kind question and leave the reading question open. `resolveFormat:604` keys on `pattern ?? locale` and refuses a reading no candidate offers — with no early return for any type, since `bestFormat` already answers `null` where there are no candidates, and it now also answers `null` where the column names no reading, which is what carries "not chosen" into `scoreColumn`. **`null` is a legitimate reading for every type**, not only for the three that have none: this function *writes* `{ type: 'date', format: null }` on a column whose reading the user was never asked for, and it used to throw on being handed that same object back — a shape the store produces and refuses, which is exactly the call story 14 makes when it restores a choice. `setColumnTyping:633` needs no change: settability comes from the catalogue.
- `ui/type-labels.js:20` — `Uhrzeit`, `Dauer`; completeness test `typeLabelGaps` already bites.
- `ui/SourcesPane.vue` — `patternLabel:238` gains `yy → JJ`, which is what renders the new `yy-MM-dd` as `JJ-MM-TT`; `readingLabel:262` learns datetime patterns and boolean pairs; `isKindQuestion:268`/`typeUndecided:275` put the placeholder on the **type** select *and* suppress the reading select while a kind question is open; `verdictText:331` words a kind question as a type and now returns `''` on a record whose evidence is absent or half-filled, the same hardening `typingDiagnostics` already had — a restored record with nothing to say renders nothing rather than throwing or printing a sentence with a hole in it; the German sentence for `typing.mixed_boolean_pairs:197` names both pairs and does not claim the column is read as text; the card shows a column's affix. The reading select's placeholder keys on the **verdict alone** (`:940`) rather than on the verdict beside an unanswered choice: a user who chose `Datum` on a two-digit-year column closed the kind question and was never asked the ordering one, so that control is where the open question is answered and it must not display an answer nobody gave. `ui/SourcesPane.test.js` covers wording, both placeholders, the suppressed select, the placeholder that survives a chosen type, every date reading in German field letters, the affix render and the empty-evidence record.
- `tests/e2e/typing.spec.js` — four journeys: the ERP export (timestamp, clock-time, ja/nein, percent, accounting) resolving time vs. duration and opening the gate; duration settling itself beside a mixed-unit column; the timestamps SQL Server, Postgres and ISO 8601 actually write; and the version-number column that must be asked about rather than dated.
- `_bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md:168` — AD-21 amendment (nanoseconds as `BigInt`, one unit for all four temporal types).
- `tests/e2e/typing.spec.js:303` — the version-number journey now also walks the second question: answering `Datum` brings the reading select back with its placeholder, the gate refuses again, and `Text` is still one click away.
- `_bmad-output/implementation-artifacts/deferred-work.md` — after the 2026-08-03 amendments, three of the ten story-4a entries are closed (the two-digit mirrors with `shortYearVerdict`'s `dmy` assumption, as one decision; the zone offset), one records two ISO shapes taken and two remaining, and the detection-cost entry carries the new measurement. **After the fifth amendment the `ymd` branch entry is closed too** — by the amendment that reached it, which is the entry's own stated trigger — and three are opened: the slash and dot `yy` residue, the datetime list's one two-digit candidate, and leap seconds beside ordinal dates. The rest are unchanged: the Parquet reader's own rounding, fractional-part precision, negative durations, the unconditional mixed-affix rule, and the boolean-pair narrowing (which reads with the detection-cost entry, not instead of it). The two entries this line used to list as still open — the missing `MM.dd.yy` mirror and `shortYearVerdict`'s `dmy` assumption — are the closed pair named at the start of it, and listing them twice was this sentence contradicting itself. After the **fourth** amendment the closed pair's status is restated rather than deleted: it recorded the `01.13.03` loss as a cost taken, and the owner removed the cost instead by declaring `dmy` the preferred two-digit order, so an mdy two-digit column is now the kind question rather than a decisive date.
- `_bmad-output/specs/spec-querbeet/stories.yaml` — story 14 gains the **five** record fields this story added (`affix`, `mixedAffixes`, `mixedBooleanPairs`, `evidence.over`, and a `chosen.format` of `null` on a type that has readings) plus the `BigInt` encoding, as things an older Recipe will lack; story 6 gains the `24:00`-is-the-next-calendar-day hazard, which is a conversion defect this story's reading rule makes reachable.
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
- [x] `core/types/typing.js` + tests — amendment 1: the five two-digit mirrors, `dayIndex` for `shortYearVerdict`, and `scoreColumn`/`bestFormat`/`unresolvedColumns` so a chosen type settles only what it answered.
- [x] `core/types/typing.js` + tests — amendment 2: end-of-day `24:00` and ISO basic format on the datetime clock, read as a pair so basic and extended never mix.
- [x] `core/types/typing.js` + tests — amendment 3: the zone offset bounded at ±14:00, with the minute bound kept in front of it.
- [x] `core/exec/source-store.js`, `ui/SourcesPane.vue`, `tests/e2e/typing.spec.js` + tests — the still-open reading reaches the diagnostic, the select placeholder and the gate.
- [x] `deferred-work.md` — three entries closed, one narrowed, one restated, and the detection measurement into the cost entry's `evidence`.
- [x] `core/types/typing.js` + tests — round 4 / amendment 5: `yy-MM-dd`, the mirror `yyyy-MM-dd` was owed; the `ymd`+`shortYear` branch becomes reachable and its ledger entry closes.
- [x] `core/types/typing.js` + tests — round 4: the text-settling rule asks the whole candidate list, as the Boundaries word it, rather than the winning candidate.
- [x] `core/exec/source-store.js` + `core/types/typing.js` + tests — round 4: `format: null` is a legal stored reading for every type, the store's `chosen` round-trips, and no reading nobody chose is written onto the record.
- [x] `core/types/typing.js` + tests — round 4: `-00:00` refused, the offset bound's symmetry argued rather than asserted, the candidate lists frozen entry-deep, and the boolean pair picked as a property rather than asked as a question.
- [x] `core/types/typing.test.js` — round 4: five mutations that shipped green, each closed with the case that kills it; `dayIndex` exported so the one that had no observer has one.
- [x] `stories.yaml` — round 4: story 6 gets the `24:00`-is-the-next-day hazard; story 14's list of round-tripping fields is six rather than four.
- [x] `deferred-work.md` + Code Map — round 4: the `ymd` branch closed, three entries opened (slash/dot `yy` residue, the datetime list's one two-digit candidate, leap seconds beside ordinal dates), the detection-cost entry's summary and its two column mixes made legible, and every `typing.js` anchor re-measured rather than adjusted.

**Acceptance Criteria:**
- Given the type vocabulary, when `time` and `duration` are added, then they are declared in `core/types/catalog.js` and nowhere else — no second list anywhere restates the types.
- Given a column of clock times with no value past 24:00, when detection runs, then the Source cannot be confirmed until the user chooses `Uhrzeit` or `Dauer` — the gate blocks on `unresolved` exactly as for the locale case.
- Given an affixed column with a user-overridden reading, when `setColumnTyping` re-scores it, then the affix property survives on the record.
- Given `numberParts`, when it reads a value, then its return carries everything story 6 needs to rebuild that value — the integer digits, the fractional digits, and the sign — so that `12,5` and `12` are distinguishable in the return and no second parser is owed.
- Given a column in which values read under two different boolean pairs, when detection runs, then `boolean` is disqualified for the whole column and a warning names both pairs, at any ratio.
- Given a column whose only sign marks are parentheses or trailing minuses and in which no value carries a decimal or grouping mark, when detection runs, then no value reads as a negative number.
- Given a two-digit-year column on any of the three separators and in either part order, when detection runs, then the century rule applies exactly as it does to `dd.MM.yy` — and `shortYearVerdict` asks about the part the candidate calls the day.
- Given a two-digit-triple column whose kind question the user answers with `Datum`, when the column is still ambiguous over the reading, then it is `unresolved` over the reading rather than `settled` — and the record carries **no** format, because a reading nobody chose must not be serialized beside a `chosen.format` of `null`.
- Given **any** type whose readings the column does not decide between — `number` as much as `date` — when the user chooses that type and no reading, then the column is `unresolved` over the reading and the gate stays shut; this is a rule about types, and the number column is the common case in a report.
- Given a chosen type with no reading, when the store stores it, then the `chosen` it writes is a shape it will accept back — story 14 restores a choice by replaying that exact object, so a shape the store produces and refuses is a defect whichever end finds it.
- Given the zone offset, when it is bounded, then the bound is ±14:00 in **both** directions and `-00:00` is refused — the one change in this story that *removes* readings a prior version accepted, so it is stated as a criterion rather than left to a task and a test.
- Given ISO 8601's basic format, when a value carries `T`, then `20251231T1430` reads with seconds, fraction and offset optional exactly as in the extended form — and a bare `20251231` stays a number, and basic and extended never mix in one representation, offset included.
- Given `yyyy-MM-dd`, when the century rule is applied, then it has its two-digit mirror `yy-MM-dd` on the dash, so a truncated ISO date is asked about rather than read as a `dd-MM-yy` date in 1931.
- Given a candidate list handed to a caller, when the caller writes to it, then nothing changes: the lists and their entries are frozen, because `preferred` lives on the list on the argument that there is no second list.
- Given `24:00`, when it stands alone it is `duration` evidence exactly as before, and when it stands behind an ISO date with a zero clock it reads as a datetime.
- Given the story-3 test suite, when this story lands, then every existing verdict, count and diagnostic is unchanged.
- Given `npm run verify`, then lint, both Vitest projects and Playwright (Chromium + Firefox, `file://`) pass.

## Spec Change Log

### 2026-08-03 — review round 4, as built: the mirror that was owed, and two frozen sentences it leaves standing

**Three owner decisions and thirteen measured defects, in one order.** Every number below was
measured on the tree before the change and again after it; nothing here is inferred from a diff.

**(A1) `yy-MM-dd` joins `DATE_PATTERNS`, dash-only, not preferred.** Before: `['25-12-31',
'25-01-15', '25-06-30']` → `date` / `dd-MM-yy` / **`settled`** — 25 December 1931, no question
raised, gate open. After: `date` / `dd-MM-yy` / **`unresolved`**, evidence `{ alternatives:
['dd-MM-yy', 'yy-MM-dd'] }`. It is the **reading** question and not the kind question, which is
what the owner asked to have measured rather than assumed: the column is a date either way, so the
reading select is where it is answered and `over: 'kind'` is correctly absent. `readsAsDate`'s
`ymd`+`shortYear` branch is reachable, its ledger entry is **closed with the resolution** rather
than deleted, and `dayIndex` answers `2` for the new candidate. A column whose *only* reading is
`yy-MM-dd` — `['40-12-31', '55-06-30', '88-01-15']`, where `40` is no day — is `unresolved` between
`date` and `text`, because the mirror carries no `preferred` flag; measured, and it is what the
non-preferred rule predicts.

**The cost of A1, which is not the case the amendment was written about, and is the headline.**
`['31-12-25', '01-03-26']` moves from `date` / `dd-MM-yy` / **`decisive`** to the same reading
question, because 31 December 2025 and 25 December **1931** are both real dates and `31` no longer
decides anything the mirror does not also read. The Boundaries' own amendment sentence covers it —
"such a column reads under two candidates, neither excludes the other, and the person decides" — and
it is the *correct* answer by the amendment's own argument. But it is the shape the owner originally
asked the two-digit year for, one separator over, and it now costs a click. The dot and the slash
are untouched (`['31.12.25','01.03.26']` and `['31/12/25','01/03/26']` are still `decisive`),
because neither has a four-digit ymd pattern to be a mirror of. Flagged rather than absorbed.

**Two frozen sentences the fifth amendment leaves false, flagged rather than edited, because the
block is the owner's.** (1) The amended century-rule bullet still ends "`readsAsDate`'s `ymd` +
`shortYear` branch therefore stays unreachable and stays in the file, with its ledger entry" — a
leftover from the paragraph the amendment replaced. The branch is reachable, the entry is closed,
and the sentence needs the owner's pen. (2) The preferred-order bullet says "`dd.MM.yy` and its
slash and dash twins settle their columns as before"; the dash twin does not, per the paragraph
above.

**(A2) End-of-day `24:00` on all four candidates: no code change, and it is now pinned rather than
believed.** Measured: `31.12.2025 24:00`, `2025-12-31 24:00`, `31.12.25 24:00` and
`2025-12-31T24:00:00Z` all read, `24:01` reads on none of the four, and `24:00` standing alone is
still exclusive `duration` evidence. The case that pins it now walks `candidatesFor(DATETIME)`
rather than sampling it. **What `24:00` means is the next calendar day**, and story 6's brief in
`stories.yaml` now says so with the failure mode spelled out: a conversion reading the date part and
the hour independently is off by exactly one day on every value this admits, and on 31 December by a
year — invisible in the counts, because the values it admits are the ones nothing else distinguishes.

**(A3) `bestFormat` answering `null` is a rule about types, not about dates.** No behaviour change:
`bestFormat(['1.234','5.678'], 'number')` already answered `null` and `scoreColumn` already came back
`unresolved` with the gate shut. What was missing was that the criterion, the matrix and the tests
were all date-shaped, so the rule was true and unobserved on the type it earns its keep on — a report
is mostly number columns, and `1.234` is a thousand or one point two three four depending on an
answer nobody gave. One acceptance criterion, four matrix rows, a unit case and a store-level case.

**(B1) The text-settling rule now asks the whole candidate list, as the Boundaries word it.** It
asked the winning candidate. Measured before: nineteen `31.12.25` beside one `01.13.03` settled as
**text**, because `01.13.03` is no `dd.MM.yy` date — although 13 January 2003 is a reading it
genuinely has, which is exactly what the rule's justification ("a version number and nothing else")
denies. After: `date` / `dd.MM.yy` / `decisive`, 19 of 20. The rule's own cases are unmoved,
including the one that proves its precedence rather than agreeing with it: nineteen `01.13.03`
beside one `01.32.03` is still `text`, `settled`, with the *non*-preferred candidate winning.

**(B2) The store wrote a `chosen` shape its own command rejected, and story 14 is the caller.**
`setColumnTyping(id, i, { type: 'date' })` on a genuine tie left `format: undefined`, so
`resolveFormat` returned `bestFormat(…)` — `null` since the fourth amendment — and wrote
`{ type: 'date', format: null }`. Replaying that exact object hit `throw new TypeError('a date column
needs a reading')`. `null` now means "no reading chosen" for **every** type rather than only for the
three that have none, and the round trip is pinned.

**(B3) A reading nobody chose is no longer written onto the persisted record.** Measured:
`scoreColumn(['03.04.25','05.06.25'], { type: 'date', format: null })` returned `verdict:
'unresolved'` **and** `format: { pattern: 'dd.MM.yy', … }` beside a `chosen.format` of `null`. The
card hid it because the reading select keys on the verdict, which is what kept it invisible rather
than what made it harmless. **Decided: the record carries `null`, so it agrees with `chosen`.** The
counts are unaffected and stay honest — `ambiguity` answers `unresolved` exactly when the two
readings parse the same number of values, so the count reported is true of *both* alternatives
rather than of the one dropped. Detection's own unresolved records keep their format, and
deliberately: nothing has been chosen there, so there is no `chosen` to disagree with, and that
shape is asserted whole by the story-3 suite.

**(B4) Three zone offsets the code's own comment argued against. Decided: keep the symmetric bound
and rewrite the comment to argue for it; refuse `-00:00` separately.** `-00:00` is the standard's
own rule and not this bound's — ISO 8601 has no negative zero — so it is refused on its own terms
while `+00:00`, `-00:01` and `Z` read. The asymmetry was **not** implemented, and the reason is that
the argument for it does not survive its own terms: "the widest offset any zone has" gives −12:00
only for *current* zones, and tzdata carries Asia/Manila at −15:56 before 1844 and America/Anchorage
at +14:00:24 before 1867. A bound that has to name its own exceptions is not the rule it looks like.
The bound is a **typo filter**, not a zone table: what it exists to refuse is `+23:59`, and it does
that in both directions. The price is two hours of westward slack, named rather than discovered —
`-13:00` reads and no zone has it — and it is now in the Boundaries' offset clause and in a test.

**(B5) Every Code Map anchor for `typing.js` except one was wrong by exactly four** — the signature
of a list edited once and a map corrected by arithmetic instead of by looking. Re-measured against
the file after this round's changes landed, not adjusted, and the Code Map now states that rule.

**(B6) `preferred` was a rule and a mutable global.** Measured: `Object.isFrozen(dateCandidates())`
`true`, `Object.isFrozen(dateCandidates()[2])` `false`, and `dateCandidates()[2].preferred = false`
flipped `['31.12.25','01.03.26']` from `decisive` to `unresolved` process-wide — from a caller that
only meant to render a reading select. All four candidate lists are now frozen entry-deep (a
datetime candidate carries a nested `date` object, and freezing the outside of that is the same hole
one level down), `candidatesFor` returns a frozen empty rather than a fresh `[]`, and the invariant
is derived from the catalogue so a settable type added later cannot slip past it.

**(B7) Choosing `boolean` on a mixed-pair column asked a question the rule forbids. Decided: it is
not a question at all.** Measured before: `unresolved` between `ja/nein` and `true/false`, 1 of 2.
The frozen rule says a column reading under two pairs is not a boolean column *at any ratio*, so
neither answer would make it one — the card was asking the user to pick a side in a mixture. The
rule's own words are "exactly as two affixes do" and "mirroring the affix rule field for field", and
the affix rule's re-score behaviour is settled: the unit is re-derived as the one covering most
values, the minority counts unparsed, the finding is dropped because the user has answered. The pair
is now picked the same way — most values, ties to the pair declared first — so `['ja','false']` is
`settled` on `true/false` at 1 of 2, and nineteen `ja` beside one `false` is `settled` on `ja/nein`
at 19 of 20. What the choice costs is the unparsed count, which is the same sentence `scoreColumn`
already carries about `mixedAffixes`. Detection is untouched: two pairs still disqualify `boolean`
for the whole column with a warning naming both.

**(B8) The isolated performance explanation miscounted two of three separators.** `DATE_PATTERNS` by
separator: before the mirrors `.` 3, `/` 2, `-` 3; after them `.` 4, `/` 4, `-` 5; after `yy-MM-dd`
`-` 6. "Four where it scored three" was true of the dot alone and was written as if it held for all
three, understating the slash by half. Corrected in the module header and in the ledger.

**(B9) The detection-cost ledger entry's summary carried a number its own evidence had overtaken,
and its two absolutes were illegible.** The summary said 3.96 s while the evidence added ~1.3× on
top and reported 4.75–4.96 s and 2.28–2.50 s for "the same NFR-3 shape", separated by a parenthetical
about the column mix. The summary now carries the ratio and says explicitly that no single absolute
belongs in it; the evidence names the two mixes once — **Mix A, report-shaped** and **Mix B,
light** — and every figure is labelled with its mix. Four absolutes from three mixes on two machines
were sitting in one paragraph, each true and none comparable.

**(B10) Story 14's brief was short by two states**, and is now six: `mixedBooleanPairs` (a fifth
record field, added in round 3) and `format: null` on a `date` column (a legal stored state this
round created), with the loader's failure mode spelled out — treating the `null` as absent and
re-proposing a best reading answers for the user the question the record exists to keep open.

**(B11) A completeness claim of the reviewer's own was false.** The ISO ledger entry said ordinal
dates are "the one ISO 8601 shape this candidate refuses that nobody has ever weighed";
`detectColumn(['2025-12-31T23:59:60Z', …])` is `text` and nothing has ever weighed a leap second
either. `23:59:60` is one *second* value exactly as `24:00` is one *hour* value, it needs no calendar
arithmetic to read, and real systems emit it. The entry is restated to **enumerate** every ISO shape
with its status — taken, cut, or open and never weighed — so the claim is checkable rather than
asserted. Leap seconds are **not** implemented; the finding is that nobody had listed them.

**(B12) Five mutations that shipped green, each closed with the case that kills it.** (1) The
zero-fraction clause in `readsAsEndOfDay`: the old case asserted `counts.unparsed === 0` on
`['2025-12-31 24:00', '01.03.2026 24:00']`, which is **already `text`** at a 0.5 hit rate, so a text
fallback satisfied it — replaced with the nine-good-values helper, whose `unparsed === 0` cannot be.
(2) `candidate.iso` on the basic-date scoping: pinned with a column carrying a colon, where the ISO
candidate is not the only one scored. (3) `BASIC_CLOCK`'s colon-free offset: `20251231T1430+02:00` is
basic wearing an extended zone, and the standard's no-mixing rule reaches the offset too. (4)
`scoreColumn`'s affix gate: reverting it to `present && format` takes
`scoreColumn(['1.234 €','2.345 €','3.456 €'], { type: 'number', format: null })` from `{ affix: '€',
parsed: 3, unresolved }` to `{ affix: null, parsed: 0, **settled** }` — the verdict flip is the
finding, because it opens the gate on a column where nothing was read, one UI click away. (5)
`dayIndex = () => 0`: **no column reaches its `mdy` or `ymd` answer through `detectColumn`**, since
the preference is consulted before the day, so there was nothing to observe it with. `dayIndex` is
now exported and the case walks `dateCandidates()`, asserting for every candidate that the part at
that index is the day. A derivation nothing can observe is one a mutation can delete, and that is
written into its docblock beside the reason it stays derived.

**(B13) Five smaller ones, all measured.** The matrix row for `31.12.25` named no verdict while that
column had moved from `settled` to `decisive` with a rendered sentence. The ±14:00 bound and ISO
basic format had tasks, rows and tests but no acceptance criterion — and the bound is the one change
in this story that *removes* readings a prior version accepted, so it now has one. The e2e comment
explained itself with `03.04.25`, a value its fixture does not contain; it names the fixture's own
`01.02.03` and `04.05.06`. And `readingsFor`'s docblock claimed a narrowing it does for `number` and
not for `date` — **decided: make the docblock true.** It now says what narrows and what deliberately
does not, with the reason: a candidate whose separator the column lacks reads nothing, and
`ambiguity` already treats a runner-up that reads nothing as no contest, so narrowing dates there
would change no verdict and no count while costing a `marksPresent` pass this path does not make.

**Three ledger entries opened, one closed, one restated, one rewritten.** Opened: the slash and dot
`yy` residue A1 does not cover (`25/12/31` is still `dd/MM/yy`, `settled`, because there is no
`yyyy/MM/dd` to be a mirror of); `DATETIME_PATTERNS` carrying one two-digit candidate on one
separator against the century rule's own symmetry argument (`['31.12.25 14:30', …]` is `datetime`
while the slash, dash and mdy twins are all `text`) — both **Ask First**, because both widen a frozen
candidate list. Closed: the unreachable `ymd` branch, by the amendment that reached it. Restated:
the ISO-shapes entry, with leap seconds. Rewritten: the detection-cost entry.

**Detection cost, measured and not optimised.** `yy-MM-dd` adds one candidate on one separator. At
the NFR-3 shape of 100,000 × 20 on a report-shaped mix, four paired runs in alternating order, best
of three per run: **2.65/2.69/2.68/2.66 s before against 2.72/2.74/2.74/2.74 s after — about
+2.5 %**. It is the honest counterweight to the five mirrors' ~1.3×: the cost is per candidate per
separator, so what was expensive was the *number* of mirrors and not the idea of one. Not optimised,
per the standing decision that no route out of detection's cost gets chosen by feel.

**Verified after the change**, not asserted: `npx eslint .` clean; `npx vitest run` 388 tests across
11 files, from a baseline of 379; `npx playwright test` 111 passed, 1 skipped. **Nine mutations were
run and each now fails** — one each for A1 (1 failure), B1 (1), B4 (1) and B6 (1), and all five of
B12's (2, 1, 1, 1, 1). The file was restored byte-identically after every one.

**KEEP.** Everything the four rounds established: the nanosecond representation, the digit-comparing
overflow guard, the restructured clock reader and its never-narrower invariant, the two-digit-triple
question with both settling mechanisms, the declared `dmy` preference living on the candidate list,
the order-independent `peelWrappers` loop and its two-mark rule, the four boolean pairs and their
unconditional no-mixing rule, the affix scored as a candidate, and the type-select placeholder.


### 2026-08-03 — correction: ISO week dates were never in scope, and the review put them back

**The owner caught this, not a review layer.** Review round 3's adversarial layer reported that the
candidate named `ISO 8601` refuses week dates (`2025-W01-1`) alongside `24:00`, basic format and
ordinal dates. That report is *true* and is not a finding: `deferred-work.md`'s closed triage entry
had already cut ISO weeks and quarters, with the reason that a week is a **period label rather than
an instant** and belongs to whatever story first groups by period — and this spec's own **Never**
section names them as cut, in the same sentence as exponential notation and `integer`.

The ledger entry written from that report listed week dates as open residue, the frozen bullet
repeated it, and a code comment in `typing.js` called them "the residue". Three places reopened a
closed decision, and the mechanism was the one this story keeps finding in other people's work: a
claim taken from a report without checking the list that already answered it. Corrected in all
three; the entry is now about ordinal dates alone.

**Ordinal dates are unaffected by the correction and the entry stands** — no cut list mentions
them, so nothing has ever weighed them. They are also cheaper than the entry first implied, and
lumping the two together hid that: `2025-001` is 1 January and `2024-366` is 31 December, so
bounding one is the leap-year rule already in the file and converting one is the year's first day
plus n−1. No weekday arithmetic. The week form needs it twice over — to validate (2025 has 52 ISO
weeks, 2026 has 53, and you cannot see which by looking) and to convert (`2025-W01-1` is
**30 December 2024**, not a day in 2025 at all). The two were never one question.

### 2026-08-03 — the fourth owner amendment, as built: `dmy` is declared, and the list is where it is declared

The amendment answers the loss the previous entry reported. The mdy mirrors made `31.12.25` and
`01.13.03` structurally identical — each a date under exactly one part order and nonsense under the
other — and nothing in the values tells a German date from a padded part number, so the tie-break
had to be a *stated preference* rather than a reading of the data. It is the same shape as the
cross-kind rule already in the file ("a tie goes to the kind declared first, and the declaration
order is the rule").

**Where it lives is the whole of the change.** `preferred: true` sits on the three dmy two-digit
mirrors in `DATE_PATTERNS`, so a reader of the list sees the preference in the list rather than
finding a `order === 'dmy'` comparison inside `shortYearVerdict`. There is no second list.
`shortYearVerdict` reads `candidate.preferred` and nothing else, which is why moving the flag onto
the mdy mirrors would be one edit to the list and none to the function — and why `dayIndex` stays
written from the candidate although the preferred order's day is always the first part today.

**The precedence is three tests in a fixed order, and the order is the rule:** text first, then the
preference, then the day past twelve. A triple that reads as a date under *no* candidate is a
version number whichever order was declared preferred, so `['01.02.03', '01.32.03', '04.05.06']` is
`text`, `settled` — and so is nineteen `01.13.03` beside one `01.32.03`, which is the case that
proves the ordering rather than merely agreeing with it, because there the winning candidate is the
non-preferred one.

**Measured, before against after.** Unchanged: `['31.12.25','01.03.26']`, `['31/12/25','01/03/26']`
and `['31-12-25','01-03-26']` all `date` / dmy / `decisive`; `['01.02.03','01.32.03','04.05.06']`
and `['1.2.3','1.13.3','2.0.1']` `text`, `settled`; `['01.02.03','04.05.06','07.08.09']` the kind
question as before; `['03.04.2025','05.06.2025']` `unresolved` over the *reading*, because at four
digits a part of `2025` is a year and the ordering question can be asked. Moved, all four from a
settled or decisive date to `unresolved` over `kind`: `['12/31/25','03/04/25']`,
`['12.31.25','03.04.25']`, `['12-31-25','03-04-25']`, `['01.13.03','02.14.04','03.15.05']`, and
nineteen `01.02.03` beside one `01.13.03`.

**One click, not two.** The kind question answered with `Datum` must not be followed by a reading
question the column has already settled. `bestFormat(['12/31/25','03/04/25'], 'date')` answers
`MM/dd/yy` — it reads 2 of 2 where `dd/MM/yy` reads 1, so `exclusive` counts 1 against 0 — and
`scoreColumn` comes back `settled`, 2 of 2. The genuine tie is untouched and still costs two
answers: `['03.04.25','05.06.25']` yields `null` from `bestFormat` and `unresolved` over
`dd.MM.yy | MM.dd.yy` from `scoreColumn`.

**One frozen sentence the amendment leaves without its reason, flagged rather than edited.** The
Boundaries' "What the mdy mirrors cost" bullet ends "The part order must come from the candidate,
or every `MM.dd.yy` column reports `unresolved` for ever and the gate never opens on one." The code
still does exactly what that sentence requires, and `dayIndex` is still right — but every
`MM.dd.yy` column now reports `unresolved` anyway, deliberately, because that is what the
preference decides. So the *rule* stands and its *justification* has been overtaken: what
`dayIndex` buys today is that moving `preferred` onto the mdy mirrors is one edit to the list and
none to `shortYearVerdict`. That is written into `dayIndex`'s docblock, where the code can carry
it; the frozen sentence needs the owner's pen.

**No detection cost, measured rather than asserted.** The change adds no candidate and no walk —
`DATE_PATTERNS` is the same thirteen entries with one extra boolean on three of them, and
`shortYearVerdict`'s loop is unchanged. At the NFR-3 shape of 100,000 × 20 with the report-shaped
column mix, four paired runs in alternating order: **2.28–2.50 s before, 2.26–2.54 s after**, best
of three per run 2.28/2.30/2.28 against 2.29/2.26/2.29. Indistinguishable, and no route out of
detection's cost was touched.

### 2026-08-03 — the three owner amendments, as built: two frozen sentences the change makes false

The three amendments in the Frozen block were implemented as written. Two of them collide with
sentences elsewhere in that same block, and both are flagged here rather than edited, because the
block is the owner's.

**(1) "The extra part is exactly fraction and zone" is now one item short.** The invariant the
Boundaries pin in both directions says the datetime clock is never narrower than the standalone
clock and wider by exactly two things. End-of-day `24:00` is a third: `24:00` behind a date reads,
`24:00` standing alone is still `duration` evidence and still not a `time`. The invariant survives
the change and its wording does not — "never narrower" holds unchanged, and what follows it needs
the third item. The test that pins it is code and was changed with the code (its name now says
*three* things, and `24:00`/`24:00:00` are pinned as read-behind-a-date and refused-standing-alone,
with `24:01`/`24:00:01` refused in both places). The frozen sentence needs the owner's pen.

**(2) "`01.13.03` is a version number and nothing else" is false the moment `MM.dd.yy` exists —
and the owner did not accept that as a cost; he answered it with a fourth amendment.** This
paragraph originally reported the loss as a consequence taken, and that is not what shipped. What
was measured is unchanged: before the mirrors, `['01.02.03', '01.13.03', '04.05.06']` → `text`,
`settled`, because 13 is no month and the value read under no date candidate; with the mirrors and
nothing else, `date`, `MM.dd.yy`, `decisive`. What was wrong was the sentence after it — "no
implementation preserves both". One does, and it is the declared preference the owner then wrote
into the Boundaries: `dmy` is the preferred order for two-digit years, so a triple readable only
the other way is neither a date nor text but the **kind question**, and the person answers it. As
shipped, `['01.02.03', '01.13.03', '04.05.06']` is `date` / `MM.dd.yy` / `unresolved` over `kind`.
The rule the Boundaries state ("a triple that cannot be a date at all settles it as text") was
untouched throughout and still fires first — `['01.02.03', '01.32.03', '04.05.06']` is `text`, and
twenty `01.02.03` beside one `99.99.99` is `text`. Only the example moved: `01.32.03` replaced
`01.13.03`, and the Boundaries now say so. See the amendment below for what was built.

**What a chosen type settles, and why it needed one machine rather than two.** `scoreColumn`'s
verdict was `settled` by construction, which was true only while every choice arrived with a
reading attached. It does not survive the mirrors: `03.04.25` beside `05.06.25` asks the kind
question first, the reading select is suppressed while it is open, and a user who answers `Datum`
has never been shown the ordering question. The route built for it is the one that adds no second
opinion: `bestFormat` — already the one function that answers "what reading do we propose for a
type the user just chose" — now answers **`null` where the column names no reading**, using the
same `score`/`exclusive` test detection uses; that `null` is what tells `scoreColumn` the reading
was not chosen, and `scoreColumn` then scores the candidates exactly as detection does. The
`if`-block that decided a verdict from two hits was extracted as `ambiguity` and all three callers
share it, so there is one place that decides when a reading is undecided rather than three.

**The `chosen === null` clause is gone from three predicates, and that is the same decision.** The
gate, the diagnostics and the reading select each asked "unresolved *and* nobody has answered",
which was a proxy for "the answer settled it" — true while `scoreColumn` always said `settled`.
Now the record's verdict already accounts for the answer, so the clause is redundant where it is
harmless and wrong where it is not: with it, a column whose reading is still open would drop out
of the gate the moment its type was chosen. `typeUndecided` keeps its clause, and deliberately —
it asks whether the *type* question is open, and a chosen type closes that one whatever else is
still open.

**Deliberately not optimised, with the cause isolated.** The five mirrors cost ~1.3× at the NFR-3
shape and are the whole of it; the always-scored ISO candidate costs nothing measurable. Both
numbers, the variants they came from and the untried route are in the detection-cost ledger entry,
under the standing decision that no route out of detection's cost is chosen by feel.

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

## Suggested Review Order

**Start here — the competition the whole story is**

- Five kinds scored independently; the highest hit rate at 0.9 proposes, declaration order breaks ties.
  [`typing.js:1031`](../../core/types/typing.js#L1031)

**The vocabulary — declared once, or not at all**

- `time` and `duration` enter here; `datetime` and `boolean` flip settable. No second list anywhere.
  [`catalog.js:45`](../../core/types/catalog.js#L45)

- Every type owes a German word; the completeness test bites when one is missing.
  [`type-labels.js:20`](../../ui/type-labels.js#L20)

**Reading one value — where a wrong number could be born**

- Sign and unit peeled from the outside in, order-independent, at most one sign mark.
  [`typing.js:452`](../../core/types/typing.js#L452)

- The accounting forms need column evidence: `4711-` is a part number, not minus 4711.
  [`typing.js:507`](../../core/types/typing.js#L507)

- Exported for story 6: digits, fraction and sign — enough to rebuild the value.
  [`typing.js:539`](../../core/types/typing.js#L539)

- Overflow compared as digits, never through a float round trip (C-10).
  [`typing.js:587`](../../core/types/typing.js#L587)

- One datetime clock, never narrower than the standalone one, wider by fraction, zone and `24:00`.
  [`typing.js:680`](../../core/types/typing.js#L680)

- Basic format is a representation of the whole value, so it is gated on the ISO candidate.
  [`typing.js:693`](../../core/types/typing.js#L693)

- The offset bound is a typo filter, not a zone table — and the comment now says so.
  [`typing.js:723`](../../core/types/typing.js#L723)

- The affix is scored as a candidate, so one stray `1.000,00 €` does not claim the column.
  [`typing.js:822`](../../core/types/typing.js#L822)

**Deciding a column — the questions this story chose to ask**

- One place decides every verdict: settled, decisive, or unresolved with its alternatives.
  [`typing.js:982`](../../core/types/typing.js#L982)

- Three two-digit parts settle nothing; two kinds of evidence do, and `dmy` breaks the rest.
  [`typing.js:1329`](../../core/types/typing.js#L1329)

- The part order comes from the candidate, so moving `preferred` is one edit to the list.
  [`typing.js:1274`](../../core/types/typing.js#L1274)

- One closure carries both column-wide findings into every return, so no route can forget one.
  [`typing.js:1186`](../../core/types/typing.js#L1186)

**Answering back — a choice closes the question it answered, and no other**

- `null` where the column names no reading: the user was never asked, so nothing is picked.
  [`typing.js:1518`](../../core/types/typing.js#L1518)

- Settled only where nothing else is open — the same ambiguity machinery detection uses.
  [`typing.js:1550`](../../core/types/typing.js#L1550)

- A reading no candidate offers is refused for every type, and `null` round-trips.
  [`source-store.js:604`](../../core/exec/source-store.js#L604)

- The shape written here is the shape replayed here — story 14 restores through this call.
  [`source-store.js:633`](../../core/exec/source-store.js#L633)

- Exported because story 14 will hand it a typing this file did not build.
  [`source-store.js:41`](../../core/exec/source-store.js#L41)

**What the person actually sees**

- A kind question is answered in the type select, so the reading select is suppressed.
  [`SourcesPane.vue:268`](../../ui/SourcesPane.vue#L268)

- Renders nothing rather than a sentence with a hole where evidence is missing.
  [`SourcesPane.vue:331`](../../ui/SourcesPane.vue#L331)

- Names both pairs and does not claim the column is read as text.
  [`SourcesPane.vue:197`](../../ui/SourcesPane.vue#L197)

**The decisions, written where the next story will look**

- AD-21 amended: nanoseconds as `BigInt`, one unit for all four temporal types.
  [`ARCHITECTURE-SPINE.md:168`](../planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md#L168)

- Story 6 converts: the unit, and that `24:00` means the next calendar day.
  [`stories.yaml:191`](../specs/spec-querbeet/stories.yaml#L191)

- Story 14 serializes: six states an older Recipe will lack, not four.
  [`stories.yaml:325`](../specs/spec-querbeet/stories.yaml#L325)

- Eleven open story-4a entries — each an Ask First or a Source nobody has yet.
  [`deferred-work.md:7`](./deferred-work.md#L7)

**Tests last, but the mutations are the point**

- Every matrix row, the story-3 regression block, and the two completeness invariants.
  [`typing.test.js:1`](../../core/types/typing.test.js#L1)

- Diagnostics, format resolution, and the choice that survives a re-score.
  [`source-store.test.js:1`](../../core/exec/source-store.test.js#L1)

- Wording, both placeholders, the suppressed select, and the empty-evidence record.
  [`SourcesPane.test.js:1`](../../ui/SourcesPane.test.js#L1)

- Four journeys, both engines, from `file://`.
  [`typing.spec.js:1`](../../tests/e2e/typing.spec.js#L1)
