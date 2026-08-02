# Editorial polish pass — `prd.md`

**Date:** 2026-08-01
**Lenses:** structure, then prose (`.claude/skills/bmad-review`)
**Document:** `_bmad-output/planning-artifacts/prds/prd-querbeet-2026-08-01/prd.md`
**Size:** 13,238 words, 733 lines (post-edit), 10 top-level sections, 39 FRs, 9 NFRs, 4 UJs

**Purpose/audience read:** this document exists to help the project owner (acting as PM) and the
downstream BMad workflows — architecture, UX, epic breakdown — agree on what querbeet does, for
whom, and where it stops, with enough argument attached that a later reader can tell a decision from
a default.

**Structure model applied:** Strategic/Context (Pyramid), the model listed for PRDs. The document
fits it well: §1 Vision is the headline, §2–§4 are the grouped support, §5–§6 draw the boundary, and
evidence (research findings, measurements) is consistently attached to the claim it supports rather
than leading it. The three deviations worth naming are S1, S9 and S11 below.

**Reader calibration:** humans. The argumentative voice, the four narrative journeys, the
`[NOTE FOR PM]` asides and the "why this exists" rationales are functional, not fluff, and no
finding below proposes flattening them.

---

## Part 1 — Edits applied to the file

13 changes, all mechanical. No claim, number, requirement or judgement was touched.

| # | Location | Problem | Fix applied |
| --- | --- | --- | --- |
| A1 | §4.2 FR-18 Notes, §4.5 desc, §4.5 FR-35 (heading, statement, bullet), §4.7 NFR-7, §6.1, §6.2 — 8 sites | The Glossary (§3) defines **Tile**; the document used `tile`/`Tile` interchangeably, with all three casings inside FR-35 alone ("Tile kinds:", "Every tile is configured", "Tiles occupy a fixed grid") | Normalised all 8 lowercase uses to `Tile`/`Tiles`, per the Glossary |
| A2 | §4.5 FR-35, first bullet | `Top-N / Bottom-N` spaced differently from the Glossary entry `Top-N/Bottom-N` | Matched to the Glossary form |
| A3 | §4.4 FR-28, orphan-Steps bullet | "since an author mid-build always has orphans" — **Author** is a defined role (§3), capitalised everywhere else it means the role | `an author mid-build` → `an Author mid-build` |
| A4 | §8, Open Question 7 | `artefacts` — the only British spelling against 10 uses of `artifact`/`artifacts` elsewhere | `built artefacts` → `built artifacts` |
| A5 | §7, Counter-metrics heading (l. 705) | Heading read "(do not optimize)" while all three bullets under it use "optimise" — same word, two spellings, same section | `(do not optimize)` → `(do not optimise)` |
| A6 | §8, between item 3 and item 4 | A stray blank line inside the ordered list. In CommonMark one blank line between items makes the **whole** list loose, so items 1–11 rendered with paragraph spacing that no other list in the document has | Removed the blank line |

### Verified clean (no edit needed)

- **Cross-references.** All 39 FR numbers, all 9 NFR numbers, all 4 UJ numbers and all 14 distinct
  `§` references resolve to something that exists and says what the citing passage claims. Spot-
  checked the load-bearing ones: FR-1→FR-36, FR-39→FR-5/FR-34, FR-9→FR-14/FR-15/FR-18/FR-26,
  FR-19→FR-13/14/15/18/38, FR-24→FR-25, FR-25→NFR-8/FR-36, FR-28→FR-12/FR-15, FR-34→FR-6/FR-14/FR-37,
  NFR-9→FR-17/FR-28/§5, §6.3→Open Questions 2/3/4. No mismatch found.
- **§0's own convention holds.** Every FR-1..FR-39 appears in §6.1, including the out-of-order
  FR-38 and FR-39, which §6.1 names explicitly inside its ranges.
- **Heading levels.** `#` → `##` → `###` → `####` throughout, no jumps, no skipped level.
- **Block template.** `**Description:**` / `**Functional Requirements:**` / FR heading / statement +
  `Realizes UJ-n` / `**Consequences (testable):**` / optional `**Notes:**` is followed by all 39 FRs.
  The two deviations are FR-5 and FR-25 (S3, P1).
