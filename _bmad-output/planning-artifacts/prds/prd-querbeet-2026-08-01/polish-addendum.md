# Editorial polish pass — `addendum.md`

**Date:** 2026-08-01 · **Lenses:** structure, then prose · **Reader calibration:** humans (default)

**Purpose read:** this document exists to help downstream architecture, solution-design and UX work
inherit querbeet's settled technology decisions, the measurements behind them, and the alternatives
already rejected — without re-litigating any of it.

**Structure model applied:** Strategic/Context (Pyramid) — decision record. The document fits it:
settled decisions lead, supporting consequences group below, evidence supports rather than leads.

**Word metrics** (`word_metrics.py`, exact): total 4,720. §1 1,115 · §2 1,176 · §3 401 · §4 231 ·
§5 147 · §6 767 · §7 837 · title block 46.

**Constraint honoured:** content is sacrosanct. Only typos, grammar, broken cross-references,
Glossary-term inconsistency and broken markup were edited. Everything touching a claim, a number, a
technology decision or the document's shape is reported, not applied.

---

## Verification of the §1 currency note (checked, no change needed)

Every claim in the paragraph was checked against the table's actual rows and against the research
directory. All four hold:

| Claim | Verdict |
| --- | --- |
| "this table tracks R1 through R7 and R9" | **Correct.** Rows cite R1, R2, R2 deepening, R3 (×6), R4 D1, R5 (×4), R6, R7, R9. No R8. Eight research directories exist and match. |
| "Four of its rows record a project decision that overrode the research verdict — Arquero, the Vite build path, Vue Flow and ECharts — and each says so in its own row" | **Correct.** Exactly four rows carry an overrides statement: Transformation engine, Delivery, Graph Editor, Charts. No fifth row claims one. ("user override" in the Encoding row and "override prior art" in the Type record row are different senses and do not create a false positive.) |
| "**R8 (view document export) has not run**" | **Correct.** No R8 directory; PRD Open Question 11 states "research R8 is written and unrun". |
| "**R9 is answered only at its gate**, so the Package container of FR-24 has no row either" | **Correct.** R9's own `scope_note` reads: "Gate sub-question only (does IndexedDB work from `file://`). Storage layout, eviction, the Package container and the Parquet question are all still open." PRD Open Question 8 is open on the same point. |

Also verified and correct, no action: `block-template.txt` does illustrate a filter at lines 74 and
128 and both are `equals` text comparisons (§2); "Chromium 150" in the Delivery row is not a typo for
151 — R2 measured on Chromium 150, later runs on 151; FR/NFR references FR-9, FR-11, FR-12, FR-13,
FR-14, FR-24, FR-25, FR-28, FR-30, FR-36, FR-37, FR-38, NFR-2, NFR-3, NFR-7, NFR-8 all resolve
correctly against `prd.md`; PRD §6.2, PRD §6.3 and "Open Questions 2–4" all resolve; the §1 table is
well formed (three columns, 21 rows, no ragged cells); heading levels run `#` → `##` with no jumps.

---

## Applied edits

| # | Location | Problem | Fix applied |
| --- | --- | --- | --- |
| A1 | §2, FR-38 threshold paragraph — "there is no shared cancellation flag available **(see below)**" | Broken cross-reference. The cancellation-flag paragraph sits four paragraphs *earlier* in §2; nothing below it discusses cancellation. A leftover from a paragraph reorder. | "(see below)" → "(see above)" |
| A2 | §6, *Consumer mode* — "binding plus limited **step** editing, or one full **editor** for everyone" | Glossary terms (`prd.md` §3: **Step**, **Editor**) in lower case. The addendum capitalises *Step* in ~30 other places and *Editor* in ~15; PRD §6.2 carries the exact parallel phrase "one interface with a full Editor for everyone". | → "limited **Step** editing, or one full **Editor** for everyone" |

Two edits, both mechanical. No wording, ordering, claim or number was altered.

---

## Reported, not applied — STRUCTURE lens

