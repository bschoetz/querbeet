# Input reconciliation: `README.md` against the PRD

**Input document:** `/home/n_to/Github/querbeet/README.md` (58 lines, current as of commit `1150e15`)
**Targets:** `prd.md`, `addendum.md` (both in this directory)
**Date:** 2026-08-01

The README is the only public-facing document in the repository, so a divergence is a defect in
whichever direction it runs: material the PRD dropped is positioning nobody downstream can
reconstruct, and a README claim the research has since falsified is a promise made to strangers.
Both directions are reported below, contradictions first, because those are the ones that cost
something.

---

## 0. Verification of the earlier alignment pass

Open Question 9 records that `README.md` was brought in line with the PRD on 2026-08-01
(commit `1150e15`). Four items were named. Three landed; one did not.

| Item | Landed? | Evidence |
| --- | --- | --- |
| Node-graph editor replaces the linear step list | **Yes** | README l. 18: *"in a small visual graph"*; roadmap l. 46: *"Pipeline editor: union, join, filter, column edit, computed column, aggregate"* |
| Group-by / aggregate is in the MVP, not after it | **Yes** | README l. 18 and l. 46 both list `aggregate` inside the MVP pipeline editor, no longer as a later roadmap bullet |
| Removal of the CDN claim | **Yes** | README l. 27: *"no CDN – every library is compiled into the one file"*; the old line *"External JS libraries are loaded via CDN"* is gone |
| PDF export is in the MVP | **No — see finding B-1** | PDF appears nowhere in `README.md`. The only enumeration of outputs is l. 19, *"the same four out"* |

Per the reconciliation brief, only the failed item is carried forward as a finding.

---

## (b) README claims the PRD contradicts or research has falsified

### B-1. The export enumeration excludes the view document, which is MVP scope

> **"Multiple input formats** – CSV, JSON, Excel and Parquet in; the same four out."
> — README l. 19

Contradicted by:

- **PRD §6.1**, MVP in-scope: *"Export as CSV, JSON, XLSX and Parquet, plus a static HTML and PDF view document (FR-36, FR-37)."*
- **PRD FR-37**, *Export a view document*, an MVP requirement with measured consequences attached — vector charts with selectable axis labels, the run status reproduced on paper, the document naming its Recipe and date.
- **PRD §2**, the Boxchecker role, which exists *only* as a consumer of that document.
- **PRD UJ-1 resolution**: *"He exports the list as Excel and the Result as static HTML for the file"*; **UJ-2 resolution**: *"the Dashboard as PDF for his management round."*

"The same four out" is not a soft omission — it is a closed enumeration that positively excludes
two MVP outputs. It also, separately, undercounts inputs: **FR-1** reads *"CSV, JSON, NDJSON, XLSX
and Parquet"*, and NDJSON is a distinct shape the PRD calls out twice (FR-4, FR-8).

**Who changes: the README.** This is the item the earlier alignment pass was meant to fix and
missed. Both the Features bullet and roadmap l. 47 (*"Result view, export, and a simple dashboard"*)
need to name the static HTML and PDF document, because for the Boxchecker audience that document
*is* the product's output.

### B-2. "Technical research are done" is overstated by two open technology questions

> "🚧 Early stage. **Planning and technical research are done** and live under
> `_bmad-output/planning-artifacts/`; the product contract is the PRD there."
> — README l. 33

Contradicted by:

- **`addendum.md` §1, currency note**: *"**R8 (view document export) has not run**, so nothing here
  covers how the HTML and PDF documents of FR-37 are produced; and **R9 is answered only at its
  gate**, so the Package container of FR-24 has no row either."*
- **PRD §0**: *"Two questions are still open at the time of writing — how the view document of FR-37
  is produced, and what container FR-24's Package uses."*
- **PRD §8** carries five further open questions (1, 5, 6, 8, 10) plus the recorded outstanding work
  on the FR-28 correction loop.

**Who changes: the README.** The sentence should read that planning is done and technical research
is largely done, with two technology questions open. The rest of the sentence — *"the product
contract is the PRD there"* — is accurate and worth keeping verbatim.

### B-3. The LLM disclosure list omits two things that actually leave the machine

