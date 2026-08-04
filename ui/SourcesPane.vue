<script>
// The one thing this component exports besides itself: the completeness
// invariant over the reading labels below. It lives in a plain `<script>` block
// because `<script setup>` compiles into a `setup()` body and can export
// nothing, and an invariant nothing can import is an invariant no test can
// observe — which is the state `typeLabelGaps` exists to keep out of a release,
// one level up.

import { TYPES } from '@core/types/catalog.js'
import { candidatesFor } from '@core/types/typing.js'

/**
 * The German word for a reading that is not spelled in field letters.
 *
 * `patternLabel` below is a *string transform*: it turns `dd` into `TT` and `yy`
 * into `JJ`, which works for exactly as long as a pattern is its own spelling. A
 * candidate that is **named** rather than spelled — `ISO 8601`, and story 4b's
 * `month name`, which is one candidate over three orderings and therefore cannot
 * be spelled as one — has no field letters to transform, so the transform would
 * hand its English name straight to a German interface.
 *
 * `ISO 8601` is in the map explicitly although its German word is the standard's
 * own name, and that is what makes the map honest: without the entry, "it comes
 * out right anyway" is an accident of the transform rather than a decision, and
 * the gap function below could not tell the two apart. **The four boolean pairs
 * are here for the same reason**: they render as their own two words because the
 * words are the column's *values* rather than interface prose — `ja/nein` is
 * what stands in the cells — and until they were entered they passed the gap
 * check by looking like patterns that spell themselves, which they do not.
 *
 * Null-prototype, because this is looked up with a key that comes out of the
 * core: a candidate named `constructor` or `toString` would otherwise inherit an
 * answer and render a function body.
 */
const NAMED_READING = Object.freeze(
  Object.assign(Object.create(null), {
    'ISO 8601': 'ISO 8601',
    'month name': 'Monatsname (2. Aug. 2026)',
    'month name and clock': 'Monatsname mit Uhrzeit (2. Aug. 2026 04:44:34)',
    'true/false': 'true/false',
    'wahr/falsch': 'wahr/falsch',
    'ja/nein': 'ja/nein',
    '1/0': '1/0',
  }),
)

/** The German word for a number reading, which names its *locale* rather than
 *  its separators: "de-DE against en-US" is a distinction a person can act on
 *  and "`.,` against `,.`" is not. It sits beside `NAMED_READING` because the
 *  gap function below has to consult both, and null-prototype for the same
 *  reason — the key comes out of the core. */
const NUMBER_LABEL = Object.freeze(
  Object.assign(Object.create(null), {
    'de-DE': 'Deutsch (1.234,56)',
    'en-US': 'Englisch (1,234.56)',
  }),
)

/** A pattern that spells itself — one that contains a field letter pair the
 *  transform can replace. Everything else needs a word. */
const FIELD_LETTERS = /dd|yy|MM|HH|mm|ss/

/**
 * Every reading the core offers that this pane would render in the core's own
 * words. Empty is the rule, and a test asserts it — the same shape
 * `typeLabelGaps()` has for the types.
 *
 * **It walks every kind `candidatesFor` serves, because the sentence above says
 * "every reading" and an invariant that checks two of four kinds is a sentence
 * that is not true.** The date patterns were the visible half; the number
 * readings fall through `NUMBER_LABEL[locale] ?? locale` with nothing watching
 * them, and story 4b just put a third locale (`en-GB`) into a locale list in the
 * same file as `NUMBER_LOCALES`, under a rule that says a third number locale
 * arrives with the Source that needs it. The day it does, this fails instead of
 * the pane rendering a bare `en-GB`.
 */
export const readingLabelGaps = () =>
  TYPES.filter((type) => type.settable)
    .flatMap((type) => [...candidatesFor(type.code)])
    .filter((candidate) =>
      candidate.locale !== undefined
        ? !Object.hasOwn(NUMBER_LABEL, candidate.locale)
        : !FIELD_LETTERS.test(candidate.pattern) &&
          !Object.hasOwn(NAMED_READING, candidate.pattern),
    )
    .map((candidate) => candidate.pattern ?? candidate.locale)
</script>

<script setup>
// The Sources pane (CAP-1..3, CAP-39). ui/ unwraps browser File objects and
// issues commands carrying bytes and a name (AD-3) — a File never crosses into
// core/. Every model change below goes through a named store command (AD-10),
// and the list is re-projected after each one.
//
// German is rendered here and only here (AD-13, C-6): the store and the reader
// deliver { severity, code, values }, and every code the pane can receive has a
// sentence in the map below. The fallback is a German sentence too — `?? code`
// would be the core talking to the user.

import { shallowRef } from 'vue'
import { nativeTypeOf } from '@core/types/catalog.js'
import { ENCODINGS } from '@core/types/encoding.js'
import { unresolvedColumns } from '@core/types/typing.js'
import RowWindow from '@ui/RowWindow.vue'
import { settableTypeLabels, typeLabel } from '@ui/type-labels.js'

const props = defineProps({
  store: { type: Object, required: true },
  /** Called after every command this pane issues, so a second reader of the same
   *  store can follow. The Editor reconciles its Source nodes from that list and
   *  has to hear about a file that finishes parsing while it is the pane on
   *  screen — this pane keeps running its own `addFiles` loop either way. */
  onChanged: { type: Function, default: null },
  /**
   * Step zero's cache, created in `ui/App.vue` and shared with the Editor
   * (decided 2026-08-04). This pane used to create its own from the engine; two
   * caches would convert the same Source twice and retain it twice, and this pane
   * never needed the engine for anything else — it asks Step zero which cells did
   * not read and renders that, and never sees an engine table.
   */
  stepZero: { type: Object, required: true },
})

// shallowRef, never ref/reactive/computed: the entries hold parsed tables, and
// a table must never enter deep reactivity (AD-6).
const sources = shallowRef(props.store.list())
const loadErrors = shallowRef([])

const refresh = () => {
  sources.value = props.store.list()
  props.onChanged?.()
}

const nf = (n) => n.toLocaleString('de-DE')

// ------------------------------------------------- the count, made clickable
//
// CAP-9's panel says "842 von 900 Werten lesbar" and, until story 6, could not
// show which 58. The jump from the count to the rows is the conversion's own
// output: Step zero converts a confirmed Source, the values that fail their
// confirmed type are boxed by the engine adapter, and the indices come back as
// plain data (AD-22 keeps the box itself inside `adapters/arquero/`).
//
// TWO THINGS ABOUT WHERE THIS STATE LIVES, both AD-6.
//
// The Step-zero cache is a plain closure, not a `ref`: it holds converted
// Tables, and a table must never enter deep reactivity — R2 measured 437–479 MB
// and an 11–13× read penalty for exactly that. It now arrives as a prop from
// `ui/App.vue` rather than being created here, so the Editor reads the same one
// converted Table this pane marks from. `marks` below is likewise a plain `Map`,
// and what reaches the template is a small array of `Set`s of row indices, which
// is neither a table nor a row.
//
// The memo is keyed by the frozen entry, like the cache it sits in front of, so
// re-rendering asks for the same array identity and `RowWindow`'s watcher does
// not repaint on every keystroke in a neighbouring field.
const stepZero = props.stepZero

