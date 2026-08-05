// The German for everything `core/graph` emits (AD-13, C-6).
//
// It lives in `ui/` because the core emits codes and never prose, and in its own
// file because completeness is the property worth testing: a code added to
// `core/graph/graph.js` or a kind added to `core/graph/kinds.js` without a word
// here should fail a test, not print `graph.inputs_missing` on a Step card in a
// German interface. That is the relationship `ui/type-labels.js` has to
// `core/types/catalog.js`, and `GRAPH_CODES` is what makes it possible: the core
// builds its enumeration out of the constants its own emit sites use, so the two
// cannot drift.
//
// **The codes carry ids, never names** — with `graph.input_lost` the single
// exception, because the node is gone and its name has nowhere else to live. So
// every sentence below resolves a name through `nameOf`, against the graph the
// caller is already rendering. A name frozen into a diagnostic would go stale the
// moment someone renames a Step.
//
// Both maps are null-prototype. They are looked up with keys that come out of the
// core, and a plain object literal answers `kindLabel('constructor')` with a
// function and renders `[object Object]` instead of the fallback this file exists
// to guarantee.

import { EXEC_CODES } from '@core/exec/execute.js'
import { GRAPH_CODES } from '@core/graph/graph.js'
import { addableKinds, kindCodes } from '@core/graph/kinds.js'
import { STEP_CODES } from '@core/steps/index.js'
import { COMBINES, OPERATORS, VALUELESS_OPERATORS } from '@core/steps/filter.js'
import { ENDS } from '@core/steps/first.js'
import { DIRECTIONS } from '@core/steps/sort.js'
import { typeLabel } from '@ui/type-labels.js'

const KIND = Object.freeze(
  Object.assign(Object.create(null), {
    source: 'Quelle',
    union: 'Union',
    join: 'Join',
    filter: 'Filter',
    columns: 'Spalten',
    // „Erste/Letzte N" rather than „Begrenzen" or „Limit": the toolbar entry has
    // to say what the Step does to a person who has never seen one, and both
    // ends belong in the name — a card reading „Erste N" while the Step is set
    // to „Letzte 10" would be the one place the graph lies about itself.
    sort: 'Sortieren',
    first: 'Erste/Letzte N',
    computed: 'Berechnete Spalte',
    aggregate: 'Aggregation',
  }),
)

/** The German word for a Step kind. Falls back to the code, which is the state
 *  `kindLabelGaps` exists to keep out of a release. */
export const kindLabel = (code) => (Object.hasOwn(KIND, code) ? KIND[code] : code)

/** Every kind in the catalogue this file has no German word for. Empty is the rule. */
export const kindLabelGaps = () => kindCodes().filter((code) => !Object.hasOwn(KIND, code))

/** `[code, label]` for the kinds the toolbar may offer, in catalogue order. */
export const addableKindLabels = () => addableKinds().map((code) => [code, kindLabel(code)])

/** What a card calls itself: its kind and the name its author gave it. Two Steps
 *  of one kind open with the same name, so a caller that needs the label to be
 *  unique — `ui/EditorPane.vue`, because this is the card's accessible name —
 *  qualifies it further. */
export const stepLabel = (kind, name) => `${kindLabel(kind)}: ${name}`

/**
 * What an input slot is called on a card.
 *
 * A Join's two inputs are not interchangeable — the left one keeps its rows and
 * the right one is matched against it — so they are named rather than numbered.
 * Every other kind counts, because every other kind's slots differ only in order.
 */
export const slotLabel = (kind, slot) =>
  kind === 'join' ? (slot === 0 ? 'Links' : 'Rechts') : `Eingang ${slot + 1}`

const q = (text) => `„${text}“`
const step = (nameOf, id) => q(nameOf(id))

// German counts one of a thing differently, and every count below can be one.
const nf = (n) => Number(n).toLocaleString('de-DE')
const inputs = (n) => (n === 1 ? '1 Eingang' : `${n} Eingänge`)
const rows = (n) => (n === 1 ? '1 Zeile' : `${nf(n)} Zeilen`)

