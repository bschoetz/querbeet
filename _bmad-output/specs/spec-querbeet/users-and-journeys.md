# Users and Journeys — querbeet

Companion to `SPEC.md`. Three roles, their jobs, and the four journeys the capabilities are shaped around. Journey ids UJ-1..UJ-4 are stable and are referenced from `acceptance-criteria.md`.

**The evidence behind these journeys is not uniform, and the difference is load-bearing: UJ-1, UJ-3 and UJ-4 describe work the Author does today and were captured from him. UJ-2 is a hypothesis** — the Consumer it describes has not been interviewed. It is written out because the product is designed for it, and marked so nothing downstream mistakes it for evidence.

## Roles

querbeet serves three roles. The first two often turn out to be the same person, which is why the MVP gives them one interface; their jobs are nonetheless different, and the product is shaped by the handoff between them. The third never touches the tool at all.

**The Author** builds pipelines. Technically confident, comfortable with data, not necessarily a programmer — the person who today reaches for PowerQuery, a spreadsheet full of VLOOKUPs, or a short script. They own the correctness of a Recipe.

**The Consumer** receives a Recipe and runs it against their own data. They are competent in their domain and read tables fluently, but they do not build pipelines and do not want to. They are why the Recipe exists.

**The Boxchecker** never opens querbeet. They receive its exports as documentation — evidence that something was measured, on a stated date, from stated inputs. Compliance, audit, quality management. They shape one requirement rather than many: an exported artifact must be self-describing enough to stand alone in a file six months later, which is why CAP-37 requires it to name its Recipe and its date.

## Jobs to be done

**As Author:**

- Replace a PowerQuery workflow that works but is slow, opaque and tied to one machine.
- Reach a correct pipeline faster by discussing it with an LLM instead of experimenting by hand.
- Stop being the bottleneck: hand out a Recipe instead of doing someone else's analysis, and without ever receiving their data.
- Produce a defensible artifact — something that goes in the compliance file and a list somebody can act on.

**As Consumer:**

- Get an overview of my own operational reality that today does not exist, or exists as a manual spreadsheet I do not fully trust.
- Answer my own question without waiting for a specialist and without handing my data to one.
- Repeat the same analysis next month against fresh files, with no re-learning.

**As Boxchecker:**

- Receive something that documents a state, is dated, names where it came from, and needs no explanation from the person who produced it.

## Non-users (v1)

- Anyone needing a live connection to a database, an API, or any data source that is not a file the user chose.
- Teams wanting shared state — a server, accounts, permissions, or a Recipe library that several people write to.
- Users at big-data scale. See C-3: there is no cap on the number of files and no deliberate obstruction above the design target, but nothing beyond it is designed for, measured, or promised.

## UJ-1 — The Author builds the patch-compliance report

- **Persona and context:** Ben runs IT. Once a quarter he owes the compliance file a status, and the CISO a list of people to chase about missing updates. He does it in PowerQuery today.
- **Entry state:** Three exports on the desktop — patch state per device, device-to-user mapping, installed software per device. He opens `querbeet.html` by double-click. No login, no connection.
- **Path:** He drags all three files into the Sources pane; each appears named, with detected columns and its first rows. One CSV gets a doubtful delimiter warning, which he corrects. He switches `LastPatchDate` from text to date and sees the Preview confirm it. He enters the Editor — acknowledging that he is now working on the mechanism — and joins patch state to the user mapping on device ID, then joins that result to software on the same ID. After the second join the tool warns that the row count went from 4,200 to 61,000: duplicate keys, many software rows per device. He inserts an Aggregate Step ahead of it. He filters to patch state older than 30 days, then keeps six columns and renames them into German.
- **Climax:** The Preview shows 143 rows — device, user, department, days behind. That is exactly the list the CISO needs.
- **Resolution:** He exports the list as Excel and the Result as static HTML for the file, then saves the Recipe as `patch-compliance.json`. Next quarter is Recipe plus three fresh files and two minutes.
- **Edge case:** A device missing from the software export would vanish silently under an inner join. After every join the tool reports how many left rows found no match.

## UJ-2 — The Consumer measures utilisation `[ASSUMPTION — hypothesis, not captured]`

- **Persona and context:** Christian heads the consulting practice. He wants to know how utilised and how profitable his consultants are. That means relating HR data, project and lead data, time bookings and billing — four sources. He is not a BI professional. Today this happens by hand in Excel: incomplete, shallow, and by his own account probably gap- and error-ridden.
- **Entry state:** He has a Recipe from the Author and his four export files. He has never built a pipeline.
- **Path:** He opens `querbeet.html`, loads the Recipe, and drops in his four files. The Pre-flight Check reports per requirement whether it fits, is missing, or is doubtful — one column is named differently in his export and he maps it. He runs the Pipeline and lands on the Dashboard, not the Editor.
- **Climax:** A utilisation figure per consultant per month, and a Top-N of the least profitable engagements — numbers he could not previously assemble at all.
- **Resolution:** He exports the table to Excel for his own further work and the Dashboard as PDF for his management round.
- **Edge case:** A wrong period, a missing consultant, or double-counted hours. The Pipeline's row-count and unmatched-row reporting is what has to make that visible, because he has no independent way to tell a plausible wrong number from a right one.
- **What is unknown and must be validated:** where his four files actually come from and how often; how the Recipe reaches him; whether his primary pain is processing the data he has or acquiring data he lacks. This is the first open question in `SPEC.md`.

## UJ-3 — The Author works a problem out with an LLM instead of by trial and error

- **Persona and context:** The Author is building a pipeline over unfamiliar exports and does not yet know how the tables relate.
- **Entry state:** Sources loaded, no Pipeline yet.
- **Path:** He annotates a few columns in his own words. He asks querbeet for a prompt block, which contains his question, the Column Profile of every Source, and his annotations — no cell values. He pastes it into a chat assistant. It answers with a Probe Query rather than a Recipe: it wants to know how many time bookings have no matching project. He pastes that back; querbeet runs it locally and shows the result, along with exactly what would be sent back. He copies the number over. The assistant now proposes a Recipe, which he pastes into querbeet.
- **Climax:** The Recipe loads as real Steps he can inspect, and the Preview shows plausible output on the first run.
- **Resolution:** He adjusts two Steps by hand and keeps going. Nothing left the machine except structure, his own descriptions, and numbers he saw before he sent them.
- **Edge case:** The assistant returns a Recipe that references a column that does not exist. querbeet rejects it against the Input Contract and says which reference failed, so he can paste the error back.

## UJ-4 — The monthly run

- **Persona and context:** Either operating role, repeating a known analysis against fresh files.
- **Entry state:** A Recipe that worked last month, and this month's exports.
- **Path:** Open the tool, load the Recipe, drop in the files, read the Pre-flight Check, run.
- **Climax:** The Result matches last month's shape, and the differences are in the data rather than in the pipeline.
- **Resolution:** Export, done, under two minutes. No decisions were required.
- **Edge case:** The source system changed its export format between months. The Pre-flight Check is what turns that from a wrong number into a visible problem.