/** @type {Map<string, { entry: object, marks: ReadonlyArray<Set<number>|null>|null }>} */
const markMemo = new Map()

/**
 * Which cells of this Source's preview are marked — one `Set` of row indices per
 * column, or `null` where nothing is.
 *
 * `null` for an unconfirmed Source, which is the matrix's own row: no conversion,
 * no marks. The columns are addressed by position, as everywhere in this pane,
 * and the conversion's map is keyed by name — a Source that repeats a name is not
 * converted at all, so the two cannot disagree here.
 *
 * **And `null` for a Source that converted cleanly, which is the common case.**
 * An array of nothing but `null`s is not the same as no array: `buildWindow` sees
 * an argument and builds one all-`false` boolean row per rendered row per column,
 * freezes them, and does it again on every scroll event — for a Source where
 * every value read. The distinction the geometry can act on is "is anything
 * marked at all", so that question is answered here, once per entry, rather than
 * fifty times a scroll.
 */
function marksFor(entry) {
  const memo = markMemo.get(entry.id)
  if (memo !== undefined && memo.entry === entry) return memo.marks

  const conversion = stepZero.of(entry)
  const columns =
    conversion === null
      ? null
      : entry.typing.columns.map((column) => {
          const at = conversion.unparsed[column.name]
          return at !== undefined && at.length > 0 ? new Set(at) : null
        })

  const marks =
    columns !== null && columns.some((set) => set !== null) ? Object.freeze(columns) : null

  markMemo.set(entry.id, { entry, marks })
  return marks
}

/** The sentence a marked cell carries. German lives here (AD-13), and it names
 *  the *type* rather than the reading: `time` and `duration` have no reading to
 *  choose, so "unter der gewählten Lesart" would send the user looking for a
 *  control that is not rendered — the same correction `typing.unparsed_values`
 *  already carries. */
const MARK_TITLE = 'Unter dem bestätigten Typ nicht lesbar'

// The formats this build can read, from the reader registry `app/` wired up —
// never a hand-kept list. Two sentences name them to the user (the drop zone and
// the unsupported-format refusal), and two hand-maintained copies of what `app/`
// already decides is the restatement problem `core/types/catalog.js` was written
// in this story to end.
// How each format is spelled in a German sentence. Only the spelling lives
// here — the *set* comes from the registry — so a format registered without an
// entry reads as its uppercase extension, which is shouty but never wrong.
const FORMAT_LABEL = { csv: 'CSV', xlsx: 'XLSX', parquet: 'Parquet', json: 'JSON' }

const formatList = () => {
  const names = props.store
    .formats()
    .map((extension) => FORMAT_LABEL[extension] ?? extension.toUpperCase())
  if (names.length === 0) return 'keine Dateien'
  if (names.length === 1) return `${names[0]}-Dateien`
  return `${names.slice(0, -1).join('-, ')}- und ${names.at(-1)}-Dateien`
}

// German counts one of a thing differently, and the diagnostic sentences below
// already do it — "Eine Zeile weicht ab" against "3 Zeilen weichen ab". The
// counts line was the one place that said "1 Zeilen" (AD-13).
const rowsLabel = (n) => (n === 1 ? '1 Zeile' : `${nf(n)} Zeilen`)
const colsLabel = (n) => (n === 1 ? '1 Spalte' : `${nf(n)} Spalten`)

const DELIMITERS = [
  { value: ',', label: 'Komma (,)' },
  { value: ';', label: 'Semikolon (;)' },
  { value: '\t', label: 'Tabulator' },
  { value: '|', label: 'Senkrechter Strich (|)' },
]

// Papa can guess a delimiter outside the four common ones (record/unit
// separators, for instance) — the select must show it rather than go blank.
const knownDelimiter = (d) => DELIMITERS.some((x) => x.value === d)
const delimiterLabel = (d) =>
  DELIMITERS.find((x) => x.value === d)?.label ?? `Anderes Zeichen (Code ${d.codePointAt(0)})`

// While the delimiter question is open, the select shows a placeholder instead
// of the comma fallback: re-selecting a value a select already displays fires
// no change event, so a user with a genuine comma file could never answer
// "Komma". The placeholder makes every real choice — comma included — an
// explicit user correction.
const hasDelimiterQuestion = (s) =>
  s.diagnostics.some((d) => d.code === 'csv.delimiter_undetectable')