- **Markdown.** No unbalanced emphasis (the four "odd `**`" hits are bold spanning a soft line wrap
  inside FR-24/FR-25 and render correctly), no malformed tables, no broken lists, no unclosed
  backticks, no doubled words, no misspellings found.
- **Term casing beyond Tile.** `Pre-flight Check` is 15/15 consistent. `Step`, `Source`, `Recipe`,
  `Package`, `Preview`, `Input Contract`, `Probe Query`, `Column Profile`, `Column Annotation`,
  `Consumer`, `Boxchecker`, `Result Step` are consistent; every remaining lowercase hit is a generic
  English use ("a build step", "three preset steps", "the source system", "any data source"), except
  the two flagged as P9/P10.
- **FR-38/FR-39 out of numeric order** — deliberate per §0, not reported.

---

## Part 2 — Structure lens (reported, not applied)

### S1 — §4.7 is not a feature group but sits inside §4 as if it were — QUESTION / MOVE (720 words)

§4 opens "Six feature groups." There are seven `###` subsections under it, and the seventh is
"Cross-cutting Non-Functional Requirements" — 720 words, the second-largest section in the document.
A reader scanning the outline counts seven and doubts the sentence; a downstream workflow slicing §4
into feature groups picks up the NFRs as a seventh.
**Fix:** promote §4.7 to a top-level section of its own (which pushes §5–§9 down by one and touches
five cross-references), or leave the placement and add half a sentence to §4's opener saying that
§4.7 is not one of the six. The second is nearly free and I would take it.

### S2 — NFRs are bullets while FRs are headings — QUESTION (no word impact)

Every FR gets a `####` heading and is therefore linkable, foldable and individually addressable.
The NFRs are nine bullets in one block, and four of them (NFR-3, NFR-4, NFR-7, NFR-9) are
paragraph-length arguments, not one-liners. NFR-3 is cited 7 times, NFR-8 and NFR-9 twice each.
**Fix:** give the NFRs the same `####` treatment as the FRs. This is asymmetry inherited from an
earlier draft, not a considered choice — the NFRs have since grown into full arguments.

### S3 — FR-25 carries three lists where every other FR carries one — MERGE (~505 words in the FR)

FR-25 is the largest FR in the document and the only one with `**Consequences (testable):**`, then a
`**Measured constraint — …**` prose block, then its own three-bullet consequence list, then
`**Additional consequences (testable):**`. This is the clearest editing seam in the document: the R9
measurement was appended rather than folded in, and the FR now has two places a reader must check
for the same kind of statement.
**Fix:** one `Consequences (testable)` list. Keep the `**Measured constraint**` paragraph and its
three user-visible consequences as the rationale block (it is genuinely explanatory and belongs
before the list), and fold the three "Additional consequences" bullets into the single list.

### S4 — True redundancy inside FR-25 — MERGE (~60 words)

Two pairs say the same thing in the two lists:

- main: "…so a session that comes back partial says so and offers to start clean" / additional:
  "A restored session that is incomplete is reported as incomplete rather than presented as whole."
- main: "The UI states plainly and persistently that data is stored in this browser." / additional:
  "The statement that data is stored in this browser says *what that means*: …"

The second pair is not pure duplication — the additional bullet adds the R9 qualification — but it
restates the base requirement to do so. **Fix:** collapse each pair into one bullet, keeping the
additional bullet's extra content. Falls out of S3 automatically.

### S5 — §4.1's Notes block is attached to the wrong FR — MOVE (~90 words)

The `**Notes:**` block that closes §4.1 sits under FR-10 (Annotate columns), but its `[ASSUMPTION]`
is about locale ambiguity and its `[NOTE FOR PM]` is explicitly about "FR-9's confirmation gate".
§9's index agrees with me and not with the document: it files this assumption as "**§4.1 FR-9**".
Every other Notes block in the document sits under the FR it belongs to.
**Fix:** move the block up to close FR-9, ahead of the FR-10 heading. Leftover from FR-10 being
inserted after the note was written.

