# The independent runs — raw record

Primary source for the FR-28 spike's only real evidence about machine authorship. Each run: a fresh
session in an assistant with no access to this repository, given one rendered block and nothing else.
No follow-up, no correction, no hint. The prose is quoted verbatim, in the original German, because
the FR-27 answer protocol asks for at most three sentences on what was built and assumed — and what a
model chooses to flag there is evidence in its own right.

The Recipes are in `selftest/cases/i*.json` and run in `selftest/run-selftest.mjs`.
Analysis is in `findings.md`, section *The independent test*.

| Run | Assistant | Block | Verdict |
| --- | --- | --- | --- |
| i1 | Gemini | `prompt-block-example.txt` | accepted, round 1, both paths |
| i2 | Sonnet 5 | `prompt-block-example.txt` | accepted, round 1, both paths |
| i3 | Gemini | `prompt-block-no-annotations.txt` | accepted, round 1, both paths |
| i4 | Gemini | `prompt-block-aggregate.txt` | refused the task in prose, invented no kind |
| i5 | Gemini | `prompt-block-empty-pipeline.txt` | accepted, round 1, both paths — **nothing was copyable** |

Every accepted Recipe is also checked against named requirements — did it union all three months,
reconcile the March spelling, join on the right key, filter at the right threshold, place its Steps.
33 of 33 met. The requirement sets live beside the cases in `run-selftest.mjs`.

---

## i1 — Gemini, worked example

> Ich habe das bestehende Rezept um einen Left Join mit der Kundenliste und einen nachfolgenden Filter
> erweitert. Für den Join verbinde ich die zusammengeführten Bestellungen (u1) mit der Kundenliste (kd)
> über die Schlüssel KundenNr und Nr, um die Kundennamen anzuhängen. Anschließend filtert der neue
> Step f1 das Ergebnis, sodass nur noch Zeilen mit einem Betrag von mehr als 1000 Euro enthalten sind
> (gt 1000).

Three sentences, as asked. Describes what it built; declares no assumption.

## i2 — Sonnet 5, worked example

> Ich habe die bestehende Union unverändert gelassen, sie per Left-Join mit der Kundenliste über
> KundenNr/Nr verknüpft (mit Duplikat-Prüfung, falls eine Kundennummer mehrfach vorkommt) und
> anschließend auf Bestellungen mit Betrag > 1000 gefiltert. Angenommen habe ich, dass „über 1000
> Euro“ als „größer 1000“ gemeint ist (nicht „ab 1000“).

Declares the boundary assumption explicitly, and gives a reason for `duplicateAudit: true` — the only
config value any two runs disagree on.

## i3 — Gemini, worked example with all Column Annotations cleared

> Ich habe den zusammengefassten Bestellungen (u1) die Kundeninformationen über einen Left Join (j1)
> auf der Kundennummer angefügt und das Ergebnis anschließend mit einem Filter (f1) auf
> Bestellbeträge größer als 1000 Euro begrenzt. Dabei bin ich davon ausgegangen, dass alle
> Bestellungen erhalten bleiben sollen (Left Join) und der Schwellenwert von 1000 Euro exklusiv ist
> (gt).

Two assumptions declared, where i1 — same assistant, same task, annotations present — declared none.
The Recipe is identical to i1's.

## i4 — Gemini, a question the three Step kinds cannot answer

Question in the block: *„Ich will für das erste Quartal den Gesamtumsatz je Region sehen — eine Zeile
pro Region mit der Summe der Beträge, absteigend sortiert."*

> Ich habe das bestehende Rezept übernommen, das bereits die drei Monatsdateien zusammenführt und
> dabei den Spaltennamen Kunden-Nr aus dem März korrekt auf KundenNr vereinheitlicht. Da querbeet
> aktuell nur die drei Step-Arten union, join und filter unterstützt, können das Gruppieren nach
> Region, das Summieren der Beträge sowie das absteigende Sortieren leider nicht direkt über das
> Rezept durchgeführt werden – diese Schritte müsstest du anschließend in einem
> Tabellenkalkulationsprogramm (z. B. per Pivot-Tabelle) vornehmen.

**Pass.** It names all three missing operations, attributes the limit to the three implemented kinds
rather than to the question, invents no `kind`, and returns the unchanged Recipe. It also routes the
user out of the tool and into a spreadsheet — which is the product signal, not a defect in the block.

## i5 — Gemini, no annotations and no Pipeline

The sharpest probe. Four Sources with bare column names, an empty Pipeline, and the question. The join
key and the March spelling appear nowhere; there is nothing to copy.

> Hier ist das passende Rezept für deine Datenaufbereitung.
>
> Da im März die Spalte Kunden-Nr heißt (in Januar/Februar KundenNr), wird diese beim Zusammentragen
> per mappings auf KundenNr vereinheitlicht. Anschließend werden die Kundennamen über die Kundenliste
> angereichert und das Gesamtergebnis auf Beträge größer als 1000 Euro gefiltert.

**All seven requirements met.** It found the March spelling by comparing the three Profiles, named the
difference before being asked about it, and matched `KundenNr` against `Nr` across two files with no
annotation pointing at either. The graph is the same one every other run produced.

One difference, and it is the useful one: `"value": 1000` as a **number**, where all four earlier
authors wrote the string `"1000"`. See `findings.md`, *The one thing the authors disagree about*.