const GERMAN = {
  'csv.field_count_mismatch': (v) =>
    v.count === 1
      ? `Eine Zeile weicht von der erwarteten Spaltenzahl (${nf(v.expected)}) ab: ` +
        `Zeile ${v.rows.map(nf).join(', Zeile ')}. Sie ist aus der Tabelle ausgeschlossen ` +
        `und unten als Rohtext einsehbar.`
      : `${nf(v.count)} Zeilen weichen von der erwarteten Spaltenzahl (${nf(v.expected)}) ab: ` +
        `Zeile ${v.rows.map(nf).join(', Zeile ')}. Sie sind aus der Tabelle ausgeschlossen ` +
        `und unten als Rohtext einsehbar.`,
  'csv.unclosed_quote': (v) =>
    `Anführungszeichen in Zeile ${nf(v.row)} wird nie geschlossen — der Rest der Datei ` +
    `wurde in dieses Feld eingelesen. Die Zeile ist ausgeschlossen und unten als ` +
    `Rohtext einsehbar.`,
  'csv.malformed_quote': (v) =>
    v.rows.length === 1
      ? `Fehlerhaft gesetzte Anführungszeichen in Zeile ${nf(v.rows[0])} — die Zeile wurde ` +
        `gelesen, ihre Werte sollten geprüft werden.`
      : `Fehlerhaft gesetzte Anführungszeichen in Zeile ${v.rows.map(nf).join(', Zeile ')} — ` +
        `die Zeilen wurden gelesen, ihre Werte sollten geprüft werden.`,
  'csv.delimiter_undetectable': (v) =>
    `Trennzeichen nicht erkennbar — die Datei wurde vorläufig mit ${delimiterLabel(v.fallback)} ` +
    `gelesen. Bitte das Trennzeichen prüfen und wählen.`,
  'csv.empty': () => 'Die Datei ist leer — keine Zeilen, keine Spalten.',
  'encoding.nul_bytes': (v) =>
    `Der gelesene Text enthält ${nf(v.count)} Null-Zeichen — das deutet auf eine falsch ` +
    `erkannte Zeichenkodierung hin (häufig UTF-16 ohne Byte-Reihenfolge-Markierung). ` +
    `Bitte die Kodierung prüfen und gegebenenfalls umstellen.`,
  'source.unsupported_format': (v) =>
    `„${v.fileName}“ hat ein nicht unterstütztes Format — gelesen werden derzeit ${formatList()}.`,
  // AD-13 exactly: `core/` decided the mapping and emitted it as values, and the
  // sentence is written here. It names *what became what* rather than reporting
  // that something was renamed — a user looking for `Betrag` in a Filter's column
  // select has to be able to find out that it is now `Betrag_2`, and which of the
  // two it is. The unnamed case reads differently on purpose: nothing "became"
  // anything there, a column that had no name got one.
  'source.columns_renamed': (v) => {
    const named = v.renamed.filter((r) => r.from !== '')
    const unnamed = v.renamed.filter((r) => r.from === '')
    const parts = []
    if (named.length) {
      parts.push(
        `Mehrfach vergebene Spaltennamen wurden eindeutig gemacht: ` +
          named.map((r) => `„${r.from}“ (Spalte ${nf(r.at)}) heißt jetzt „${r.to}“`).join(', ') +
          `.`,
      )
    }
    if (unnamed.length) {
      parts.push(
        unnamed.length === 1
          ? `Spalte ${nf(unnamed[0].at)} hat in der Kopfzeile keinen Namen und heißt jetzt „${unnamed[0].to}“.`
          : `Diese Spalten haben in der Kopfzeile keinen Namen und wurden nach ihrer Position ` +
            `benannt: ${unnamed.map((r) => `Spalte ${nf(r.at)} → „${r.to}“`).join(', ')}.`,
      )
    }
    // No claim about the values here. It read "die Werte selbst sind unverändert",
    // which is true of CSV and XLSX and false of Parquet, where a duplicated
    // column arrives empty — and this sentence cannot see which format it is
    // describing. What it *can* say is why the rename had to happen at all.
    return parts.join(' ') + ` Eine Tabelle kann zwei Spalten gleichen Namens nicht auseinanderhalten.`
  },
  'source.unreadable': (v) =>
    `„${v.fileName}“ konnte nicht gelesen werden — die Datei ist beschädigt, ` +
    `passwortgeschützt oder in einem anderen Format als ihre Endung angibt.`,
  'parquet.unsupported_codec': (v) =>
    `„${v.fileName}“ ist mit dem Verfahren ${v.codec} komprimiert, das querbeet nicht ` +
    `entpacken kann. Die Datei ist in Ordnung — bitte sie unkomprimiert oder mit Snappy ` +
    `erneut ausgeben lassen.`,
  'xlsx.empty': (v) =>
    v.sheet === ''
      ? 'Die Arbeitsmappe enthält kein Tabellenblatt — keine Zeilen, keine Spalten.'
      : `Das Tabellenblatt „${v.sheet}“ ist leer — keine Zeilen, keine Spalten.`,
  'xlsx.sheet_missing': (v) =>
    `Das Tabellenblatt „${v.sheet}“ gibt es in dieser Datei nicht mehr — gelesen wurde ` +
    `stattdessen „${v.using}“. Bitte das gewünschte Blatt wählen.`,
  'xlsx.mixed_types': (v) =>
    `Spalte „${v.column}“ enthält Werte verschiedener Excel-Typen ` +
    `(${v.kinds.map((k) => typeLabel(k)).join(', ')}) — sie wird als Text gelesen, ` +
    `damit kein Wert stillschweigend umgedeutet wird.`,
  // Both sentences describe what happens *after* the store makes column names
  // unique (story 6b), and they used to describe what happened before it: "diese
  // Spalte bleibt ohne Namen" and "sind aber am Namen nicht zu unterscheiden"
  // were true until 2026-08-04 and are now the opposite of what the card one line
  // below reports. Two sentences on one card contradicting each other is worse
  // than either being merely terse.
  'xlsx.blank_header': (v) =>
    v.columns.length === 1
      ? `In der Kopfzeile ist Spalte ${nf(v.columns[0])} leer — querbeet benennt sie beim Einlesen ` +
        `nach ihrer Position (siehe Meldung dazu). Bitte die Kopfzeile prüfen.`
      : `In der Kopfzeile sind die Spalten ${v.columns.map(nf).join(', ')} leer — querbeet benennt ` +
        `sie beim Einlesen nach ihrer Position (siehe Meldung dazu). Bitte die Kopfzeile prüfen.`,
  'xlsx.duplicate_header': (v) =>
    `Die Kopfzeile vergibt ${v.columns.map((c) => `„${c}“`).join(', ')} mehrfach — querbeet hat die ` +
    `Spalten beim Einlesen eindeutig benannt, damit sie auseinanderzuhalten sind. Welcher Name wo ` +
    `steht, sagt die Meldung dazu.`,
  'parquet.nested_column': (v) =>
    `Spalte „${v.column}“ ist verschachtelt (Liste, Map oder Struktur) — sie wird als Text ` +
    `im JSON-Format gelesen. Das Auffächern in einzelne Spalten kommt später.`,
  'parquet.unsupported_type': (v) =>
    `Spalte „${v.column}“ hat den Parquet-Typ ${v.type}, für den querbeet noch keine ` +
    `Umrechnung kennt — sie wird als Text gelesen.`,
  // The names *are* distinguishable now; the values are still missing, because
  // the Parquet reader plans a duplicated column as unreadable and fills it with
  // nulls (`adapters/parquet/parquet-reader.js`). Story 6b deliberately does not
  // open that reader, so the sentence says what is actually true of the file
  // rather than repeating a premise that has changed — and it must, because the
  // rename sentence beside it no longer claims the values are untouched.
  'parquet.duplicate_column_name': (v) =>
    `Die Datei enthält ${nf(v.columns)} Spalten mit dem Namen „${v.column}“. Die Namen sind beim ` +
    `Einlesen eindeutig gemacht worden, die Werte dieser Spalten liest querbeet aber noch nicht — ` +
    `sie bleiben leer. Die übrigen Spalten sind vollständig gelesen.`,
  'parquet.unreadable_column': (v) =>
    `Spalte „${v.column}“ hat den Parquet-Typ ${v.type}, den querbeet nicht entschlüsseln ` +
    `kann — sie bleibt leer. Die übrigen Spalten der Datei sind vollständig gelesen.`,
  'parquet.decimal_precision': (v) =>
    v.values === 1
      ? `Spalte „${v.column}“: ein Wert hat mehr Stellen, als sich hier exakt rechnen lassen. ` +
        `Er steht unverändert in der Tabelle und zählt als nicht lesbar, damit keine falsche ` +
        `Zahl weiterverwendet wird.`
      : `Spalte „${v.column}“: ${nf(v.values)} Werte haben mehr Stellen, als sich hier exakt ` +
        `rechnen lassen. Sie stehen unverändert in der Tabelle und zählen als nicht lesbar, ` +
        `damit keine falschen Zahlen weiterverwendet werden.`,
  // querbeet itself holds nanoseconds (AD-21), so this loss is the reader's and
  // not the representation's: the Parquet library hands over a `Date`, which is
  // millisecond-resolution by construction, so the finer digits are gone before
  // anything of ours sees the value. Saying "querbeet rechnet in Millisekunden"
  // here would now be false — and would send someone looking in the wrong place.
  'parquet.timestamp_precision': (v) =>
    `Spalte „${v.column}“ ist in ${v.unit === 'NANOS' ? 'Nanosekunden' : 'Mikrosekunden'} ` +
    `gespeichert und wird beim Einlesen auf Millisekunden gerundet. Die feineren Stellen ` +
    `gehen verloren.`,
  'parquet.non_finite_number': (v) =>
    v.values === 1
      ? `Spalte „${v.column}“ enthält einen Wert, der keine Zahl ist (unendlich oder ` +
        `undefiniert) — er zählt als nicht lesbar.`
      : `Spalte „${v.column}“ enthält ${nf(v.values)} Werte, die keine Zahlen sind (unendlich ` +
        `oder undefiniert) — sie zählen als nicht lesbar.`,
  'typing.unknown_native_type': (v) =>
    `Spalte „${v.column}“ wurde vom Dateiformat als „${v.type}“ angekündigt — diesen Typ ` +
    `kennt querbeet nicht. Die Spalte wird wie Text untersucht; bitte den Vorschlag prüfen.`,
  'typing.ambiguous_locale': (v) =>
    `Spalte „${v.column}“: nichts entscheidet zwischen zwei Lesarten. Bitte unter ` +
    `„Spalten & Typen“ wählen.`,
  // The alternatives can be an empty list: the core reads them through `?.` on a
  // typing it did not build (story 14 restores one from a Recipe), and a record
  // carrying `verdict: 'unresolved'` with no evidence still has to name its
  // column so the gate's reason is never silent. "entscheidet zwischen ." is a
  // sentence with a hole in it, which is worse than the shorter true one.
  'typing.ambiguous_kind': (v) =>
    v.alternatives.length < 2
      ? `Spalte „${v.column}“: der Typ ist ungeklärt. Bitte unter „Spalten & Typen“ den Typ ` +
        `wählen.`
      : `Spalte „${v.column}“: nichts entscheidet zwischen ${v.alternatives.map(typeLabel).join(' und ')}. ` +
        `Bitte unter „Spalten & Typen“ den Typ wählen.`,
  // The sentence may not say "wird als Text gelesen": the finding survives
  // whatever kind wins, and eighteen German dates beside `12 €` and `12 $` are
  // still a date column. What is always true is why no number type is proposed.
  'typing.mixed_affixes': (v) =>
    `Spalte „${v.column}“ enthält Werte mit verschiedenen Einheiten ` +
    `(${v.affixes.join(' und ')}). Solche Werte lassen sich nicht zusammenrechnen, deshalb ` +
    `schlägt querbeet für diese Spalte keinen Zahlentyp vor. Bitte prüfen.`,
  // Same discipline as the sentence above, for the same reason: the finding
  // survives whatever kind wins the column, so this may not say "wird als Text
  // gelesen" either. What is always true is why no boolean type is proposed.
  'typing.mixed_boolean_pairs': (v) =>
    `Spalte „${v.column}“ schreibt Ja und Nein in zwei verschiedenen Schreibweisen ` +
    `(${v.pairs.join(' und ')}). Eine Spalte, die ihr Ja zweimal buchstabiert, stammt nicht aus ` +
    `einem System, deshalb schlägt querbeet für diese Spalte keinen Wahrheitswert vor. ` +
    `Bitte prüfen.`,
  // "unter der gewählten Lesart" was true while every type that could carry an
  // unreadable value had a reading to choose. `time` and `duration` have none —
  // the question they raise is answered in the Typ select — so on those columns
  // the sentence sent the user looking for a control that is not rendered. The
  // type is what every column has, and naming it is true for all of them.
  'typing.unparsed_values': (v) =>
    v.unparsed === 1
      ? `Spalte „${v.column}“: ein Wert von ${nf(v.readable)} lässt sich unter dem ` +
        `gewählten Typ nicht lesen.`
      : `Spalte „${v.column}“: ${nf(v.unparsed)} von ${nf(v.readable)} Werten lassen sich ` +
        `unter dem gewählten Typ nicht lesen.`,
  'typing.unconfirmed': () =>
    'Die Spaltentypen sind noch nicht bestätigt — ohne Bestätigung rechnet querbeet nicht ' +
    'mit dieser Quelle.',
}

