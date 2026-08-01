# querbeet – Projekt-Outline & Handover

Dieses Dokument beschreibt Ziel, Umfang und nächste Schritte des Projekts. Es war das Handover an Claude Code und ist der Ausgangspunkt, aus dem alles Weitere gewachsen ist.

> **Stand 2026-08-01.** Verbindlich ist inzwischen das PRD unter `_bmad-output/planning-artifacts/prds/prd-querbeet-2026-08-01/prd.md`, die Technologieentscheidungen stehen im `addendum.md` daneben, und die Messungen dahinter in `_bmad-output/planning-artifacts/research/` und `.../spikes/`. Dieses Dokument wurde an den Stellen nachgezogen, an denen es dem PRD widersprochen hat — Abschnitte 3, 4, 5, 6, 9 und 10. Wo es hier und im PRD unterschiedlich steht, gilt das PRD.

## 1. Vision & Ziel

querbeet ist ein browserbasiertes ETL-Tool für Nicht-BI-Profis. Ein Nutzer soll ohne Programmier- oder Datenbankkenntnisse aus mehreren Report-Dateien (typisch: 2–5 CSV-/Excel-Exporte aus verschiedenen Systemen) eine konsolidierte Tabelle erstellen können – durch Zusammenklicken einer kleinen Pipeline.

**Leitsatz:** Reports in, consolidated table out.

**Was seit der ersten Fassung dazugekommen ist — die zwei Hebel, die querbeet von einem persönlichen Hilfsmittel zu etwas Weitergebbarem machen:**

1. **Das Rezept ist das Produkt.** Die Pipeline lässt sich als kleine JSON-Datei weitergeben. Wer ein Rezept hat, lässt es über die eigenen Daten laufen — ohne es zu verstehen, ohne etwas zu installieren und ohne die Daten an den zu schicken, der es geschrieben hat. Das Wissen wandert, die Daten bleiben.
2. **Ein Sprachmodell kann Rezepte schreiben.** querbeet gibt einem Assistenten ein *Column Profile* — Struktur und die eigenen Spaltennotizen, nie Werte — und bekommt ein Rezept oder eine Probe-Abfrage zurück. Die Abfrage läuft lokal, nur ihr Ergebnis geht zurück. Alles per Zwischenablage, das Werkzeug selbst macht keine Netzwerkanfrage. Gemessen: zwei fremde Assistenten haben in vier Läufen aus der Formatdokumentation allein gültige Rezepte geschrieben, keiner brauchte eine zweite Runde.

**Später:** Aus der konsolidierten Tabelle Dashboards erzeugen.
- Im MVP: Tabellen anzeigen (inkl Top 10/ Bottom10), einfach Bar- und LineChart für eine Tabelle (), Tabellen filtern anhand KOpfzeile
- OoS für MVP: komplexere Charts, komplexere Filter, PDF-Export, Layouting-Engine für Dashboard (nur basis-Engine im MVP)

## 2. Zielgruppe & Kern-Use-Case

- Sachbearbeiter, Controller, Projektleiter – Menschen, die Excel können, aber kein SQL.
- Typischer Fall: Drei Monatsreports aus unterschiedlichen Quellen mit teils unterschiedlichen Spaltennamen sollen zu einer Gesamttabelle zusammengeführt werden (Union und/oder Join über eine Schlüsselspalte), gefiltert und exportiert werden.

## 3. Technische Rahmenbedingungen (fix)

