---
title: 'Story 3 — Typing as Step zero: detection, ambiguity, and a confirmation gate'
type: 'feature'
created: '2026-08-02'
status: 'draft'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
  - '_bmad-output/planning-artifacts/research/technical-type-and-locale-detection-2026-08-01/research.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every cell in a loaded Source is a string, and nothing says what it means (CAP-9, FR-9). `1.234` is one thousand two hundred thirty-four or it is 1.234, and no downstream Step — filter, join, aggregate — can be right until a person has settled that. Today nothing asks.

**Approach:** Detect a type and, where relevant, a number or date locale per column by reading **every** value, report what the evidence supports — including the state where nothing settles it — let the user correct any column, and record the mapping as confirmed per Source. Confirmation is a state in `core/exec`, not a UI flag, so the scheduler's AD-29 gate has something real to read when it arrives.

## Boundaries & Constraints

**Always:**
- FR-9: detection reads **every value in the column, never a sample**. Every comparable engine samples and that is the documented cause of silent corruption; a querbeet column holds at most the NFR-3 target and detection is already a column walk.
- Two ambiguity outcomes are distinguished and worded differently: one reading carries decisive evidence and the count is named ("47 values have a day above 12, so dd.mm"), **or nothing in the column settles it** and the system says exactly that instead of naming a winner. The second is severity `unresolved` (`core/diagnostics`), which exists for this.
- The proposed type, the proposed locale and the share of values that parse are shown per column. Changing a type or locale recomputes the share immediately.
- Missing tokens (`-`, `n/a`, `k.A.`, empty) are declared per column and are part of the confirmed typing, not a display setting — they change null shares, grouping, join matching and "is empty".
- A leading-zero value such as `0123` stays text unless the user says otherwise.
- AD-20: a reader declares each column's domain. A `native:<type>` column skips locale inference and is presented as pre-typed, but still passes the missing-value sweep and is still confirmable — the gate must not degrade into a rubber stamp for typed formats.
- AD-13: `core/` emits codes and values; German lives in `ui/`. AD-6: no table or column array enters `ref`/`reactive`/`computed`.
- AD-1/AD-2: detection is pure, framework-free, browser-free, and unit-tested under the `core` Vitest project. Any `ui/` branch it grows is tested in the `ui/` project (AD-27).
- Confirmation is per Source and survives a rename. A re-read that changes the columns (encoding, delimiter, header row) invalidates it — the mapping described columns that no longer exist.

