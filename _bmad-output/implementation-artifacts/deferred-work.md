# Deferred Work

Issues surfaced by review that were not the originating story's problem to solve.
Entries move to **Closed** with a note saying where they went — they are not deleted,
so a later reader can see what was decided rather than only what remains.

## Open

- source_spec: `spec-3-typing-step-zero.md`
  summary: Detection blocks the main thread for 991 ms at the NFR-3 per-Source target of 100,000 rows by 20 columns, and again on every encoding or header-row re-read. It is linear in rows × columns, so a 200-column Source of that height costs about ten seconds.
  evidence: Reading every value is the frozen premise of the story (FR-9) and is not up for revision; the cost of doing so was. Two rounds of it are already paid — `score()` no longer allocates a row-index set per candidate, and a single pass now narrows the candidates to those a value could match, which took the NFR-3 shape from 1,499 ms to 991 ms and a 500,000-row integer column from 322 ms to 164 ms. The measured rate is about 2 million cells per second. What is left is real per-value work, and the routes out are all costly. **A worker is not one of them:** AD-15 forbids sending a dataset off-thread to compute on it, and R4 measured why — a structured clone of 100,000 rows blocks the sender for 109–132 ms and half a million for 511–627 ms, against 263–446 ms for the whole pipeline. That leaves making detection async so it can yield between columns, which turns `addSource` into an async command and touches the AD-10 command shape everywhere; or fusing the per-candidate walks into one pass over the values, which is maybe another third and makes `score` markedly harder to read. Both want a measurement harness in the repo rather than a script in a session, and neither belongs to a story about what a column is.

- source_spec: `spec-3-typing-step-zero.md`
  summary: An annotation on a column whose name does not survive a re-read is gone for good — correcting the header row back does not bring it back.
  evidence: Carry-over is keyed by name because a name is the only thing a re-read preserves, which is what FR-10 promises and what the code does. The gap is beyond that promise: only the current typing is retained, so an annotation orphaned by a header-row correction has nowhere to wait. Holding orphaned annotations for later re-attachment means a second store of per-Source user content and a rule for when it expires — new scope, and the same mechanism a Recipe file needs anyway.
  status: open — carried into story 14's `invoke_dev_with` in `_bmad-output/specs/spec-querbeet/stories.yaml` (2026-08-02). Deliberately not solved now: a second store for user content, invented before the first one exists, would be guessed rather than fitted.

- source_spec: `spec-3-typing-step-zero.md`
  summary: Unparsed values are counted per column, not listed — the panel says "842 von 900 Werten lesbar" but cannot show *which* 58 failed.
  evidence: The matrix row reads "the 58 are listed as unparsed, original text kept". The originals are kept and visible — the preview grid renders the raw table untouched — and the count is exact, so nothing is lost or silently replaced. What is missing is the shortcut from the count to those rows. Listing them means marking cells in the preview under a confirmed type, which is boxed cells (AD-22) and therefore story 6's conversion; doing it here would mean a second scan whose result story 6 immediately replaces.
  status: open — carried into story 6's `invoke_dev_with` in `_bmad-output/specs/spec-querbeet/stories.yaml` (2026-08-02). Story 6 already owns the boxes that carry the original text; what it now also owns is the jump from the count to the rows.

- source_spec: `spec-2-source-preview.md`
  summary: `ui/RowWindow.vue` is billed as reusable by story 10 unchanged, but carries the Source story's vocabulary and a fixed height — `preview*` test ids, the default label `Tabellenvorschau`, and a hardcoded `VIEWPORT_ROWS = 10` with no height prop.
  evidence: Story 10's Result table wants a pane-filling grid; adopting the component at any taller height breaks the invariant that the container must stay under `WINDOW_SIZE` rows. The shared `preview` test id would also make the existing page-scoped `getByTestId('preview')` assertions match the Result table once both render.
  status: open — carried into story 10's `invoke_dev_with` in `_bmad-output/specs/spec-querbeet/stories.yaml` (2026-08-02). Deliberately not solved now: a seam invented without a second consumer is guessed rather than measured.

## Closed

- source_spec: `spec-3-typing-step-zero.md`
  summary: The Step zero panel renders every column expanded, with four controls each — a 200-column CSV puts 800 form controls in one Source card.
  evidence: `<details open>` is deliberate: FR-9 says the proposed type, the proposed reading and the share that parses are shown per column, and a panel folded shut shows none of them. The concern came from `RowWindow`'s ~50-row ceiling one story earlier, and the entry said itself that a ceiling chosen without a measurement is a guess.
  status: closed 2026-08-02 — measured in the built artefact, Chromium, 200 data rows. 20 columns: 142 ms to render, 80 controls, 1,569 DOM nodes. 50 columns: 133 ms, 200 controls, 3,759 nodes. 100 columns: 156 ms, 400 controls, 7,409 nodes. 200 columns: 221 ms, 800 controls, 14,709 nodes. A type change at 200 columns costs 40 ms and a confirmation 107 ms, against 25 ms and 39 ms at 20. No ceiling is warranted: `RowWindow`'s exists because a spacer over half a million rows collapses in Firefox, which is a different order of magnitude from 800 controls. What does hurt at 200 columns is detection, and that is its own open entry.

