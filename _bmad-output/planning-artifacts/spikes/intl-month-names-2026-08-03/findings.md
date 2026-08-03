# Spike: month-name spellings across the engines this product runs in

**Date:** 2026-08-03 · **Answers:** the two questions story 4b left for its spec checkpoint
**Engines:** Node v26.5.1 (ICU 78.3, Unicode 17.0, tz 2026a), Chromium 151.0.7922.34, Firefox 153.0
**Apparatus:** `probe.mjs` — one measurement function run unchanged in every engine; `run-spike.mjs` — the runner and the comparison; raw output in `measurements.json`

## The questions

Story 4b holds two things open for its spec:

1. Can a browser's ICU version shift a spelling (`Sept.` against `Sep.`), and therefore does a **set of accepted spellings per month** beat one exact string? An engine update must not turn a typed column back into text. AD-27 makes this a measurement, not a reading.
2. English ordinal suffixes (`Aug 2nd, 2026`) — Intl never emits them, exporters do.

It also states four things as already measured. Three of them are re-measured here because the spike had to build the table anyway, and one of them turns out to be understated.

## A third engine, which the story does not name

The story frames drift as a browser question. It is not only that. AD-27 puts `core/`, `ports/` and `adapters/` under Vitest with `environment: 'node'`, and `typing.js` lives in `core/`. If the month table is derived from `Intl` at runtime, **the table the unit tests see is Node's ICU, not the browser's** — so a disagreement between Node and a browser is a test that passes green while the product fails. Node is therefore measured here as a first-class engine, not as a convenience.

Measured: it agrees. That closes the risk for today's versions rather than removing it, which is precisely what the frozen fixture below is for.

## Cross-engine agreement — total, today

Over the three locales in scope × two widths × twelve months = **72 cells per engine**:

| Check | Result |
| --- | --- |
| cells compared per engine | 72 |
| disagreements within the product matrix (Node, Chromium, Firefox) | **0** |
| locale data genuinely present, not silently fallen back | 6/6 per engine, all three |
| the owner's `2. Aug. 2026` reproduced byte for byte | YES, all three |
| the owner's `31. Juli 2026` reproduced byte for byte | YES, all three |
| ordinal suffix emitted by Intl, over 2 016 rendered values per engine | **none**, all three |

The fallback check is not a formality. A missing locale would hand back an English table under a German tag, and every value in it would look plausible and be wrong. `resolvedOptions().locale` is asserted per formatter.

WebKit was measured too, as a fourth independent ICU outside the product matrix. It could not be launched: Playwright's `webkit-2336` needs host system packages installed through `sudo npx playwright install-deps`, which is an apt path on an Arch machine. It is recorded as skipped rather than quietly dropped. Nothing here depends on it.

## The finding that decides question 1 — and it is not drift

**en-US abbreviates September to `Sep`. en-GB abbreviates it to `Sept`.** Both are in scope from the start, because the story puts English in scope from the start.

So the two spellings the story feared an ICU *update* might swap between are **both already present today, from two locales, in every engine measured**. Together with German `Sept.` that is three spellings of one month across the vocabularies 4b must accept anyway:

| Month | Spellings across de-DE, en-US, en-GB (both widths) |
| --- | --- |
| 9 | `Sept.`  `September`  `Sep`  `Sept` |

**A set of accepted spellings per month is therefore forced by the locales in scope, independently of whether ICU ever drifts.** Question 1's design answer is settled on evidence available now, and it does not depend on the unresolved part.

That matters for planning: before this spike the fallback plan was to research CLDR release history if all engines agreed today — because agreement today proves nothing about tomorrow. All engines *did* agree, and the research is **still not needed**, because the decision it would have informed is already made by en-US against en-GB. Drift remains unproven either way; it just no longer blocks anything.

## The union vocabulary, and why one candidate is safe

The story proposes ONE candidate over the union of both vocabularies and all three orderings, rather than a reading select nobody can answer, on the argument that a month name identifies its own shape. That argument holds only if no spelling means two different months — so it is computed rather than eyeballed, under the normalization an implementation will plausibly apply (case-folded, trailing point dropped, so an exporter writing `AUG` or `Aug` where CLDR says `Aug.` does not become a second vocabulary):

| Check | Result |
| --- | --- |
| distinct normalized spellings across all three locales, both widths | 34 |
| spellings that mean two different months | **0** |