const renderText = (d) => GERMAN[d.code]?.(d.values) ?? 'Unbekannte Meldung aus dem Kern.'

// ---------------------------------------------------------------- Step zero
//
// CAP-9's panel. The core decided what a column is and counted what parses; the
// German for all of it lives here and only here (AD-13). The one sentence worth
// getting right is the second ambiguity state: when nothing in a column settles
// the reading, this must say so rather than name a winner, because naming a
// winner is exactly what every comparable tool does silently.

// The type select offers exactly what the catalogue calls settable, in its
// order, labelled from `ui/type-labels.js` — no list of types is restated here
// (AD-13). As of story 4a that is every type there is: detection reaches
// `datetime`, `time`, `duration` and `boolean` from text, so none of them is a
// dead end a user could pick and nothing could read.
const SETTABLE_TYPES = settableTypeLabels()

/** A date pattern in German field letters — TT.MM.JJJJ, not dd.MM.yyyy. The
 *  four-digit year is replaced before the two-digit one, or `dd.MM.yyyy` would
 *  come out as `TT.MM.JJJJ` on its first half and nonsense on its second. A
 *  named reading is answered from the map above before the transform is asked at
 *  all, because there is nothing in it for the transform to replace. */
const patternLabel = (pattern) =>
  Object.hasOwn(NAMED_READING, pattern)
    ? NAMED_READING[pattern]
    : pattern.replace(/dd/g, 'TT').replace(/yyyy/g, 'JJJJ').replace(/yy/g, 'JJ')

const formatLabel = (format) =>
  format == null
    ? ''
    : format.pattern
      ? patternLabel(format.pattern)
      : Object.hasOwn(NUMBER_LABEL, format.locale)
        ? NUMBER_LABEL[format.locale]
        : format.locale

/**
 * What an alternative is called when a sentence has to mention it.
 *
 * Two questions arrive here. A reading ambiguity names formats — a date pattern
 * in German field letters, a number reading by its locale, a boolean pair by its
 * two words. The time-against-duration ambiguity names *types*, so it is
 * labelled from the catalogue's German words instead: "zwischen Uhrzeit und
 * Dauer" is the question, and it is answered with the type select.
 */
const readingLabel = (column, key) =>
  isKindQuestion(column)
    ? typeLabel(key)
    : Object.hasOwn(NUMBER_LABEL, key)
      ? NUMBER_LABEL[key]
      : patternLabel(key)

/** Is this column's open question about its type rather than about a reading?
 *  The core says so on the evidence; deriving it from the type here would be a
 *  second opinion that drifts the moment another pair of types competes. */
const isKindQuestion = (column) => column.evidence?.over === 'kind'

/** The type select cannot show the proposal while the proposal is the question.
 *  Re-selecting the value a select already displays fires no change event, so a
 *  column proposed as `Dauer` and asking "Uhrzeit or Dauer?" could never be
 *  answered with `Dauer` — the gate would stay shut for good. Same placeholder,
 *  same reason, as the reading select and the delimiter select before it. */
