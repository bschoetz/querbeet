// The pane's own execution: the toolbar, the refusal region, the reconciliation
// watcher, and the placement rule that only breaks across a remount.
//
// happy-dom, `--project ui` (AD-27). The canvas arrives as a prop, so this
// envelope can drive the pane without a `GraphView` implementation at all —
// which is the same seam that keeps `ui/` from importing an adapter (AD-1).

import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { createStepZeroCache } from '@core/exec/convert.js'
import { createGraphStore } from '@core/graph/graph-store.js'
import EditorPane from './EditorPane.vue'

/** A canvas that renders the node bodies and nothing else. It stands in for the
 *  Vue Flow adapter exactly at the port's surface: it takes the two projections
 *  and the guard, and it emits the three change reports. */
const StubCanvas = {
  name: 'StubCanvas',
  props: { nodes: { type: Array }, edges: { type: Array }, guard: { type: Function } },
  emits: ['connect', 'refused', 'move', 'remove', 'disconnect'],
  setup(props, { slots }) {
    return () =>
      h(
        'div',
        { class: 'stub-canvas' },
        props.nodes.map((node) => h('div', { key: node.id }, slots.step?.({ node }))),
      )
  },
}

/**
 * The engine and the Step-zero cache the pane executes through.
 *
 * A stub, and a deliberately inert one: the cases below are about the pane's own
 * execution — the toolbar, the refusal region, the reconciliation watcher — and
 * the Sources they use are name-and-id shapes with no typing at all, so Step zero
 * answers `null` for every one of them and no run gets past gate 1. That is the
 * right envelope for these cases; the executor is exercised in
 * `core/exec/execute.test.js` and the whole chain in `tests/e2e/execution.spec.js`.
 */
const stubEngine = () => ({
  fromColumns: (columns) => ({ columns }),
  filter: () => ({ table: null, removed: 0, boxed: 0, unreadable: [] }),
  selectColumns: () => ({}),
})

const render = (graph, sources = []) =>
  mount(EditorPane, {
    props: {
      graph,
      sources,
      canvas: StubCanvas,
      engine: stubEngine(),
      stepZero: createStepZeroCache(stubEngine()),
    },
  })

const refusal = (w) => w.find('[data-testid="editor-refusal"]').text()
const cards = (w) => w.findAll('[data-testid="step-card"]')
const cardFor = (w, id) => w.find(`[data-testid="step-card"][data-node="${id}"]`)
const toolbarButton = (w, label) => w.findAll('button').find((b) => b.text() === label)

describe('the toolbar', () => {
  it('offers a button per addable kind, in German, and no Source', () => {
    const w = render(createGraphStore())
    const labels = w.findAll('button').map((b) => b.text())

    expect(labels).toContain('+ Union')
    expect(labels).toContain('+ Join')
    expect(labels).toContain('+ Berechnete Spalte')
    expect(labels).not.toContain('+ Quelle')
  })

  it('adds a Step through the command and re-projects', async () => {
    const graph = createGraphStore()
    const w = render(graph)

    await toolbarButton(w, '+ Filter').trigger('click')

    expect(graph.list()).toHaveLength(1)
    expect(cards(w)).toHaveLength(1)
    expect(cards(w)[0].text()).toContain('Filter')
  })
})

describe('placement across a remount', () => {
  it('does not put the next Step on top of an existing one', async () => {
    // This story unmounts the Editor on every view switch. A counter held in
    // component state restarts at zero, and the next Step lands exactly on the
    // first — the overlap that no other test in the tree can see.
    const graph = createGraphStore()

    const first = render(graph)
    await toolbarButton(first, '+ Filter').trigger('click')
    first.unmount()

    const second = render(graph)
    await toolbarButton(second, '+ Filter').trigger('click')
    second.unmount()

    const [a, b] = graph.list()
    expect(graph.list()).toHaveLength(2)
    expect({ x: b.x, y: b.y }).not.toEqual({ x: a.x, y: a.y })
  })
})

