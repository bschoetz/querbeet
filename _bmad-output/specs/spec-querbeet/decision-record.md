# Decision Record — querbeet

Companion to `SPEC.md`. Product decisions that closed off an alternative, and the mitigations already chosen for the two riskiest of them. This exists so a downstream reader re-litigates nothing by accident: several of these moved more than once before landing, and one reverses a position stated in the project's own original outline.

Technology picks and their rationale are in `technology-decisions.md`; this file is about product shape.

## Options considered and rejected

**LLM channel.** Three shapes were considered in sequence and the decision moved twice. API-only was the first answer; it was withdrawn during discovery in favour of copy-paste primary with an optional key; and at review the API path was removed from the MVP altogether. What survives is copy-paste only, and that has a consequence worth stating plainly: **C-2's network silence becomes unconditional.** The MVP artifact makes no network request in any configuration, verifiable by grepping the built file rather than by reasoning about settings. When the API path returns post-MVP, its binding constraint is already recorded: it must send exactly what the copy-paste block would have contained, so it can never become a second and laxer disclosure path.

**LLM disclosure model.** An earlier decision in the same session was "structure plus opt-in sample values". The Probe Query concept, contributed by the project owner, supersedes that framing: rather than deciding up front how much to reveal, the model asks questions, querbeet answers them locally, and only answers travel. Sample release survives as an explicit narrower affordance (CAP-30).

**Recipe with embedded data.** Considered as one format with a checkbox; rejected in favour of two named artifacts, Recipe and Package, so a file's contents are evident from what it is rather than from a flag inside it.

**Consumer mode.** Three depths were considered — binding-only repair, binding plus limited Step editing, or one full Editor for everyone. The last was chosen for the MVP on build cost, with CAP-11's deliberate-entry guard carrying the intent that two interfaces would otherwise have carried. A roles/rights/views model is explicitly deferred.

**Interactive HTML export.** Cut from the MVP as the most expensive single item, being effectively a second small product. It is the strongest candidate for the first post-MVP addition, because it collapses the Consumer's setup cost to zero.

**Computed column formula language.** Deferred rather than rejected in favour of fixed click-together operations. The decisive argument was machine authorship rather than implementation cost: a fixed operation list is a plain data structure a model can emit and the system can validate, whereas a formula language invites a model to produce syntax the parser does not know.

**Pipeline shape.** Three shapes were put to the project owner: a strictly linear Step list, a list whose Steps can be named and referenced as inputs by any later Step, or a full node graph. The graph was chosen. The middle option was offered because it delivers the requested capability — a filtered subset reused in two places — at close to no cost, since Union and Join already take two inputs and the model therefore already admits multiple edges; the difference between it and a graph is mostly the editor, not the data model. The graph's costs were named before the decision was taken. C-13 is the standing mitigation: **the Recipe format is written so a linear pipeline is the trivial case of it**, so a model asked for something simple can produce something simple.

**Comparison value as a string.** The alternative to a JSON number was to require a string always, and the research plan itself leaned that way on the argument that only a string keeps a Recipe portable across locales. The opposite holds. A JSON number needs no locale to be read correctly anywhere, while a string re-admits into the Recipe exactly the locale defect that CAP-9's type confirmation exists to remove — and admits it one level deeper, past the gate. The two are equivalent below 2⁵³ and diverge only above it, which no report figure in this product reaches. The mechanism that would have made the question moot, grammar-constrained decoding under a strict schema, is unavailable because a Recipe arrives through the clipboard; enforcement therefore lives in the CAP-28 ingest validator rather than in the channel.

**Drag-and-drop.** An early draft banned drag reordering outright, on a misreading of the research. The finding is narrower: the documented failure is a *library that mutates DOM order* while the framework diffs the same list — two sources of truth, and the list fights itself. Native drag events that compute a target index and update the model are fine, because the framework then re-renders from a single truth. What remains binding is C-7: no interaction may exist *only* as a pointer gesture, which is a correctness rule about keyboard reachability rather than an accessibility target.

## Additions that reversed an earlier position

**Aggregate as a sixth Step kind (CAP-18)** was added against both the project's original outline and the README roadmap, which place group-by after the MVP. Confirmed by the project owner in discussion: the Consumer's job cannot be expressed without grouping, and Top-N Tiles and key figures presuppose it.

**The graph Editor arrived late** and reverses an explicit non-goal in the original outline, which specified a linear step list. Three consequences followed; two have since been retired by measurement (the technology gap closed, and the framework verdict survived re-examination) and one cannot be — **the graph enlarges the Recipe format at exactly the point where a language model must produce it correctly.** Five of five independent authoring runs succeeded against the enlarged format, which is encouraging evidence and not a settled question: the failure path it depends on has never been exercised, which is an open question in `SPEC.md`.

**The original outline's Editor shape survived and is not decoration.** Three panes — Sources, Pipeline, Result — and a Step tile whose **height grows with its content**. That second detail is why the Editor spike measured anchor drift against variable-height node bodies at all, and the answer that came back is what makes the growing tile safe to build.

## Mitigations already chosen, for the two riskiest decisions

**CAP-9's confirmation gate is the single most user-visible friction in the product and the single strongest correctness guarantee.** If usage shows it being clicked through blindly, **the mitigation is to make unconfirmed columns visually loud in the Result, not to remove the gate.**

**CAP-38's two execution modes cost the most explanation of anything in the product**, and were chosen over both single-mode alternatives with that understood. Live-only is unaffordable at the upper end of C-3; explicit-only makes every small pipeline — which is most of them — feel like a compiler. The risk to watch is the boundary: **if users report being surprised by the switch, the fix is to make the mode indicator louder, not to remove a mode.**

**Roles and permissions are the deferral most likely to be needed sooner than planned**, if Recipes actually reach non-technical Consumers.

## Scope risk, stated plainly

The MVP contains **four largely independent product surfaces**: the loading and typing layer, the graph Editor, the LLM collaboration protocol, and the result presentation layer. Each is individually modest; together they are a substantial build for one person. Three observations follow, and none is a recommendation to cut — the scope decisions are the project owner's and were made deliberately, in some cases after the cost was named.

First, **only the transformation path is validated by an existing workflow.** The Author's patch-compliance report exists today in PowerQuery and its every step is known. The LLM protocol is a strong idea with no usage behind it, and the Dashboard is evidenced by one named need rather than by a practice.

Second, the graph Editor's one unretired consequence is the Recipe-format enlargement described above.

Third, **the natural build order is the risk order.** Reaching a working consolidation-and-export path first — a version that replaces the PowerQuery workflow end to end and nothing more — produces a tool that earns its keep on its own, and turns every later block into an addition rather than a prerequisite. The Recipe format should nonetheless be designed for machine authorship from the first commit, because retrofitting that is expensive and designing for it is nearly free.
