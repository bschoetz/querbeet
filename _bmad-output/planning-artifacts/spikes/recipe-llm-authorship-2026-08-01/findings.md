# Spike results: can a model write a Recipe from the documentation alone?

**Date:** 2026-08-01 · **Status:** artefacts built, self-test green, **the load-bearing test not yet run**
**Answers:** PRD Open Question 3 — half. **Feeds:** FR-27, FR-28.
**Artefacts:** `block-template.txt`, `prompt-block-example.txt`, `proposed/`, `selftest/` · **Raw data:** `selftest/results.json`
**Built on:** `../editor-vueflow-2026-08-01/` — `querbeet/recipe@1`, its validator and its named rejections
come from there and **were not modified**. See *Why the new checks are a separate module*.

---

## Verdict

The format documents in **6,734 B of plain text** — the whole spec section, every Step kind, every
config shape, every rejection class. A full FR-27 block for four Sources and a running Pipeline is
**10,938 B**. Recipes written from that block alone load: five tasks, 2 to 8 Steps, all five accepted
and all five byte-stable across a save/load round trip. **Thirteen** defect classes are each refused
by a message that names the defect.

**But the model that wrote those five Recipes also wrote the block and the validator behind it.** That
is a consistency check on the documentation, not a measurement of machine authorship. Open Question 3
is not closed and must not be recorded as closed. What this spike delivers is the apparatus to close
it: paste `prompt-block-example.txt` into an assistant that has never seen this repository, and run
its answer through `selftest/run-selftest.mjs`.

Four things the loader accepted that arguably it should not were found and are now settled: **three by
code** (column checking, a Source under `steps`, a fallback layout), **one by amending the PRD**
(a disconnected graph stays legal — see below). The column check is the one that mattered: without it
the independent test cannot distinguish *the model got the schema right* from *the model got the
column names right*.

---

## What was built

| Artefact | What it is |
| --- | --- |
| `block-template.txt` | The FR-27 block. German, plain text, three placeholders: `{{FRAGE}}`, `{{PROFIL}}`, `{{PIPELINE}}`. Sections 1–3 are the variable part; sections 4–5 are the format specification and the answer protocol, and they are constant. |
| `example-context.json` | The worked example's three variable parts: a question, an FR-26 Column Profile for four Sources, and the Recipe currently loaded. |
| `render-block.mjs` | Fills the template. `--check` fails if the rendered file on disk has drifted from the template. The app has to do this at FR-27 time; here it stands in for the app, so the block can be produced and tested without a browser. |
| `prompt-block-example.txt` | **Generated. The paste-ready block.** 10,938 B. This is the file to drop into a foreign assistant. |
| `proposed/columns.js` | Schema propagation and the column check — the FR-28 clause the Editor spike's validator does not cover. |
| `proposed/layout.js` | The fallback layout for a Recipe that arrives without `ui`. |
| `proposed/load-recipe.mjs` | `fromRecipe` + the three new checks, in the order the product should run them. |
| `selftest/cases/` | 22 Recipes: 5 authored for real tasks, 11 defects, 6 probes for things the loader might wave through. |
| `selftest/run-selftest.mjs` | Runs every case through **both** load paths, checks acceptance, checks the refusal names the defect, and re-serializes every accepted graph to check the round trip. |

