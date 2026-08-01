# Spike results: can a model write a Recipe from the documentation alone?

**Date:** 2026-08-01 · **Status:** built, self-tested, and **passed cold by two assistants in four runs, none needing a second round**
**Answers:** PRD Open Question 3 — yes, with the sample size named. **Feeds:** FR-27, FR-28.
**Artefacts:** `block-template.txt`, three rendered blocks, `proposed/`, `selftest/`
**Raw data:** `selftest/results.json`, `independent-runs.md`
**Built on:** `../editor-vueflow-2026-08-01/` — `querbeet/recipe@1`, its validator and its named rejections
come from there and **were not modified**. See *Why the new checks are a separate module*.

---

## Verdict

The format documents in **6,734 B of plain text** — the whole spec section, every Step kind, every
config shape, every rejection class. A full FR-27 block for four Sources and a running Pipeline is
**10,938 B**. Recipes written from that block alone load: five tasks, 2 to 8 Steps, all five accepted
and all five byte-stable across a save/load round trip. **Thirteen** defect classes are each refused
by a message that names the defect.

**But the model that wrote those five Recipes also wrote the block and the validator behind it**, so
that is a consistency check on the documentation and not a measurement of machine authorship. The
measurement is the four independent runs: **Gemini and Sonnet 5, cold, no repository access, no
instruction beyond the block. All four loaded on the first round; not one needed a correction.** The
three that were asked to build the same Pipeline produced the same graph as each other and as this
session, differing in exactly one boolean. The fourth was asked for something the three Step kinds
cannot do, and said so instead of inventing a kind.

The sample is small and its limits are named in *The independent test* below — chiefly that one of the
two assistants shares this session's vendor, and that no run ever produced a refusal, so FR-28's
paste-the-error-back loop is still unexercised.

Four things the loader accepted that arguably it should not were found and are now settled: **three by
code** (column checking, a Source under `steps`, a fallback layout), **one by amending the PRD**
(a disconnected graph stays legal — see below). The column check is the one that mattered: without it
the independent test cannot distinguish *the model got the schema right* from *the model got the
column names right*.

---

## The independent test

**Four runs, 2026-08-01.** Each one a fresh session with no access to this repository, given one
rendered block and nothing else — no follow-up, no correction, no hint. Prose verbatim in
`independent-runs.md`; Recipes in `selftest/cases/i*.json`.

| Run | Assistant | Block | Result |
| --- | --- | --- | --- |
| i1 | Gemini | worked example | accepted round 1, both paths — 7 Steps, 6 edges, round trip identical |
| i2 | Sonnet 5 | worked example | accepted round 1, both paths — identical Recipe |
| i3 | Gemini | example, **all Column Annotations cleared** | accepted round 1, both paths — identical Recipe |
| i4 | Gemini | a question the three Step kinds cannot answer | **refused the task in prose, invented no kind** |

**Nothing needed a second round.** No refusal was ever produced, so the paste-the-error-back loop that
FR-28 is designed around is still unexercised — the one part of the design this test could not reach.

### The four authors converge on one graph

i1, i2, i3 and this session's own `t5-modify` are the same Recipe: same Step ids, kinds, `inputs`
wiring, `result`, and the same `config` values throughout — **except one flag**. Sonnet 5's answer is
identical to this session's down to every config value; Gemini's two answers are identical to each
other.

| | Gemini (i1, i3) | Sonnet 5 (i2) | This session (`t5`) |
| --- | --- | --- | --- |
| `u1` (given in the block) | preserved verbatim | preserved verbatim | preserved verbatim |
| `j1` keys / type / `nullsMatch` | `KundenNr = Nr`, `left`, `false` | identical | identical |
| **`j1` `duplicateAudit`** | **`false`** | **`true`** | **`true`** |
| `f1` condition | `Betrag`, `gt`, `"1000"` | identical | identical |
| `inputs` shorthand, `ui` | both used correctly | both used correctly | both used correctly |