- **Single-HTML-Datei**: Die gesamte App lebt in einer `querbeet.html`. Kein Build-Schritt als Voraussetzung für die *Nutzung*. Für die *Entwicklung* ist der Build inzwischen Pflicht, nicht optional: Vite mit `vite-plugin-singlefile`, weil `hyparquet-writer` reines ESM ohne UMD-Bundle ist. Der Build wird darauf festgenagelt, dass `dist/` genau eine Datei enthält — Build-Erfolg heißt auf diesem Pfad nicht, dass das Artefakt läuft.
- **~~CDN-Libraries erlaubt~~ → Zur Laufzeit wird nichts geladen.** Diese Annahme aus der ersten Fassung ist widerlegt: eine `file://`-Seite hat einen *opaque origin*, jeder Abruf scheitert an CORS. Kein CDN, keine Nachbar-Konfigurationsdatei, kein Lazy-Chunk, keine externe Schriftart. Alle Bibliotheken werden in die eine Datei einkompiliert. Daten kommen ausschließlich über Dateiauswahl oder Drag-and-drop herein.
- **Kein Server, kein Backend, keine Auth**: Alle Verarbeitung clientseitig, und querbeet stellt selbst keine einzige Netzwerkanfrage.

  **Präzisierung zu „Daten verlassen den Browser nicht" (2026-08-01, aus R9 gemessen):** Zellwerte verlassen den Browser nur durch einen Export, den der Nutzer ausgelöst hat, oder durch eine LLM-Freigabe, die er vorher vollständig gesehen und bestätigt hat. Einen anderen Weg hinaus gibt es nicht. Was *nicht* gilt, ist Abschottung gegenüber anderen lokalen Seiten: was unter `file://` im Browser gespeichert wird, liegt in einem geteilten Speicher-Bucket, den jede andere lokal geöffnete HTML-Seite lesen kann — in beiden Engines nachgemessen. Vom Rechner geht nichts weg; die Oberfläche darf aber nicht mehr behaupten, als das.
- **Datenmengen**: Richtwert ~100.000 Zeilen je Quelle und in der Größenordnung einer halben Million Zeilen über alle Quellen zusammen. Keine Obergrenze für die Anzahl der Quellen, keine künstliche Zeilenbremse; oberhalb des Zielwerts wird nichts versprochen und nichts absichtlich blockiert.
- **Moderne Browser**: Chromium-basiert (Edge 143+ / Chrome 143+) ist **Leitbrowser** – Projektentscheidung 2026-08-01, siehe unten. Firefox (145+) bleibt Ziel, ist aber nachrangig; Safari (26.5) optional zu vernachlässigen.

  **Projektentscheidung Leitbrowser (2026-08-01).** Chromium-basierte Browser sind ab sofort der
  Referenzbrowser für Entwicklung und Performance-Budgets. Jeder Kollege hat Edge auf dem Rechner,
  also steht allen ein Chromium-Browser zur Verfügung. Firefox-Parität wird im Rahmen der ersten
  MVP-Builds *gemessen* statt vorab angenommen; liefert Firefox dort nicht ab, wird er fallen
  gelassen, statt Aufwand in Sonderbehandlung zu stecken.

  Anlass war R4/D2, aber das Messbild ist differenzierter als „Firefox ist langsamer" – es ist
  **arbeitsartabhängig** (Details in `_bmad-output/planning-artifacts/research/technical-performance-and-table-rendering-2026-08-01/research.md`):
  - **JS-lastige Arbeit: Firefox deutlich langsamer.** Arquero-Pipeline 446 ms vs. 263 ms; volle
    Zeilen-Materialisierung (`objects()` über 100k) 97 ms vs. 12,5 ms – Faktor 8.
  - **DOM-Rendering: praktisch gleichauf.** 50-Zeilen-Fenster-Swap 5 ms (Firefox) vs. 4,1 ms
    (Chromium), und Firefox war dabei *gleichmäßiger* (Maximum 10 ms vs. 98 ms).
  - **Ein echter Verhaltensunterschied, keine Geschwindigkeitsfrage:** oberhalb von ~16–20 Mio. px
    Elementhöhe kollabiert Firefox die Box auf Höhe 0 (Liste verschwindet lautlos), während
    Chromium sauber bei 33.554.428 px klemmt. Bei 100k Zeilen × 28 px (2,8 Mio. px) trifft das
    keinen von beiden.

  Was im MVP zu prüfen ist, ist also **nicht** „ist Firefox langsam", sondern: reicht Firefox auf
  den JS-lastigen Pfaden (Pipeline-Lauf, Export, Zwischenablage) noch für flüssige Bedienung.