The example is deliberately a **modification** task, not a fresh build: the block hands the model the
Recipe that is already loaded and asks it to extend it. FR-27 requires that path
(*"describes the Pipeline as it currently stands, so a model can be asked to modify rather than only
to create"*), and it is the harder of the two — the model has to preserve ids it did not choose.

### Why the new checks are a separate module

The Editor spike's answer is a **measured artefact**: one file, 247,987 B, four questions answered in
two engines from a real `file://` URL. Editing `model/recipe.js` in place would leave that `dist/`
stale and the measurement unrepeatable without a browser run, which is not available while R4 is
measuring timings on the same machine. So the checks are written as a composition — `loadRecipe` =
`fromRecipe` + three checks — and the self-test reports **both paths side by side**. Folding them in
is three lines inside `fromRecipe` once the Editor stops being a spike.

## What the self-test measured

`node selftest/run-selftest.mjs` — no browser, no network, ~0.3 s. Every case runs twice: through
`fromRecipe` exactly as the Editor spike measured it, and through `proposed/load-recipe.mjs`.

### Authored from the block, expected to load

| Case | Task | Result (both paths) |
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

### Refused by name, unchanged from the Editor spike

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

### Refused only by the proposed path — the five the new checks add

| Case | Message |
| --- | --- |
| `s1-unknown-column` | *„Nur Vertrieb“ filtert auf die Spalte „Abteilung“ (Bedingung 1), aber sein Eingang hat sie nicht. Verfügbar: Bestellnr, Datum, KundenNr, Betrag, Region.* |
| `x9-join-key-missing` | *„Kundenname dran“ verbindet über die Spalte „Kundennummer“ (Schlüssel 1 rechts), aber die rechte Tabelle hat sie nicht. Verfügbar: Nr, Name, Ort.* |
| `x10-union-mapping-missing` | *„Beide Monate“ ordnet die Spalte „KdNr“ zu (Zuordnung 1), aber keiner seiner Eingänge hat sie. Verfügbar: Bestellnr, KundenNr, Betrag.* |
| `x11-filter-after-union-drop` | *„Nur Süd“ filtert auf die Spalte „Region“ (Bedingung 1), aber sein Eingang hat sie nicht. Verfügbar: Bestellnr, KundenNr, Betrag.* |
| `s4-source-in-steps` | *„Bestellungen“ ist eine Quelle und gehört unter „sources“, nicht unter „steps“.* |

`x11` is the one that proves the check is propagation and not a lookup: `Region` exists in the first
monthly file, the Union runs with `"unmatched": "drop"` and therefore emits only the intersection, and
the filter downstream names a column that existed two Steps earlier and does not exist here. Naming
what *is* available is what makes the message worth pasting back.

### The fallback layout

`s3-no-ui` — five Steps, no `ui` anywhere:

```
measured:  b1@0,0   b2@0,0     j1@0,0     kd@0,0     u1@0,0
proposed:  b1@0,0   b2@0,140   j1@520,0   kd@0,280   u1@260,0
```

Column is the longest path from a Source, so a Step always sits right of everything feeding it; row is
order of first appearance, so the Recipe's own ordering stays visible. It fires **only** when every
node is at the origin — the signature of a model that omitted the field. A Recipe that positions its
Steps, or a canvas the user has arranged, is never touched.

### Accepted on both paths, deliberately

- `s2-orphan` — a second branch that never reaches the Result Step. **This is the PRD amendment**, see
  below.
- `s5-source-without-columns` — a Source that declares no columns. No Input Contract means no schema,
  so the column check is switched off for everything downstream rather than guessing. Silence here is
  correct: the alternative is a page of false accusations against a Recipe whose author simply has not
  described the file yet.

## What this does **not** show

Stated plainly, because it is the whole weakness of this spike:

1. **Same author, three times over.** The `querbeet/recipe@1` format, `block-template.txt`, and the
   22 test Recipes were all produced by the same model in the same session. Worse than same-model:
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
   tell the difference — the column check narrows that gap without closing it.

### How to run the real test

Cheap, and it is the only thing that closes Open Question 3:

1. Open a fresh session in an assistant that has no access to this repository — a different vendor is
   better than a different session of the same one.
2. Paste `prompt-block-example.txt`. Nothing else. No corrections, no follow-up hints.
3. Save the answer's JSON block to `selftest/cases/`, add a row to the `CASES` table in
   `run-selftest.mjs` with `measured: 'ok'`, and run it.
4. If it is refused: paste the refusal back verbatim — that is the loop FR-28 is designed around —
   and record how many rounds it takes. **The number of rounds is the actual finding**, not the
   pass/fail of round one.
5. Repeat with at least two assistants and one task that the three Step kinds cannot answer, to see
   whether the model says so or invents a kind.

Record it as a new section here. Until then the honest status line is *apparatus built, format
self-consistent, machine authorship unmeasured.*

## The four gaps, and what was done about them

1. **Column names were never checked.** `s1-unknown-column` filtered on `Abteilung`, which no Source
   has, and loaded clean — against FR-28's *"a Recipe referencing a column, Source or Step that does
   not exist is rejected naming the failing reference."* This was the likeliest failure mode of a
   machine-authored Recipe, because a model that half-recalls a column name got no signal at all.
   **Closed by `proposed/columns.js`.** It propagates the schema Step by Step rather than checking
   against the Sources: a Source contributes its declared `columns`; a filter passes its input
   through; a join concatenates left then right; a union applies its `mappings` and then takes the
   union or the intersection of its inputs depending on `unmatched`. Every column named in a `config`
   is checked against what actually arrives at that Step, and the refusal lists what was available.
   Four of the five new refusals come from this.
2. **A disconnected graph loads.** `s2-orphan` has a second branch that never reaches the Result Step.
   **Closed by amending the PRD, not the code.** Refusing it would make a pasted Recipe stricter than
   the Editor that produced it: an author mid-build always has orphans, and FR-12 marks them rather
   than refusing them. FR-28's consequence list now says a cyclic graph is rejected and an
   unconnected Step is marked, with the reasoning recorded in place so the wording is not silently
   restored later.
3. **A Recipe without `ui` stacked every Step on 0,0.** Omitting cosmetic fields is exactly what a
   model does under length pressure, and there is no auto-layout (out of scope in the Editor spike;
   `@dagrejs/dagre` is the named candidate if it ever enters). **Closed by `proposed/layout.js`,**
   about 30 lines, applied only when every node is at the origin. The block still asks for `ui` and
   now says why: the model knows better than the tool what belongs side by side.
4. **A Source declared in `steps` was accepted** and silently normalized back into `sources` on the
   next save, so one graph had two encodings and the documentation described one of them.
   **Closed by refusing it,** naming the Source and where it belongs.

Two further observations, neither a gap:

- **The JSON syntax message is the engine's**, and it is the one refusal a model cannot always act on:
  *"Expected double-quoted property name in JSON at position 171"* points into a document the model
  may not be able to reconstruct character-for-character. It is still better than nothing, and the
  fix — echo the offending line — is a presentation detail for whoever builds FR-28's paste UI.
- **Union `mappings` does not say which input a mapping applies to.** `{"target": "KundenNr", "from": "Kunden-Nr"}`
  identifies the source column by name only. That is unambiguous as long as no two inputs use the same
  column name for different things, which is precisely the case a Union of near-identical monthly
  files does not hit. Worth knowing before Union config is finalized; it did not obstruct any case here.

### Two decisions the column check forced, both open for revision

Schema propagation cannot be written without answering these, so they are answered here and flagged
rather than left implicit. Both belong to the transformation engine and R1 may overrule either.

- **A Join whose two inputs share a column name is legal**, and what happens to the duplicate is not
  decided. `columnsAt` emits the name once; `checkColumns` reports the collision as a **note**, not an
  error, because a suffix convention (`Name_rechts`) is Arquero's business and inventing one here
  would bind the engine to a spike's guess. No test case triggers it today.
- **A Union with `"unmatched": "drop"` emits the intersection of its inputs' columns**, and with
  `"keep"` the union of them, first input's order first. That is the reading the config's own labels
  imply — *behalten (null)* against *verwerfen* — and `x11` depends on it.

## FR-27, line by line

| FR-27 requires | Status |
| --- | --- |
| Copyable in one action | The block is one plain-text file. The app must produce it as one clipboard write; nothing in the format resists that. |
| Contains the question, the Column Profile and the answering instructions | Sections 1, 2 and 4–5. |
| Includes the Recipe format specification | Section 4, complete: frame, ids, Sources, Steps, the three kinds, `inputs`, `config` per kind, `result`, `ui`, and ten rejection classes with their real messages. |
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
| `proposed/columns.js` | Schema propagation per Step kind, and the column check with its named refusals. |
| `proposed/layout.js` | Fallback layout for a Recipe with no positions. |
| `proposed/load-recipe.mjs` | The composed load path: `fromRecipe` plus the three new checks. |
| `selftest/run-selftest.mjs` | The self-test, and the table of cases with their expectations per path. |
| `selftest/cases/` | 22 Recipes: `t*` authored, `x*` defects, `s*` the silent acceptances this spike went looking for. |
| `selftest/results.json` | Generated. Per case and per path: acceptance, node and edge count, positions, round-trip verdict, refusal text. |