/**
 * How much work a run has, with its verb — „ist 1 Arbeitsschritt", „sind 12
 * Arbeitsschritte".
 *
 * **„Arbeitsschritt" rather than „Step", and it is a deliberate second word.** A
 * run's order contains the contributing Quellen as well as the Steps, so calling
 * the count a number of Steps says something the user cannot verify.
 *
 * **And the count is the run's own, not the Pipeline's**, which is the half the
 * first version of this left out: `total` is `order.length`, and the order is the
 * *contributing* subset — what `contributingTo` says feeds the Result. A Pipeline
 * of 45 Steps of which 11 reach the Result reports 11, so a sentence reading „Von
 * 11 Arbeitsschritten" in front of 45 cards is a number with nowhere to be
 * checked. The sentence therefore says what the number is *for* — the work this
 * result needs — rather than presenting it as a total of anything on screen.
 */
const workNeeded = (n) => (n === 1 ? 'ist 1 Arbeitsschritt' : `sind ${nf(n)} Arbeitsschritte`)

/** `Eingang 1 und Eingang 2`, in German rather than as a comma-joined list. */
const slotList = (slots) =>
  slots.length < 2
    ? `Eingang ${slots[0] + 1}`
    : `${slots.slice(0, -1).map((s) => `Eingang ${s + 1}`).join(', ')} und Eingang ${slots.at(-1) + 1}`

// --------------------------------------------------------- the Filter's words
//
// The operator vocabulary is closed in `core/steps/filter.js` and this is the
// German for it, keyed off that list rather than restated beside it — the same
// relationship `ui/type-labels.js` has to the type catalogue, and it is what lets
// `operatorLabelGaps()` fail instead of a raw `not_empty` appearing in a select.

const OPERATOR = Object.freeze(
  Object.assign(Object.create(null), {
    eq: 'ist gleich',
    ne: 'ist ungleich',
    lt: 'ist kleiner als',
    lte: 'ist kleiner oder gleich',
    gt: 'ist größer als',
    gte: 'ist größer oder gleich',
    // The semantics are in the word, because CAP-15 requires the user to know
    // them: three different cell contents match this one operator and a label
    // reading only „ist leer" would leave two of them to be discovered.
    empty: 'ist leer (auch nur Leerzeichen)',
    not_empty: 'ist nicht leer',
  }),
)

export const operatorLabel = (code) => (Object.hasOwn(OPERATOR, code) ? OPERATOR[code] : code)

/** `[code, label]` for every operator a Filter offers, in the core's order. */
export const operatorLabels = () => OPERATORS.map((code) => [code, operatorLabel(code)])

/** Whether this operator's row renders a value input at all. */
export const takesValue = (op) => !VALUELESS_OPERATORS.includes(op)

const COMBINE = Object.freeze(
  Object.assign(Object.create(null), {
    all: 'Alle Bedingungen müssen zutreffen',
    any: 'Mindestens eine Bedingung muss zutreffen',
  }),
)

export const combineLabel = (code) => (Object.hasOwn(COMBINE, code) ? COMBINE[code] : code)

/** `[code, label]` for the two combination rules, in the core's order. */
export const combineLabels = () => COMBINES.map((code) => [code, combineLabel(code)])

/** Every operator or combination rule the core offers that this file has no
 *  German word for. Empty is the rule, and a test asserts it. */
export const operatorLabelGaps = () => [
  ...OPERATORS.filter((code) => !Object.hasOwn(OPERATOR, code)),
  ...COMBINES.filter((code) => !Object.hasOwn(COMBINE, code)),
]

// ------------------------------------------------------- the Sort's two words
//
// The same relationship again, to the direction vocabulary closed in
// `core/steps/sort.js`: a raw `asc` in a select is the core talking to the user,
// and `directionLabelGaps()` is what fails instead.

const DIRECTION = Object.freeze(
  Object.assign(Object.create(null), {
    asc: 'Aufsteigend (A–Z, klein → groß, alt → neu)',
    desc: 'Absteigend (Z–A, groß → klein, neu → alt)',
  }),
)

export const directionLabel = (code) =>
  Object.hasOwn(DIRECTION, code) ? DIRECTION[code] : code

/** `[code, label]` for the two directions a sort key offers, in the core's order. */
export const directionLabels = () => DIRECTIONS.map((code) => [code, directionLabel(code)])

/** Every direction the core offers that this file has no German word for. Empty
 *  is the rule, and a test asserts it. */
export const directionLabelGaps = () => DIRECTIONS.filter((code) => !Object.hasOwn(DIRECTION, code))