describe('the refusal region', () => {
  it('renders a refused command as a German sentence, announced', async () => {
    const graph = createGraphStore()
    const join = graph.addStep('join', { name: 'Join' }).id
    const w = render(graph)

    await w
      .find(`[data-node="${join}"]`)
      .findAll('button')
      .find((b) => b.text() === 'Eingang hinzufügen')
      .trigger('click')

    expect(w.find('[data-testid="editor-refusal"]').attributes('role')).toBe('status')
    expect(refusal(w)).toContain('Fehler')
    expect(refusal(w)).toContain('„Join“ nimmt höchstens 2 Eingänge.')
  })

  it('says nothing about a position or a removal the canvas reported on its own', async () => {
    // Under design B the canvas reports about nodes it measured a frame ago, so
    // a change for a Step just deleted is a race between two truthful views.
    const graph = createGraphStore()
    const w = render(graph)
    const canvas = w.findComponent(StubCanvas)

    canvas.vm.$emit('move', 'ghost', 10, 20)
    canvas.vm.$emit('remove', 'ghost')
    canvas.vm.$emit('disconnect', 'ghost', 0)
    await nextTick()

    expect(refusal(w)).toBe('')
  })

  it('names a cycle when the pointer drop is refused, through the same command', async () => {
    const graph = createGraphStore()
    graph.syncSources([{ id: 'src:a', name: 'A' }])
    const union = graph.addStep('union', { name: 'Halbjahr' }).id
    const filter = graph.addStep('filter', { name: 'Nur Bestand' }).id
    graph.connect(union, filter, 0)

    const w = render(graph)
    w.findComponent(StubCanvas).vm.$emit('refused', filter, union, 0)
    await nextTick()

    expect(refusal(w)).toContain('würde einen Kreis schließen')
    expect(graph.get(union).inputs).toEqual([null, null])
  })
})

describe('the state the graph reports about itself', () => {
  it('names a missing Result designation rather than leaving the marks unexplained', async () => {
    const graph = createGraphStore()
    // The first Step that could be a Result becomes one, so the state is reached
    // by removing *that* Step and leaving another standing.
    const first = graph.addStep('filter', { name: 'Nur Bestand' }).id
    graph.addStep('filter', { name: 'Nur Lager' })
    graph.removeStep(first)
    expect(graph.resultId()).toBeNull()
    const w = render(graph)

    expect(w.find('[data-testid="editor-status"]').text()).toContain(
      'Kein Step ist als Ergebnis ausgewiesen',
    )
    expect(w.find('[data-testid="editor-status"]').text()).toContain('Ungeklärt')
  })

  it("renders a Step's own marks on its own card", async () => {
    const graph = createGraphStore()
    graph.syncSources([
      { id: 'src:a', name: 'Umsatz Q1' },
      { id: 'src:b', name: 'Umsatz Q2' },
    ])
    const union = graph.addStep('union', { name: 'Halbjahr' }).id
    graph.connect('src:a', union, 0)
    graph.connect('src:b', union, 1)

    const w = render(graph, [
      { id: 'src:a', name: 'Umsatz Q1' },
      { id: 'src:b', name: 'Umsatz Q2' },
    ])
    await w.setProps({ sources: [{ id: 'src:a', name: 'Umsatz Q1' }] })

    expect(cardFor(w, union).text()).toContain('„Halbjahr“ hat an Eingang 2 „Umsatz Q2“ verloren.')
  })
})

