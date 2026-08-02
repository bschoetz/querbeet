# Input reconciliation: `idea.md` → PRD + addendum

**Date:** 2026-08-01
**Input:** `/home/n_to/Github/querbeet/idea.md` (original handover outline)
**Targets:** `prd.md`, `addendum.md` (this directory)

This pass asks one question per piece of material in `idea.md`: did it reach either target, and
does it matter that it did not. The known-intentional divergences — node graph, Aggregate in the
MVP, PDF export in the MVP, decided persistence, superseded stack (AlaSQL, SheetJS, CDN) — are not
treated as gaps; the PRD governs there.

Eleven gaps below, ordered by what they cost if they stay lost. Seven are qualitative — tone,
motivation, feel, a usability bar — which is the category a numbered FR structure drops without
anyone noticing. Four are structural or technical. A closing section lists material that was
checked and found adequately carried, so a later reader does not re-open it.

---

## G1. The Leitsatz — the one sentence the whole product is measured against

**`idea.md` §1:**

> **Leitsatz:** Reports in, consolidated table out.

**Where it should live:** `prd.md` §1 Vision, as a set-off line — ideally the first or last line of
the section.

**Status:** Not carried in any form. §1 contains the words "gets one consolidated table out" inside
a longer sentence, which is a description of behaviour, not a principle.

**Judgement: carry it.** This is the highest-value single line in the input and the cheapest to
restore. Its function is not decorative — it is a scope test. A PRD with six feature groups, 37
FRs, four product surfaces and an acknowledged scope risk (§6.3) needs one sentence that settles
arguments about what belongs. "Reports in, consolidated table out" does that: it admits the
transformation path without argument, admits the Dashboard and the export as the "out", and makes
anything that is neither an input file nor the consolidated result argue for itself. The author set
it in bold and gave it its own label; it survived every revision of `idea.md` including the
alignment pass. Losing it is losing the product's own summary of itself.

## G2. The learnability bar — "without instructions"

**`idea.md` §10, Definition of Done:**

> Der Kern-Use-Case ist ohne Anleitung von einem Excel-affinen Nutzer durchführbar.
> *(The core use case can be carried out without instructions by an Excel-literate user.)*

**Where it should live:** `prd.md` §7 Success Metrics, as a primary or secondary SM; alternatively
as an NFR alongside NFR-5/NFR-6.

**Status:** Not carried. §7 has four success metrics: the PowerQuery workflow is retired (SM-1), a
Recipe runs in someone else's hands (SM-2), the monthly rerun costs nothing (SM-3), the LLM path
shortens authoring (SM-4). SM-1 is satisfied by the Author, who wrote the tool's requirements and
cannot fail to understand it. SM-2 comes closest but tests the *Recipe*, not the interface: a
Consumer given a Recipe never builds anything. Nowhere does the PRD state that the tool must be
operable without being explained. The words "instruction", "tutorial", "onboarding", "learn" (other
than "no re-learning" in a JTBD) appear nowhere in either target.

**Judgement: carry it, and it is the most consequential loss after G1.** It is the only quality bar
in the input that constrains the *interface* rather than the output, and it is the one thing the
Author cannot verify on himself. It also has teeth against decisions this PRD has already made:
FR-9's mandatory type-confirmation gate, FR-22's Pre-flight Check and FR-11's deliberate Editor
entry each add a step a user must understand unprompted, and §4.1's own PM note concedes FR-9 is
"the single most user-visible friction in the product". Without a stated no-instructions bar,
nothing in the document pushes back when the next such gate is added.

Note it does **not** conflict with counter-metric SM-C1 ("do not optimise speed of first result").
Comprehensible-without-explanation and fast are different axes, and saying so explicitly when the
metric is added would be worth one clause.

## G3. Who the user actually is — "can Excel, cannot SQL"

**`idea.md` §1 and §2:**

> Ein Nutzer soll **ohne Programmier- oder Datenbankkenntnisse** … eine konsolidierte Tabelle
> erstellen können – durch **Zusammenklicken** einer kleinen Pipeline.

> Sachbearbeiter, Controller, Projektleiter – Menschen, die Excel können, aber kein SQL.