// ------------------------------------------- which end the limit takes from
//
// The words name the *rows*, not the order: „Erste" and „Letzte" are what a
// person asks for („die letzten 10"), while `first`/`last` is what the config
// holds. The parenthetical is the part a user cannot see — every order this
// product produces puts what it could not read at the end.

const END = Object.freeze(
  Object.assign(Object.create(null), {
    first: 'Erste — vom Anfang der Reihenfolge',
    last: 'Letzte — vom Ende der Reihenfolge',
  }),
)

export const endLabel = (code) => (Object.hasOwn(END, code) ? END[code] : code)

/** `[code, label]` for the two ends a limit offers, in the core's order. */
export const endLabels = () => ENDS.map((code) => [code, endLabel(code)])

/** Every end the core offers that this file has no German word for. Empty is the
 *  rule, and a test asserts it. */
export const endLabelGaps = () => ENDS.filter((code) => !Object.hasOwn(END, code))

const GERMAN = Object.freeze(
  Object.assign(Object.create(null), {
    'graph.cycle': (v, nameOf) =>
      `${step(nameOf, v.sourceId)} → ${step(nameOf, v.targetId)} würde einen Kreis schließen: ` +
      `${step(nameOf, v.targetId)} liegt bereits vor ${step(nameOf, v.sourceId)}.`,
    'graph.self_connection': (v, nameOf) =>
      `${step(nameOf, v.id)} kann nicht mit sich selbst verbunden werden.`,
    'graph.source_takes_no_input': (v, nameOf) =>
      `${step(nameOf, v.targetId)} ist eine Quelle und nimmt keine Eingänge.`,
    'graph.already_connected': (v, nameOf) =>
      `${step(nameOf, v.sourceId)} liegt bereits an Eingang ${v.slot + 1} von ${step(nameOf, v.targetId)}.`,
    'graph.result_is_source': (v, nameOf) =>
      `${step(nameOf, v.id)} ist eine Quelle und kann nicht der Ergebnis-Step sein.`,
    'graph.max_inputs': (v, nameOf) =>
      `${step(nameOf, v.id)} nimmt höchstens ${inputs(v.max)}.`,
    'graph.min_inputs': (v, nameOf) =>
      `${step(nameOf, v.id)} braucht mindestens ${inputs(v.min)}.`,
    'graph.no_such_slot': (v, nameOf) =>
      `${step(nameOf, v.id)} hat keinen Eingang ${v.slot + 1}.`,
    'graph.slot_empty': (v, nameOf) =>
      `Eingang ${v.slot + 1} von ${step(nameOf, v.id)} ist bereits leer.`,
    // The one refusal that names a control rather than a rule: the button is
    // beside the select that shows what would be destroyed.
    'graph.slot_connected': (v, nameOf) =>
      `Eingang ${v.slot + 1} von ${step(nameOf, v.id)} ist belegt — bitte erst die Verbindung ` +
      `lösen, dann den Eingang entfernen.`,
    'graph.empty_name': (v, nameOf) =>
      `${step(nameOf, v.id)} braucht einen Namen — der alte bleibt stehen.`,
    'graph.unknown_step': (v) => `Es gibt keinen Step mit der Kennung ${q(v.id)}.`,
    'graph.unknown_kind': (v, nameOf) =>
      `${step(nameOf, v.id)} hat die unbekannte Step-Art ${q(v.kind)}.`,
    'graph.duplicate_id': (v) => `Die Kennung ${q(v.id)} ist bereits vergeben.`,
    // Named rather than merely forbidden: the control that removes a Source is in
    // the other pane, and a refusal that does not say where is a dead end.
    'graph.source_not_removable': (v, nameOf) =>
      `${step(nameOf, v.id)} ist eine Quelle — Quellen werden unter „Quellen“ entfernt, nicht im Editor.`,

    // The one code whose values carry a name: the node is gone, so there is
    // nothing left to resolve the id against.
    'graph.input_lost': (v, nameOf) =>
      `${step(nameOf, v.id)} hat ` +
      v.lost.map((l) => `an Eingang ${l.slot + 1} ${q(l.name)}`).join(' und ') +
      ` verloren.`,
    'graph.inputs_missing': (v, nameOf) =>
      `${step(nameOf, v.id)} braucht ${inputs(v.required)}, hat aber ${v.filled}.`,
    'graph.input_replaced': (v, nameOf) =>
      `Eingang ${v.slot + 1} von ${step(nameOf, v.id)} lag an ${step(nameOf, v.replaced)} — ` +
      `diese Verbindung ist jetzt gelöst.`,
    'graph.orphan': (v, nameOf) => `${step(nameOf, v.id)} trägt nicht zum Ergebnis bei.`,
    'graph.no_result': (v) =>
      v.steps === 1
        ? 'Kein Step ist als Ergebnis ausgewiesen — der vorhandene Step trägt zu nichts bei.'
        : `Kein Step ist als Ergebnis ausgewiesen — die ${v.steps} vorhandenen Steps tragen zu nichts bei.`,
    // Allowed, and said out loud (decided 2026-08-04). A Step consuming the same
    // upstream twice is a legitimate way to double a dataset; doubling it without
    // saying so is not. The sentence names the consequence rather than only the
    // shape, because the shape alone reads as a mistake the user did not make.
    'graph.duplicate_upstream': (v, nameOf) =>
      `${step(nameOf, v.id)} nimmt ${step(nameOf, v.upstream)} an ${slotList(v.slots)} — ` +
      `die Zeilen dieses Steps zählen dadurch mehrfach.`,
    'graph.not_configurable': (v, nameOf) =>
      `${step(nameOf, v.id)} hat nichts einzustellen — Quellen werden unter „Quellen“ eingerichtet, ` +
      `und für diese Step-Art gibt es noch keine Einstellungen.`,

    // ------------------------------------------------------- the Step kinds
    //
    // A Step emits its findings as codes with structured values (AD-13); the
    // sentences are here, beside the graph's, because a Step's mark is rendered
    // on the same card by the same map. `column` is a name rather than an id —
    // a column is not a Step and there is nothing to resolve it against.
    // **It names the column or the condition, never the field.** `field` is the
    // core's own word for a slot in a config object — `to`, `from`, `combine`,
    // `op` — and interpolating it put English on a German screen, which NFR-6
    // forbids and which an ordinary gesture reached: clearing a „Neuer Name“
    // field produced „… sind unvollständig (to)". The value stays in the
    // diagnostic as machine data; what a person is told is which control is
    // waiting for them.
    'step.config_invalid': (v) => {
      if (v.column !== undefined) {
        return `Für Spalte ${q(v.column)} fehlt der neue Name — die vorherige Einstellung bleibt in Kraft.`
      }
      // The one refusal a loaded Recipe reaches and a form cannot: the number
      // field only offers whole numbers from 1 upward, so `0`, `-1` and `2,5`
      // arrive from outside. The sentence names what a count is rather than
      // repeating what was wrong with the one that came.
      if (v.field === 'count') {
        return (
          'Die Anzahl muss eine ganze Zahl ab 1 sein — die vorherige Einstellung bleibt in Kraft.'
        )
      }
      // A Sort's keys and a Filter's conditions share this code, and `at` alone
      // cannot tell them apart — so the field decides which word the user reads.
      //
      // Two sentences rather than one, because the two states are not the same
      // state: a key with no column is an entry that has not finished, while a
      // key whose direction is neither of the two words is complete and wrong —
      // the shape a Recipe out of a language model arrives in. „Unvollständig"
      // over the second would send its author looking for something missing.
      if (v.field === 'direction') {
        return (
          `Sortierung ${v.at + 1} hat keine gültige Richtung — möglich sind „Aufsteigend“ und ` +
          `„Absteigend“. Die vorherige Einstellung bleibt in Kraft.`
        )
      }
      if (v.field === 'key') {
        return `Sortierung ${v.at + 1} ist unvollständig — die vorherige Einstellung bleibt in Kraft.`
      }
      if (v.at !== undefined) {
        return `Bedingung ${v.at + 1} ist unvollständig — die vorherige Einstellung bleibt in Kraft.`
      }
      return 'Die Einstellungen dieses Steps sind unvollständig — die vorherigen bleiben in Kraft.'
    },
    'step.rename_collision': (v) =>
      `Der Name ${q(v.name)} ist in diesem Step bereits vergeben — zwei Spalten können nicht gleich ` +
      `heißen. Die vorherige Einstellung bleibt in Kraft.`,
    // CAP-40's configure-time refusal. It names the column rather than the
    // position, because the user chose a word and the word is what is already
    // sorted by — and it says why a second key on one column cannot mean
    // anything, since "already taken" alone reads as an arbitrary restriction.
    'step.sort_key_repeated': (v) =>
      `Nach Spalte ${q(v.column)} wird in diesem Step schon sortiert — eine zweite Sortierung nach ` +
      `derselben Spalte ändert nichts. Die vorherige Einstellung bleibt in Kraft.`,
    'step.unknown_column': (v) =>
      `Es gibt keine Spalte ${q(v.column)} mehr im Eingang dieses Steps — bitte die Einstellungen prüfen.`,
    // CAP-15's refusal, and it names **both** types: one alone leaves the user
    // guessing which half to change.
    'step.type_mismatch': (v) =>
      `Spalte ${q(v.column)} hat den Typ ${typeLabel(v.columnType)}, der Vergleichswert ist ` +
      `${valueTypeText(v.valueType)}. querbeet rechnet hier nichts um — bitte den Wert anpassen.`,
    'step.value_unreadable': (v) =>
      `Der Vergleichswert ${q(String(v.value))} für Spalte ${q(v.column)} lässt sich nicht als ` +
      `${typeLabel(v.type)} lesen. Erwartet wird ${temporalFormText(v.type)}.`,
    // The verb follows the number here too: a Filter that removes nothing over a
    // one-row table is not an exotic case, it is the first thing a person builds.
    'step.rows_removed': (v) =>
      v.removed === 0
        ? `Keine Zeile entfernt — ${rows(v.kept)} ${v.kept === 1 ? 'bleibt' : 'bleiben'} übrig.`
        : `${rows(v.removed)} entfernt, ${rows(v.kept)} übrig.`,
    // The box never silently passes as text, and this is where that promise is
    // kept in words: the rows are named as dropped and the reason is the type.
    // German counts one of a thing differently, and the *verb* has to follow the
    // number as well as the noun — "1 Zeile wurden" is what a plural-only
    // sentence produces, and one unreadable value is the ordinary case.
    'step.boxed_rows_dropped': (v) =>
      v.rows === 1
        ? `1 Zeile wurde nicht verglichen, weil ihr Wert unter dem bestätigten Typ nicht lesbar ` +
          `ist — sie ist aus dem Ergebnis dieses Steps ausgeschlossen.`
        : `${rows(v.rows)} wurden nicht verglichen, weil ihr Wert unter dem bestätigten Typ nicht ` +
          `lesbar ist — sie sind aus dem Ergebnis dieses Steps ausgeschlossen.`,
    // The Sort's counterpart, and it is a *different* sentence because a box in
    // a sort key is placed rather than dropped: no row leaves this Step. The
    // wording says „hinter die lesbaren Werte" rather than „ganz am Ende",
    // because with two keys a box in the second one moves the row only within
    // its group — and a sentence that is true of one key and false of two is
    // exactly the kind of number this product must not print.
    'step.boxed_rows_last': (v) =>
      v.rows === 1
        ? `1 Zeile hat in einer Sortierspalte einen Wert, der unter dem bestätigten Typ nicht ` +
          `lesbar ist — sie wird nicht verglichen, sondern in beiden Richtungen hinter die ` +
          `lesbaren Werte gestellt.`
        : `${rows(v.rows)} haben in einer Sortierspalte einen Wert, der unter dem bestätigten Typ ` +
          `nicht lesbar ist — sie werden nicht verglichen, sondern in beiden Richtungen hinter die ` +
          `lesbaren Werte gestellt.`,
    // The limit's own warning, and it is about the rows that **stayed**. Every
    // order this product produces puts what it could not read at the end, so
    // „die letzten 3" after a sort is quite likely three unreadable rows — a
    // legitimate thing to ask for, and not a thing to discover by accident.
    'step.boxed_rows_kept': (v) =>
      v.rows === 1
        ? `1 der behaltenen Zeilen enthält einen Wert, der unter dem bestätigten Typ nicht lesbar ` +
          `ist. Nicht lesbare Werte stehen in jeder Sortierung am Ende — am Ende der Reihenfolge ` +
          `sind sie deshalb zuerst zu finden.`
        : `${nf(v.rows)} der behaltenen Zeilen enthalten einen Wert, der unter dem bestätigten ` +
          `Typ nicht lesbar ist. Nicht lesbare Werte stehen in jeder Sortierung am Ende — am Ende ` +
          `der Reihenfolge sind sie deshalb zuerst zu finden.`,

    // --------------------------------------------------------- the execution
    'exec.source_unconfirmed': (v, nameOf) =>
      `${step(nameOf, v.id)} ist noch nicht bestätigt — ohne Bestätigung rechnet querbeet nicht. ` +
      `Bitte unter „Quellen“ die Spaltentypen bestätigen.`,
    'exec.kind_not_executable': (v, nameOf) =>
      `${step(nameOf, v.id)} ist eine ${kindLabel(v.kind)} — diese Step-Art kann querbeet noch nicht ` +
      `ausführen. Solange sie zum Ergebnis beiträgt, wird nichts gerechnet.`,
    'exec.input_missing': (v, nameOf) =>
      `${step(nameOf, v.id)} hat an Eingang ${v.slot + 1} nichts liegen — dieser Step wurde nicht gerechnet.`,
    'exec.input_failed': (v, nameOf) =>
      `${step(nameOf, v.id)} konnte nicht gerechnet werden: ${step(nameOf, v.upstream)} an Eingang ` +
      `${v.slot + 1} hat kein Ergebnis geliefert.`,
    // A guard that was supposed to be unreachable. It says so plainly rather
    // than blaming the data — the user did nothing wrong and there is nothing
    // for them to correct — and it names the Step so a report has a subject.
    'exec.step_threw': (v, nameOf) =>
      `${step(nameOf, v.id)} (${kindLabel(v.kind)}) ist beim Rechnen mit einem internen Fehler ` +
      `abgebrochen. Das ist ein Fehler in querbeet, nicht in den Daten — die übrigen Steps wurden ` +
      `weiter gerechnet.`,
    // The run's own sentence, and the reason it exists: a Step's marks live in
    // that Step's panel, so a user with nothing selected would otherwise see a
    // pipeline that computed nothing and no reason anywhere on screen.
    'exec.run_incomplete': (v, nameOf) =>
      v.steps === 1
        ? `Der Lauf hat kein Ergebnis: ${step(nameOf, v.id)} konnte nicht gerechnet werden. ` +
          `Der Grund steht in den Einstellungen dieses Steps.`
        : `Der Lauf hat kein Ergebnis: ${v.steps} Steps konnten nicht gerechnet werden, ` +
          `beginnend mit ${step(nameOf, v.id)}. Die Gründe stehen in den Einstellungen des ` +
          `jeweiligen Steps.`,
    // The cancellation (AD-9). Three things have to be in it, and each of them is
    // a question a user would otherwise have to guess at: that the run stopped
    // because they said so, how far it got, and — the one that decides whether
    // cancelling is safe to press — that the numbers on screen are still the
    // previous run's rather than a half-computed set. The finished work stays in
    // the cache, so pressing it again costs nothing, and that is said too.
    //
    // **The count says what it counts, and that took two goes.** `total` is the
    // length of the walk's dependency order: the *contributing* nodes, Quellen
    // included, because Step zero is a node in the walk and that is precisely what
    // makes it cancellable. It is therefore neither the number of Steps in the
    // Pipeline nor a number the user can count on the canvas — round 1 shipped
    // „Von 46 Steps" (wrong about Quellen, and with „Von 1 Steps" and a hard-coded
    // „1" beside it), and round 2's „Von 11 Arbeitsschritten (Quellen mitgezählt)"
    // was still a total of nothing findable. So the sentence names the work *this
    // result needs* rather than a total of anything on screen.
    'exec.run_cancelled': (v) => {
      const done =
        v.done === 0
          ? 'war noch keiner fertig gerechnet'
          : v.done === 1
            ? `war ${nf(v.done)} fertig gerechnet`
            : `waren ${nf(v.done)} fertig gerechnet`
      return (
        `Der Lauf wurde abgebrochen. Für das Ergebnis ${workNeeded(v.total)} nötig ` +
        `(Quellen mitgezählt); davon ${done}. Die fertigen Ergebnisse bleiben gespeichert — ` +
        `angezeigt wird weiterhin das Ergebnis des vorherigen Laufs.`
      )
    },
  }),
)

