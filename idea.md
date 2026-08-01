# querbeet – Projekt-Outline & Handover

Dieses Dokument beschreibt Ziel, Umfang und nächste Schritte des Projekts. Es dient als Grundlage für die Implementierung (Handover an Claude Code).

## 1. Vision & Ziel

querbeet ist ein browserbasiertes ETL-Tool für Nicht-BI-Profis. Ein Nutzer soll ohne Programmier- oder Datenbankkenntnisse aus mehreren Report-Dateien (typisch: 2–5 CSV-/Excel-Exporte aus verschiedenen Systemen) eine konsolidierte Tabelle erstellen können – durch Zusammenklicken einer kleinen Pipeline.

**Leitsatz:** Reports in, consolidated table out.

**Später:** Aus der konsolidierten Tabelle Dashboards erzeugen.
- Im MVP: Tabellen anzeigen (inkl Top 10/ Bottom10), einfach Bar- und LineChart für eine Tabelle (), Tabellen filtern anhand KOpfzeile
- OoS für MVP: komplexere Charts, komplexere Filter, PDF-Export, Layouting-Engine für Dashboard (nur basis-Engine im MVP)

## 2. Zielgruppe & Kern-Use-Case

- Sachbearbeiter, Controller, Projektleiter – Menschen, die Excel können, aber kein SQL.
- Typischer Fall: Drei Monatsreports aus unterschiedlichen Quellen mit teils unterschiedlichen Spaltennamen sollen zu einer Gesamttabelle zusammengeführt werden (Union und/oder Join über eine Schlüsselspalte), gefiltert und exportiert werden.

## 3. Technische Rahmenbedingungen (fix)

- **Single-HTML-Datei**: Die gesamte App lebt in einer `querbeet.html`. Kein Build-Schritt als Voraussetzung für die Nutzung. (Ein Build, der am Ende eine einzelne HTML-Datei ausgibt, ist erlaubt – z. B. Vite mit Single-File-Plugin.)
- **CDN-Libraries erlaubt**: JS-Frameworks/Libs dürfen per CDN geladen werden.
- **Kein Server, kein Backend, keine Auth**: Alle Verarbeitung clientseitig; Daten verlassen den Browser nicht.
- **Datenmengen**: Ausgelegt auf typische Reports, Richtwert bis ~100.000 Zeilen. Keine Big-Data-Ambitionen.
- **Moderne Browser**: Firefox (145+) / Edge (143+)/ Chrome (143+) / Safari (26.5, bei Problemen ist Safari aber optional zu vernachlässigen)

## 4. Vorgeschlagener Tech-Stack (zur Validierung durch Claude Code)

- **UI**: Vue 3 oder Alpine.js per CDN (leichtgewichtig, reaktiv, kein Build nötig). Alternativ Vanilla JS, wenn die Komplexität es zulässt.
- **CSV-Parsing**: PapaParse.
- **Excel (xlsx) lesen/schreiben**: SheetJS (xlsx).
- **Transformations-Engine**: AlaSQL (SQL-über-JS-Arrays, deckt Join/Union/Filter/Group By ab) – Alternative: eigene, kleine Transformationsfunktionen auf Array-Basis, falls AlaSQL zu schwergewichtig wirkt.
- **Styling**: schlankes CSS-Framework (z. B. Pico.css oder Tailwind via CDN) oder handgeschriebenes CSS.

Bitte noch andere Technologien prüfen, z.B. pandas als JS? export in pandas-formate?

Entscheidungsfreiheit für Claude Code, solange die Rahmenbedingungen aus Abschnitt 3 gelten.

## 5. Funktionsumfang MVP

### 5.1 Daten laden

- Mehrere Dateien per Drag-and-drop oder Dateidialog laden (CSV und JSON zuerst, XLSX als zweite Ausbaustufe).
- Automatische Erkennung von Trennzeichen und Header-Zeile bei CSV, mit manueller Korrekturmöglichkeit.
- KOrrektur von JSON-Syntaxtabweichungen (vor allem falls JSON aus einem LLM kommt, da gibt es ja gängige schwierigkeiten)
- Jede geladene Datei erscheint als benannte Quelle mit Datenvorschau (erste ~50 Zeilen) und erkannten Spalten.
- Vorschau für nested JSON (gerne ausf Basis von bestehenden libraries)

### 5.2 Pipeline zusammenklicken

Lineare Schrittliste (kein Node-Graph im MVP). Verfügbare Schritte:

1. **Union** – mehrere Quellen untereinanderhängen, mit Spalten-Mapping (Spalte A der Quelle 1 entspricht Spalte B der Quelle 2).
2. **Join** – zwei Quellen über eine oder mehrere Schlüsselspalten verbinden (Left Join als Default, Inner als Option).
3. **Filter** – Zeilen nach einfachen Bedingungen filtern (gleich, ungleich, enthält, größer/kleiner, leer/nicht leer).
4. **Spalten bearbeiten** – auswählen, umbenennen, Reihenfolge ändern.
5. **Berechnete Spalte** (nice-to-have im MVP) – einfache Formeln auf Zeilenbasis.

Nach jedem Schritt: Live-Vorschau des Zwischenergebnisses.

### 5.3 Export

- Ergebnis als CSV, JSON oder XLSX herunterladen. Parquet gerne auch, falls machbar

### 5.4 Pipeline speichern & laden

- Pipeline-Definition (Schritte + Einstellungen, ohne Daten) als JSON-Datei exportieren und wieder importieren, damit wiederkehrende Monats-Workflows reproduzierbar sind.

## 6. Nicht-Ziele (bewusst außen vor)

- Kein Server, keine Datenbank, keine Nutzerverwaltung.
- Keine Anbindung an APIs oder Live-Datenquellen.
- Keine Verarbeitung sehr großer Datenmengen.
- Kein vollwertiger Node-basierter Pipeline-Editor im MVP.
- Dashboards: erst nach stabilem MVP (siehe Roadmap).

## 7. UI-Skizze (Grobkonzept)

Dreiteiliges Layout:

1. **Links – Quellen**: Liste der geladenen Dateien, Button „Datei hinzufügen".
2. **Mitte – Pipeline**: vertikale Schrittliste, Schritte hinzufügen/entfernen/umsortieren, jeder Schritt mit kompaktem Konfigurationsbereich.
3. **Rechts/unten – Vorschau**: Tabellenansicht des Ergebnisses nach dem aktuell ausgewählten Schritt, plus Export-Buttons.

Sprache der UI: Deutsch (Zielgruppe), Code und Kommentare auf Englisch.

## 8. Nächste Schritte / Milestones

**M1 – Grundgerüst & Laden**
- Projektstruktur als Single-HTML anlegen, gewählte Libs einbinden.
- CSV-Upload mit Vorschau und Spaltenerkennung.
- Akzeptanz: Zwei CSV-Dateien laden und beide in der Vorschau ansehen können.
- JSON-Upload und Vorschau mit Felderkennung,
- Akzeptanz: 1 verschachteltes JSON kann hochgeladen und angezeigt werden.

**M2 – Kern-Transformationen**
- Union mit Spalten-Mapping, Join über Schlüsselspalte, Filter.
- Live-Vorschau nach jedem Schritt.
- Akzeptanz: Der Kern-Use-Case (3 Reports → 1 konsolidierte Tabelle) funktioniert durchgängig.

**M3 – Export & Spaltenbearbeitung**
- CSV-/XLSX-Export, Spalten auswählen/umbenennen/sortieren.
- Akzeptanz: Ergebnis lässt sich in Excel öffnen und ist „abgabefertig".

**M4 – Pipelines speichern**
- Pipeline als JSON exportieren/importieren.
- Akzeptanz: Ein gespeicherter Monats-Workflow läuft mit neuen Dateien gleicher Struktur erneut durch.

**M5 – Politur**
- XLSX als Eingabeformat, Fehlerbehandlung (kaputte CSVs, fehlende Schlüssel beim Join), leere Zustände, kleine UX-Verbesserungen.

**Später – Dashboards (v2)**
- Einfache Diagramme (Balken, Linie, Kennzahlen-Kacheln) auf Basis der konsolidierten Tabelle.

## 9. Offene Entscheidungen (bitte im Zuge von M1 klären)

- Framework-Wahl (Vue vs. Alpine vs. Vanilla) und Transformations-Engine (AlaSQL vs. eigene Funktionen).
- Umgang mit Datentypen (Zahlen-/Datumserkennung beim Import: automatisch, manuell korrigierbar?).
- Encoding-Handling bei CSV (UTF-8 vs. Windows-1252 – bei deutschen Excel-Exporten relevant!).
- Persistenz im Browser: bewusst verzichten (Datei-basiert via JSON) oder zusätzlich letzte Sitzung merken?

## 10. Definition of Done (MVP)

- Eine einzelne HTML-Datei, die offline im Browser läuft (nach einmaligem Laden der CDN-Ressourcen).
- Der Kern-Use-Case ist ohne Anleitung von einem Excel-affinen Nutzer durchführbar.
- README aktualisiert, Beispiel-CSVs im Repo zum Ausprobieren.