## 4. Tech-Stack — entschieden

Die Vorschläge dieser Fassung (Alpine, SheetJS, AlaSQL, CDN) sind durch sechs Forschungsläufe und zwei Spikes ersetzt. Vollständig mit Begründung und Messwerten im `addendum.md` neben dem PRD; hier nur das Ergebnis:

- **UI**: Vue 3.5.40, ausgeliefert über Vite + `vite-plugin-singlefile` als eine HTML-Datei.
- **Transformations-Engine**: Arquero 8.0.3, gepinnt und vendored. *Nicht* AlaSQL.
- **Graph-Editor**: Vue Flow 1.48.2 — das Graphmodell selbst bleibt bibliotheksfrei, damit der Ausstieg offen ist.
- **CSV**: PapaParse 5.5.4, `dynamicTyping` dauerhaft aus — es zerstört deutsche Zahlen.
- **Encoding**: keine Bibliothek. BOM-Prüfung → strikter UTF-8-Test → Windows-1252-Fallback → manuelle Übersteuerung.
- **XLSX**: `write-excel-file` 4.1.1 und `read-excel-file` 9.3.5 hinter einem dünnen Adapter. *Nicht* SheetJS: 334 KB gzipped, Zellformatierung hinter einer Paywall, seit zwei Jahren kein Release.
- **Parquet**: `hyparquet-writer` 0.16.3 zum Schreiben, `hyparquet` 1.27.1 zum Lesen. Round-Trip gegen pyarrow, DuckDB und Polars geprüft.
- **JSON**: `jsonrepair` 3.15.0, aber erst nachdem `JSON.parse` gescheitert ist; Vorschau mit `json-formatter-js`; Verflachen von verschachteltem JSON in eigenem Code, weil drei gepflegte Bibliotheken drei verschiedene Array-Semantiken gewählt haben.
- **Tabellendarstellung**: handgerollte Zeilenfensterung mit fester Zeilenhöhe, ~50 Zeilen im Fenster.

Offen geblieben ist die Frage nach pandas-artigen Formaten insofern, als Parquet jetzt gelesen *und* geschrieben wird — damit ist der Austausch mit der Python-Welt abgedeckt.

## 5. Funktionsumfang MVP

### 5.1 Daten laden

- Mehrere Dateien per Drag-and-drop oder Dateidialog laden (CSV und JSON zuerst, XLSX als zweite Ausbaustufe).
- Automatische Erkennung von Trennzeichen und Header-Zeile bei CSV, mit manueller Korrekturmöglichkeit.
- KOrrektur von JSON-Syntaxtabweichungen (vor allem falls JSON aus einem LLM kommt, da gibt es ja gängige schwierigkeiten)
- Jede geladene Datei erscheint als benannte Quelle mit Datenvorschau (erste ~50 Zeilen) und erkannten Spalten.
- Vorschau für nested JSON (gerne ausf Basis von bestehenden libraries)

### 5.2 Pipeline zusammenklicken

**Geändert 2026-08-01: Der MVP hat einen Graph-Editor, keine lineare Schrittliste.** Der Grund ist der Kern-Use-Case selbst — drei Quellen zusammenführen und dann anreichern ist keine Kette, sondern verzweigt. Eine lineare Liste hätte das nur mit unsichtbaren Verweisen abbilden können. Die Konsequenzen sind nicht klein und stehen im PRD (§4.2, offene Frage 2 und 4); ein linearer Verlauf bleibt der triviale Fall, in dem jeder Schritt genau einen Eingang hat.

Verfügbare Schritt-Arten:

1. **Union** – mehrere Quellen untereinanderhängen, mit Spalten-Mapping (Spalte A der Quelle 1 entspricht Spalte B der Quelle 2). Zwei oder mehr Eingänge.
2. **Join** – zwei Quellen über eine oder mehrere Schlüsselspalten verbinden (Left Join als Default, Inner als Option). Genau zwei Eingänge, und nach jedem Join wird gemeldet, wie viele linke Zeilen keinen Treffer hatten und ob sich Zeilen durch doppelte Schlüssel vervielfacht haben.
3. **Filter** – Zeilen nach einfachen Bedingungen filtern.
4. **Spalten bearbeiten** – auswählen, umbenennen, Reihenfolge ändern.
5. **Berechnete Spalte** – einfache Formeln auf Zeilenbasis.
6. **Aggregate** – gruppieren und zusammenfassen. **Neu im MVP** (Projektentscheidung, gegen die ursprüngliche Roadmap), weil der Join ohne vorgeschaltete Aggregation stillschweigend Zeilen vervielfacht.

Genau ein Schritt ist der **Ergebnis-Step**. Nach jedem Schritt: Live-Vorschau des Zwischenergebnisses.

### 5.3 Export

- Ergebnis als CSV, JSON, XLSX oder Parquet herunterladen. **Parquet ist machbar und drin** — `hyparquet-writer` schreibt, `hyparquet` liest, und der Rundlauf ist gegen pyarrow, DuckDB und Polars geprüft. Damit ist auch der Austausch mit der Python-Welt abgedeckt.
- Zusätzlich: das Ergebnis als eigenständiges HTML-Dokument, das ohne querbeet lesbar ist und sich selbst benennt — welches Rezept, welche Dateien, welches Datum.

### 5.4 Das Rezept — speichern, laden, weitergeben

Aus „Pipeline-Definition exportieren" ist der Kern des Produkts geworden. Das Rezept ist eine kleine JSON-Datei im Format `querbeet/recipe@1`: Schritte, ihre Einstellungen, wie sie verbunden sind, und der *Input Contract* — welche Dateien mit welchen Spalten erwartet werden.

- **Ein Rezept enthält keine Daten**, und zwar strukturell: die Tabellen leben gar nicht erst im Graphmodell, sondern in einer eigenen Registry neben ihm. Es gibt nichts, was beim Speichern vergessen werden könnte zu entfernen.
- **Weitergebbar.** Wer ein Rezept bekommt, lässt es über eigene Dateien laufen. Passt die Struktur nicht, sagt eine Vorabprüfung, welche Spalte fehlt, statt an einer beliebigen Stelle zu scheitern.
- **Maschinenlesbar und maschinenschreibbar.** Gemessen: ein Rezept mit sechs Schritten wiegt 1.309 B, ein Rundlauf Speichern → Leeren → Laden ist byte-identisch, und ungültige Rezepte werden mit einer benannten Begründung abgelehnt, die man dem Modell zurückgeben kann, das sie geschrieben hat.

### 5.5 LLM-Unterstützung

- **Column Profile**: eine strukturelle Beschreibung der geladenen Quellen — Zeilenzahl, je Spalte Typ, Locale, Anzahl verschiedener Werte, Leer-Anteil und die eigene Spaltennotiz. Keine Zellwerte, außer der Nutzer gibt einzelne Spalten ausdrücklich frei.
- **Prompt-Block**: Frage + Profil + aktuelle Pipeline + Formatbeschreibung, in einer Aktion kopierbar. Nichts daran ist verborgen; was rausgeht, steht sichtbar drin.
- **Rückweg**: Die Antwort wird vor dem Anwenden geprüft. Ein Rezept mit Kreis, unbekannter Schritt-Art, falscher Eingangszahl oder einer Spalte, die es nicht gibt, wird ganz abgelehnt — nie halb angewendet.
- **Probe-Abfrage**: Braucht das Modell erst Werte, formuliert es eine Abfrage in derselben Schritt-Sprache. Sie läuft lokal, das Ergebnis wird dem Nutzer gezeigt, und erst er entscheidet, ob es zurückgeht.

## 6. Nicht-Ziele (bewusst außen vor)