> "querbeet produces a copy-ready prompt block containing your question and a *structural* profile of
> your files: **column names, types, distinct counts, null shares**. No cell values, unless you
> release specific ones on purpose."
> — README l. 21

Incomplete against:

- **FR-26**: the profile contains *"per Source: name, row count, and per column the name, confirmed
  type and locale, distinct-value count, null share, **and Column Annotation**."*
- **Glossary, Column Annotation**: *"A free-text description the user attaches to a column …
  Annotations are part of the Recipe and **are sent to the LLM**."*
- **FR-27**: the block additionally includes *"the Recipe format specification and the Probe Query
  format specification"* and *"describes the Pipeline as it currently stands."*

Column Annotations are user-authored prose about their own data — the single most likely place for a
user to write something sensitive without noticing. A README that enumerates what leaves, in a
section whose whole rhetorical work is precision about disclosure, must not stop one item short.
Source and column *names* are also disclosed and the README says so only obliquely via "column
names"; Source names are not covered at all.

**Who changes: the README.** Add the Column Annotations and the Pipeline description to the
enumeration. FR-27's *"Everything that would leave the machine is visible in the block. There is no
hidden portion"* is the guarantee the README should be echoing, and it is stronger than the list.

### B-4. Absolute network claims that the PRD schedules to break

> "The exchange is plain copy-paste; **querbeet itself never talks to anyone**." — README l. 21
> "**querbeet makes no network requests.** No server, no account, no telemetry, and no CDN" — README l. 27

Accurate today, and deliberately so — **NFR-2** makes it *"unconditional in the MVP and verifiable
from the built artifact"*, and `addendum.md` §6 (*LLM channel*) records that removing the API path
is precisely what made it unconditional. But:

- **PRD §6.2**: *"An optional stored API key that automates the same exchange is **the first item in
  the post-MVP backlog**."*

The README states this as a property of the tool, not of the current version. The first post-MVP
release falsifies a claim that is doing heavy positioning work — PRD §1: *"a tool that provably
cannot exfiltrate data needs no approval process to try."*

**Who changes: the README, but not yet.** Nothing is wrong now. Flagged so that the claim is scoped
("makes no network request in any configuration it ships with today") rather than silently becoming
false. The PRD needs no change; its own wording already carries the qualifier.

### B-5. Browser support promises more than NFR-4 makes

> "Open the file in **a modern browser**. Chromium-based browsers – Chrome and Edge – are the
> reference; **Firefox is a target but secondary**."
> — README l. 38

The ranking is right and matches **NFR-4**. Three things do not:

- **Version floors are absent.** NFR-4: *"Edge 143+ and Chrome 143+ … Firefox 145+ … Safari is
  optional."* "A modern browser" is broader than the PRD supports.
- **Firefox's conditionality is dropped.** NFR-4: Firefox *"is measured during the first builds
  rather than assumed, and **if it does not carry the JavaScript-heavy paths it is dropped** rather
  than specially accommodated."* "A target but secondary" reads as a commitment; the PRD holds it as
  a hypothesis under test.
- **Desktop-only is never stated.** **NFR-5**: *"Desktop only, designed for Full HD. Mobile and
  tablet layouts are not supported and not attempted."* A reader whose "modern browser" is a phone
  is told nothing.

**Who changes: the README.** One sentence covers all three.

### B-6. The interface is German and the README does not say so

**NFR-6**: *"The interface is German. Code, comments, and project documents are English."* The
Glossary carries a whole German-label column for this reason.

The README is written in English, and mentions German exactly once — as a joke about the name
(l. 7). A reader who downloads `querbeet.html` on the strength of this page has not been told the UI
will not be in the language the page was written in.

**Who changes: the README.** This is the single largest expectation mismatch on the page, measured
by how surprised a reader will be at first launch.

### B-7. "Excel" is unqualified; only `.xlsx` is read

> "CSV, JSON, **Excel** and Parquet in" — README l. 19, and identically in roadmap l. 45.

**PRD §6.2**, out of scope for MVP: *"Reading legacy Excel formats — `.xls`, `.xlsb`, `.ods`. Only
`.xlsx` is read."*

**Who changes: the README.** "Excel (`.xlsx`)" costs seven characters and removes a support request.

### B-8. The persistence story omits eviction and the shared-session consequence

