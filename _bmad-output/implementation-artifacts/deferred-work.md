# Deferred Work

Issues surfaced by review that were not this story's problem to solve. Append-only.

- source_spec: `spec-2-source-preview.md`
  summary: The paging controls in `ui/RowWindow.vue` — the buttons, their German labels, their disabled states — are rendered by no test in any envelope; only the page math underneath them is covered.
  evidence: Paging engages above `PAGE_ROWS` (571,428 rows), which no affordable e2e fixture reaches, and there is no `ui/` component-test envelope — `vitest.config.js` includes only `core/**`, `ports/**` and `adapters/**` under `environment: 'node'`, and the repo carries no component-test dependency. Adding one is marked "Ask First" in this story's spec, so it needs a human decision rather than a patch.

- source_spec: `spec-2-source-preview.md`
  summary: `ui/RowWindow.vue` is billed as reusable by story 10 unchanged, but carries the Source story's vocabulary and a fixed height — `preview*` test ids, the default label `Tabellenvorschau`, and a hardcoded `max-h-[308px]` with no height prop.
  evidence: Story 10's Result table wants a pane-filling grid; adopting the component at any taller height breaks the invariant that the container must stay under `WINDOW_SIZE` rows. The shared `preview` test id would also make the existing page-scoped `getByTestId('preview')` assertions match the Result table once both render.

- source_spec: `spec-2-source-preview.md`
  summary: The Source card's counts line has no German singular — a one-row, one-column Source reads `1 Zeilen, 1 Spalten`.
  evidence: `ui/SourcesPane.vue` renders both nouns in the plural unconditionally, and the e2e suite pins `1 Zeilen, 3 Spalten`. The row noun shipped that way in story 1; this story added the column noun. AD-13 makes German the product surface, so the fix belongs in a pass over the app's count formatting rather than in one line here.

- source_spec: `spec-2-source-preview.md`
  summary: The diagnostic-code scan in `tests/e2e/csv-sources.spec.js` now reads parsed cell values, so fixture data can fail it as a leak that never happened.
  evidence: The scan runs `/\b[a-z]+\.[a-z]+_[a-z_]+\b/` over `body.innerText` to prove no raw core vocabulary reaches the screen. Before this story the body held only column names and product chrome; the preview now puts arbitrary user data there. Today's fixtures contain no such token, so it passes — the fragility is latent, and the scan should be scoped away from user data.

- source_spec: `spec-2-source-preview.md`
  summary: The preview sits between the file-name line and the parse-correction controls on every Source card, with no way to collapse it.
  evidence: A ~310 px scroll region per card pushes story 1's `Zeichenkodierung` / `Trennzeichen` / `Kopfzeile` controls roughly a screen apart with three Sources, and a wheel event over a card now scrolls the preview instead of the pane. Neither the ordering nor a collapse affordance is discussed in the spec.