**Where it should live:** `prd.md` §2 Target User, in the Author paragraph and/or as a one-line
calibration under the three-role split.

**Status:** Partially carried, and the part that was dropped shifted the target upward. The PRD's
Author is "technically confident, comfortable with data, not necessarily a programmer — the person
who today reaches for PowerQuery, a spreadsheet full of VLOOKUPs, or a short script." The PRD's
Consumer is "competent in their domain and reads tables fluently, but they do not build pipelines".
The three concrete job titles are gone, and so is the bright line "Excel yes, SQL no".

**Judgement: carry the calibration line; the job titles are optional.** This is not only phrasing.
"Reaches for a short script" describes someone strictly more technical than "kann Excel, aber kein
SQL", and the PRD's Author is the person who will be assumed when a design decision is close. The
input's line is a testable ceiling — if a screen requires a concept a competent Excel user does not
have, it is out of bounds — and the PRD's wording is not. The three job titles are worth one clause
because they say *where in an organisation* this lands, which nothing in §2 currently does; the
PRD's roles are functional (Author/Consumer/Boxchecker) and deliberately abstract, and one concrete
sentence beneath them costs nothing and grounds them.

"Zusammenklicken" is the positive form of a rule the PRD only states negatively (§5: "No formula
language, no scripting, no SQL"; FR-17: operations chosen "from fixed lists"). The mechanism is
carried; the intent — *everything is assembled by clicking, nothing is typed* — is worth one clause
in §2 or FR-17 because it generalises to features not yet designed.

## G4. Why JSON repair exists at all

**`idea.md` §5.1:**

> KOrrektur von JSON-Syntaxtabweichungen (vor allem falls JSON aus einem LLM kommt, da gibt es ja
> gängige schwierigkeiten)
> *(Correction of JSON syntax deviations — above all when the JSON comes from an LLM, where there
> are well-known difficulties.)*

**Where it should live:** `prd.md` §4.1 group description, or one clause in FR-5.

**Status:** The mechanics are carried thoroughly and then some — FR-4 (detect malformed), FR-5
(repair, with a handled-case list that includes markdown code fences and ellipsis truncation),
FR-6 (disclose what changed). The *reason* is nowhere.

**Judgement: carry it — one clause, high leverage.** Two FRs and a third disclosure requirement is
a lot of machinery for a data-loading tool, and a reader coming to §4.1 cold cannot tell why
querbeet repairs JSON when it does not repair CSV. The answer is in the input: the expected
malformed-JSON producer is a language model, not a broken export. That single fact justifies the
whole cluster, explains why *those* handled cases (code fences and ellipsis truncation are LLM
artifacts, not export artifacts), and ties §4.1 to §4.4 — a user who works with querbeet through a
chat assistant will be pasting model output around, and JSON repair is the same story from the
other end. It also sets a priority for the repair list if it is ever trimmed. Losing the rationale
turns a coherent design into an arbitrary-looking feature.

## G5. The layout sketch, and the growing Step tile

**`idea.md` §7:**

> Dreiteiliges Layout:
> 1. **Links – Quellen**: Liste der geladenen Dateien, Button „Datei hinzufügen".
> 2. **Mitte – Pipeline**: … eine Fläche mit dem Schritt-Graphen … jeder Schritt eine Kachel mit
>    kompaktem Konfigurationsbereich, **deren Höhe mit ihrem Inhalt wächst**.
> 3. **Rechts/unten – Vorschau**: Tabellenansicht des Ergebnisses nach dem aktuell ausgewählten
>    Schritt, plus Export-Buttons.

**Where it should live:** `addendum.md` — it is UX-spec material, and the addendum opens by saying
it exists for "material that belongs to a downstream document — architecture, solution design, UX
spec". A new short section, or an addition to §7 (The graph Editor).

**Status:** Not carried as a layout. The PRD refers to a "Sources pane" three times (UJ-1, FR-1,
FR-10) and to the Editor as "a distinct area", but never states a spatial arrangement. The tile
that grows with its content is present only as an *implication*: addendum §7 reports that the
variable-height tripwire "passes: anchors drift 0 px in Chromium and 0.02 px in Firefox across five
runtime height changes" — a spike that was run precisely because the author wanted node bodies to
grow, with that motivation written down nowhere.

**Judgement: carry it, marked as the Author's working layout rather than a binding spec.** Three
reasons. First, it is the only expression of spatial intent in the entire input set, and a UX phase
starting from the PRD alone would have to invent it. Second, the configuration living *inside* the
node — rather than in a side panel opened on selection — is a real design decision with a real
cost, and it is the reason the variable-height risk was worth a spike at all; recording the intent
next to the measurement makes the measurement legible. Third, it needs a caveat that only exists
now, so writing it down now is cheaper than later: the input's layout has the pipeline permanently
in the middle, whereas FR-11 makes the Editor deliberately entered and FR-35 lands a Consumer on
the Dashboard. The three-pane arrangement is therefore the Author's view, not the application's
only view — a distinction worth one sentence and easy to get wrong if someone reconstructs the
layout from §7 of the input later.

## G6. Empty states

**`idea.md` §8, M5:**

> **M5 – Politur**: … Fehlerbehandlung (kaputte CSVs, fehlende Schlüssel beim Join), **leere
> Zustände**, kleine UX-Verbesserungen.

**Where it should live:** `prd.md` — a consequence bullet under FR-11 and/or FR-35, or a line in
§6.1.

**Status:** Not carried. The string "empty state" appears nowhere in either target. The nearest
statements are two duplicated bullets: FR-11 "Starting with no Recipe opens the Editor directly,
since there is nothing else to show" and FR-35 "Starting with no Recipe opens the Editor rather
than an empty Dashboard." Both say *where* an empty app routes; neither says what that screen
contains.

**Judgement: carry it, briefly.** Modest in isolation, but it is the first screen of a
double-clickable HTML file with no server, no account and no onboarding — the entire first
impression, and the only place the tool can explain itself to a Consumer who was handed a file. It
is also the screen G2's no-instructions bar leans on most heavily. One consequence bullet stating
that the zero-state names what to do next is enough; it does not need its own FR.

## G7. Structurally broken CSV has no requirement

**`idea.md` §8, M5:**

> Fehlerbehandlung (**kaputte CSVs**, fehlende Schlüssel beim Join)

**Where it should live:** `prd.md` §4.1, as a consequence bullet on FR-3 or a small FR beside it.

**Status:** Not carried for CSV. The malformed-input path is developed in detail for JSON — FR-4
detects, FR-5 repairs, FR-6 discloses — and for encoding (FR-2) and delimiter/header (FR-3). What
is absent is the CSV analogue of FR-4: rows with the wrong field count, unterminated quotes, a file
that parses but ragged. FR-1 covers only "an unsupported or unreadable file", and FR-3 covers only
"when the delimiter cannot be determined". A CSV with 40 good rows and one row carrying an extra
semicolon is neither unreadable nor an undetermined delimiter, and nothing in the PRD says what
happens to it. The second half of the input's phrase, "fehlende Schlüssel beim Join", *is* carried —
FR-14 reports unmatched left rows and warns on row multiplication.

**Judgement: carry it — this is a genuine functional hole, not a wording loss.** It also lands
squarely on the theme §4 states as querbeet's characteristic failure mode: "a plausible wrong
number, not an error message." A silently dropped or silently shifted CSV row is exactly that, and
CSV is the format the target user will bring most often. One bullet: rows that do not match the
header's field count are reported with a count and remain inspectable, never dropped silently.

## G8. What to actually measure about Firefox

**`idea.md` §3:**

> das Messbild ist differenzierter als „Firefox ist langsamer" – es ist **arbeitsartabhängig**:
> - **JS-lastige Arbeit: Firefox deutlich langsamer.** Arquero-Pipeline 446 ms vs. 263 ms; volle
>   Zeilen-Materialisierung (`objects()` über 100k) 97 ms vs. 12,5 ms – Faktor 8.
> - **DOM-Rendering: praktisch gleichauf.** … und Firefox war dabei *gleichmäßiger* (Maximum 10 ms
>   vs. 98 ms).
>
> Was im MVP zu prüfen ist, ist also **nicht** „ist Firefox langsam", sondern: reicht Firefox auf
> den JS-lastigen Pfaden (Pipeline-Lauf, Export, Zwischenablage) noch für flüssige Bedienung.

**Where it should live:** `addendum.md` §2, as one paragraph beside the existing worker and
transfer findings.

**Status:** Partially carried, and the operative half is the half that thinned. NFR-4 carries the
decision, the reason (everyone has Edge), the measure-don't-assume rule, and the drop-if-it-doesn't-
carry-the-JavaScript-heavy-paths rule. What is gone: that DOM rendering is a tie and Firefox is
actually *steadier* there (max 10 ms vs 98 ms), the factor-8 row-materialization figure, and the
named list of paths to test — pipeline run, export, clipboard. The addendum has no browser-
performance entry at all; it cites "263–446 ms for the entire Arquero pipeline" as an
engine-unattributed range inside a paragraph about worker transfer cost, and 97 vs 12.5 ms appears
nowhere.

**Judgement: carry a compressed version.** The raw numbers live in the research document and do not
need duplicating, but two things do. First, the shape of the result: a reader of NFR-4 alone
concludes "Firefox is slower", which is wrong in the rendering half and would misdirect the very
measurement NFR-4 schedules. Second, the named path list, because NFR-4 commits the project to a
measurement during the first builds without saying what to measure — and "clipboard", the third
item, is not obviously JavaScript-heavy until you notice FR-27's block is built by string assembly
over every Column Profile. Three sentences in addendum §2.

## G9. Sample files in the repository

**`idea.md` §10, Definition of Done:**

> README aktualisiert, Beispieldateien im Repo zum Ausprobieren.
> *(README updated, example files in the repo to try it out.)*

**Where it should live:** Not the PRD — this is delivery/DoD material. `addendum.md`, or the epic
breakdown when it is written.

**Status:** Not carried. Neither target mentions example or sample data files. (FR-30's "sample
values" is a different thing — releasing cell values to an LLM.)

**Judgement: carry it into the epic/DoD layer, not into the PRD.** Worth not losing for three
reasons that outlive its DoD framing. A fixture set is the only way anyone but the Author can
exercise a Recipe end to end while Open Question 1 stays open and the Consumer remains
uninterviewed. It is the natural home for the awkward cases the PRD now demands — a
semicolon-delimited German CSV, a `1.234` ambiguity FR-9 must refuse to resolve silently, an
LLM-mangled JSON for FR-5, a duplicate-key join for FR-14. And FR-20's requirement that "the Recipe
format is documented well enough that a language model can produce a valid one from the
documentation alone" is already measured against fixture files in the authorship spike; keeping
them in the repo is what makes that measurement repeatable.

## G10. The staged format rollout

**`idea.md` §5.1:**

> Mehrere Dateien per Drag-and-drop oder Dateidialog laden (**CSV und JSON zuerst, XLSX als zweite
> Ausbaustufe**).

**Where it should live:** `prd.md` §6.3 (build order), one clause.

**Status:** Not carried. §6.1 lists all five input formats — CSV, JSON, NDJSON, XLSX, Parquet — as
one scope item with no sequencing. §6.3's build-order observation is about the four product
surfaces, not about formats within the loading layer.

**Judgement: carry it only if §6.3 is edited for another reason — low value on its own.** The
sequencing is nonetheless still true and still useful: XLSX is the format with an unresolved
technical risk (Open Question 5, whether `read-excel-file` constructs its worker in a way that
survives `file://`) and an unverified output claim (Open Question 6, German format codes in a real
German Excel, owner scheduled 2026-08-02). Ordering CSV and JSON ahead of it is what keeps those
two open questions off the critical path. That reasoning is available in the PRD but never joined
up, and one clause would join it.

## G11. "Das Rezept ist das Produkt" as a priority statement

**`idea.md` §1:**

> 1. **Das Rezept ist das Produkt.** … Das Wissen wandert, die Daten bleiben.

**Status:** Carried in substance and, in one case, improved. §1 of the PRD has "the pipeline itself
is a portable artifact", "The author's expertise travels; the data does not", and "This is what
turns a personal utility into leverage". §4.3 develops it fully. The only thing not carried is the
flat identity claim — the Recipe *is* the product, not a feature of it.

**Judgement: do not carry as written; note the tension instead.** The PRD is right not to repeat it
verbatim, because §6.3 deliberately recommends the opposite build order: reach a working
consolidation-and-export path first, "a version that replaces the PowerQuery workflow end to end
and nothing more". That is a considered position and it supersedes the input's emphasis. But §6.3
already carries the reconciliation in its own last sentence — "The Recipe format should nonetheless
be designed for machine authorship from the first commit, because retrofitting that is expensive
and designing for it is nearly free" — so the input's claim is answered rather than dropped. No
action. Recorded here so a later reader does not re-raise it.

---

## Checked and adequately carried — no action

- **"Das Wissen wandert, die Daten bleiben"** → PRD §1, "The author's expertise travels; the data
  does not." Carried, arguably better.
- **Core use case, three monthly reports with differing column names** → UJ-1, UJ-4, FR-13.
- **Live preview after every step** → FR-19, including downstream propagation.
- **Prompt block = question + profile + current pipeline + format description, one action, nothing
  hidden** → FR-27, all four components plus the no-hidden-portion clause.
- **Probe Query, local execution, user decides what returns** → FR-29, FR-30.
- **Recipe contains no data, structurally** → FR-20 plus addendum §7 ("Datasets never enter the
  graph model"). The *structural* argument — tables live in a registry beside the graph, so there is
  nothing to forget to strip — is in the addendum, not the PRD; adequate.
- **Recipe measurements (1,309 B, byte-identical round trip, named rejections)** → addendum §7.
- **Self-naming HTML export: which Recipe, which files, which date** → FR-37.
- **`3.150` ambiguity example** → FR-9, using `1.234`. Same point, same treatment.
- **No build step required for *use*** → NFR-1, verbatim in effect.
- **Nothing fetched at runtime, opaque origin, CORS** → NFR-2 and addendum §2.
- **Data-residence qualification (shared `file://` bucket)** → NFR-8 and FR-25, in more detail than
  the input.
- **Scale target, no source cap, no artificial row brake** → NFR-3.
- **UI German, code and comments English** → NFR-6 and the Glossary's German-label column.
- **Filtering by column header** → FR-32.
- **Top-10 / Bottom-10, simple bar and line charts** → FR-35 tile kinds.
- **"Abgabefertig" Excel output** → FR-36 (German number and date conventions, real dates, leading
  zeros as text, umlauts and euro sign) plus Open Question 6. Mechanically complete.
- **Milestone acceptance criteria M1–M4** → covered by FR-1/FR-8 (load two CSVs, preview), FR-7/FR-8
  (nested JSON), SM-1 (core use case end to end), SM-3 (saved monthly workflow reruns).
- **"Komplexere Filter" out of scope** → implied by FR-15's fixed operator list and single all/any
  combination rule. Could be named in §6.2 for symmetry with the other cut items; not required.

## Not gaps — residual inconsistencies inside `idea.md` itself

These are input-hygiene items, not PRD omissions. The alignment pass recorded as closed under Open
Question 9 rewrote §§3, 4, 5, 6, 9 and 10 but left three statements in §1 untouched:

1. **§1 line 20 still lists PDF export as out of scope for the MVP** ("OoS für MVP: komplexere
   Charts, komplexere Filter, PDF-Export, Layouting-Engine für Dashboard") while FR-37 requires it.
   This is the same class of contradiction Open Question 9 claims to have resolved.
2. **§6 still says "Dashboards: erst nach stabilem MVP (siehe Roadmap)"** while FR-35 puts a tile
   Dashboard in the MVP — and §1 of the same document already contradicts §6 by putting tables and
   simple bar/line charts in the MVP.
3. **§1 reports the authorship measurement as "zwei fremde Assistenten … in vier Läufen"**, where
   Open Question 3 records five runs out of five and explicitly caveats that only one of the two
   models is a foreign vendor. The input both understates the count and overstates the
   independence.

None affects the PRD. Fixing them is a two-minute edit to `idea.md` if the document is to keep
claiming it was brought in line.