const typeUndecided = (column) =>
  column.verdict === 'unresolved' && column.chosen === null && isKindQuestion(column)

const formatChoices = (type) => candidatesFor(type)

/**
 * Whether this column may be retyped — guarded by its **domain**, not its type.
 *
 * A `native:number` column has type `number`, which is perfectly settable, and a
 * type-keyed guard therefore handed it the full select: switching it would have
 * asked the store for a retype the store now refuses, over a column whose format
 * already answered the question (AD-20). What makes a column unretypeable is
 * where its type came from. Its missing tokens and its annotation stay editable.
 */
const isSettable = (column) => nativeTypeOf(column.domain) === null

// German counts one of a thing differently, and every count in this panel can
// be one: a one-row Source, a single unreadable value, a single deciding value.
// The verb has to follow the number, not only the noun.
const readsOnlyAs = (n, reading) =>
  n === 1
    ? `1 Wert lässt sich nur als ${reading} lesen`
    : `${nf(n)} Werte lassen sich nur als ${reading} lesen`

/** How a column's controls name themselves. The name alone, unless the header
 *  repeats it — two controls both labelled "Typ: Datum" name the same thing to
 *  a screen reader and to any locator, while addressing different columns. The
 *  position is added only where it is needed, so the common case reads as a
 *  name rather than as a coordinate. */
const columnLabel = (s, at) => {
  const name = s.typing.columns[at].name
  const repeated = s.typing.columns.filter((c) => c.name === name).length > 1
  return repeated ? `${name} (Spalte ${at + 1})` : name
}

const hitRate = (c) => {
  const readable = c.counts.total - c.counts.missing
  const rate =
    readable === 1
      ? `${nf(c.counts.parsed)} von 1 Wert lesbar`
      : `${nf(c.counts.parsed)} von ${nf(readable)} Werten lesbar`
  return c.counts.missing === 0 ? rate : `${rate}, ${nf(c.counts.missing)} leer`
}

/**
 * The sentence under a column's controls, and what it says about a record this
 * pane did not build.
 *
 * `core/exec` reads a column's evidence through `?.` because story 14 restores a
 * typing from a Recipe and a hand-edited or older file can carry a verdict with
 * nothing behind it. The same records reach here, so the same care is owed: a
 * verdict whose evidence is missing, empty or half-filled says **nothing**
 * rather than "Nichts in dieser Spalte entscheidet zwischen  und ." — half a
 * sentence reads as a rendering bug and hides the state it was meant to report.
 * The column is still named in the diagnostic list and still blocks the gate.
 */
const verdictText = (c) => {
  const named = (c.evidence?.alternatives ?? []).map((k) => readingLabel(c, k))
  if (named.length < 2) return ''

  if (c.verdict === 'unresolved') {
    const [a, b] = named
    // Which control answers it is named, because the two questions are answered
    // in different places: a reading in the Lesart select, a type in the Typ one.
    return isKindQuestion(c)
      ? `Nichts in dieser Spalte entscheidet zwischen ${a} und ${b} — bitte den Typ wählen.`
      : `Nichts in dieser Spalte entscheidet zwischen ${a} und ${b} — bitte wählen.`
  }
  if (c.verdict === 'decisive' && typeof c.evidence.decidedBy === 'number') {
    const [winner, other] = named
    const decided = readsOnlyAs(c.evidence.decidedBy, winner)
    // Evidence pointing the other way is named too. A column where 47 values
    // say dd.mm and 3 say mm.dd is still dd.mm, but a sentence that mentions
    // only the 47 reads as unanimity, and the 3 are the ones that will come out
    // wrong. Where the counts are equal there is no decisive reading at all and
    // the core never reports one.
    return c.evidence.contested > 0
      ? `${decided}, ${nf(c.evidence.contested)} nur als ${other} — die Mehrheit ` +
          `spricht für ${winner}.`
      : `${decided}, nicht als ${other} — daher ${winner}.`
  }
  return ''
}

// The same predicate the gate uses, from the same place (AD-13): a second copy
// here would drift the moment the rule gains a clause, and the card would then
// promise a confirmation the store refuses.
const openQuestions = (s) => unresolvedColumns(s.typing)

const confirmState = (s) => {
  if (s.typing.confirmed) return 'Typen bestätigt.'
  const open = openQuestions(s)
  if (open.length === 0) return 'Typen noch nicht bestätigt.'
  return open.length === 1
    ? `Noch offen: ${open[0]}.`
    : `Noch offen: ${open.slice(0, -1).join(', ')} und ${open.at(-1)}.`
}

// Every severity gets a German label and its own colour: CAP-34 requires a
// glance-level distinction, and an enum rendered raw is the core talking to
// the user (C-6).
const SEVERITY = {
  info: { label: 'Hinweis', tone: 'text-slate-500' },
  warning: { label: 'Warnung', tone: 'text-amber-600' },
  error: { label: 'Fehler', tone: 'text-red-600' },
  unresolved: { label: 'Ungeklärt', tone: 'text-violet-600' },
}

const ENCODING_LABEL = {
  'utf-8': 'UTF-8',
  'windows-1252': 'Windows-1252',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
}

const ENCODING_SOURCE = {
  bom: 'an der Byte-Reihenfolge-Markierung erkannt',
  probe: 'geprüft: gültiges UTF-8',
  fallback: 'Rückfall auf Windows-1252',
  override: 'von Hand gewählt',
}

async function addFiles(files) {
  const failures = []
  for (const file of files) {
    // AD-3: the File is unwrapped here; the command carries bytes and a name.
    // Per-file try/catch: a File whose backing store is gone (deleted between
    // pick and read, a dropped directory) rejects arrayBuffer(), and the
    // remaining files must still load.
    try {
      const bytes = await file.arrayBuffer()
      const { source, diagnostics } = await props.store.addSource({ bytes, fileName: file.name })
      if (!source) {
        for (const d of diagnostics) failures.push({ ...SEVERITY[d.severity], text: renderText(d) })
      }
    } catch {
      failures.push({
        ...SEVERITY.error,
        text: GERMAN['source.unreadable']({ fileName: file.name }),
      })
    }
  }
  // Functional append at the end — no start-of-call snapshot that would
  // clobber a concurrent batch's errors.
  if (failures.length > 0) loadErrors.value = [...loadErrors.value, ...failures]
  refresh()
}

const dismissErrors = () => {
  loadErrors.value = []
}

function onPick(event) {
  addFiles([...event.target.files])
  event.target.value = ''
}

function onDrop(event) {
  addFiles([...(event.dataTransfer?.files ?? [])])
}

