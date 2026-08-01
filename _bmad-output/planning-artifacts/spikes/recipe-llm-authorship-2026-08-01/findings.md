# Spike results: can a model write a Recipe from the documentation alone?

**Date:** 2026-08-01 · **Status:** artefacts built, self-test green, **the load-bearing test not yet run**
**Answers:** PRD Open Question 3 — partially. **Feeds:** FR-27, FR-28.
**Artefacts:** `block-template.txt`, `prompt-block-example.txt`, `selftest/` · **Raw data:** `selftest/results.json`
**Built on:** `../editor-vueflow-2026-08-01/` — `querbeet/recipe@1`, its validator and its named rejections
come from there and were not modified.

---

## Verdict

The format documents in **6,154 B of plain text** — the whole spec section, every Step kind, every
config shape, every rejection class. A full FR-27 block for four Sources and a running Pipeline is
**10,358 B**. Recipes written from that block alone load: five tasks, 2 to 8 Steps,
all five accepted and all five byte-stable across a save/load round trip. The eight defects the block
warns about are each refused by a message that names the defect.

**But the model that wrote those five Recipes also wrote the block and the validator behind it.** That
is a consistency check on the documentation, not a measurement of machine authorship. Open Question 3
is not closed and must not be recorded as closed. What this spike delivers is the apparatus to close
it: paste `prompt-block-example.txt` into an assistant that has never seen this repository, and run
its answer through `selftest/run-selftest.mjs`.

Four things the loader accepts that arguably it should not, and one that a model will get wrong by
default, are listed under **Gaps** below. The `ui` gap is the one worth fixing before the independent
test: a Recipe without positions loads with every Step stacked on 0,0, and there is no auto-layout.

---

## What was built

| Artefact | What it is |
| --- | --- |
| `block-template.txt` | The FR-27 block. German, plain text, three placeholders: `{{FRAGE}}`, `{{PROFIL}}`, `{{PIPELINE}}`. Sections 1–3 are the variable part; sections 4–5 are the format specification and the answer protocol, and they are constant. |
| `example-context.json` | The worked example's three variable parts: a question, an FR-26 Column Profile for four Sources, and the Recipe currently loaded. |
| `render-block.mjs` | Fills the template. `--check` fails if the rendered file on disk has drifted from the template. The app has to do this at FR-27 time; here it stands in for the app, so the block can be produced and tested without a browser. |
| `prompt-block-example.txt` | **Generated. The paste-ready block.** 10,358 B, 318 lines. This is the file to drop into a foreign assistant. |
| `selftest/cases/` | 17 Recipes: 5 authored for real tasks, 8 defects, 4 probes for things the loader might wave through. |
| `selftest/run-selftest.mjs` | Loads each case through the real `fromRecipe`, checks acceptance, checks the refusal names the defect, and re-serializes every accepted graph to check the round trip. |