### S6 — One consequence stated twice, in two FRs — CUT (~15 words)

FR-11: "Starting with no Recipe opens the Editor directly, since there is nothing else to show."
FR-35: "Starting with no Recipe opens the Editor rather than an empty Dashboard."
Same rule, two owners. FR-11 is the right owner (it is the FR about entering the Editor).
**Fix:** cut the FR-35 bullet, or reduce it to "See FR-11."

### S7 — FR-28 narrates its own revision history inside a testable consequence — MOVE (~55 words)

> "A Recipe whose Steps do not all contribute to the Result Step is **not** rejected. It was, in an
> earlier wording of this requirement; the FR-28 spike showed that refusing it would make a pasted
> Recipe stricter than the Editor that produced it…"

The requirement is the first sentence. The rest is the changelog of the requirement, sitting in a
list whose header promises testable consequences. It is good reasoning and should survive — it just
should not be in the consequence.
**Fix:** keep "A Recipe whose Steps do not all contribute to the Result Step is **not** rejected;
orphans are marked on load, as they are anywhere else" as the bullet, and move the spike's reasoning
into a `**Notes:**` block on FR-28. FR-28 has no Notes block today; it is the only FR of its weight
that carries all its argument inline.

### S8 — FR-39's closing bullet restates §4's theme — CONDENSE (~40 words) / arguably PRESERVE

