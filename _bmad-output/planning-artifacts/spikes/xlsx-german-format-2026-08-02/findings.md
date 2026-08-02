# Spike: German number and date formats through `write-excel-file`

**Date:** 2026-08-02 · **Answers:** PRD open question 6 / SPEC open question on CAP-36
**Versions:** `write-excel-file` 4.1.1, `read-excel-file` 9.3.5 (both the pinned versions)
**Apparatus:** `run-spike.mjs`, output `german-format-probe.xlsx`, extracted `styles.xml`, LibreOffice render in `render/`

## The question, and why most of it did not need Excel

The open question read: *do `write-excel-file`'s format codes render as German decimal commas in a real German Excel?* It was filed as needing a human with a German Excel installation.

Most of it did not. The question conflates three things, and only the third needs Microsoft Excel:

1. **Does the library write real numbers and real dates, or strings?** A format code applied to a string formats nothing. Machine-checkable.
2. **Which format-code dialect is correct?** xlsx stores format codes **locale-neutrally** — `.` is the decimal separator and `,` the thousands separator *inside the code*, and the consuming application renders them per the user's locale. So the right code for German output is `#,##0.00`, and writing `#.##0,00` because it "looks German" is a defect. Checkable against any locale-aware renderer.
3. **Does Microsoft Excel specifically agree?** Needs Microsoft Excel.

## What the library actually writes

All eight codes reach `xl/styles.xml` verbatim as custom `numFmt` entries, ids 100–107. Nothing is rewritten, normalized or silently dropped:

```
numFmtId 100  #,##0.00              numFmtId 104  dd.mm.yyyy
numFmtId 101  #.##0,00              numFmtId 105  DD.MM.YYYY
numFmtId 102  [$-407]#,##0.00       numFmtId 106  [$-407]dd.mm.yyyy
numFmtId 103  #,##0.00\ "€"         numFmtId 107  yyyy-mm-dd
```

The library is a pass-through for format codes. Whatever is wrong with a code is the caller's fault, which puts the whole decision in querbeet's own adapter.

## Round trip — cell types are real

Read back through `read-excel-file` 9.3.5, over a stated population rather than "all of them":

| Check | Result |
| --- | --- |
| cases read back | 13 of 13 |
| every numeric case is a JS `number` | YES (7/7) |
| every date case is a JS `Date` | YES (4/4) |
| leading zero `0123` survived as text | YES |
| umlauts and euro sign survived | YES |

## Rendering — confirmed in one independent German-locale renderer

LibreOffice, converted under `LC_ALL=de_DE.UTF-8`. Every case renders as the design requires, **and the predicted trap fires:**

| ID | Code | Rendered | Verdict |
| --- | --- | --- | --- |
| N1 | `#,##0.00` | `1.234,56` | correct |
| **N2** | **`#.##0,00`** | **`1.234,56000`** | **WRONG — the "German-looking" code is a defect** |
| N3 | `[$-407]#,##0.00` | `1.234,56` | correct, prefix unnecessary |
| N4 | *(none)* | `1234,56` | correct — General, no grouping |
| N5 | `#,##0.00` | `1.234.567,89` | correct |
| N6 | `#,##0.00` | `-1.234,56` | correct |
| N7 | `#,##0.00\ "€"` | `1.234,56 €` | correct |
| D1 | `dd.mm.yyyy` | `31.12.2025` | correct |
| D2 | `DD.MM.YYYY` | `31.12.2025` | correct — case-insensitive |
| D3 | `[$-407]dd.mm.yyyy` | `31.12.2025` | correct, prefix unnecessary |
| D4 | `yyyy-mm-dd` | `2025-12-31` | correct |
| T1 | *(text)* | `0123` | correct |
| T2 | *(text)* | `Größenmaß Äöü ß — 12,50 €` | correct |

## Verdict

**The design question is settled. The product claim is not yet fully verified.**

Settled, and this is the part that changes what gets built:

- **Write locale-neutral format codes. Never write a German-looking one.** `#,##0.00` for numbers, `dd.mm.yyyy` for dates. `#.##0,00` is the trap and it is the code a German-speaking developer will reach for.
- **The `[$-407]` locale prefix is unnecessary** and buys nothing here. It also *pins* the rendering to German rather than following the reader's locale, which is the wrong behaviour for a file the recipient may open anywhere — leave it off.
- Date codes are case-insensitive; the lowercase form is conventional.
- Cell types are real, so the format codes have something to format.

Still open, and it is now a one-open-one-look check rather than an investigation: **does Microsoft Excel agree with LibreOffice?** LibreOffice implements the same specification and is strong evidence, but it is a different product, and the two most plausible places to diverge are the escaped currency literal (`\ "€"`, N7) and the locale prefix (N3, D3) — neither of which querbeet needs to use. The rows querbeet's adapter will actually depend on are N1, N5, N6, D1, T1 and T2, and all six are the plainest cases in the sheet.

**To close it:** open `german-format-probe.xlsx` in a German Excel and read the last two columns against each other. N2 must look wrong; everything else must match.

## Two API findings for the `TableWriter` adapter

Both cost this spike a run, and both will otherwise cost the adapter one:

- **`write-excel-file` 4.1.1 has no `filePath` option.** The v1/v2 signature is gone; the call returns `{ toBuffer, toStream, toFile }`. In the browser the path is `toBuffer`.
- **`read-excel-file` 9.3.5 returns `[{ sheet, data }]`**, not a flat grid, when no sheet is specified. Indexing the wrapper as rows yields an empty set — which made this spike's first run report "every case passed" over zero cases. Every verdict in `run-spike.mjs` now prints the population it ran over, because an "all of them passed" that cannot say how many is the same sentence whether the answer is 7 or 0.
