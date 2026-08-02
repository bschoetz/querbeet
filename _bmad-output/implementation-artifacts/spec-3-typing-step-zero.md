---
title: 'Story 3 — Typing as Step zero: detection, ambiguity, confirmation, annotations'
type: 'feature'
created: '2026-08-02'
status: 'done'
review_loop_iteration: 1
# The commit the spec was approved at, immediately before implementation.
# Everything after it is story 3's diff, including the two documentation
# commits that amended typing.js and typing.spec.js.
baseline_commit: '65922fcab880a6b2d37f4602b847ea42382650db'
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
  - '_bmad-output/planning-artifacts/research/technical-type-and-locale-detection-2026-08-01/research.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every cell in a loaded Source is a string, and nothing says what it means (CAP-9, FR-9). `1.234` is one thousand two hundred thirty-four or it is 1.234, and no downstream Step — filter, join, aggregate — can be right until a person has settled that. Today nothing asks.

**Approach:** Detect a type and, where relevant, a number or date locale per column by reading **every** value, report what the evidence supports — including the state where nothing settles it — let the user correct any column, and record the mapping as confirmed per Source. A free-text annotation per column (CAP-10, FR-10) rides in the same per-column record, because it is the same row of the same panel and the same command shape. Confirmation is a state in `core/exec`, not a UI flag, so the scheduler's AD-29 gate has something real to read when it arrives.

## Boundaries & Constraints

**Always:**
- FR-9: detection reads **every value in the column, never a sample**. Every comparable engine samples and that is the documented cause of silent corruption; a querbeet column holds at most the NFR-3 target and detection is already a column walk.
- Two ambiguity outcomes are distinguished and worded differently: one reading carries decisive evidence and the count is named ("47 values have a day above 12, so dd.mm"), **or nothing in the column settles it** and the system says exactly that instead of naming a winner. The second is severity `unresolved` (`core/diagnostics`), which exists for this.
- **Decisive means strictly more exclusive evidence than the runner-up.** A column where each reading reads values the other cannot, in equal number, has no decisive reading and falls to the second outcome. Naming a winner there — by sort order, by tie-break, by any rule the column itself does not supply — is the silent behaviour this story exists to refuse, and it does not become acceptable because the count attached to it is real.
- **An ambiguity between readings that mean the same thing is not an ambiguity.** Where no value in the column can tell two readings apart *and* both would yield the same value for every value present — a column of separator-free integers under the German and the English number reading — they are one reading, reported as settled. The user is never asked a question whose two answers are identical; a gate that refuses over such a column refuses over almost every real table.
- The proposed type, the proposed locale and the share of values that parse are shown per column. Changing a type or locale recomputes the share immediately.
- Missing tokens (`-`, `n/a`, `k.A.`, empty) are declared per column and are part of the confirmed typing, not a display setting — they change null shares, grouping, join matching and "is empty".
- A leading-zero value such as `0123` stays text unless the user says otherwise.
- AD-20: a reader declares each column's domain. A `native:<type>` column skips locale inference and is presented as pre-typed, but still passes the missing-value sweep and is still confirmable — the gate must not degrade into a rubber stamp for typed formats.
- AD-13: `core/` emits codes and values; German lives in `ui/`. AD-6: no table or column array enters `ref`/`reactive`/`computed`.
- AD-1/AD-2: detection is pure, framework-free, browser-free, and unit-tested under the `core` Vitest project. Any `ui/` branch it grows is tested in the `ui/` project (AD-27).
- Confirmation is per Source and survives a rename. A re-read that changes the columns (encoding, delimiter, header row) invalidates it — the mapping described columns that no longer exist.
- FR-10: an annotation is free text on a column, editable at any time, visible in the Sources pane. It is the user's own content, so a re-read carries it across for every column whose name survives — losing a sentence someone wrote because they corrected the delimiter would be hostile. It never affects detection, a hit rate or the gate.

**Ask First:** any new runtime dependency; storing the confirmed mapping or the annotations in a Recipe file (the Recipe module does not exist yet — story 14); changing `SourceReader`'s return shape.