> "One honest qualification: **whatever querbeet remembers between sessions** lives in the browser's
> storage for `file://` pages, and that storage is **shared across all local HTML files you open**
> rather than isolated per file. Nothing leaves your machine – but another local page you open could
> read it. There is a one-action delete for exactly this reason."
> — README l. 29

The shared-bucket qualification landed correctly and matches **NFR-8** and **FR-25**. Two measured
consequences from R9 did not come across, and one of them is a near-certainty for this README's own
audience:

- **FR-25, additional consequences**: *"storage cannot be made persistent from `file://` in either
  engine, so it is **best-effort by construction**"* — the browser can remove it without warning.
  "Whatever querbeet remembers between sessions" implies a durability the platform does not offer.
- **FR-25, first user-visible consequence**: *"**Two copies of `querbeet.html` on one machine share
  one stored session.** Opening the second copy shows the first copy's Recipe and data. **Copying the
  file is the expected way to distribute this tool, so this will happen.**"* The README's Getting
  Started section (l. 37) instructs the reader to do exactly the thing that triggers this.

**Who changes: the README.** Two clauses. The section is otherwise the strongest passage on the page
and its voice — "One honest qualification" — is worth preserving intact.

### B-9. The Package is absent, and its absence sits under the wrong heading

**FR-24** puts the Package in MVP scope: *"a compressed container bundling a Recipe together with
**the raw data of its Sources**."* The Glossary makes it a first-class named artifact, *"Distinct
from a Recipe, not a variant of one."*

The README never mentions it. That is a scope omission anywhere on the page; under the heading
**"Where the data goes"** — which answers *"Nowhere, unless you send it"* — it is a hole in exactly
the enumeration that section exists to close. Nothing is false: a Package is a user-triggered export
and therefore falls under the README's own "unless you send it" clause. But the document names every
other way data can move and stays silent about the one artifact designed to move it.

**Who changes: the README.** One Features bullet or one roadmap item, ideally phrased so the
Recipe/Package distinction is evident from the names, which is why FR-24 required two names in the
first place.

### B-10. Roadmap gaps (low severity)

The five roadmap bullets do not cover **FR-4 – FR-7** (JSON malformed-detection, repair, repair
disclosure, flattening with an explicit array strategy) or **FR-25** (session persistence with an
easy delete), all of which are MVP scope per §6.1. Roadmap l. 45 says only *"with encoding detection
and a type-confirmation step"*.

**Who changes: nobody, optionally the README.** The roadmap is deliberately coarse and reads as a
summary rather than an inventory. Noted for completeness; JSON repair is the one that carries enough
user-visible weight to be worth a clause.

---

## (a) README material not carried into the PRD or addendum

The PRD is a functional-requirement structure and it drops what such a structure always drops. Four
of these are worth capturing, because nothing downstream — UX copy, a landing page, the German UI's
own tone — has any other source for them.

### A-1. The tagline and the category word

> "**Visual ETL in a single HTML file. Reports in, consolidated table out.**" — README l. 3
> "querbeet lets non-BI users build small ETL pipelines by point and click" — README l. 5

The word **ETL** appears nowhere in `prd.md` or `addendum.md`. Neither does any one-line positioning
statement. PRD §1 opens with *"querbeet turns a recurring data-consolidation chore into a file you
can hand to someone else"* — a good sentence about the *differentiator*, but it does not tell a
first-time reader what category of thing this is. The README's parallel construction ("Reports in,
consolidated table out") is also the compressed form of §1's own longer sentence and reads better
than it.

**Who changes: the PRD.** A one-line positioning statement belongs at the top of §1, quoted from the
README so the two cannot drift.

### A-2. The name

> "The name is a German pun: *querbeet* means "all over the place / criss-cross", with *query*
> hiding inside."
> — README l. 7

The PRD's only note on the name is under the title: *"Working title — confirmed, it is the
repository name and the product name."* The meaning is nowhere. This matters more than a naming
anecdote usually would, because **NFR-6** puts the UI in German and the Glossary already maintains a
German label column — the product's voice is German and its name is a German joke, and the document
that governs the UI's vocabulary does not know that.

**Who changes: the PRD.** One line under the title note.

### A-3. The negative positioning: what querbeet is instead of