"Nothing about this is silent. The failure this requirement exists to prevent is the one §4 names as
characteristic: a plausible wrong number instead of an error message." §4 already states this once,
deliberately and up front ("A theme runs through several of them and is stated once here rather than
repeated"). FR-39 then repeats it — and the bullet is not testable, unlike the five above it.
**Fix, if any:** condense to a cross-reference. **Counter-argument for PRESERVE:** FR-39 is the
newest FR and the one most likely to be read cold by an implementer who skipped §4, and the
reinforcement is cheap. Author's call — I would keep it and accept the inconsistency with §4's own
"stated once" promise.

### S9 — §5's "Deferred, not rejected" list opens with something that is not a deferral — MOVE

The self-service-BI bullet is a positioning statement about where querbeet's boundary runs, and it
argues the boundary is permanent ("A department that outgrows that has outgrown querbeet, and that
is the correct outcome"). Under a heading that promises deferrals, a fast reader files "self-service
BI" as post-MVP, which is the exact misreading §5's own preamble warns about: "a downstream reader
treating a deferral as a principle will build the wrong thing" — here the inverse.
**Fix:** lift it above the Permanent/Deferred split as §5's framing paragraph, or move it under
**Permanent** where its argument actually points.

### S10 — §9 Assumptions Index is not in document order — MOVE (no word impact)

Order is §2.3, §2, §3+§4.2, §3+§4.2, §4.1, §7, §4.6, §6.3. It is a lookup table (Reference/Database
shape) and random access wants a predictable sort.
**Fix:** sort by section number.

### S11 — §8 mixes closed and open questions in one list, and Q3 has outgrown the section — CONDENSE (~500 words)

§8 is the largest section in the document (1,307 words, 9.9% of it). Five of eleven items are struck
through and closed; six are live. Open Question 3 alone runs roughly 450 words of findings prose —
sample sizes, model names, byte counts, caveats, and a decision record — inside a list whose job is
to tell a reader what is still unknown.
**Fix:** two sub-lists, "Open" and "Closed (kept for the record)", numbers preserved. And move Q3's
evidence into `addendum.md`, which already exists beside this file for exactly that ("the technology
decisions and their consequences are recorded in `addendum.md`"), leaving §8 with the verdict, the
caveat that the correction loop is unexercised, and the pointer.
**Note:** this is the single largest available reduction and also the one most likely to be refused —
the detail is the evidence, and the author has kept it deliberately close to the question. Flagged,
not urged.

### S12 — PRESERVE: §0 before §1

Pyramid says conclusion first, and §0 Document Purpose (296 words of numbering conventions and
scope-of-research) delays the Vision. For a document whose stated audience is downstream *workflows*
that need the FR-numbering contract before they can consume anything, this is correct. Flagging so a
later pass does not "fix" it.

### S13 — PRESERVE: the journeys, the Notes asides, and the argument in the FRs

§2.3 is 961 words of narrative for a document read mostly by machines and one human who already
knows the stories. It stays: UJ-1 is the only end-to-end validation the product has, UJ-2 is the
hypothesis the whole Consumer half rests on and is marked as such, and the `Edge case` slot in each
journey is where several FRs get their reason for existing. Likewise the `[NOTE FOR PM]` blocks and
the "why this exists" rationales — they are what makes this PRD auditable six months out.

---

## Part 3 — Prose lens (reported, not applied)

**Voice noted and preserved:** direct, argumentative, first-person-absent. Recurring devices that are
style and not error, and were left alone throughout — the em-dash aside; the ", because" clause
(9 occurrences) used to attach a reason to a completed claim; bold used to carry the load-bearing
sentence of a long bullet; the sentence-final judgement ("and that is the correct outcome", "which is
the failure this product exists to make impossible"); occasional comma splices for rhetorical speed.

### P1 — §4.1 FR-5, the `**Why this exists,**` label

> "**Why this exists,** because the handled cases look arbitrary without it: the JSON that reaches
> querbeet broken most often did not come from a system, it came from a language model."

The bold label swallows its comma and the sentence never reaches a main clause. It is also the only
one-off block label in the document (every other FR uses Description / Consequences / Notes).
**Consider:** `**Why this exists** — the handled cases look arbitrary without it: the JSON that
reaches querbeet broken most often did not come from a system, it came from a language model.`
**Not applied** because the ", because" construction is a deliberate and frequent pattern here, and
the label may be doing intentional work; the fix is a punctuation judgement the author should make.

### P2 — §2.3 UJ-3, wrong mechanism named — substance, so reported only

> "querbeet rejects it against the Input Contract and says which reference failed"

The Input Contract (FR-21) declares what the Pipeline expects of the *Consumer's files*, and FR-22
checks files against it. A model-authored Recipe referencing a column that does not exist is
rejected by FR-28's ingest validator, not by the Input Contract — FR-28 says so in its own words
("A Recipe referencing a column, Source or Step that does not exist is rejected naming the failing
reference"). UJ-3 is the LLM journey and FR-28 is its FR; the Input Contract has no role in it.
**Fix:** name the validator, or cite FR-28. Left alone because correcting it restates a claim.

### P3 — §7 SM-1's validation range looks stale — substance, so reported only

> "**SM-1: The PowerQuery workflow is retired.** … Validates FR-1 – FR-19, FR-36, FR-37."

The range predates FR-38 and FR-39. Both are exercised by the metric it describes: the quarterly
patch-compliance run executes the Pipeline (FR-38, and at Ben's row counts probably in live mode)
and loads three CSVs that FR-39 exists to vet. Elsewhere the document is careful to name the
out-of-order numbers inside a range — §6.1 writes "FR-1 – FR-10, FR-39" and "FR-11 – FR-19, FR-38"
for exactly this reason. **Fix:** if SM-1 is meant to cover them, write "FR-1 – FR-19, FR-38, FR-39,
FR-36, FR-37"; if not, the omission is worth a word. SM-2/3/4's ranges are clean.

### P4 — §4.2 FR-14, "the input row count" has two referents

> "When the output row count exceeds the input row count, the Step warns explicitly that duplicate
> keys produced additional rows, and states the factor."

A Join takes exactly two inputs (FR-12), so "the input row count" is undefined. The intended
comparison is almost certainly against the left input.
**Consider:** "When the output row count exceeds the left input's row count…"

### P5 — §4.3 FR-22, two actions compressed into one clause

> "A column present under a different name is reported as missing with the actual column list
> offered for mapping (FR-23)."

"with" attaches an action to a report; the reader has to unpick which subject does which.
**Consider:** "A column present under a different name is reported as missing, and the Source's
actual columns are offered for mapping (FR-23)."

### P6 — §0, unclear antecedent

> "…the graph Editor, chart rendering, and browser persistence. They live in
> `_bmad-output/planning-artifacts/research/`…"

The preceding list is of research *topics*; the things that live in the directory are the *reports*.
**Consider:** "The reports live in…".

### P7 — §2.3 UJ-1, wrong object

> "One CSV gets a doubtful delimiter warning, which he corrects."

He corrects the delimiter; the warning is the symptom.
**Consider:** "One CSV gets a doubtful delimiter warning, and he corrects the delimiter."

### P8 — Two forms of the same number, in requirements that test against it

"Scrolling through a hundred thousand rows stays smooth" (FR-31), "Searching a hundred thousand rows
returns within an interaction-responsive time" (FR-33) — against "100,000 rows" in FR-25 and NFR-3,
and "half a million" / "500k" in §8. FR-31 and FR-33 are testing against NFR-3's number and read
better sharing its notation.
**Consider:** "100,000 rows" in both, leaving the prose spellings in §1/§2 narrative untouched.

### P9 — §1, `The author's expertise travels` — noted, not changed

**Author** is a Glossary role and is capitalised in every later use that means the role. §1 precedes
§2, where the role is introduced, and speaks in deliberately plain language throughout ("wires
together a small graph of union, join, filter and column operations"). Left as is; flagged so the
inconsistency is a choice rather than an oversight.

### P10 — §4.2 FR-12, `part of the pipeline` — noted, not changed

Last bullet-but-two of FR-12, whose own heading and statement capitalise **Pipeline**. The generic
reading ("part of the pipeline being built") is defensible, so this was left alone rather than swept
with the Tile fix.

### P11 — Mixed British/American spelling — partially applied

Dominant register is British: *optimise, optimising, organisation, utilisation, utilised, recognised,
unrecognised, serialise, summarises, artifacts-with-i-but-otherwise-British*. Against it sit
*virtualized/virtualization* (FR-31, §4.5, §8) and *memoize* (§8), which are library-standard
technical terms and read wrong in -ise form.
**Applied:** only the §7 collision, where the same word appeared both ways within one section (A5).
**Left:** the technical -ize terms. **Consider:** a standing note in the project's style guide, since
this will recur in every document.

### P12 — Hard-wrapped paragraphs in FR-24 and FR-25 only

The R9 material (FR-24's last bullet, FR-25's `Measured constraint` block and additional
consequences) is wrapped at roughly 95 columns; the other 700-odd lines are one line per paragraph.
Renders identically, but it makes every future edit to those two FRs produce a multi-line diff where
the rest of the document produces a one-line diff.
**Consider:** unwrap to match. Cosmetic; falls out of S3 if that is taken.

### P13 — Comma splice in FR-5 — noted, not changed

"…did not come from a system, it came from a language model." In keeping with the document's voice
and its rhythm of paired clauses. Left.

---

## Summary

**Applied:** 13 edits — 9 Glossary-casing normalisations (Tile ×8, Author ×1), 1 Glossary-form match
(Top-N/Bottom-N), 2 spelling-consistency fixes (artifacts, optimise), 1 markdown render fix (stray
blank line making §8's list loose). No content, requirement, number, decision or judgement altered.

**Reported:** 13 structure findings (2 of them PRESERVE) and 13 prose findings.

**Estimated reduction if every reported CUT/MERGE/CONDENSE is accepted:** roughly 670 words, ~5.1%
of 13,238 — and ~500 of those 670 sit in S11 alone, which is the finding most likely to be refused.
Excluding S11, the redundancy in this document is about 170 words, or 1.3%. That is a tight document.
No length target was stated; none is needed.

**Comprehension trade-offs:** S8 and S11 both trade reinforcement for brevity and are marked as
author's-call rather than recommended. Nothing else in the list costs the reader anything.

**Character of the findings:** as expected for a document edited several times in one day, the real
findings are seams, not defects — FR-25's two consequence lists (S3/S4), §4.1's Notes block orphaned
by FR-10's insertion (S5), FR-28's requirement narrating its own revision (S7), SM-1's range predating
FR-38/FR-39 (P3), and two FRs hard-wrapped where the rest of the file is not (P12). The numbering
contract in §0, the FR/NFR/UJ cross-reference web, and the FR block template are all intact.