**Ask First:** adding `date-fns` (R5's pick for date parsing) or any other runtime dependency; storing the confirmed mapping in a Recipe file (the Recipe module does not exist yet); changing `SourceReader`'s return shape.

**Never:** converting cell values into typed values — boxed cells (AD-22) and UTC-midnight epoch milliseconds (AD-21) are assumed to belong with the `Table` port in story 6, for the reason in Design Notes; this story decides *what a column is*, not what its cells become. Column annotations (FR-10). Enforcing the gate inside a scheduler that does not exist yet (story 7+) — this story owns the state the gate reads. Any typed-syntax surface (NFR-9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| German numbers | column of `1.234,56`, `80,00` | type `number`, decimal `,` group `.`, hit rate 100 % | N/A |
| Anglo numbers | column of `1,234.56` | type `number`, decimal `.` group `,`, and the pane states which reading it chose | N/A |
| Decisive dates | `03/04/2025` plus 47 values with a day above 12 | `date`, `dd.mm`, with the deciding count named | N/A |
| Irreducibly ambiguous | every value parses under both readings | severity `unresolved`, no winner named, the column is unconfirmable until the user picks | N/A |
| Leading zeros | `0123`, `0456` | stays `text`; a numeric reading is offered, never applied | N/A |
| Missing tokens | user declares `k.A.` missing in a column | those cells count as missing, not as unparsed; hit rate recomputes | N/A |
| Partial parse | 842 of 900 values parse as a date | hit rate reported as 842/900; the 58 are listed as unparsed, original text kept | N/A |
| Native column | reader declares `native:number` | pre-typed, no locale inference, still swept for missing values, still confirmable | N/A |
| Confirm | user confirms a Source whose columns are all settled | Source reads confirmed; a Source with an `unresolved` column cannot be confirmed | refuse, naming the columns |
| Re-read invalidates | confirmed Source, user changes the header row | confirmation drops, the pane says so | N/A |

</frozen-after-approval>

## Code Map

- `core/types/typing.js` — new: the detection engine. Pure. Per column: candidate enumeration, full-column scan, hit counts per candidate, the decisive-evidence count, and the `unresolved` verdict when two candidates tie at full coverage. Number separators come from `Intl.NumberFormat('<locale>').formatToParts` (R5) — never a hand-written table. Budget throughput as rows × columns × candidates: no library infers a format, so the candidate loop is ours in every case (R5).
- `core/types/typing.test.js` — new: the matrix above, plus the boundary cases R5 named — a column that is 100 % parseable under both readings, a day-above-12 that appears only in the last rows (the sampling trap), `0123`, and an all-missing column.
- `core/types/encoding.js:1-40` — read-only: the shape to copy. A `core/types` module is pure, exports named constants, and carries its reasoning in the header.
- `core/exec/source-store.js:116-161` — `addSource` mints the entry; add `typing` alongside `table`/`proposal`/`damage`. `reRead` (L78-107) is where a re-read must drop a confirmation.
- `core/exec/source-store.js:201-225` — `reconfigureParse` is the model for a new `setColumnTyping(id, columnName, patch)` command: validate at the boundary, rebuild a frozen entry, never mutate.
- `core/exec/source-store.js:227-235` — the returned surface; `confirmTyping(id)` and `unconfirmTyping(id)` join it. `list()`/`get()` stay the only readers.
- `core/exec/source-store.test.js` — the command tests to extend: confirmation refused while a column is `unresolved`, confirmation dropped by `reconfigureParse` and `overrideEncoding`, kept by `renameSource`.
- `core/diagnostics/diagnostic.js:29-62` — `unresolved` already exists and is documented as CAP-9's severity. Emit `typing.ambiguous_locale`, `typing.unparsed_values`, `typing.unconfirmed` through it; no new severity.
- `adapters/csv/csv-reader.js:262-268` — read-only: every CSV column is `domain: 'text'`. AD-20's `native:<type>` has no producer yet (XLSX is story 4), so that branch ships tested against a fake reader result, not a real file.
- `ui/SourcesPane.vue:251-268` — the counts line and the correction controls; the per-column typing panel goes with them, above the preview grid. `refresh()` (L23) already re-projects after every command.
- `ui/RowWindow.vue` — read-only this story: unparsed cells are marked when values become boxed (story 6), not now.

## Tasks & Acceptance

**Execution:**
- [ ] `core/types/typing.js` + `typing.test.js` — detection, hit rates, the two ambiguity verdicts — the whole matrix lives or dies here.
- [ ] `core/exec/source-store.js` — `typing` on the entry, `setColumnTyping`, `confirmTyping`, `unconfirmTyping`, and confirmation invalidation on re-read — AD-10 commands, frozen entries.
- [ ] `core/exec/source-store.test.js` — the confirmation lifecycle, including what invalidates it.
- [ ] `ui/SourcesPane.vue` — the per-column panel: proposed type, locale, hit rate, the ambiguity sentence, the corrections, and the confirm action — German, `ui/` only (AD-13).
- [ ] `ui/SourcesPane.test.js` — the `unresolved` branch and the disabled confirm action, in the `ui/` envelope (AD-27).
- [ ] `tests/e2e/typing.spec.js` — a German-number Source and an irreducibly ambiguous one, confirmed and refused, from the built artefact.

**Acceptance Criteria:**
- Given a column whose decisive value sits past row 20,480, when detection runs, then it is found — the sampling trap is a test, not a comment.
- Given a Source with one `unresolved` column, when the user confirms, then confirmation is refused and the column is named.
- Given a confirmed Source, when the header row changes, then the confirmation is gone and the pane says so.
- Given `npm run verify`, then lint, both Vitest projects and Playwright (Chromium + Firefox, `file://`) pass.

## Spec Change Log

## Design Notes

- **The sampling trap is the point of the story.** DuckDB scans 20,480 rows, Arquero 1,000, Power Query 200, Frictionless 100 — and the value that resolves `03/04/2025` is decisive only inside the window scanned. R5 found a reproduction of the resulting corruption on a 2 GB file. querbeet reads the column.
- **No prior art exists for the reporting half.** DuckDB, Power Query, LibreOffice and Frictionless all resolve locale ambiguity silently; DuckDB documents a tie-break where dd-mm beats mm-dd with no warning. The override prior art worth copying is Power Query's "Change Type → Using Locale", which asks for type and locale in one action.
- **A 100 % hit rate under both readings is the case the wording must survive.** FR-9's example wording is a hit rate ("842 of 900 readable"), which answers a different question than ambiguity — a column can be fully readable both ways. That is the `unresolved` state, and it needs its own sentence.
- **Dates need a dependency decision.** No library infers a format; R5 picked `date-fns` 4.4.0 for parsing against a supplied pattern, with `d3-time-format` as runner-up. Luxon lost on throughput: 356 ms per 100,000 values *per candidate*. This is an Ask First.
- **Why conversion is assumed out of scope, and the assumption that carries it.** The story's own dev note names boxed cells (AD-22) and UTC-midnight epoch ms (AD-21), and FR-9 does list unparsed values as marked and inspectable — so this is a narrowing, made deliberately and open to reversal. Two facts drive it. The entry's `table` is the **raw** parsed table: story 2's preview renders it as text exactly as parsed, and CAP-39's damage inspection reads from it, so converted values cannot replace it in place. A converted column would therefore be a **second full copy of every column** — against R4/D2's budget, where 100k × 20 already costs 80.2 MB as an engine table — and where that copy lives is a `Table`-port question (AD-5), not a typing question. Detection can report the unparsed **count** per column without holding the converted values, which is what FR-9's hit rate actually needs. If the human wants conversion here, the memory question has to be answered first.

## Verification

**Commands:**
- `npm run lint` — clean; proves `core/types` stays DOM-free.
- `npm test` — both projects; the detection matrix and the confirmation lifecycle green.
- `npm run test:e2e` — builds `dist/` and runs both engines from `file://`.