- Kein Server, keine Datenbank, keine Nutzerverwaltung.
- Keine Anbindung an APIs oder Live-Datenquellen.
- Keine Verarbeitung sehr großer Datenmengen.
- ~~Kein vollwertiger Node-basierter Pipeline-Editor im MVP.~~ **Zurückgenommen 2026-08-01** — siehe 5.2. Der Editor ist im MVP.
- Dashboards: erst nach stabilem MVP (siehe Roadmap).

## 7. UI-Skizze (Grobkonzept)

Dreiteiliges Layout:

1. **Links – Quellen**: Liste der geladenen Dateien, Button „Datei hinzufügen".
2. **Mitte – Pipeline**: ~~vertikale Schrittliste~~ **eine Fläche mit dem Schritt-Graphen** (geändert 2026-08-01, siehe 5.2). Schritte hinzufügen, entfernen und verbinden; jeder Schritt eine Kachel mit kompaktem Konfigurationsbereich, deren Höhe mit ihrem Inhalt wächst. Ein Schritt ist als Ergebnis-Step markiert. Verbindungen, die einen Kreis schließen würden, werden mit Begründung abgelehnt statt still hergestellt.
3. **Rechts/unten – Vorschau**: Tabellenansicht des Ergebnisses nach dem aktuell ausgewählten Schritt, plus Export-Buttons.

Sprache der UI: Deutsch (Zielgruppe), Code und Kommentare auf Englisch.

## 8. Nächste Schritte / Milestones

> **Diese Reihenfolge stammt aus der Zeit vor dem Graph-Editor und vor dem Rezept als Produktkern.** Sie ist nicht falsch, aber unvollständig: der Editor kommt darin nicht vor, und „Pipeline speichern" steht als M4 hinten, obwohl das Rezept inzwischen die Kernhypothese trägt. Verbindlich wird der Epic-Zuschnitt aus dem PRD; bis der existiert, bleibt das hier als grobe Richtung stehen.

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

## 9. Offene Entscheidungen — alle vier beantwortet

- ~~Framework-Wahl und Transformations-Engine.~~ **Vue 3 und Arquero**, siehe Abschnitt 4.
- ~~Umgang mit Datentypen.~~ **Automatisch erkannt, aber bestätigungspflichtig.** Der deutsche Zahlen- und Datumsparser ist tragende Architektur, kein Detail: zwei Bibliotheken wurden dabei gemessen, wie sie deutsche Zahlen still zerstören, beide über dieselbe Ursache — ein Muster, das den Punkt als Dezimaltrennzeichen liest. Wo ein Wert echt mehrdeutig ist (`3.150` — dreitausend oder drei Komma eins fünf?), muss der Nutzer entscheiden. Wie genau, ist der noch laufende Forschungslauf R5.
- ~~Encoding-Handling bei CSV.~~ **BOM → strikter UTF-8-Test → Windows-1252**, jederzeit übersteuerbar. Keine Bibliothek nötig.
- ~~Persistenz im Browser.~~ **Beides: dateibasiert *und* letzte Sitzung merken.** IndexedDB funktioniert unter `file://` und übersteht einen Browser-Neustart — in beiden Engines gemessen. Mit den Einschränkungen aus Abschnitt 3: geteilter Bucket, nicht dauerhaft erzwingbar.

Was jetzt noch offen ist, steht im PRD unter „Open Questions" — allen voran, dass der Consumer, auf dem die halbe Produktidee steht, noch nicht befragt wurde.

## 10. Definition of Done (MVP)

- Eine einzelne HTML-Datei, die offline im Browser läuft — ohne jede Netzwerkanfrage, auch beim ersten Öffnen.
- Der Kern-Use-Case ist ohne Anleitung von einem Excel-affinen Nutzer durchführbar.
- Ein Rezept, das eine zweite Person über ihre eigenen Dateien laufen lässt, ohne diese Dateien herzugeben.
- README aktualisiert, Beispieldateien im Repo zum Ausprobieren.
