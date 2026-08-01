# Spike: can a model write a Recipe from the documentation alone?

**Status:** [x] built, self-tested, and passed cold by two assistants in four runs, 2026-08-01 —
**none needed a second round**
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

That is why the blocks were pasted into **Gemini and Sonnet 5**, cold, and their answers run through
the same test. Four runs, all accepted on the first round on both load paths; the three that built the
same Pipeline produced the same graph as each other and as this session, differing in exactly one
boolean; the fourth was asked for something the three Step kinds cannot do and said so rather than
inventing a kind. Prose verbatim in `independent-runs.md`, analysis in `findings.md`.

The limits are named there too: one of the two assistants shares this session's vendor, no run ever
produced a refusal so FR-28's correction loop is unexercised, and the annotation probe left the March
rename visible in the Pipeline it handed over.

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