/** The German for the *kind* of value a comparison carried. Three words, because
 *  `valueKind` in `core/steps/filter.js` answers in three — and `unknown` is the
 *  fourth state, where the config holds something that is no comparison value at
 *  all. */
const VALUE_TYPE = Object.freeze(
  Object.assign(Object.create(null), {
    number: 'eine Zahl',
    text: 'ein Text',
    boolean: 'ein Wahrheitswert',
    unknown: 'kein vergleichbarer Wert',
  }),
)

const valueTypeText = (kind) =>
  Object.hasOwn(VALUE_TYPE, kind) ? VALUE_TYPE[kind] : 'ein Wert anderer Art'

/** What a temporal comparison value has to look like. Named rather than merely
 *  refused: „lässt sich nicht lesen" without the expected shape is a dead end. */
const TEMPORAL_FORM = Object.freeze(
  Object.assign(Object.create(null), {
    date: 'JJJJ-MM-TT (zum Beispiel 2025-12-31)',
    datetime: 'JJJJ-MM-TT HH:MM (zum Beispiel 2025-12-31 14:30)',
    time: 'HH:MM (zum Beispiel 14:30)',
    duration: 'Stunden:Minuten (zum Beispiel 36:30)',
  }),
)

const temporalFormText = (type) =>
  Object.hasOwn(TEMPORAL_FORM, type) ? TEMPORAL_FORM[type] : 'die kanonische Schreibweise'