const rename = (id, name) => {
  props.store.renameSource(id, name)
  refresh()
}
const remove = (id) => {
  props.store.removeSource(id)
  // No entry arrives for a removed Source again, so nothing else would ever
  // release its conversion — the two caches are keyed by Source id and would
  // hold a converted Table for a Source that no longer exists.
  stepZero.release(id)
  markMemo.delete(id)
  refresh()
}
// The three commands that re-parse are awaited: a binary reader cannot be
// synchronous, so refreshing before the read has landed would project the
// previous table (see the note on `createSourceStore`).
//
// While one is in flight the control that issued it is disabled and says so. A
// 2.4 MB workbook takes a third of a second to parse and a slow machine much
// longer, and a card that stays fully interactive and unchanged for that long
// invites a second click over the first. The store serializes the commands so
// nothing is lost either way; this is what stops the user having to find out.
const parsing = shallowRef({})

const isParsing = (id, control) => parsing.value[id] === control

const reparse = async (id, control, run) => {
  parsing.value = { ...parsing.value, [id]: control }
  try {
    await run()
  } catch {
    // A reader that fails is not this path: the store turns that into a
    // Diagnostic on the card. A rejection here is a programming error, and
    // letting it escape an event handler would leave an unhandled rejection —
    // a page error in the built artefact, and a card disabled for good. It goes
    // to the same visible, dismissible channel a failed file load uses.
    const failed = props.store.get(id)
    loadErrors.value = [
      ...loadErrors.value,
      {
        ...SEVERITY.error,
        text: GERMAN['source.unreadable']({ fileName: failed?.fileName ?? failed?.name ?? '' }),
      },
    ]
  } finally {
    const rest = { ...parsing.value }
    delete rest[id]
    parsing.value = rest
    refresh()
  }
}

const setEncoding = (id, chosen) =>
  reparse(id, 'encoding', () => props.store.overrideEncoding(id, chosen))

const setDelimiter = (id, delimiter) =>
  reparse(id, 'delimiter', () =>
    delimiter ? props.store.reconfigureParse(id, { delimiter }) : undefined,
  )

const setHeaderRow = (id, raw) => {
  const headerRow = Number(raw)
  // Refresh in every case: on invalid input the bound value snaps the DOM back
  // to the state the application actually holds.
  return reparse(id, 'headerRow', () =>
    Number.isInteger(headerRow) && headerRow >= 1
      ? props.store.reconfigureParse(id, { headerRow })
      : undefined,
  )
}

// A sheet switch re-reads the retained bytes (AD-7). The native domains and the
// annotations follow their columns by name; the confirmation never does, because
// every value in the table just changed.
const setSheet = (id, sheet) =>
  reparse(id, 'sheet', () => (sheet ? props.store.reconfigureParse(id, { sheet }) : undefined))

// The refusal is state, not a thrown error: an unanswered question is a
// property of the data, not a caller's bug. It is held per Source so a card can
// say what it is waiting for without the others changing.
const refusals = shallowRef({})

// A refusal describes the moment it was issued. Any edit that could answer one
// of the columns it names makes it stale, and a card that says "still open"
// about a column its own summary calls answered is worse than no refusal.
const clearRefusal = (id) => {
  refusals.value = { ...refusals.value, [id]: null }
}

// Columns are addressed by position, not by name: a header may repeat a name,
// and the store refuses to guess which of them a command meant.
const setType = (id, at, type) => {
  // The empty value is the reset, not a type: it withdraws the user's choice
  // and puts the column back to whatever detection proposes — including back to
  // an open question, if that is what the values support.
  //
  // No format is passed either way. The user picked a type and left the reading
  // to detection, which scores the candidates — handing over the first one
  // would give an Anglo column the German reading and a collapsed hit rate.
  props.store.setColumnTyping(id, at, type === '' ? { type: null } : { type })
  clearRefusal(id)
  refresh()
}

const setFormat = (id, column, at, key) => {
  const format = formatChoices(column.type).find((f) => (f.pattern ?? f.locale) === key)
  if (!format) return // the placeholder, which is not an answer
  props.store.setColumnTyping(id, at, { type: column.type, format })
  clearRefusal(id)
  refresh()
}

const MISSING_EMPTY = '(leer)'

const setMissing = (id, at, raw) => {
  // Comma-separated, trimmed, empties dropped — except that "empty cell counts
  // as missing" has to stay expressible, so a trailing comma is not an accident
  // to clean up. It is spelled as a word instead, matched whole: a token like
  // `x(leer)` is a token, not the sentinel. A comma cannot appear inside a
  // token; nothing seen so far needs one.
  const tokens = String(raw)
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .map((t) => (t.toLowerCase() === MISSING_EMPTY ? '' : t))
  props.store.setColumnTyping(id, at, { missingTokens: [...new Set(tokens)] })
  clearRefusal(id)
  refresh()
}

const missingText = (column) =>
  column.missingTokens.map((t) => (t === '' ? MISSING_EMPTY : t)).join(', ')

const annotate = (id, at, text) => {
  props.store.annotateColumn(id, at, text)
  refresh()
}

const confirm = (id) => {
  const { unresolved: open } = props.store.confirmTyping(id)
  refusals.value = { ...refusals.value, [id]: open.length > 0 ? open : null }
  refresh()
}

const unconfirm = (id) => {
  props.store.unconfirmTyping(id)
  refresh()
}
</script>