**The one disagreement has a visible cause.** Sonnet 5's prose gives its reason — *„mit
Duplikat-Prüfung, falls eine Kundennummer mehrfach vorkommt"* — while neither Gemini run mentions the
flag at all. The block's own join example shows `"duplicateAudit": false`. So the split is between an
author who reasoned about the flag and one who took the example's value. **An example in a
specification is a default in practice**, whatever the prose around it says. Worth knowing wherever a
block example carries a value the author did not intend as a recommendation.

Neither choice is wrong here: the Profile reports `Nr` at 1,103 distinct values across 1,103 rows, so
the join key is unique and the audit has nothing to catch.

### What the four runs establish

- **The format crosses a vendor boundary.** Two assistants, no shared session, no repository access,
  same graph. This is the point Open Question 3 asked about, and it holds.
- **The modify path works, three times over.** Every run returned the pre-existing Union verbatim —
  id, name, mapping, position — rather than rebuilding it in its own idiom. That was the part most
  likely to fail and it never did.
- **The linear shorthand is discoverable.** `"inputs": "j1"` on the single-input Step, arrays on the
  others, in every run, without being told twice.
- **`ui` survived length pressure** in all four. The fallback layout was built for this case and was
  never needed. It stays: four samples are not a guarantee, and it costs 30 lines.
- **The instruction not to invent a Step kind is followed** — i4, below.
- **The answer protocol produces useful prose.** i2 and i3 each declared the assumption that *„über
  1000 Euro"* means `gt` and not `gte`, unprompted, in the three sentences the block allows. That
  ambiguity is real and is exactly what a user needs surfaced.

### i4 — the question the tool cannot answer

Asked for total revenue per region, sorted descending — grouping, summing and sorting, none of which
the three implemented kinds can do. Gemini named all three missing operations, attributed the limit to
the Step kinds rather than to the question, returned the unchanged Recipe, and **invented no `kind`**.
The run asserts this mechanically: any `kind` outside `union`/`join`/`filter` fails the case.

It then sent the user to a spreadsheet — *„diese Schritte müsstest du anschließend in einem
Tabellenkalkulationsprogramm (z. B. per Pivot-Tabelle) vornehmen."* That is not a defect in the block;
it is what a competent assistant does with a tool that stops short. It is also a direct argument for
FR-18's Aggregate Step: the missing kind does not make the assistant fail, it makes the assistant
route the user out of querbeet.

### What the runs still do not establish

1. **Two vendors, and one of them is this session's own family.** Sonnet 5 and the Opus 5 session that
   wrote the format share a vendor and a training lineage; only Gemini is genuinely foreign. The
   honest count is **one foreign vendor plus one same-family model**, not two independent samples.
2. **The annotation probe was weaker than intended.** Clearing the Column Annotations removed the
   pointer to the join key — and Gemini still matched `KundenNr` against `Nr`, which are different
   strings, so that inference is real. But the *other* hard decision, the March column named
   `Kunden-Nr`, was never actually hidden: section 3 of the block hands over the current Pipeline, and
   that Pipeline contains the mapping. To test the rename, the probe needs a block whose Pipeline is
   empty.
3. **No refusal, so no correction loop.** Everything passed round one. How a model behaves when handed
   *„„Nur Süd“ filtert auf die Spalte „Abteilung“ …"* is unmeasured, and that loop is what FR-28's
   paste-back requirement exists for. The cheapest way to reach it is probe 2 above with an empty
   Pipeline, or a Profile with genuinely awkward column names.
4. **Nobody asked a Probe Query.** All four resolved the `gt`/`gte` ambiguity by assuming and saying
   so, which is reasonable — but it means the Probe Query section of the block is written and
   unexercised. A question that cannot be answered by assumption would be needed to reach it.

### One ambiguity all four authors shared

`"value": "1000"` — a string, for a `gt` comparison against a numeric column. Four independent authors
wrote the string, because the block's only filter example uses one (`"Süd"`) and nothing in the format
says what type a comparison value has or who coerces it. Unanimity across four authors makes it the
de-facto convention rather than a decision. **It should become a decision**, in the block and in
whatever the transformation engine does with it — R1/R5 territory, and a `Betrag` formatted
`1.234,56` is exactly where a silent coercion goes wrong.

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
| `selftest/cases/` | 25 Recipes: 5 authored for real tasks, 11 defects, 5 probes for things the loader might wave through, and 4 written by foreign assistants. |
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