/**
 * The German sentence for a Diagnostic out of `core/graph`.
 *
 * `nameOf` resolves a Step id against the graph the caller is rendering. The
 * fallback is a German sentence too — `?? code` would be the core talking to the
 * user, which is the state the gap function below exists to prevent.
 */
export const graphText = (diagnostic, nameOf = (id) => id) =>
  Object.hasOwn(GERMAN, diagnostic.code)
    ? GERMAN[diagnostic.code](diagnostic.values, nameOf)
    : 'Unbekannte Meldung aus dem Kern.'

/**
 * The line a run in flight puts on screen — „Rechnet Filter „Nur Große“ (4 von
 * 46)“.
 *
 * Not a Diagnostic and therefore not in the map above: progress is a state, not
 * something the core reported, and `graphLabelGaps()` has nothing to check it
 * against. It lives here all the same, because German lives here.
 *
 * **It names the *kind* rather than calling everything a Step**, for the reason
 * `exec.run_cancelled` above states: the walk contains Quellen, and „Rechnet Step
 * 1 von 46: „gross““ for a Quelle is the interface being wrong about what it is
 * doing.
 *
 * **The two halves come from two places, and a reader should know which.** The
 * kind and the position are the walk's — `core/exec/execute.js` yields them, so
 * they describe the node the run is actually in front of. The *name* is not: it is
 * resolved through `nameOf` against the graph the pane is rendering right now, the
 * same way every sentence in this file resolves one, so a Step renamed mid-run
 * reports its new name. That is the behaviour the file wants (a name frozen into a
 * message goes stale), and it is worth saying because the mixture is not obvious.
 *
 * The position is a position and carries no noun — `done` is how many are
 * finished, so `done + 1` is the one being computed — and `total` is the run's own
 * length, which is the contributing subset rather than the size of the Pipeline.
 * A transient line naming the node it is working on can carry that; the
 * cancellation sentence, which is read after the fact, spells it out instead.
 */