- source_spec: `spec-3-typing-step-zero.md`
  summary: `setColumnTyping`'s `type: null` reset — "back to whatever detection proposes" — is covered by a core test and reachable from no control in the product.
  evidence: `TYPE_LABEL` offers Text, Zahl and Datum, so once a user overrode a type the only route back was a re-read, which drops the confirmation with it.
  status: fixed 2026-08-02 — the type select carries a "Zurück zum Vorschlag" option, rendered only while a choice of the user's stands, and `setType` maps its empty value to `{ type: null }`. The proposed type is deliberately not named in the label: it would have to ride on the column record and would be stale exactly when the user has been changing the most. Covered in the `ui/` envelope, both branches, and end to end in both engines — override to Text, hand it back, and the type *and* the reading return.

- source_spec: `spec-3-typing-step-zero.md`
  summary: Story 3 shipped without the adversarial review pass that stories 1 and 2 went through.
  evidence: Stories 1 and 2 ran the three review layers — blind hunter, edge-case hunter, verification-gap reviewer — as independent context-free subagents, and story 2's produced eight patches including two real defects nobody would have found by re-reading their own work (rows expressed in rem against a px geometry; a virtualized table announcing ~50 rows to a screen reader). Story 3 was implemented directly on request and self-reviewed by mutation instead: sampling the column, letting a tie name a winner, opening the gate, carrying a confirmation across a re-read, and dropping an annotation each fail exactly the tests that name them. That is evidence the tests bite, not evidence the design is right.
  status: closed 2026-08-02 — the round ran against the full diff from `65922fc`, all three layers as context-free subagents. It was worth running: the layers found, and this session fixed, an integer-only column being reported as irreducibly ambiguous and therefore blocking AD-29's gate on almost every real table; a symmetric 5-against-5 split still naming a winner alphabetically with a confident German sentence; three named diagnostics that were never emitted, so the card called an unconfirmable Source clean; a reading select that could not receive the answer to the question it was asking, whose e2e test passed only because Playwright forces a change event; missing tokens silently reverting on a re-read; and duplicate column names collapsing onto the first. Three of those needed a human decision and got one; the rest were patched. Spec Change Log entry: review iteration 1. `done_checkpoint` is still outstanding and is tracked in `stories.yaml`, not here.

- source_spec: `spec-2-source-preview.md`
  summary: The paging controls in `ui/RowWindow.vue` — the buttons, their German labels, their disabled states — were rendered by no test in any envelope; only the page math underneath them was covered.
  evidence: Paging engages above `PAGE_ROWS` (571,428 rows), which no affordable e2e fixture reaches, and there was no `ui/` component-test envelope — `vitest.config.js` included only `core/**`, `ports/**` and `adapters/**` under `environment: 'node'`. Adding a dependency is marked "Ask First" in the story's spec, so it needed a decision rather than a patch.
  status: fixed 2026-08-02 — R10 answered it (`@vue/test-utils` + `happy-dom` as a `ui/**`-scoped Vitest project, +321 ms measured on this repo), AD-27 now names three envelopes, and `ui/RowWindow.test.js` covers the branch in nine cases with a props-only fake table that claims 571,429 rows and allocates none. Verified by mutation: removing the page offset, forcing the controls visible, and unbinding the last page's disabled state each fail exactly the case that names them.

- source_spec: `spec-2-source-preview.md`
  summary: The Source card's counts line had no German singular — a one-row, one-column Source read `1 Zeilen, 1 Spalten`.
  evidence: `ui/SourcesPane.vue` rendered both nouns in the plural unconditionally, and the e2e suite pinned `1 Zeilen, 3 Spalten`. The row noun shipped that way in story 1; story 2 added the column noun. AD-13 makes German the product surface.
  status: fixed 2026-08-02 — `rowsLabel` / `colsLabel` in `ui/SourcesPane.vue`, matching the declension the pane's damage sentences already do, plus the same for the per-page count in `ui/RowWindow.vue`. Pinned by a one-row one-column e2e case.

- source_spec: `spec-2-source-preview.md`
  summary: The diagnostic-code scan in `tests/e2e/csv-sources.spec.js` read parsed cell values, so fixture data could fail it as a leak that never happened.
  evidence: The scan runs `/\b[a-z]+\.[a-z]+_[a-z_]+\b/` over `body.innerText` to prove no raw core vocabulary reaches the screen. Before story 2 the body held only column names and product chrome; the preview put arbitrary user data there.
  status: fixed 2026-08-02 — the preview grids are hidden for the duration of the scan and restored inside the same `evaluate`, so `innerText` keeps its visibility semantics and the scan sees product chrome only.

- source_spec: `spec-2-source-preview.md`
  summary: The preview sat between the file-name line and the parse-correction controls on every Source card, with no way to collapse it.
  evidence: A ~310 px scroll region per card pushed story 1's `Zeichenkodierung` / `Trennzeichen` / `Kopfzeile` controls roughly a screen apart with three Sources, and a wheel event over a card scrolled the preview instead of the pane.
  status: fixed 2026-08-02 — the grid moved below the controls and the diagnostics, so everything that explains or corrects the read comes first and the excluded-rows report sits directly under the table it is missing from. A collapse toggle was considered and rejected: more state and more clicks for a problem ordering already solves. Pinned by a geometric e2e assertion.
