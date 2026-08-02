# Deferred Work

Issues surfaced by review that were not the originating story's problem to solve.
Entries move to **Closed** with a note saying where they went — they are not deleted,
so a later reader can see what was decided rather than only what remains.

## Open

- source_spec: `spec-3-typing-step-zero.md`
  summary: Story 3 shipped without the adversarial review pass that stories 1 and 2 went through, and its `done_checkpoint` is still outstanding. **Being made good: the spec is back at `in-review` with a baseline commit, so the review can run against the real diff.**
  evidence: Stories 1 and 2 ran the three review layers — blind hunter, edge-case hunter, verification-gap reviewer — as independent context-free subagents, and story 2's produced eight patches including two real defects nobody would have found by re-reading their own work (rows expressed in rem against a px geometry; a virtualized table announcing ~50 rows to a screen reader). Story 3 was implemented directly on request and self-reviewed by mutation instead: sampling the column, letting a tie name a winner, opening the gate, carrying a confirmation across a re-read, and dropping an annotation each fail exactly the tests that name them. That is evidence the tests bite, not evidence the design is right. `stories.yaml` also marks story 3 `spec_checkpoint: true` and `done_checkpoint: true`; the spec checkpoint was bypassed by an explicit instruction and the done checkpoint has not happened. Anyone reading the green suite should know both facts before trusting it.

- source_spec: `spec-3-typing-step-zero.md`
  summary: Unparsed values are counted per column, not listed — the panel says "842 von 900 Werten lesbar" but cannot show *which* 58 failed.
  evidence: The matrix row reads "the 58 are listed as unparsed, original text kept". The originals are kept and visible — the preview grid renders the raw table untouched — and the count is exact, so nothing is lost or silently replaced. What is missing is the shortcut from the count to those rows. Listing them means marking cells in the preview under a confirmed type, which is boxed cells (AD-22) and therefore story 6's conversion; doing it here would mean a second scan whose result story 6 immediately replaces.

- source_spec: `spec-2-source-preview.md`
  summary: `ui/RowWindow.vue` is billed as reusable by story 10 unchanged, but carries the Source story's vocabulary and a fixed height — `preview*` test ids, the default label `Tabellenvorschau`, and a hardcoded `VIEWPORT_ROWS = 10` with no height prop.
  evidence: Story 10's Result table wants a pane-filling grid; adopting the component at any taller height breaks the invariant that the container must stay under `WINDOW_SIZE` rows. The shared `preview` test id would also make the existing page-scoped `getByTestId('preview')` assertions match the Result table once both render.
  status: open — carried into story 10's `invoke_dev_with` in `_bmad-output/specs/spec-querbeet/stories.yaml` (2026-08-02). Deliberately not solved now: a seam invented without a second consumer is guessed rather than measured.

## Closed

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