**The union is unambiguous. One candidate is sound**, and the reading select the story wanted to avoid is avoidable on measured grounds.

Full table, as an implementation must accept it:

| Month | Spellings | Month | Spellings |
| --- | --- | --- | --- |
| 1 | `Jan.` `Januar` `Jan` `January` | 7 | `Juli` `Jul` `July` |
| 2 | `Feb.` `Februar` `Feb` `February` | 8 | `Aug.` `August` `Aug` |
| 3 | `März` `Mar` `March` | 9 | `Sept.` `September` `Sep` `Sept` |
| 4 | `Apr.` `April` `Apr` | 10 | `Okt.` `Oktober` `Oct` `October` |
| 5 | `Mai` `May` | 11 | `Nov.` `November` `Nov` |
| 6 | `Juni` `Jun` `June` | 12 | `Dez.` `Dezember` `Dec` `December` |

## Format context against standalone — the story understates this

The story's claim (3) is that the table must come from `formatToParts` of a whole date rather than from `{month:'short'}` alone, because "standalone yields `Aug` and `Jul`, in a date the same option yields `Aug.` and `Juli`". The direction is right and the size is wrong. Measured, German short:

```
in a date    Jan.  Feb.  März  Apr.  Mai  Juni  Juli  Aug.  Sept.  Okt.  Nov.  Dez.
standalone   Jan   Feb   Mär   Apr   Mai  Jun   Jul   Aug   Sep    Okt   Nov   Dez
```

**Eleven of twelve differ. Only `Mai` coincides.** A table built the easy way is not slightly wrong at two entries — it is wrong nearly everywhere, and it misses both of the owner's values. The discipline the story asks for is not a refinement, it is the difference between a working feature and a broken one.

The story's claim (2) is confirmed exactly: CLDR abbreviates only the long names, so `Jan. Feb. Apr. Aug. Sept. Okt. Nov. Dez.` carry a point while `März Mai Juni Juli` stand in full without one. `Sept.` has four letters, so a three-letter rule is wrong — confirmed.

## The three shapes, from the same formatter as the table

Claim (4) — that adding English costs a second vocabulary and a second ordering but no new ambiguity — is confirmed at the pattern level. `formatToParts` of 2 August 2026, literals quoted:

| Locale | Skeleton | Rendered |
| --- | --- | --- |
| de-DE | `<day> ". " <month> " " <year>` | `2. Aug. 2026` |
| en-US | `<month> " " <day> ", " <year>` | `Aug 2, 2026` |
| en-GB | `<day> " " <month> " " <year>` | `2 Aug 2026` |

The month name's position identifies the shape inside every value, and the union check above proves no value reads as two different dates.

## Question 2 — ordinal suffixes

Intl emits none, over 2 016 rendered values per engine (12 months × 28 days × 6 locale/width combinations), in all three engines. So `Aug 2nd, 2026` cannot be derived from Intl and is not in any table built from it. Whether to accept it is a spec decision for 4b about what exporters emit, not a measurement — and this spike deliberately does not make it. What it does establish is that accepting it means adding a rule Intl will never justify, which is the kind of hand-written addition the derivation discipline exists to keep out.

## Verdict, and what changes for story 4b

- **Accept a set of spellings per month, not one exact string.** Decided on en-US `Sep` against en-GB `Sept`, today, in every engine — not on speculation about ICU updates.
- **The CLDR-history research is not needed.** The question it would answer no longer changes the design.
- **Derive the table from `Intl` in format context, and freeze this measurement as a test fixture.** Runtime derivation follows the engine, which is right; the frozen table is what turns a future ICU change into a failing test instead of a column that silently falls back to text. This is the same move the xlsx spike's workbook makes for the `TableWriter` adapter — a fixture whose whole job is to fail the day something moves underneath it.
- **Node is the third engine and belongs in 4b's brief.** `core/` runs under `environment: 'node'`, so its ICU is the one the unit tests see. It agrees today; the fixture is what keeps that honest.
- **The union is safe: one candidate, no reading select.** 34 spellings, 0 collisions.
- Ordinal suffixes remain 4b's call. The measurement says Intl will not hand them over.

**Re-run `node run-spike.mjs` from the repo root** whenever Node or a browser is upgraded. Its comparison section fails loudly by printing a non-zero disagreement count; the day that number moves is the day the set of accepted spellings needs a new entry.
