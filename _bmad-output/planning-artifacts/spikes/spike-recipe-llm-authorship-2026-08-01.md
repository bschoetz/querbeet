# Spike: can a model write a Recipe from the documentation alone?

**Status:** [x] built, self-tested, and passed by a foreign assistant on the first round, 2026-08-01
— **one vendor, one task; the generality is one sample deep**
**Created:** 2026-08-01, unblocked by the Vue Flow Editor spike
**Kind:** spike. The outcome is a prompt block, a self-test, and one honest caveat.
**Results:** `recipe-llm-authorship-2026-08-01/findings.md`
**Answers:** PRD Open Question 3 · **Feeds:** FR-27, FR-28

---

## Why this exists

PRD FR-28 requires a language model to emit a valid Recipe from documentation alone, and Open
Question 3 flags a graph as materially harder to get right than a list. The Editor spike closed the
prerequisite: `querbeet/recipe@1` exists, a validator rejects cycles, dangling references and wrong
arity by name, and nothing is partially applied.

What was missing is the other half — the documentation a model is given, and evidence that it is
enough.

**Read first:** `editor-vueflow-2026-08-01/findings.md`, section Q4, and
`editor-vueflow-2026-08-01/app/src/model/recipe.js`. The format and its rejections are settled there
and were **not modified** here: the checks this spike adds live in `recipe-llm-authorship-2026-08-01/proposed/`
as a composition over `fromRecipe`, so the Editor spike's measured 247,987 B artefact stays exactly as
measured. Folding them in is three lines, once the Editor stops being a spike.

---

## The three deliverables

1. **The format documentation as a copy-ready prompt block**, in the shape FR-27 demands: the user's
   question, the Column Profile, the Pipeline as it stands, the format specification, the answer
   protocol. Template with placeholders, so the app can render it.
2. **A self-test** that runs Recipes written from exactly that documentation through the real
   `fromRecipe` — valid ones for several tasks, and one case per rejection class.
3. **The finished block**, rendered and ready to paste into a foreign assistant.

## The caveat that is part of the deliverable

The self-test is **weak evidence**. The format, the documentation and the test Recipes come from the
same model in the same session, and that session had read the validator first. It can show the
documentation does not contradict the loader. It cannot show the documentation is sufficient.

That is why the block was pasted into **Gemini**, cold, and its answer run through the same test:
accepted on the first round, on both load paths, and identical to this session's own answer Step for
Step. One vendor, one task — and a task whose two hard decisions the example's Column Annotations
name outright, so it measures whether a foreign model can *express* a plan, not whether it can *find*
one. What remains is in `findings.md`, section *The independent test*.

## Explicitly out of scope

- **Executing a Recipe.** Structural validity only. Whether a `gt` comparison against a German-formatted
  number filters correctly belongs to R1 and R5.
- **The Probe Query (FR-29).** The block proposes it as a Recipe plus `"purpose": "probe"` because
  FR-27 demands its specification be included, but nothing enforces or acts on it.
- **Sample release (FR-30).** No slot in the block, by design for now.
- **The three missing Step kinds.** This build has union, join and filter; the PRD names six. A task
  needing an aggregate is a test case here, not a construction task.

## Done when

The block renders, and Recipes written from it alone — for several different tasks — load through the
real validator, while every rejection class is refused by a message that names the defect.
**Reached.** 5 authored Recipes accepted and byte-stable across a round trip, 13 defect classes
refused by name, 4 silent acceptances found and closed.

## Outcome

- The format documents in **6,734 B**; a full block for four Sources and a running Pipeline is
  **10,938 B**. Answers run 526 B to 1,764 B.
- **Four gaps found, all settled.** Three by code, in `proposed/` rather than in the Editor spike's
  measured artefact: a column check built on Step-by-Step schema propagation, a refusal for a Source
  declared under `steps`, and a fallback layout for a Recipe that arrives without `ui`. One by
  amending the PRD: a disconnected graph stays legal, because refusing it would make a pasted Recipe
  stricter than the Editor that produced it.
- **The column check was the one that mattered.** Without it the independent test cannot separate
  "got the schema right" from "got the column names right". It bites on propagated schemas, not just
  on what a Source declares: a filter downstream of a Union with `"unmatched": "drop"` naming a column
  the intersection dropped is refused, and the refusal lists what is available instead.
- **Two engine decisions fell out of writing it**, both recorded and both open to R1: a Join whose
  inputs share a column name is legal and the duplicate's fate is undecided (reported as a note, not
  an error); a Union with `drop` emits the intersection, with `keep` the union.