## What the **self-test** does not show

Stated plainly, because it was the whole weakness of this spike before run 1 — and points 2 to 4
still stand afterwards:

1. **Same author, three times over.** The `querbeet/recipe@1` format, `block-template.txt`, and the
   22 `t*`/`x*`/`s*` Recipes were all produced by the same model in the same session. Worse than
   same-model: the session had already read `recipe.js` and `graph.js` in full before writing a line
   of the block. Anything the documentation forgets to say, the author still knows. **This measures
   whether the documentation contradicts the validator. It cannot measure whether the documentation is
   sufficient.** *This is the point run 1 addresses, one sample deep.*
2. **One model, one style.** Addressed by the independent runs, within their own limits — see
   *The independent test*, *What the runs still do not establish*.
3. **No user in the loop.** FR-27's block is assembled by a person who has a real question about real
   files. Every question here was written to be answerable by three Step kinds, and the example's
   Column Annotations name both hard decisions outright.
4. **Nothing was executed.** The Recipes load and round-trip. Whether `{"op": "gt", "value": "1000"}`
   against a `Betrag` column formatted `1.234,56` filters correctly is R1/R5 territory and is not
   touched here. A Recipe can be structurally perfect and semantically wrong, and this spike cannot
   tell the difference — the column check narrows that gap without closing it.

### How to run a further independent test

Four are done and written up above. Each further run is the same five minutes:

1. Open a fresh session in an assistant with no access to this repository. **Vary the vendor** — the
   variable that is thinnest so far, since Sonnet 5 shares this session's family.
2. Paste one of the three rendered blocks. Nothing else. No corrections, no follow-up hints. For a new
   probe, edit a context file and render: `node render-block.mjs my-context.json my-block.txt`.
3. Save the answer's JSON to `selftest/cases/i<n>-<vendor>.json`, add a row to the `CASES` table in
   `run-selftest.mjs` with `measured: 'ok', independent: '<vendor>', round: 1, block: '<block>'`, and
   run it. **Keep the prose** and add it to `independent-runs.md` — what a model chooses to flag there
   is evidence, and it is what distinguished i2 and i3 from i1.
4. If it is refused: paste the refusal back verbatim — that is the loop FR-28 is designed around and
   the one part of the design nothing has reached yet — and record how many rounds it takes. **The
   number of rounds is the finding.** Save each round as its own case.

The two probes most likely to produce something new, in order: **a block whose Pipeline is empty**, so
the March rename is genuinely hidden rather than handed over in section 3; and **a third vendor**.

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
| `render-block.mjs` | Template + context → block. `--check` with no arguments verifies all three rendered blocks against the template. |
| `prompt-block-example.txt` | Generated. The worked example — this is what run 1 used. |
| `context-no-annotations.json`, `prompt-block-no-annotations.txt` | Probe 2: the same task with every Column Annotation cleared. |
| `context-aggregate.json`, `prompt-block-aggregate.txt` | Probe 3: a question the three Step kinds cannot answer. |
| `proposed/columns.js` | Schema propagation per Step kind, and the column check with its named refusals. |
| `proposed/layout.js` | Fallback layout for a Recipe with no positions. |
| `proposed/load-recipe.mjs` | The composed load path: `fromRecipe` plus the three new checks. |
| `selftest/run-selftest.mjs` | The self-test, and the table of cases with their expectations per path. |
| `selftest/cases/` | 25 Recipes: `t*` authored, `x*` defects, `s*` the silent acceptances this spike went looking for, `i*` the four independent runs. |
| `selftest/results.json` | Generated. Per case and per path: acceptance, node and edge count, positions, round-trip verdict, refusal text. |
| `independent-runs.md` | The raw record of the four independent runs, with each assistant's prose quoted verbatim. |
