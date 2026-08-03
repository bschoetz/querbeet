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

import { GRAPH_CODES } from '@core/graph/graph.js'
import { addableKinds, kindCodes } from '@core/graph/kinds.js'

const KIND = Object.freeze(
  Object.assign(Object.create(null), {
    source: 'Quelle',
    union: 'Union',
    join: 'Join',
    filter: 'Filter',
    columns: 'Spalten',
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
const inputs = (n) => (n === 1 ? '1 Eingang' : `${n} Eingänge`)

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
  }),
)

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

/** Every code `core/graph` can emit that this file has no sentence for. Empty is
 *  the rule, and a test asserts it. */
export const graphLabelGaps = () => GRAPH_CODES.filter((code) => !Object.hasOwn(GERMAN, code))

/** Every severity gets a German label and its own colour: CAP-34 requires a
 *  glance-level distinction, and an enum rendered raw is the core talking to the
 *  user (C-6). */
export const SEVERITY = Object.freeze({
  info: { label: 'Hinweis', tone: 'text-slate-500' },
  warning: { label: 'Warnung', tone: 'text-amber-600' },
  error: { label: 'Fehler', tone: 'text-red-600' },
  unresolved: { label: 'Ungeklärt', tone: 'text-violet-600' },
})