| # | Location | Tag | Problem | Suggested fix (author's call) |
| --- | --- | --- | --- | --- |
| S1 | §7 (837 w) vs §1 Graph Editor row + §2 freeze rule | CONDENSE | Three facts are stated twice at full length: Vue Flow ships no cycle detection, Vue Flow copies the nodes it is handed, and `Object.freeze` is itself the reactivity protection. §1's row already says the first two; §2's freeze rule already says the third; §7 restates all three as fresh findings. | Let §7's paragraphs point at §1 and §2 for the statement and keep only the *measurement* (the zero-occurrence grep, the `isReactive false` result). Saves ~90–120 words. Not true redundancy — §7 adds evidence — so this is a condensation, not a cut. |
| S2 | §7, opening italic block (lines 107–110, ~60 w) | CUT / QUESTION | Document-history meta-commentary addressed to a reader who watched the edit happen: "This section previously recorded the shape of a gap — 'nothing has been screened' — and that is no longer true". A downstream architect reading this in three months does not need the section's own changelog. | Cut, or reduce to the dateline "*Rewritten 2026-08-01.*" — which is worth keeping, since no other section carries a date and §7 is the one whose contents most recently inverted. Saves ~50 words. |
| S3 | §7 placement (after §6) | MOVE | Front-loading violation. §7 is measured research output — the same class of material as §1 and §2 — but it sits behind §6 "Options considered and rejected", which is the document's *lowest*-value section by the pyramid model (rejected alternatives are nice-to-know). A reader scanning for what is known about the Editor reaches it last. | Consider §1 → §2 → §7 → §3 → §4 → §5 → §6. Zero word impact; pure ordering. |
| S4 | §2 (1,176 w, the longest section) | QUESTION | Nine equally weighted bolded paragraphs in flat sequence, with no grouping and no ordering signal. The reader cannot tell that paragraphs 1–3 are build-and-runtime rules, 4–5 are worker/data-transfer rules, 6 is rendering, 7–8 are execution and Editor shape, 9–10 are parsing and prompt hygiene. This is the document's largest scanning cost. | Either three `###` sub-headings, or a one-line index at the head of §2. No content moves. |
| S5 | §1 table, Source column — rows Delivery, Parquet read, Graph Editor, Charts, Type record, CSS | QUESTION | The third column has stopped being a source citation and become prose: six cells run 60–120 words, the longest (CSS) is 128. The table's scanning value — Concern → Decision at a glance — is intact in column 2 but the row heights defeat it. | Consider a footnote or a `#### Notes on selected rows` block below the table, leaving `R5`, `R7 — charts and dashboard rendering` etc. in the cell. Content unchanged, zero words lost. |
| S6 | §1 currency note | **PRESERVE** | Looks like scaffolding a structural editor would cut. It is the highest-value 90 words in the document: it is what stops a downstream reader treating an absent row as an answered question, and all four of its claims verify. | Keep as is, at the top, before the table. |
| S7 | §4 (231 w) and §5 (147 w) | **PRESERVE** | The two shortest and most directly actionable sections sit behind the two longest. Raising them would front-load value — but the current order is a genuine dependency order (decisions → their consequences → hazards → constraints → seams), and breaking it would leave §4 and §5 referring forward. | Keep the order. Noted so the pyramid-model reading is not mistaken for a defect. |

**Structure summary:** 5 recommendations, 2 explicit preserves. Estimated reduction if S1 and S2 are
accepted: ~140–170 words, roughly 3–4 % of 4,720. No length target was given, and none is needed —
the document is dense rather than long. One comprehension trade-off to weigh: S2 removes the only
signal that §7 was rewritten, which matters more here than in most documents because the section
previously said the opposite.

---

## Reported, not applied — PROSE lens

**Voice noted and preserved:** direct declaratives, a bolded thesis sentence opening most paragraphs,
em-dash asides, imperatives addressed to the builder ("build it", "Hold results in `shallowRef`"),
exact unrounded measurements with both engines named, `querbeet` always lower case. None of the
findings below asks for that to be flattened, and no number is touched.

### Claims that read as editing seams — for the author to resolve, since fixing them changes a claim