The example is deliberately a **modification** task, not a fresh build: the block hands the model the
Recipe that is already loaded and asks it to extend it. FR-27 requires that path
(*"describes the Pipeline as it currently stands, so a model can be asked to modify rather than only
to create"*), and it is the harder of the two — the model has to preserve ids it did not choose.

## What the self-test measured

`node selftest/run-selftest.mjs` — no browser, no network, ~0.2 s.

### Authored from the block, expected to load

| Case | Task | Result |
| --- | --- | --- |
| `t1-linear` | One Source, filter to one region | 2 Steps, 1 edge, round trip identical |
| `t2-join` | Attach the customer name to each order | 3 Steps, 2 edges, round trip identical |
| `t3-union-filter` | Three monthly files — one names the key column differently — then filter | 5 Steps, 4 edges, round trip identical |
| `t4-two-unions` | Two unions feeding one join, then a two-condition filter | 8 Steps, 7 edges, round trip identical |
| `t5-modify` | The example block's own task: extend the loaded Pipeline | 7 Steps, 6 edges, round trip identical |

Answers are small: 526 B for the linear case, 1,764 B for the largest. `inputs` is written as a bare
string wherever a Step has one input, in the authored files and again after re-serialization — the
design rule from the Editor spike ("a linear pipeline is the trivial case") survives contact with
machine-shaped input.

### Defects the block warns about, expected to be refused by name

All eight refused, each naming the defect:

| Case | Message |
| --- | --- |
| `x1-cycle` | *Der Graph enthält einen Kreis: Filter A → Filter B → Filter A.* |
| `x2-join-arity` | *„Alles verbinden“ ist ein Join und nimmt genau 2 Eingänge, das Rezept nennt 3.* |
| `x3-result-is-source` | *Der ausgewiesene Ergebnis-Step „b1“ ist eine Quelle.* |
| `x4-dangling` | *„Kundenname dran“ verweist an Eingang 2 auf „kunden“, das es nicht gibt.* |
| `x5-unknown-kind` | *„Summe je Region“ hat die unbekannte Step-Art „aggregate“.* |
| `x6-no-result` | *Das Rezept weist keinen Ergebnis-Step aus.* |
| `x7-duplicate-id` | *Die Kennung „b1“ kommt mehrfach vor.* |
| `x8-broken-json` | *Das ist kein gültiges JSON: Expected double-quoted property name in JSON at position 171* |

`x5` is the case worth keeping: the task was *sum by region*, which the three implemented Step kinds
cannot do. The PRD names six kinds; this build has three. A model asked for an aggregate will invent
`"kind": "aggregate"` unless the block forbids it — the block forbids it, and the loader catches it
anyway. Both halves are needed, because a model that ignores the instruction still gets a usable
refusal.

## What this does **not** show

Stated plainly, because it is the whole weakness of this spike:

1. **Same author, three times over.** The `querbeet/recipe@1` format, `block-template.txt`, and the
   17 test Recipes were all produced by the same model in the same session. Worse than same-model:
   the session had already read `recipe.js` and `graph.js` in full before writing a line of the block.
   Anything the documentation forgets to say, the author still knows. **This measures whether the
   documentation contradicts the validator. It cannot measure whether the documentation is
   sufficient.**
2. **One model, one style.** Even a clean-room run of the same model family would not say what a
   different assistant does with the same text.
3. **No user in the loop.** FR-27's block is assembled by a person who has a real question about real
   files. Every question here was written to be answerable by three Step kinds.
4. **Nothing was executed.** The Recipes load and round-trip. Whether `{"op": "gt", "value": "1000"}`
   against a `Betrag` column formatted `1.234,56` filters correctly is R1/R5 territory and is not
   touched here. A Recipe can be structurally perfect and semantically wrong, and this spike cannot
   tell the difference.

### How to run the real test

Cheap, and it is the only thing that closes Open Question 3:

1. Open a fresh session in an assistant that has no access to this repository — a different vendor is
   better than a different session of the same one.
2. Paste `prompt-block-example.txt`. Nothing else. No corrections, no follow-up hints.
3. Save the answer's JSON block to `selftest/cases/`, add a row to the `CASES` table in
   `run-selftest.mjs` with `expect: 'ok'`, and run it.
4. If it is refused: paste the refusal back verbatim — that is the loop FR-28 is designed around —
   and record how many rounds it takes. **The number of rounds is the actual finding**, not the
   pass/fail of round one.
5. Repeat with at least two assistants and one task that the three Step kinds cannot answer, to see
   whether the model says so or invents a kind.

Record it as a new section here. Until then the honest status line is *apparatus built, format
self-consistent, machine authorship unmeasured.*

## Gaps found

Four things the loader accepts that FR-28 or common sense argues against. None is a defect in the
Editor spike's work — three of them are checks nobody has written yet, and the fourth is a design
question.

1. **Column names are never checked.** `s1-unknown-column` filters on `Abteilung`, which no Source
   has, and loads clean. FR-28 requires *"a Recipe referencing a column, Source or Step that does not
   exist is rejected naming the failing reference"* — Sources and Steps are checked, columns are not.
   This is the likeliest failure mode of a machine-authored Recipe, because a model that half-recalls
   a column name produces exactly this and gets no signal. The Source columns are in the Recipe
   already (`sources[].columns`), so the check is local: walk `config` per kind — `filter.conditions[].column`,
   `join.keys[].left/right`, `union.mappings[].target/from` — against the columns reachable upstream.
   **Recommended before the independent test**, because without it the test cannot distinguish
   "the model got the schema right" from "the model got the column names right".
2. **A disconnected graph loads.** `s2-orphan` has a second branch that never reaches the Result Step.
   FR-28 says a disconnected graph is rejected naming the defect. `orphans()` exists in `graph.js` and
   `validate()` does not call it. Arguably correct as it stands — the Editor marks orphans in the UI
   rather than refusing them, and an author mid-build always has orphans — but then **FR-28's wording
   is wrong**, not the code. Pick one: either `validate()` reports orphans as errors on the Recipe
   path only, or the PRD drops "disconnected" from FR-28. This is a decision, not a bug.
3. **A Recipe without `ui` loads with everything on 0,0.** `s3-no-ui` produces five Steps stacked at
   the origin. `x`/`y` default to 0 and there is no auto-layout (explicitly out of scope in the Editor
   spike; `@dagrejs/dagre` is the named candidate if it ever enters). Omitting cosmetic fields is
   exactly what a model does under length pressure. The block therefore asks for `ui` explicitly and
   gives the two step sizes — but instruction-following is not a guarantee. **A fallback layout on the
   Recipe path** — any left-to-right pass over the topological order — costs perhaps 20 lines and
   removes the failure mode entirely. Recommended.
4. **A Source declared in `steps` is accepted.** `s4-source-in-steps` puts `"kind": "source"` in the
   `steps` array with `file`/`columns` in `config`, and it loads. `toRecipe` then normalizes it back
   into `sources`, so it self-heals on the next save. Harmless, but it means one graph has two
   encodings and only one is documented. Either reject `kind: "source"` inside `steps` naming it, or
   document the tolerance. Rejecting is cheaper.

Two further observations, neither a gap:

- **The JSON syntax message is the engine's**, and it is the one refusal a model cannot always act on:
  *"Expected double-quoted property name in JSON at position 171"* points into a document the model
  may not be able to reconstruct character-for-character. It is still better than nothing, and the
  fix — echo the offending line — is a presentation detail for whoever builds FR-28's paste UI.
- **Union `mappings` does not say which input a mapping applies to.** `{"target": "KundenNr", "from": "Kunden-Nr"}`
  identifies the source column by name only. That is unambiguous as long as no two inputs use the same
  column name for different things, which is precisely the case a Union of near-identical monthly
  files does not hit. Worth knowing before Union config is finalized; it did not obstruct any case here.

## FR-27, line by line

| FR-27 requires | Status |
| --- | --- |
| Copyable in one action | The block is one plain-text file. The app must produce it as one clipboard write; nothing in the format resists that. |
| Contains the question, the Column Profile and the answering instructions | Sections 1, 2 and 4–5. |
| Includes the Recipe format specification | Section 4, complete: frame, ids, Sources, Steps, the three kinds, `inputs`, `config` per kind, `result`, `ui`, the rejection list. |
| Includes the Probe Query format specification | **Partial.** Section 4 ends with the Probe Query as *a Recipe plus `"purpose": "probe"`*, honouring FR-29's "same Step vocabulary, no second query language". The validator ignores unknown top-level fields, so such a document loads today — but nothing enforces or acts on the marker. **This is a proposal, not a measured design.** |
| Describes the Pipeline as it currently stands | Section 3, as the loaded Recipe verbatim. The example exercises the modify path. |
| Everything that would leave the machine is visible; no hidden portion | By construction: `render-block.mjs` emits one file and nothing else, and the Profile carries structure only — row counts, distinct counts, null shares, annotations, no cell values. FR-30 sample release has no slot in the block and was not built. |

The Column Profile's rendering — a fixed-width table per Source, aligned in plain text so it survives
a chat window that does not render markdown tables — is this spike's invention and is **provisional**.
FR-26 fixes the fields, not the layout.

## Files

| Path | What it is |
| --- | --- |
| `block-template.txt` | The FR-27 block, with the three placeholders. Source of truth. |
| `example-context.json` | Question, Column Profile, current Recipe for the worked example. |
| `render-block.mjs` | Template + context → block. `--check` detects drift. |
| `prompt-block-example.txt` | Generated. Paste this into a foreign assistant. |
| `selftest/run-selftest.mjs` | The self-test, and the table of cases with their expectations. |
| `selftest/cases/` | 17 Recipes: `t*` authored, `x*` defects, `s*` silent acceptances. |
| `selftest/results.json` | Generated. Per case: acceptance, node and edge count, round-trip verdict, refusal text. |