> "Consolidating a few report files **shouldn't require a BI professional, a database, or an ETL
> suite**. querbeet aims to cover **the everyday case: three exports from different systems in, one
> consistent table out**."
> — README l. 11

Partially carried. PRD §2 describes the Author as *"the person who today reaches for PowerQuery, a
spreadsheet full of VLOOKUPs, or a short script"*, and §5 has a careful paragraph on the self-service
BI boundary. But the README's framing is doing something the PRD's does not: it names the three
things a user would otherwise have to acquire (a person, a database, a suite), and it states the
target scale in the user's own units — *three files* — where **NFR-3** states it in rows (100,000 per
Source, ~500,000 total). Both framings are useful and they are not substitutes.

**Who changes: the PRD, lightly.** The "everyday case: three exports in, one table out" phrasing is
worth one sentence in §1 next to NFR-3's row figures, because it is the sentence a person actually
recognises themselves in.

### A-4. The tool family

> "*Part of a small family of tools: [korpus](#) (ontology tool) and [dokufix](#) (Markdown
> reader/editor).*"
> — README l. 57

Nowhere in the PRD. It is context about the author's wider project set, not a product requirement,
and there is no evidence it constrains anything in querbeet.

**Who changes: nobody.** Recorded so a later reader does not mistake it for an unnoticed gap. If a
shared design language or a shared file convention across the three ever becomes real, it acquires a
home in the architecture document rather than here.

### A-5. Licensing has no owner in the PRD

> "## License
> TBD"
> — README l. 51–53

The PRD does not mention licensing at all. `addendum.md` §1 tracks the licences of the dependencies
carefully — Apache-2.0 for ECharts, MIT for Vue Flow *"with no paid tier and no runtime key, verified
in the shipped LICENSE"*, BSD-3-Clause for Arquero — so the constraint set on the eventual choice is
already known and recorded, but the choice itself is unowned and undated.

**Who changes: the PRD.** Either an Open Question in §8 with an owner, or an explicit statement that
the licence is deliberately deferred. "TBD" in a public README with no corresponding entry in the
contract is the state where a decision gets made by accident.

---

## Summary

| # | Finding | Direction | Who changes | Severity |
| --- | --- | --- | --- | --- |
| B-1 | "The same four out" excludes the MVP's HTML/PDF view document; inputs omit NDJSON | Contradiction | README | **High** |
| B-2 | "Technical research are done" — R8 unrun, FR-24 container open | Falsified | README | **High** |
| B-3 | LLM disclosure list omits Column Annotations and the Pipeline description | Incomplete | README | **High** |
| B-6 | German UI (NFR-6) never stated on an English page | Omission | README | **High** |
| B-8 | Persistence: eviction and the two-copies-share-a-session consequence missing | Incomplete | README | Medium |
| B-5 | Browser support broader than NFR-4; desktop-only (NFR-5) absent | Overpromise | README | Medium |
| B-9 | The Package (FR-24) absent, including from "Where the data goes" | Omission | README | Medium |
| B-7 | "Excel" unqualified; only `.xlsx` is read | Overpromise | README | Low |
| B-4 | "Never talks to anyone" — unconditional today, first post-MVP item breaks it | Scheduled | README, later | Low |
| B-10 | Roadmap omits JSON repair/flattening and session persistence | Omission | README (optional) | Low |
| A-1 | Tagline, and the category word "ETL", carried nowhere | Dropped | PRD | Medium |
| A-2 | The name's meaning carried nowhere | Dropped | PRD | Medium |
| A-3 | "Not a BI professional, a database, or an ETL suite"; scale in files not rows | Partial | PRD | Low |
| A-5 | Licensing unowned in the PRD | Gap | PRD | Low |
| A-4 | Tool family (korpus, dokufix) | Dropped | Nobody | Informational |

Ten of fifteen findings are the README's to fix, which is the expected shape: the PRD is downstream
of six research runs the README has not absorbed. The four PRD-side items are all voice and
positioning — the material a functional-requirement structure has no slot for, and which will
otherwise be reinvented, differently, by whoever writes the first UI string.

The three data-residence and disclosure findings (B-3, B-8, B-9) should be fixed together and in one
pass. That section of the README is its best writing and its most load-bearing claim, and each of the
three is a place where the enumeration stops one item before it is complete.