**Never:** converting cell values into typed values — boxed cells (AD-22) and UTC-midnight epoch milliseconds (AD-21) belong with the `Table` port in story 6, which now says so; this story decides *what a column is*, not what its cells become. Enforcing the gate inside a scheduler that does not exist yet (story 7+) — this story owns the state the gate reads. Sending annotations to a model (the Column Profile is story 16). Any typed-syntax surface (NFR-9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| German numbers | column of `1.234,56`, `80,00` | type `number`, decimal `,` group `.`, hit rate 100 % | N/A |
| Anglo numbers | column of `1,234.56` | type `number`, decimal `.` group `,`, and the pane states which reading it chose | N/A |
| Decisive dates | `03/04/2025` plus 47 values with a day above 12 | `date`, `dd.mm`, with the deciding count named | N/A |
| Irreducibly ambiguous | every value parses under both readings and they disagree — `1.234`, `5.678` | severity `unresolved`, no winner named, the column is unconfirmable until the user picks | N/A |
| Ambiguous but equivalent | `1`, `2`, `42` — no value carries a separator, so both number readings give the same number | `number`, settled, hit rate 100 %, confirmable; no question is asked | N/A |
| Evidence on both sides | 5 values read only as dd.mm, 5 only as mm.dd | severity `unresolved` — neither reading is decisive, so no winner is named | N/A |
| Leading zeros | `0123`, `0456` | stays `text`; a numeric reading is offered, never applied | N/A |
| Missing tokens | user declares `k.A.` missing in a column | those cells count as missing, not as unparsed; hit rate recomputes | N/A |
| Partial parse | 842 of 900 values parse as a date | hit rate reported as 842/900; the 58 are listed as unparsed, original text kept | N/A |
| Native column | reader declares `native:number` | pre-typed, no locale inference, still swept for missing values, still confirmable | N/A |
| Confirm | user confirms a Source whose columns are all settled | Source reads confirmed; a Source with an `unresolved` column cannot be confirmed | refuse, naming the columns |
| Re-read invalidates | confirmed Source, user changes the header row | confirmation drops, the pane says so | N/A |
| Annotate | user writes "Netto, ohne Fracht" on a column | text visible in the pane and editable again; detection and hit rate unchanged | N/A |
| Annotation survives | annotated Source, user switches encoding | the annotation is still on the column of that name | N/A |

</frozen-after-approval>

## Code Map

- `core/types/typing.js` — new: the detection engine. Pure. Per column: candidate enumeration, full-column scan, hit counts per candidate, the decisive-evidence count, and the `unresolved` verdict when two candidates tie at full coverage. Number separators come from `Intl.NumberFormat('<locale>').formatToParts` (R5) — never a hand-written table. Budget throughput as rows × columns × candidates: no library infers a format, so the candidate loop is ours in every case (R5).
- `core/types/typing.test.js` — new: the matrix above, plus the boundary cases R5 named — a column that is 100 % parseable under both readings, a day-above-12 that appears only in the last rows (the sampling trap), `0123`, and an all-missing column.
- `core/types/encoding.js:1-40` — read-only: the shape to copy. A `core/types` module is pure, exports named constants, and carries its reasoning in the header.
- `core/exec/source-store.js:116-161` — `addSource` mints the entry; add `typing` alongside `table`/`proposal`/`damage`. `reRead` (L78-107) is where a re-read must drop a confirmation.
- `core/exec/source-store.js:201-225` — `reconfigureParse` is the model for a new `setColumnTyping(id, columnIndex, patch)` command: validate at the boundary, rebuild a frozen entry, never mutate. `annotateColumn(id, columnIndex, text)` is the same shape. **Commands address a column by index, not by name.** A CSV header may repeat a name — `csv-reader.js:211` passes header cells through verbatim, and a trailing delimiter yields two columns called `''` — and a name-keyed command silently edits the first of them while the second becomes unreachable. Carry-over across a re-read stays keyed by name, because that is what FR-10 promises and a name is the only thing a re-read preserves; a repeated name there resolves to the first unclaimed column of that name, in order.
- `core/exec/source-store.js:227-235` — the returned surface; `setColumnTyping`, `annotateColumn`, `confirmTyping` and `unconfirmTyping` join it. `list()`/`get()` stay the only readers.
- `core/exec/source-store.test.js` — the command tests to extend: confirmation refused while a column is `unresolved`, confirmation dropped by `reconfigureParse` and `overrideEncoding`, kept by `renameSource`; annotations carried across a re-read by column name.
- `core/diagnostics/diagnostic.js:29-62` — `unresolved` already exists and is documented as CAP-9's severity. Emit `typing.ambiguous_locale`, `typing.unparsed_values`, `typing.unconfirmed` through it; no new severity. These are **derived**, not stored: an entry keeps the reader's own diagnostics as `readDiagnostics`, and `commit` recomputes `diagnostics` as that slice plus `typingDiagnostics(typing)`. A typing command changes the entry, so the summary on the card follows without any command having to remember to update it. `typing.unconfirmed` is `unresolved` severity, which means a freshly loaded Source is not `clean` until a person has confirmed it — that is AD-29's gate being visible rather than implicit.
- `adapters/csv/csv-reader.js:262-268` — read-only: every CSV column is `domain: 'text'`. AD-20's `native:<type>` has no producer yet (XLSX is story 4), so that branch ships tested against a fake reader result, not a real file.
- `ui/SourcesPane.vue:251-268` — the counts line and the correction controls; the per-column typing panel goes with them, above the preview grid. `refresh()` (L23) already re-projects after every command.
- `ui/SourcesPane.vue:52-56` — the pattern the reading select must adopt: `hasDelimiterQuestion` already records that re-selecting the value a `<select>` already displays fires no `change` event, so a proposal presented as the selected option cannot be ratified. An `unresolved` column must therefore show a placeholder rather than the detected winner — which is also the only presentation consistent with a verdict that refuses to name one.
- `ui/RowWindow.vue` — read-only this story: unparsed cells are marked when values become boxed (story 6), not now.

## Tasks & Acceptance

**Execution:**
- [x] `core/types/typing.js` + `typing.test.js` — detection, hit rates, the two ambiguity verdicts — the whole matrix lives or dies here.
- [x] `core/exec/source-store.js` — `typing` on the entry, `setColumnTyping`, `annotateColumn`, `confirmTyping`, `unconfirmTyping`, confirmation invalidation and annotation carry-over on re-read — AD-10 commands, frozen entries.
- [x] `core/exec/source-store.test.js` — the confirmation lifecycle, what invalidates it, and what an annotation survives.
- [x] `ui/SourcesPane.vue` — the per-column panel: proposed type, locale, hit rate, the ambiguity sentence, the corrections, the annotation field, and the confirm action — German, `ui/` only (AD-13).
- [x] `ui/SourcesPane.test.js` — the `unresolved` branch and the refused confirm action, in the `ui/` envelope (AD-27). The action is not disabled: a disabled button cannot say why, and the refusal naming the open columns is the sentence the user needs.
- [x] `tests/e2e/typing.spec.js` — a German-number Source and an irreducibly ambiguous one, confirmed and refused, plus an annotation written and surviving a re-read, from the built artefact.

**Acceptance Criteria:**
- Given a column whose decisive value sits past row 20,480, when detection runs, then it is found — the sampling trap is a test, not a comment.
- Given a Source with one `unresolved` column, when the user confirms, then confirmation is refused and the column is named.
- Given a confirmed Source, when the header row changes, then the confirmation is gone and the pane says so.
- Given an annotated column, when the encoding changes, then the annotation is still there.
- Given `npm run verify`, then lint, both Vitest projects and Playwright (Chromium + Firefox, `file://`) pass.

## Spec Change Log

### 2026-08-02 — review iteration 1

**Triggering findings.** The three review layers ran as context-free subagents against the full story-3 diff from `65922fc`. Three of their findings could not be resolved from the spec as frozen:

1. *An integer-only column cannot be confirmed.* Verified: `detectColumn(['1','2','3'])` returns `unresolved` between `de-DE` and `en-US`, and `unresolvedColumns` names it. The frozen matrix row "every value parses under both readings" describes this case exactly, so the code was right about the spec and the spec was wrong about the world. Every `Menge`, `Anzahl`, ID and year column blocked AD-29's gate behind a question whose two answers give the same number — the situation `typing.js` already names as the reason de-CH is excluded, with the rule applied only to candidates and not to values.
2. *Symmetric evidence still named a winner.* Verified with 90 ambiguous values, 5 readable only as dd.mm and 5 only as mm.dd: `verdict: 'decisive'`, `decidedBy: 5`, winner `dd.MM.yyyy` from `localeCompare`, and five values written off as unparsed. The card then asserted "5 Werte lassen sich nur als TT.MM.JJJJ lesen … daher TT.MM.JJJJ" while five values said the opposite. That is DuckDB's silent tie-break with a confident German sentence on top.
3. *No diagnostic was emitted at all.* The Code Map named three codes and the frozen Boundaries named the severity; the implementation shipped a string field on the column record. The card's severity summary called an unconfirmable Source clean, so CAP-34's glance-level distinction missed the one state the fourth severity was invented for.

**What was amended.** Boundaries gained two rules — decisive requires strictly more exclusive evidence than the runner-up, and readings that no value distinguishes *and* that mean the same thing are one reading. The matrix gained three rows separating "ambiguous and disagreeing" from "ambiguous but equivalent" and "evidence on both sides". The Code Map now says where the diagnostics attach (derived at `commit` from a `readDiagnostics` slice, never stored), that commands address columns by index while carry-over stays keyed by name, and that the reading select adopts the delimiter placeholder already in the file. The task line claiming a *disabled* confirm action was corrected to the refusal that was actually built.

**Known-bad state avoided.** A gate that refuses to open for the most common column type in any table, while a second gate opens for a column whose evidence contradicts itself, and a severity summary that reports both as clean.

**KEEP.** The full-column walk and its rationale; the two-outcome vocabulary and the `unresolved` severity; conversion staying in story 6; `Intl`-derived separators with no hand-written table and no date library; commands as frozen rebuilds through `commit`; annotations riding the same per-column record; the German living only in `ui/`.

### 2026-08-02 — deferred-work triage, after the review

Not a loopback: the six open entries were walked with the human and two were acted on rather than carried.

**Detection cost, measured instead of estimated.** The ledger's 2.5 s for the NFR-3 shape was a scaling of one subagent measurement; the real figure was 1,499 ms. AD-15 rules out the worker route outright, so the answer was the constant factor: one pass now collects the separators a column contains, date patterns whose separator appears in no value are dropped, and number readings are deduplicated against the marks that actually occur — which also makes the equivalence rule structural rather than a branch in the verdict. 991 ms at 100,000 × 20, and all 146 core cases unchanged, which is the correctness argument in practice. The entry stays open with the new number and the two remaining routes named.

**The reset got a control.** `setColumnTyping(id, index, { type: null })` existed, was tested, and reached no user. The type select now carries "Zurück zum Vorschlag" while a user choice stands. The proposed type is not named in the label: it would have to ride on the column record and would be stale exactly when the user has been changing the most.

**The DOM-weight entry closed on a measurement** — 200 columns render in 221 ms with 800 controls, and a type change there costs 40 ms. Orphaned annotations went to story 14 and the unparsed-value listing to story 6, both written into `stories.yaml` rather than left in the ledger alone.

## Design Notes

- **The sampling trap is the point of the story.** DuckDB scans 20,480 rows, Arquero 1,000, Power Query 200, Frictionless 100 — and the value that resolves `03/04/2025` is decisive only inside the window scanned. R5 found a reproduction of the resulting corruption on a 2 GB file. querbeet reads the column.
- **No prior art exists for the reporting half.** DuckDB, Power Query, LibreOffice and Frictionless all resolve locale ambiguity silently; DuckDB documents a tie-break where dd-mm beats mm-dd with no warning. The override prior art worth copying is Power Query's "Change Type → Using Locale", which asks for type and locale in one action.
- **A 100 % hit rate under both readings is the case the wording must survive.** FR-9's example wording is a hit rate ("842 of 900 readable"), which answers a different question than ambiguity — a column can be fully readable both ways. That is the `unresolved` state, and it needs its own sentence.
- **No date library.** R5 picked `date-fns` for parsing against a supplied pattern, but its own headline finding is that **no library infers a format** — the candidate loop is querbeet's code either way, and a library would only save the per-pattern parse of a handful of all-numeric date shapes. Detection here needs to *test* a value against a candidate, not to parse arbitrary human dates. Own code, no dependency, and the "Ask First" never triggers. Revisit if a story needs month names or a real calendar.
- **Why conversion lives in story 6.** The entry's `table` is the **raw** parsed table: story 2's preview renders it as text exactly as parsed, and CAP-39's damage inspection reads from it, so converted values cannot replace it in place. A converted column would therefore be a **second full copy of every column** — against R4/D2's budget, where 100k × 20 already costs 80.2 MB as an engine table — and where that copy lives is a `Table`-port question (AD-5). Detection reports the unparsed **count** per column without holding converted values, which is what FR-9's hit rate needs. Story 6's dev note now carries the other half.
- **The equivalence rule is not a branch in the verdict — it is the candidate list.** Two number readings differ only where a value carries one of their separators, so a single pass over the column collects which separators occur and the readings are deduplicated against *that*. A column of separator-free integers offers one candidate, so there is no runner-up to argue with and no ambiguity to report. Nothing is converted, which keeps the story's "Never" intact, and it is the cheaper answer as well as the correct one: one walk instead of two. The same pass drops every date pattern whose separator appears in no value — `readsAsDate` splits on its separator and requires three parts, so such a pattern scores zero without being asked. Detection still reads every value; it stops reading it nine times. Measured at the NFR-3 shape, 100,000 rows by 20 columns: 991 ms rather than 1,499 ms, with all 146 core cases unchanged.
- **The same equivalence exists for dates and is deliberately not implemented.** A column whose day and month coincide in every value (`01.01.2025`, `02.02.2025`) reads the same under both orders, but deciding that needs the two readings compared as values, that means parsing, and parsing is story 6. Such a column stays `unresolved` and the user answers a question that at least has an answer.
- **Annotations are here rather than in their own story** because they are one text field in the column row this story already builds, one command in the shape this story already establishes, and the only story in the plan that ever names them. Splitting them would have cost a spec, a review and a checkpoint to save perhaps forty lines.

## Verification

**Commands:**
- `npm run lint` — clean; proves `core/types` stays DOM-free.
- `npm test` — both projects; the detection matrix and the confirmation lifecycle green.
- `npm run test:e2e` — builds `dist/` and runs both engines from `file://`.

## Suggested Review Order

**What a column is, and when that is a question**

- The verdict, in one place: equivalent readings collapse, symmetric evidence settles nothing.
  [`typing.js:304`](../../core/types/typing.js#L304)

- Two readings no value distinguishes *and* that mean the same number are one reading.
  [`typing.js:236`](../../core/types/typing.js#L236)

- The pair of counters that makes "decisive" mean more than "first alphabetically".
  [`typing.js:212`](../../core/types/typing.js#L212)

- A chosen type gets the best-scoring reading, not the first candidate.
  [`typing.js:361`](../../core/types/typing.js#L361)

**The typing as state the rest of the app can see**

- Derived on every commit, so no command can leave the summary behind.
  [`source-store.js:125`](../../core/exec/source-store.js#L125)

- The three codes, and why an unconfirmed Source is not clean.
  [`source-store.js:44`](../../core/exec/source-store.js#L44)

**The command boundary**

- Columns addressed by position — a CSV header may repeat a name.
  [`source-store.js:201`](../../core/exec/source-store.js#L201)

- A type or reading the store cannot honour is refused, not stored.
  [`source-store.js:387`](../../core/exec/source-store.js#L387)

- What a re-read carries: annotation, chosen type, missing tokens — never the confirmation.
  [`source-store.js:157`](../../core/exec/source-store.js#L157)

**The panel, and the one control that had to change**

- The placeholder: an unresolved column must not name a winner in its own select.
  [`SourcesPane.vue:612`](../../ui/SourcesPane.vue#L612)

- The decisive sentence now names the evidence pointing the other way too.
  [`SourcesPane.vue:168`](../../ui/SourcesPane.vue#L168)

- German declines with the number, not only with the noun.
  [`SourcesPane.vue:143`](../../ui/SourcesPane.vue#L143)

- The refusal is announced, not merely coloured.
  [`SourcesPane.vue:549`](../../ui/SourcesPane.vue#L549)

- A repeated column name disambiguates its labels by position, and only then.
  [`SourcesPane.vue:153`](../../ui/SourcesPane.vue#L153)

**The cases that were missing**

- An integer column is not a question — the case that blocked the gate everywhere.
  [`typing.test.js:153`](../../core/types/typing.test.js#L153)

- Evidence on both sides in equal measure names no winner.
  [`typing.test.js:172`](../../core/types/typing.test.js#L172)

- The three diagnostics, and that answering the questions clears them.
  [`source-store.test.js:403`](../../core/exec/source-store.test.js#L403)

- A repeated column name is two columns, including to the gate.
  [`source-store.test.js:616`](../../core/exec/source-store.test.js#L616)

- The fixture reader now honours its parse config, so a re-read can change values.
  [`source-store.test.js:705`](../../core/exec/source-store.test.js#L705)

- A native domain survives a re-read — the claim story 4 is staked on.
  [`source-store.test.js:719`](../../core/exec/source-store.test.js#L719)

- The reading a real user can actually pick, not one Playwright forces.
  [`SourcesPane.test.js:206`](../../ui/SourcesPane.test.js#L206)

- The whole of it from the built artefact, in both engines.
  [`typing.spec.js:75`](../../tests/e2e/typing.spec.js#L75)
