# Spike: can a model write a Recipe from the documentation alone?

**Status:** [x] apparatus built and self-tested, 2026-08-01 — **the independent test is not yet run**
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
and were not changed here.

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

The real test is one independent assistant, given nothing but the rendered block. The protocol for
running it is in `findings.md`, section *How to run the real test*. Until it is run, Open Question 3
stays open.

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
**Reached.** 5 authored Recipes accepted and byte-stable across a round trip, 8 defects refused by
name, 4 silent acceptances found and written up as gaps.

## Outcome

- The format documents in **6,154 B**; a full block for four Sources and a running Pipeline is
  **10,358 B**. Answers run 526 B to 1,764 B.
- **Four gaps.** Column names are never validated (the likeliest machine failure mode, and FR-28
  requires it); a disconnected graph loads (FR-28 says it should not — decide which is wrong);
  a Recipe without `ui` stacks every Step on 0,0 and there is no auto-layout; a Source declared in
  `steps` is tolerated and silently normalized on save.
- **Recommended before the independent test:** the column check and a fallback layout. Without the
  first, the test cannot separate "got the schema right" from "got the column names right".