| # | Location | Problem | Suggested fix |
| --- | --- | --- | --- |
| P1 | §7, final paragraph — "Vue Flow ships no auto-layout and no undo/redo, and neither does any alternative screened — Baklava does ship undo/redo, clipboard, subgraphs and a topological sort" | Self-contradiction inside one sentence: "neither does any alternative" is refuted by the clause immediately after the dash. Reads as a seam where a shared property (no auto-layout) was later extended to undo/redo. | Consider: "Vue Flow ships no auto-layout and no undo/redo, and no alternative screened ships auto-layout either — Baklava *does* ship undo/redo, …"? Only the author can confirm which property is the shared one. |
| P2 | §6, *Comparison value as a string* — "The two are equivalent above 2⁵³, which no report figure in this product reaches." | Reads as an inversion. A JSON number and a string are interchangeable *below* 2⁵³ and diverge *above* it; as written, the sentence asserts equivalence in exactly the range where the number loses precision, and then says that range is unreachable — which would make the sentence pointless. | Consider: "The two diverge only above 2⁵³, which no report figure in this product reaches."? Substantive, so not applied. |
| P3 | §7, NFR-7 paragraph — "**Nine of eleven** Editor interactions are keyboard-reachable … **Connecting two Steps is the one gap**" | The arithmetic leaves one interaction unaccounted for: 9 reachable + 1 gap = 10 of 11. The spike's own table (`spikes/editor-vueflow-2026-08-01/findings-keyboard.md`) names the eleventh — *deliberate pan / zoom*, "no keyboard path; open decision whether it is still needed" — and treats it as separate from the one *NFR-7* gap. | Either name the eleventh, or qualify: "the one NFR-7 gap". The source is right; the addendum's compression is what drops it. |
| P4 | §7 — "with **seven** rejection classes each naming its defect" | Worth a source check. The spike summary (`spike-editor-vueflow-2026-08-01.md`, Q4) says "seven named rejection classes"; the underlying `findings.md` enumerates "**Six** rejection classes". The addendum inherited the summary's number. The discrepancy is in the sources, not introduced here. | Reconcile the spike, then the addendum follows. Not a rewrite. |
| P5 | §1, opening line — "Every decision below comes from a completed research run … **They** are inputs to **this PRD**, not outputs of it" | Two loose references in one sentence: singular "Every decision … comes" shifts to plural "They"; and "this PRD" inside `addendum.md` self-refers to the sibling document. The second may be deliberate — treating PRD + addendum as one artifact — which is why it is reported rather than fixed. | Consider: "The decisions below each come from a completed research run … They are inputs to the PRD, not outputs of it"? |

### Consistency and mechanics — safe but not applied, being judgement calls about referent or house style

| # | Location | Problem | Suggested fix |
| --- | --- | --- | --- |
| P6 | §2 chart-renderer paragraph (4×: "two **tile** settings", "every **tile** needs", "a single-category **tile**", "a **tile** size change") | The PRD Glossary §3 defines **Tile** (Kachel) as an element of a Dashboard, and these four are Dashboard Tiles. The addendum lower-cases it throughout. *Not* applied because it is internally consistent — a deliberate register, not a seam — and because §2's other use, "a Step **tile**'s height grows with its content", is a different referent (an Editor node body, correctly lower case) that must stay lower case if the four above are raised. | Capitalise the four Dashboard Tiles, leave "Step tile" alone. Author's call. |
| P7 | §6 (2×) and §7 (1×) — "no research exists for the **editor** component", "mostly the **editor**, not the data model", "The **editor** costs 0.32–2.76 MB of heap" | Lower-case *editor* where the addendum capitalises **Editor** roughly fifteen times elsewhere. Not applied because the referent shifts: §7's instance is a heap range measured *across three candidate libraries*, so "the editor" there plausibly means the editor component, not querbeet's Editor — capitalising it would quietly narrow the claim. | Decide referent per instance, then align. §6's "mostly the editor, not the data model" is the clearest candidate for capitalisation. |
| P8 | §1 — "seriali**s**es the culture into the saved script" (Type record row) vs "zero `NaN` in any seriali**z**ed SVG" (Charts row) | Same verb, two spellings, two rows apart in one table. The document is otherwise comfortably mixed (British *serialise*, *favour*, *behaviour*; American *virtualization*, *memoize*) which matches the PRD's own house style — but a single word spelled both ways inside one table is a copy-edit defect rather than a style choice. | Pick one for this verb. |
| P9 | §2 — "for about **4%** more heap" | The only `%` in the document set tight. The other five all carry a space: "88–98 %", "−0.9 % and +18.8 %", "~30 %", "~2.6 %". | "4 %". Not applied only because the instruction forbids touching numerics; the space changes no value. |
| P10 | §7 — "**BaklavaJS** 2.8.1" (first paragraph) vs "**Baklava** does ship undo/redo" (last paragraph) | The one library named two ways, first and last mention. | Use "BaklavaJS" on first mention and "Baklava" thereafter, or pick one. |
| P11 | §1 CSS row — "**Tailwind v4.3.3**" | The only version number in the table carrying a `v` prefix; every other row is bare ("Vue 3.5.40", "Arquero 8.0.3", "PapaParse 5.5.4", "ECharts 6.1.0"). | Drop the `v`. |
| P12 | §3, null-join-keys bullet — "**Either** exclude sentinel rows …, give each side a distinct sentinel …, or refuse the join" | *Either* introduces three alternatives. Common in informal usage; strictly it pairs two. | Drop "Either", or "One of three: …". Lowest priority in this list. |

**Prose summary:** 12 findings, 0 applied — 5 are claim-level seams that only the author may resolve
(P1–P5), 7 are consistency calls where the correct target depends on a referent or a house-style
decision (P6–P12). No grammatical error, misspelling, malformed table, broken list, unbalanced
emphasis, duplicated word or sentence fragment was found beyond the two already fixed above; the
markdown renders correctly throughout.