<template>
  <section>
    <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
      Quellen
    </h2>

    <label
      data-testid="drop-zone"
      class="mt-3 flex max-w-2xl cursor-pointer flex-col gap-2 rounded border-2 border-dashed border-slate-300 p-6 text-sm text-slate-600 hover:border-slate-400"
      @dragover.prevent
      @drop.prevent="onDrop"
    >
      <!-- The formats come from the reader registry, so this sentence and the
           refusal below it can never disagree with what the build can open. -->
      <span>Dateien hierher ziehen oder per Klick auswählen — gelesen werden {{ formatList() }}.</span>
      <input
        type="file"
        multiple
        aria-label="Dateien auswählen"
        class="text-sm"
        @change="onPick"
      >
    </label>

    <div
      v-if="loadErrors.length"
      class="mt-4 max-w-2xl"
    >
      <ul class="space-y-2">
        <li
          v-for="(err, i) in loadErrors"
          :key="i"
          class="flex gap-3 rounded border border-red-200 bg-red-50 p-3 text-sm"
        >
          <span
            class="w-24 shrink-0 font-semibold"
            :class="err.tone"
          >
            {{ err.label }}
          </span>
          <span>{{ err.text }}</span>
        </li>
      </ul>
      <button
        type="button"
        class="mt-2 rounded border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-50"
        @click="dismissErrors"
      >
        Schließen
      </button>
    </div>

    <ul class="mt-4 max-w-2xl space-y-4">
      <li
        v-for="s in sources"
        :key="s.id"
        data-testid="source-card"
        class="rounded border border-slate-200 p-4"
      >
        <div class="flex items-center gap-3">
          <input
            :value="s.name"
            aria-label="Name"
            class="w-full rounded border border-slate-200 px-2 py-1 text-sm font-semibold"
            @change="rename(s.id, $event.target.value)"
          >
          <button
            type="button"
            :aria-label="'Entfernen: ' + s.name"
            class="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-50"
            @click="remove(s.id)"
          >
            Entfernen
          </button>
        </div>

        <!-- The counts are the Source's totals, never the preview window's:
             the grid further down holds ~50 rows whatever this says (AD-24). -->
        <p
          data-testid="source-counts"
          class="mt-2 text-sm text-slate-500"
        >
          {{ s.fileName }} — {{ rowsLabel(s.table.rowCount) }}, {{ colsLabel(s.table.columns.length) }}
        </p>

        <!-- The parse controls a format actually has, and no others. Which they
             are is read off the reader's own proposal rather than off a list of
             formats kept here: a binary Source has no encoding to choose (a
             workbook is a zip of UTF-8 XML and says so itself), Parquet has no
             correctable decision at all, and a control rendered over a format
             that cannot answer it is an invitation to break a good read. -->
        <div
          v-if="s.encoding.chosen || s.proposal.delimiter != null || s.proposal.headerRow != null || s.proposal.sheets?.length"
          class="mt-3 flex flex-wrap items-end gap-4 text-sm"
        >
          <label
            v-if="s.encoding.chosen"
            class="flex flex-col gap-1"
          >
            <span class="text-xs text-slate-500">Zeichenkodierung</span>
            <select
              :value="s.encoding.chosen"
              aria-label="Zeichenkodierung"
              :disabled="isParsing(s.id, 'encoding')"
              class="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
              @change="setEncoding(s.id, $event.target.value)"
            >
              <option
                v-for="enc in ENCODINGS"
                :key="enc"
                :value="enc"
              >
                {{ ENCODING_LABEL[enc] }}
              </option>
            </select>
          </label>

          <!-- A workbook with no sheet at all still reports an empty list, and
               an option-less select is a control with nothing to choose. -->
          <label
            v-if="s.proposal.sheets?.length"
            class="flex flex-col gap-1"
          >
            <span class="text-xs text-slate-500">Tabellenblatt</span>
            <select
              :value="s.proposal.sheet"
              aria-label="Tabellenblatt"
              :disabled="isParsing(s.id, 'sheet')"
              class="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
              @change="setSheet(s.id, $event.target.value)"
            >
              <option
                v-for="name in s.proposal.sheets"
                :key="name"
                :value="name"
              >
                {{ name }}
              </option>
            </select>
          </label>

          <label
            v-if="s.proposal.delimiter != null"
            class="flex flex-col gap-1"
          >
            <span class="text-xs text-slate-500">Trennzeichen</span>
            <select
              :value="hasDelimiterQuestion(s) ? '' : s.proposal.delimiter"
              aria-label="Trennzeichen"
              :disabled="isParsing(s.id, 'delimiter')"
              class="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
              @change="setDelimiter(s.id, $event.target.value)"
            >
              <option
                v-if="hasDelimiterQuestion(s)"
                disabled
                value=""
              >
                Bitte wählen …
              </option>
              <option
                v-for="d in DELIMITERS"
                :key="d.value"
                :value="d.value"
              >
                {{ d.label }}
              </option>
              <option
                v-if="!hasDelimiterQuestion(s) && !knownDelimiter(s.proposal.delimiter)"
                :value="s.proposal.delimiter"
              >
                {{ delimiterLabel(s.proposal.delimiter) }}
              </option>
            </select>
          </label>

          <label
            v-if="s.proposal.headerRow != null"
            class="flex flex-col gap-1"
          >
            <span class="text-xs text-slate-500">Kopfzeile</span>
            <input
              type="number"
              min="1"
              :value="s.proposal.headerRow"
              aria-label="Kopfzeile"
              :disabled="isParsing(s.id, 'headerRow')"
              class="w-20 rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
              @change="setHeaderRow(s.id, $event.target.value)"
            >
          </label>

          <!-- role="status" so the wait is announced rather than only shown: a
               binary read takes long enough that a screen-reader user would
               otherwise have no signal at all that the card is working. -->
          <span
            v-if="parsing[s.id]"
            role="status"
            data-testid="parse-pending"
            class="pb-1 text-xs text-slate-500"
          >Datei wird neu gelesen …</span>
          <span
            v-else-if="s.encoding.source"
            class="pb-1 text-xs text-slate-400"
          >{{ ENCODING_SOURCE[s.encoding.source] }}</span>
        </div>

        <ul
          v-if="s.diagnostics.length"
          class="mt-3 space-y-2"
        >
          <li
            v-for="(d, i) in s.diagnostics"
            :key="i"
            class="flex gap-3 rounded border border-slate-200 p-3 text-sm"
          >
            <span
              class="w-24 shrink-0 font-semibold"
              :class="SEVERITY[d.severity].tone"
            >
              {{ SEVERITY[d.severity].label }}
            </span>
            <span>{{ renderText(d) }}</span>
          </li>
        </ul>

        <!-- Step zero (CAP-9). Open by default: FR-9 says the proposed type,
             the proposed locale and the share that parses are shown per
             column, and a panel folded shut shows none of them. It sits above
             the preview because it is a question addressed to the reader,
             and below the parse controls because a header row correction
             changes what the columns even are. -->
        <details
          v-if="s.typing.columns.length"
          open
          data-testid="typing"
          class="mt-3 rounded border border-slate-200 p-3 text-sm"
        >
          <summary class="cursor-pointer text-slate-600">
            Spalten &amp; Typen — {{ confirmState(s) }}
          </summary>

          <!-- role="status" so pressing a button that refuses says so out loud.
               Without it the confirm action appears to do nothing at all to a
               screen reader, which is the one case where it does the most. -->
          <p
            v-if="refusals[s.id]"
            role="status"
            data-testid="typing-refusal"
            class="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900"
          >
            Nicht bestätigt — diese Spalten sind noch offen:
            {{ refusals[s.id].join(', ') }}.
          </p>

          <ul class="mt-2 space-y-3">
            <!-- Keyed by position: a CSV header may repeat a name, and two rows
                 with the same key would make Vue reuse the wrong one. -->
            <li
              v-for="(col, at) in s.typing.columns"
              :key="at"
              data-testid="typing-column"
              class="rounded border border-slate-100 p-2"
            >
              <div class="flex flex-wrap items-end gap-3">
                <span class="min-w-32 font-semibold text-slate-700">{{ col.name }}</span>

                <label
                  v-if="isSettable(col)"
                  class="flex flex-col gap-1"
                >
                  <span class="text-xs text-slate-500">Typ</span>
                  <select
                    :value="typeUndecided(col) ? '' : col.type"
                    :aria-label="'Typ: ' + columnLabel(s, at)"
                    class="rounded border border-slate-200 px-2 py-1"
                    @change="setType(s.id, at, $event.target.value)"
                  >
                    <!-- The question is which type this column is, so the select
                         must not already show one of the two answers: the value
                         a select displays cannot be chosen, and the gate would
                         never open. Disabled, so it is a prompt and never an
                         answer — the reading select does the same thing. -->
                    <option
                      v-if="typeUndecided(col)"
                      value=""
                      disabled
                    >
                      Bitte wählen
                    </option>
                    <!-- Only while a choice of the user's stands. Without it,
                         overriding a type is one-way: nothing in the pane puts
                         the column back to the proposal, and a re-read is the
                         only way out — which takes the confirmation with it.
                         The proposed type is deliberately not named here: it
                         would have to ride on the column record, and it would
                         be stale exactly when the user has been changing the
                         most. The reset says what it does instead. -->
                    <option
                      v-if="col.chosen"
                      value=""
                    >
                      Zurück zum Vorschlag
                    </option>
                    <option
                      v-for="[value, label] in SETTABLE_TYPES"
                      :key="value"
                      :value="value"
                    >
                      {{ label }}
                    </option>
                  </select>
                </label>

                <!-- A column its format already typed (AD-20). It gets no type
                     control at all: a select whose options lack its own value
                     would show "Text" and retype the column on the first
                     interaction, and the store now refuses that patch anyway.
                     The German word comes from the catalogue's label map, so a
                     new type cannot land here as a raw English word. -->
                <span
                  v-else
                  data-testid="typing-native"
                  class="pb-1 text-xs text-slate-500"
                >Vom Format vorgegeben: {{ typeLabel(col.type) }}</span>

                <!-- No reading select while the open question is which *type*
                     this column is. A date-or-text column still carries
                     `type: 'date'` and a `dd.MM.yy` reading, so this rendered
                     beside the type placeholder — two prompts, and answering
                     this one settled the column as `date` and opened the gate.
                     `over: 'kind'` exists so the card cannot point at a control
                     that fails to answer the question; a control that answers it
                     *wrongly* is worse. It returns the moment a type is chosen. -->
                <label
                  v-if="isSettable(col) && !typeUndecided(col) && formatChoices(col.type).length"
                  class="flex flex-col gap-1"
                >
                  <span class="text-xs text-slate-500">Lesart</span>
                  <!-- While the question is open the select shows a placeholder
                       rather than the leading candidate. Two reasons, and either
                       alone would be enough: re-selecting the value a select
                       already displays fires no change event, so the user could
                       never answer with the reading detection happens to rank
                       first; and a verdict whose whole content is "nothing names
                       a winner" must not name one in the control beside it. -->
                  <!-- The verdict alone decides, not the verdict beside an
                       unanswered choice: a user who answered "Datum" on a
                       two-digit-year column has closed the *kind* question and
                       has never been asked the ordering one, so the reading is
                       still open and this control is where it is answered. It
                       must show the placeholder there too, or the reading the
                       core ranked first could never be chosen. -->
                  <select
                    :value="
                      col.verdict === 'unresolved'
                        ? ''
                        : (col.format?.pattern ?? col.format?.locale ?? '')
                    "
                    :aria-label="'Lesart: ' + columnLabel(s, at)"
                    class="rounded border border-slate-200 px-2 py-1"
                    @change="setFormat(s.id, col, at, $event.target.value)"
                  >
                    <option
                      v-if="col.verdict === 'unresolved'"
                      value=""
                      disabled
                    >
                      Bitte wählen
                    </option>
                    <option
                      v-for="choice in formatChoices(col.type)"
                      :key="choice.pattern ?? choice.locale"
                      :value="choice.pattern ?? choice.locale"
                    >
                      {{ formatLabel(choice) }}
                    </option>
                  </select>
                </label>

                <!-- The unit the column's numbers carry. It is a property of
                     the column, not of a cell: the stored number is the number
                     in the field (12,5 for `12,5 %`), and this is where the
                     percent sign went. -->
                <span
                  v-if="col.affix"
                  data-testid="typing-affix"
                  class="pb-1 text-xs text-slate-500"
                >Einheit: {{ col.affix }}</span>

                <span
                  data-testid="typing-hitrate"
                  class="pb-1 text-xs text-slate-500"
                >{{ hitRate(col) }}</span>
              </div>

              <!-- A verdict with no evidence behind it has nothing to say, and
                   an empty amber line would read as a warning about nothing. The
                   condition is the sentence itself rather than the evidence
                   field: a record restored from a Recipe can carry evidence that
                   is present and yet says nothing, and `verdictText` is the one
                   place that knows the difference. -->
              <p
                v-if="col.verdict !== 'settled' && verdictText(col)"
                data-testid="typing-verdict"
                class="mt-2 text-xs"
                :class="col.verdict === 'unresolved' ? 'text-amber-700' : 'text-slate-500'"
              >
                {{ verdictText(col) }}
              </p>

              <div class="mt-2 flex flex-wrap gap-3">
                <label class="flex flex-1 flex-col gap-1">
                  <span class="text-xs text-slate-500">Fehlende Werte</span>
                  <input
                    :value="missingText(col)"
                    :aria-label="'Fehlende Werte: ' + columnLabel(s, at)"
                    class="rounded border border-slate-200 px-2 py-1 text-xs"
                    @change="setMissing(s.id, at, $event.target.value)"
                  >
                </label>

                <label class="flex flex-2 flex-col gap-1">
                  <span class="text-xs text-slate-500">Notiz</span>
                  <input
                    :value="col.annotation"
                    :aria-label="'Notiz: ' + columnLabel(s, at)"
                    placeholder="Wofür steht diese Spalte?"
                    class="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                    @change="annotate(s.id, at, $event.target.value)"
                  >
                </label>
              </div>
            </li>
          </ul>

          <div class="mt-3">
            <button
              v-if="!s.typing.confirmed"
              type="button"
              :aria-label="'Typen bestätigen: ' + s.name"
              class="rounded border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
              @click="confirm(s.id)"
            >
              Typen bestätigen
            </button>
            <button
              v-else
              type="button"
              :aria-label="'Bestätigung aufheben: ' + s.name"
              class="rounded border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-50"
              @click="unconfirm(s.id)"
            >
              Bestätigung aufheben
            </button>
          </div>
        </details>

        <!-- The preview sits below the correction controls, not above them.
             Everything that explains or corrects the read comes first — the
             knobs, then what went wrong — and the grid is the payoff you look
             at once those are right. Above the knobs it pushed them a screen
             apart on a three-Source pane. The column names are this grid's
             header row now; the chips that used to carry them would have been
             the same names twice. Damaged rows stay out of the table and
             inspectable in the report directly below it (CAP-39). -->
        <RowWindow
          class="mt-3"
          :table="s.table"
          :label="'Vorschau: ' + s.name"
          :marks="marksFor(s)"
          :mark-title="MARK_TITLE"
        />

        <details
          v-if="s.damage.mismatches.length"
          class="mt-3 text-sm"
        >
          <summary class="cursor-pointer text-slate-600">
            Ausgeschlossene Zeilen als Rohtext
          </summary>
          <pre
            class="mt-2 overflow-x-auto rounded bg-slate-50 p-3 text-xs"
          ><template
            v-for="m in s.damage.mismatches"
            :key="m.row"
          >Zeile {{ m.row }}: {{ m.raw }}&#10;</template></pre>
        </details>
      </li>
    </ul>
  </section>
</template>