describe('the Sources', () => {
  it('are reconciled on mount', () => {
    const graph = createGraphStore()
    const w = render(graph, [{ id: 'src:a', name: 'Umsatz Q1' }])

    expect(graph.list().map((s) => s.id)).toEqual(['src:a'])
    expect(cardFor(w, 'src:a').get('input[aria-label="Name"]').element.value).toBe('Umsatz Q1')
  })

  it('are not marked as contributing to nothing before there is anything to contribute to', () => {
    // Two freshly loaded CSVs and no Step yet: „…trägt nicht zum Ergebnis bei."
    // on every card is a state the user cannot act on, because there is no Step
    // to designate. `graph.no_result` is what names that state, once.
    const graph = createGraphStore()
    const w = render(graph, [
      { id: 'src:a', name: 'Umsatz Q1' },
      { id: 'src:b', name: 'Umsatz Q2' },
    ])

    expect(w.findAll('[data-testid="step-mark"]')).toHaveLength(0)
    expect(w.find('[data-testid="editor-status"]').exists()).toBe(false)
  })

  it('are reconciled again whenever the list changes, not only on mount', async () => {
    // A file that finishes parsing while the Editor is open would otherwise stay
    // invisible until the pane was left and re-entered.
    const graph = createGraphStore()
    const w = render(graph, [{ id: 'src:a', name: 'Umsatz Q1' }])

    await w.setProps({
      sources: [
        { id: 'src:a', name: 'Umsatz Q1' },
        { id: 'src:b', name: 'Umsatz Q2' },
      ],
    })

    expect(cardFor(w, 'src:b').exists()).toBe(true)
    await w.setProps({ sources: [{ id: 'src:a', name: 'Neuer Name' }] })
    expect(cardFor(w, 'src:b').exists()).toBe(false)
    expect(cardFor(w, 'src:a').attributes('aria-label')).toBe('Quelle: Neuer Name')
  })
})

describe('the slot row, end to end through the pane', () => {
  it('issues connect with the right slot index and the right Step', async () => {
    const graph = createGraphStore()
    const w = render(graph, [
      { id: 'src:a', name: 'Umsatz Q1' },
      { id: 'src:b', name: 'Umsatz Q2' },
    ])
    await toolbarButton(w, '+ Union').trigger('click')
    const union = graph.list().find((s) => s.kind === 'union').id

    const selects = cardFor(w, union).findAll('[data-testid="step-slot"] select')
    await selects[1].setValue('src:b')

    expect(graph.get(union).inputs).toEqual([null, 'src:b'])
  })

  it('says what a replacement displaced, rather than dropping it on the floor', async () => {
    // The one `info` in the map, and the only place it is rendered.
    const graph = createGraphStore()
    const w = render(graph, [
      { id: 'src:a', name: 'Umsatz Q1' },
      { id: 'src:b', name: 'Umsatz Q2' },
    ])
    await toolbarButton(w, '+ Filter').trigger('click')
    const filter = graph.list().find((s) => s.kind === 'filter').id

    const row = () => cardFor(w, filter).findAll('[data-testid="step-slot"] select')[0]
    await row().setValue('src:a')
    await row().setValue('src:b')

    expect(refusal(w)).toContain('Hinweis')
    expect(refusal(w)).toContain('lag an „Umsatz Q1“')
    expect(graph.get(filter).inputs).toEqual(['src:b'])
  })

  it('offers only what the guard accepts — the same guard the canvas is handed', async () => {
    const graph = createGraphStore()
    const w = render(graph, [{ id: 'src:a', name: 'Umsatz Q1' }])
    await toolbarButton(w, '+ Union').trigger('click')
    await toolbarButton(w, '+ Filter').trigger('click')

    const union = graph.list().find((s) => s.kind === 'union').id
    const filter = graph.list().find((s) => s.kind === 'filter').id
    graph.connect(union, filter, 0)
    await w.setProps({ sources: [{ id: 'src:a', name: 'Umsatz Q1' }] }) // force a re-read
    await nextTick()

    const options = cardFor(w, union)
      .findAll('[data-testid="step-slot"] select')[0]
      .findAll('option')
      .map((o) => o.attributes('value'))

    expect(options).not.toContain(filter) // it would close a cycle
    expect(options).toContain('src:a')
    // …and the canvas is handed the very same answer.
    const guard = w.findComponent(StubCanvas).props('guard')
    expect(guard(filter, union, 0)).toBe(false)
    expect(guard('src:a', union, 0)).toBe(true)
  })
})