export const progressText = (at, nameOf = (id) => id) => {
  const label = kindLabel(at.kind)
  const what = at.kind && label !== at.kind ? `${label} ` : ''
  return `Rechnet ${what}${step(nameOf, at.stepId)} (${nf(at.done + 1)} von ${nf(at.total)})`
}

/**
 * Every code the Editor can put on screen that this file has no sentence for.
 * Empty is the rule, and a test asserts it.
 *
 * Three enumerations rather than one, because three modules emit into this map:
 * the graph model, the Step kinds and the executor. Each builds its list out of
 * the constants its own emit sites use, so none of them can drift from what it
 * actually emits — and adding a fourth producer means adding it here, which is a
 * visible edit rather than a silent gap.
 */
export const graphLabelGaps = () =>
  [...GRAPH_CODES, ...STEP_CODES, ...EXEC_CODES].filter((code) => !Object.hasOwn(GERMAN, code))

/** Every severity gets a German label and its own colour: CAP-34 requires a
 *  glance-level distinction, and an enum rendered raw is the core talking to the
 *  user (C-6). */
export const SEVERITY = Object.freeze({
  info: { label: 'Hinweis', tone: 'text-slate-500' },
  warning: { label: 'Warnung', tone: 'text-amber-600' },
  error: { label: 'Fehler', tone: 'text-red-600' },
  unresolved: { label: 'Ungeklärt', tone: 'text-violet-600' },
})