// ------------------------------------------------- the interim recompute rule
//
// Until story 7's scheduler brings AD-29's mode gate and its row threshold,
// execution recomputes after every **data-affecting** change and after nothing
// else. That rule is invisible to every other envelope: an e2e run cannot tell a
// recomputed number from an unchanged one, and the whole point is that the
// unchanged ones cost 263–446 ms each at the design scale. Here the engine can
// be counted.

describe('what recomputes and what does not', () => {
  /** A `Table` handle wide enough for the executor and the panel. */
  const handle = (names) => ({
    rowCount: () => 2,
    schema: () => names.map((name) => ({ name, type: 'text' })),
    column: () => [],
    *rows() {
      yield Object.fromEntries(names.map((name) => [name, 'x']))
      yield Object.fromEntries(names.map((name) => [name, 'y']))
    },
  })

  /** An engine that counts the verbs a run asks it for. */
  const countingEngine = () => {
    const calls = { filter: 0, selectColumns: 0 }
    return {
      calls,
      fromColumns: () => handle(['a']),
      filter: (table) => {
        calls.filter += 1
        return { table, removed: 0, boxed: 0, unreadable: [] }
      },
      selectColumns: (table) => {
        calls.selectColumns += 1
        return table
      },
    }
  }

  const withEngine = (graph, engine, sources = [{ id: 'src:a', name: 'Umsatz Q1' }]) =>
    mount(EditorPane, {
      props: {
        graph,
        sources,
        canvas: StubCanvas,
        engine,
        // A cache stand-in that always answers: what is under test is the number
        // of runs, not Step zero.
        stepZero: { of: (entry) => (entry ? { table: handle(['Kunde', 'Betrag']) } : null) },
      },
    })

  const wired = () => {
    const graph = createGraphStore()
    graph.syncSources([{ id: 'src:a', name: 'Umsatz Q1' }])
    const filter = graph.addStep('filter', { name: 'Nur Große' }).id
    graph.connect('src:a', filter, 0)
    graph.setResult(filter)
    return { graph, filter }
  }

  it('recomputes when a Step is connected', async () => {
    const { graph } = wired()
    const engine = countingEngine()
    const w = withEngine(graph, engine)
    const before = engine.calls.filter

    await w.find('[data-testid="step-slot"] select').setValue('')
    expect(engine.calls.filter).toBe(before) // disconnected: nothing to filter
    await w.find('[data-testid="step-slot"] select').setValue('src:a')
    expect(engine.calls.filter).toBe(before + 1)
  })

  it('recomputes for a configuration change', async () => {
    const { graph, filter } = wired()
    const engine = countingEngine()
    withEngine(graph, engine)
    const before = engine.calls.filter

    graph.configureStep(filter, { combine: 'all', conditions: [] })
    expect(engine.calls.filter).toBe(before)
  })

  it('does not recompute for a rename or a move', async () => {
    // A rename changes a word on a card and a move changes two numbers. Neither
    // changes what the Pipeline computes, and both are issued at pointer and
    // keystroke frequency.
    const { graph, filter } = wired()
    const engine = countingEngine()
    const w = withEngine(graph, engine)
    const before = engine.calls.filter

    const name = cardFor(w, filter).get('input[aria-label="Name"]')
    name.element.value = 'Nur Bestand'
    await name.trigger('change')
    w.findComponent(StubCanvas).vm.$emit('move', filter, 120, 240)
    await nextTick()

    expect(graph.get(filter).name).toBe('Nur Bestand')
    expect(graph.get(filter).x).toBe(120)
    expect(engine.calls.filter).toBe(before)
  })
})
