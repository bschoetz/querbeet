// The pane's own execution: the toolbar, the refusal region, the reconciliation
// watcher, and the placement rule that only breaks across a remount.
//
// happy-dom, `--project ui` (AD-27). The canvas arrives as a prop, so this
// envelope can drive the pane without a `GraphView` implementation at all —
// which is the same seam that keeps `ui/` from importing an adapter (AD-1).

import { flushPromises, mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { createRunCache } from '@core/exec/cache.js'
import { createStepZeroCache } from '@core/exec/convert.js'
import { createGraphStore } from '@core/graph/graph-store.js'
import EditorPane from './EditorPane.vue'
import StepPanel from './StepPanel.vue'

// ------------------------------------------------------- the two ports a run needs
//
// Story 7b made execution asynchronous, so this pane now takes a `Clock` and a
// `Yield` (AD-25, AD-9). Both are stood in for here, and neither stand-in is a
// timer: **this repository has never used fake timers and still does not need
// any**, which is the whole architectural argument for an injected yield.

/**
 * A stopped clock. `at` is milliseconds and a case moves it by assignment, which
 * is how the 150 ms reveal delay is reached without waiting 150 ms.
 */
const testClock = () => {
  let minted = 0
  return { at: 0, now() { return this.at }, runId: () => `run:${(minted += 1)}` }
}

/**
 * A `Yield` that resolves on the microtask queue.
 *
 * **Deliberately not what the product uses**, and it is safe here for one reason:
 * these cases are about *which commands start a run* and *what the pane does with
 * the answer*, never about whether a click is delivered between Steps. The
 * macrotask contract is what `adapters/scheduler/queue-yield.test.js` pins and
 * what `tests/e2e/execution.spec.js` exercises in the engines that have an input
 * queue at all. What this buys is that `flushPromises()` — a macrotask — drains a
 * whole run, so a case reads exactly as it did before execution became async.
 */
const instantYield = () => ({ next: () => Promise.resolve() })

/**
 * A `Yield` the case releases by hand, one Step at a time.
 *
 * `next()` hands out a promise and keeps its resolver; `release()` lets exactly
 * one Step through and then drains what that Step queued. So a case can stand a
 * run still in the middle of the walk, do something to it, and see what happens —
 * which is what every cancellation case needs and what no timer would give it.
 */
const handYield = () => {
  const waiting = []
  return {
    next: () => new Promise((resolve) => waiting.push(resolve)),
    /** How many Steps are waiting to start. */
    pending: () => waiting.length,
    async release(times = 1) {
      for (let i = 0; i < times; i += 1) {
        // Wait for the run to be *waiting* first, so `release(2)` means "two more
        // Steps ran" rather than "two resolvers were called at some point".
        await flushPromises()
        waiting.shift()?.()
      }
      await flushPromises()
    },
    /**
     * Release the yield that was asked for **last**, which is the newest run's.
     *
     * **This is not an order the shipped yielder produces, and saying so is the
     * point of this paragraph** (review round 1 said the opposite). One
     * `MessageChannel` pair serves every run and its messages arrive in the order
     * they were posted, so the superseded run — which asked first — always resumes
     * first, finds its cancellation flag set, and resolves *before* the run that
     * replaced it. In `file://` there is no way to make an older run's outcome
     * land last.
     *
     * What this ordering stands in for is therefore not a state but a property:
     * **the publish rule must be the generation and not the arrival order.** A
     * pane that dropped a superseded outcome merely because it happened to arrive
     * first would pass every case using `release` and be wrong the day a yield
     * stops being FIFO — a second channel, a host-supplied `Yield`, a run
     * interrupted by something that resolves out of band. `release` covers the
     * order the adapter produces; this covers the rule.
     */
    async releaseLast(times = 1) {
      for (let i = 0; i < times; i += 1) {
        await flushPromises()
        waiting.pop()?.()
      }
      await flushPromises()
    },
  }
}

/** A canvas that renders the node bodies and nothing else. It stands in for the
 *  Vue Flow adapter exactly at the port's surface: it takes the two projections
 *  and the guard, and it emits the three change reports. */
const StubCanvas = {
  name: 'StubCanvas',
  props: { nodes: { type: Array }, edges: { type: Array }, guard: { type: Function } },
  emits: ['connect', 'refused', 'move', 'remove', 'disconnect', 'select'],
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
      clock: testClock(),
      yielder: instantYield(),
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

  // Awaited, because a run is asynchronous as of story 7b and the count a case
  // starts from is the count after the mount's own run has finished. The
  // assertions below are otherwise exactly what they were.
  // The entry carries `typing.confirmed`, because gate 1 asks the *entry* now
  // rather than asking for a converted table (story 7b, review round 1): the
  // conversion is what costs 548–555 ms, and the gate runs above the walk's first
  // yield. A fixture that answers for the door must answer for the predicate too,
  // which is the same thing as saying it has to look like an entry the store
  // minted.
  const withEngine = async (
    graph,
    engine,
    sources = [{ id: 'src:a', name: 'Umsatz Q1', typing: { columns: [], confirmed: true } }],
  ) => {
    const w = mount(EditorPane, {
      props: {
        graph,
        sources,
        canvas: StubCanvas,
        engine,
        // A cache stand-in that always answers: what is under test is the number
        // of runs, not Step zero.
        stepZero: { of: (entry) => (entry ? { table: handle(['Kunde', 'Betrag']) } : null) },
        clock: testClock(),
        yielder: instantYield(),
      },
    })
    await flushPromises()
    return w
  }

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
    const w = await withEngine(graph, engine)
    const before = engine.calls.filter

    await w.find('[data-testid="step-slot"] select').setValue('')
    await flushPromises()
    expect(engine.calls.filter).toBe(before) // disconnected: nothing to filter
    await w.find('[data-testid="step-slot"] select').setValue('src:a')
    await flushPromises()
    expect(engine.calls.filter).toBe(before + 1)
  })

  it('recomputes for a configuration change', async () => {
    // **Through the panel, not through the store.** The previous version of this
    // case called `graph.configureStep` directly — which the pane never hears
    // about — and then asserted that nothing recomputed, so it was
    // shape-identical to its neighbour below and pinned the opposite of its own
    // name. The rule the interim recompute list most needs pinned had no test.
    const { graph, filter } = wired()
    const engine = countingEngine()
    const w = await withEngine(graph, engine)

    w.findComponent(StubCanvas).vm.$emit('select', filter)
    await nextTick()

    const panel = w.findComponent(StepPanel)
    expect(panel.exists()).toBe(true)
    const before = engine.calls.filter

    panel.vm.$emit('configure', { combine: 'any', conditions: [] })
    await flushPromises()

    expect(graph.get(filter).config).toEqual({ combine: 'any', conditions: [] })
    expect(engine.calls.filter).toBe(before + 1)
  })

  it('does not recompute for a rename or a move', async () => {
    // A rename changes a word on a card and a move changes two numbers. Neither
    // changes what the Pipeline computes, and both are issued at pointer and
    // keystroke frequency.
    const { graph, filter } = wired()
    const engine = countingEngine()
    const w = await withEngine(graph, engine)
    const before = engine.calls.filter

    const name = cardFor(w, filter).get('input[aria-label="Name"]')
    name.element.value = 'Nur Bestand'
    await name.trigger('change')
    w.findComponent(StubCanvas).vm.$emit('move', filter, 120, 240)
    await flushPromises()

    expect(graph.get(filter).name).toBe('Nur Bestand')
    expect(graph.get(filter).x).toBe(120)
    expect(engine.calls.filter).toBe(before)
  })

  // ------------------------------------------------ the cache, as the pane wires it
  //
  // What is under test here is the *wiring*, not the cache: that the pane hands
  // `executeGraph` a cache it does not own and a Source key derived in `core/`
  // from the registry entry. The cache's own semantics are
  // `core/exec/cache.test.js`'s and the executor's are
  // `core/exec/execute.test.js`'s.

  /** A registry entry as the store mints one, cut down to the fields a key is
   *  made of. `byteDigest` is what makes it keyable at all. */
  const entry = (over = {}) => ({
    id: 'src:a',
    name: 'Umsatz Q1',
    byteDigest: '0123456789abcdef0123456789abcdef',
    parseConfig: { delimiter: ',', headerRow: 1, sheet: null },
    encoding: { chosen: 'utf-8', source: 'probe', override: null },
    typing: { columns: [], confirmed: true },
    ...over,
  })

  const withCache = async (graph, engine, sources, cache) => {
    const w = mount(EditorPane, {
      props: {
        graph,
        sources,
        canvas: StubCanvas,
        engine,
        stepZero: { of: (e) => (e ? { table: handle(['Kunde', 'Betrag']) } : null) },
        cache,
        clock: testClock(),
        yielder: instantYield(),
      },
    })
    await flushPromises()
    return w
  }

  it('answers a configuration returned to a previous value from the cache', async () => {
    const { graph, filter } = wired()
    const engine = countingEngine()
    const w = await withCache(graph, engine, [entry()], createRunCache())

    w.findComponent(StubCanvas).vm.$emit('select', filter)
    await nextTick()
    const panel = w.findComponent(StepPanel)
    const before = engine.calls.filter

    panel.vm.$emit('configure', { combine: 'any', conditions: [] })
    await flushPromises()
    expect(engine.calls.filter).toBe(before + 1)

    // Back to the default the first run already computed. Nothing to do.
    panel.vm.$emit('configure', { combine: 'all', conditions: [] })
    await flushPromises()
    expect(engine.calls.filter).toBe(before + 1)
  })

  it('misses when the delimiter was corrected and the Source re-parsed', async () => {
    // **A re-parse, which is a state the store actually produces** —
    // `reconfigureParse` re-reads the retained bytes under a new delimiter and
    // commits a new entry under the same id. The earlier version of this case
    // changed the *byte digest* under a fixed id instead, which no store command
    // can do (a new file is a new `addSource` with a newly minted id, AD-14), so
    // it named a state the Code Map rules out. The digest half of that key is
    // covered where it belongs, as a `sourceKey` property in
    // `core/exec/cache-key.test.js`.
    const { graph } = wired()
    const engine = countingEngine()
    const cache = createRunCache()
    const w = await withCache(graph, engine, [entry()], cache)
    const before = engine.calls.filter

    await w.setProps({
      sources: [entry({ parseConfig: { delimiter: ';', headerRow: 1, sheet: null } })],
    })
    await flushPromises()

    expect(engine.calls.filter).toBe(before + 1)
  })

  it('serves the same Source unchanged, so a re-projection computes nothing', async () => {
    const { graph } = wired()
    const engine = countingEngine()
    const w = await withCache(graph, engine, [entry()], createRunCache())
    const before = engine.calls.filter

    await w.setProps({ sources: [entry()] }) // a fresh object, the same Source
    await flushPromises()

    expect(engine.calls.filter).toBe(before)
  })
})

// ------------------------------------------------ the scheduler, as the pane drives it
//
// What is under test here is the *wiring*, not the scheduler: that the pane starts
// a run rather than calling one, cancels the one in flight before starting
// another, publishes only the newest, lets go on unmount, and renders the progress
// line and the cancel control on the terms the story sets. The scheduler's own
// semantics are `core/exec/scheduler.test.js`'s and the message queue's are
// `adapters/scheduler/queue-yield.test.js`'s.

describe('the run, in flight', () => {
  /** A `Table` handle whose row count says which call produced it, so "the pane is
   *  still showing the previous run's numbers" is an assertion rather than a hope. */
  const handle = (rows) => ({
    rowCount: () => rows,
    schema: () => [{ name: 'Kunde', type: 'text' }],
    column: () => [],
    *rows() {
      yield { Kunde: 'x' }
    },
  })

  const countingEngine = () => {
    const calls = { fromColumns: 0, filter: 0, selectColumns: 0 }
    return {
      calls,
      fromColumns: () => {
        calls.fromColumns += 1
        return handle(100)
      },
      filter: (table) => {
        calls.filter += 1
        return { table, removed: 0, boxed: 0, unreadable: [] }
      },
      selectColumns: () => {
        calls.selectColumns += 1
        return handle(calls.selectColumns)
      },
    }
  }

  /** A registry entry as the store mints one, cut to the fields a key is made of. */
  const entry = () => ({
    id: 'src:a',
    name: 'Umsatz Q1',
    byteDigest: '0123456789abcdef0123456789abcdef',
    parseConfig: { delimiter: ',', headerRow: 1, sheet: null },
    encoding: { chosen: 'utf-8', source: 'probe', override: null },
    typing: { columns: [], confirmed: true },
  })

  /** Source → Filter → Columns: three nodes, so a run can be stopped with some of
   *  them done and some not. */
  const wired = () => {
    const graph = createGraphStore()
    graph.syncSources([{ id: 'src:a', name: 'Umsatz Q1' }])
    const filter = graph.addStep('filter', { name: 'Nur Große' }).id
    const columns = graph.addStep('columns', { name: 'Nur Kunde' }).id
    graph.connect('src:a', filter, 0)
    graph.connect(filter, columns, 0)
    graph.configureStep(columns, { columns: [{ from: 'Kunde', to: 'Kunde' }] })
    graph.setResult(columns)
    return { graph, filter, columns }
  }

  const paneWith = (graph, { engine, yielder, clock, stepZero, sources }) =>
    mount(EditorPane, {
      props: {
        graph,
        sources: sources ?? [entry()],
        canvas: StubCanvas,
        engine,
        stepZero: stepZero ?? { of: (e) => (e ? { table: handle(100) } : null) },
        clock,
        yielder,
      },
    })

  const progressLine = (w) => w.find('[data-testid="editor-progress"]')
  const cancelButton = (w) => w.find('[data-testid="editor-cancel"]')
  const statusText = (w) =>
    w
      .findAll('[data-testid="editor-status"]')
      .map((p) => p.text())
      .join('\n')
  /** What the panel is showing for a Step — the run's own answer, read through the
   *  component that renders it rather than through the pane's internals. */
  const shownFor = async (w, id) => {
    w.findComponent(StubCanvas).vm.$emit('select', id)
    await nextTick()
    return w.findComponent(StepPanel).props('result')
  }

  it('says nothing at all about a run that finishes inside the reveal delay', async () => {
    // A cached last-Step edit costs 24.1 ms (Chromium) / 54 ms (Firefox); the
    // delay is 150. Below it the band is untouched and cannot flicker, which is
    // what keeps a fixed-height region from becoming a strobe on every keystroke.
    const { graph } = wired()
    const clock = testClock() // stopped at 0, so every run is instantaneous
    const w = paneWith(graph, { engine: countingEngine(), yielder: instantYield(), clock })
    await flushPromises()

    expect(progressLine(w).exists()).toBe(false)
    expect(cancelButton(w).exists()).toBe(false)
  })

  it('names the Step and the position once a run has outlived the delay', async () => {
    const { graph, filter } = wired()
    const clock = testClock()
    const yielder = handYield()
    const w = paneWith(graph, { engine: countingEngine(), yielder, clock })
    await flushPromises()

    // The first report is at t=0 and reveals nothing. The run then takes its time
    // over the Source, and the second report is what the user sees.
    expect(progressLine(w).exists()).toBe(false)
    clock.at = 200
    await yielder.release()
    await nextTick()

    // The kind, not the word „Step": the walk's second node is a Filter, and its
    // first is a Quelle. The sentence itself is `ui/StepCard.test.js`'s.
    expect(progressLine(w).text()).toBe('Rechnet Filter „Nur Große“ (2 von 3)')
    // **Not a live region**, and the announcement is a sibling that says the same
    // state once: this line's text changes once per node, so announcing it would
    // mean 46 interruptions over a 46-node walk and would bury the sentence that
    // says the run ended.
    expect(progressLine(w).attributes('role')).toBeUndefined()
    const announced = w.find('[data-testid="editor-running"]')
    expect(announced.attributes('role')).toBe('status')
    expect(announced.text()).toContain('Der Lauf rechnet noch')
    // A real focusable element, not a div with a handler (AD-30).
    expect(cancelButton(w).element.tagName).toBe('BUTTON')
    expect(cancelButton(w).text()).toBe('Lauf abbrechen')
    // The Step the walk is in front of is the one the line names.
    expect(w.vm.$props.graph.get(filter).name).toBe('Nur Große')
  })

  it('stops the walk, says so in German, and keeps the previous run on screen', async () => {
    const { graph, filter, columns } = wired()
    const clock = testClock()
    const yielder = handYield()
    const engine = countingEngine()
    const w = paneWith(graph, { engine, yielder, clock })

    // A first run, all the way through, so there is something to keep showing.
    await yielder.release(3)
    expect(engine.calls.selectColumns).toBe(1)
    expect(await shownFor(w, columns)).toMatchObject({ rowCount: 1 })

    // A second run, stopped in front of the Columns Step.
    w.findComponent(StubCanvas).vm.$emit('select', filter)
    await nextTick()
    w.findComponent(StepPanel).vm.$emit('configure', { combine: 'any', conditions: [] })
    await flushPromises()
    clock.at = 200
    await yielder.release(2) // Source and Filter done, Columns waiting
    await nextTick()
    expect(cancelButton(w).exists()).toBe(true)

    await cancelButton(w).trigger('click')
    await yielder.release()
    await nextTick()

    // The walk stopped before the Step it was in front of.
    expect(engine.calls.selectColumns).toBe(1)
    expect(statusText(w)).toContain('Der Lauf wurde abgebrochen')
    // Three nodes in the walk, of which one is the Quelle — so the sentence counts
    // Arbeitsschritte, says that Quellen are among them, and says the count is the
    // work this result needs rather than a total of anything on the canvas.
    expect(statusText(w)).toContain(
      'Für das Ergebnis sind 3 Arbeitsschritte nötig (Quellen mitgezählt); davon waren 2',
    )
    // …and what the panel shows is still the first run's answer, not a blank and
    // not a partial set.
    expect(await shownFor(w, columns)).toMatchObject({ rowCount: 1 })
    // The line and the control go with the run that is no longer in flight.
    expect(progressLine(w).exists()).toBe(false)
    expect(cancelButton(w).exists()).toBe(false)
  })

  it('cancels the run in flight when an edit starts another, and publishes only the new one', async () => {
    const { graph, filter, columns } = wired()
    const clock = testClock()
    const yielder = handYield()
    const engine = countingEngine()
    const w = paneWith(graph, { engine, yielder, clock })
    await yielder.release(3)
    expect(engine.calls.selectColumns).toBe(1)

    w.findComponent(StubCanvas).vm.$emit('select', filter)
    await nextTick()
    const panel = w.findComponent(StepPanel)

    // Two edits, the second landing while the first one's run is still walking.
    panel.vm.$emit('configure', { combine: 'any', conditions: [] })
    await flushPromises()
    await yielder.release() // the second run has done its Source
    panel.vm.$emit('configure', {
      combine: 'all',
      conditions: [{ column: 'Kunde', op: 'eq', value: 'Anna' }],
    })
    await flushPromises()
    await yielder.release(6) // enough for whatever is left of either run

    // The superseded run computed no Columns Step of its own…
    expect(engine.calls.selectColumns).toBe(2)
    // …and it says nothing: a run the pane replaced is not a run the user
    // cancelled, and a German sentence about it would be a report on machinery.
    expect(statusText(w)).not.toContain('abgebrochen')
    expect(await shownFor(w, columns)).toMatchObject({ rowCount: 2 })
  })

  it('discards a superseded run’s outcome whichever order the two resolve in', async () => {
    // The generation guard rather than the cancel. A cancel only takes effect at
    // the *next* Step, so a superseded run is still in the queue when the run that
    // replaced it publishes — and whatever it eventually says must change nothing.
    //
    // The case above covers the order the shipped `MessageChannel` yielder
    // produces, where the older run resolves first. This one drives the opposite
    // order by hand: not a state `file://` can reach (see `releaseLast`), but the
    // proof that what decides who publishes is the generation and not which
    // promise happened to settle first.
    const { graph, filter, columns } = wired()
    const clock = testClock()
    const yielder = handYield()
    const engine = countingEngine()
    const w = paneWith(graph, { engine, yielder, clock })
    await yielder.release(3)

    w.findComponent(StubCanvas).vm.$emit('select', filter)
    await nextTick()
    const panel = w.findComponent(StepPanel)

    panel.vm.$emit('configure', { combine: 'any', conditions: [] })
    await flushPromises() // run B is waiting in front of its Source
    panel.vm.$emit('configure', {
      combine: 'all',
      conditions: [{ column: 'Kunde', op: 'eq', value: 'Anna' }],
    })
    await flushPromises() // run C is waiting behind it, B is cancelled

    // C first, all the way through and published…
    await yielder.releaseLast(3)
    await nextTick()
    expect(await shownFor(w, columns)).toMatchObject({ rowCount: 2 })

    // …and only then does B get its turn and resolve.
    await yielder.release(2)
    await nextTick()

    expect(await shownFor(w, columns)).toMatchObject({ rowCount: 2 })
    expect(statusText(w)).not.toContain('abgebrochen')
  })

  it('lets go of a run in flight when the pane is unmounted', async () => {
    // `ui/App.vue` makes the Editor `v-if`, so a view switch is a genuine unmount.
    // A run still walking would go on spending the main thread and then publish
    // into a component that is gone.
    const { graph } = wired()
    const clock = testClock()
    const yielder = handYield()
    const engine = countingEngine()
    const w = paneWith(graph, { engine, yielder, clock })

    await yielder.release() // the Source is done, the Filter is waiting
    expect(engine.calls.filter).toBe(0)

    w.unmount()
    await yielder.release(3)

    expect(engine.calls.filter).toBe(0)
    expect(engine.calls.selectColumns).toBe(0)
  })

  it('picks up where a cancelled run stopped, out of the cache', async () => {
    // The pane's half of the reason story 7a came first: cancelling costs the user
    // only the Step that was interrupted.
    const { graph, filter } = wired()
    const clock = testClock()
    const yielder = handYield()
    const engine = countingEngine()
    const cache = createRunCache()
    const w = mount(EditorPane, {
      props: {
        graph,
        sources: [entry()],
        canvas: StubCanvas,
        engine,
        stepZero: { of: (e) => (e ? { table: handle(100) } : null) },
        cache,
        clock,
        yielder,
      },
    })
    // Past the reveal delay from the start, so the control is on screen for the
    // whole of the run this case interrupts.
    clock.at = 200

    // Stopped after the Filter, in front of the Columns Step.
    await yielder.release(2)
    await nextTick()
    await cancelButton(w).trigger('click')
    await yielder.release()
    expect(engine.calls).toMatchObject({ filter: 1, selectColumns: 0 })

    expect(statusText(w)).toContain('Der Lauf wurde abgebrochen')

    // The same run asked for again — a re-projection of the same graph.
    w.findComponent(StubCanvas).vm.$emit('select', filter)
    await nextTick()
    w.findComponent(StepPanel).vm.$emit('configure', { combine: 'all', conditions: [] })
    await yielder.release(4)
    await nextTick()

    // The Filter is served from the entry the cancelled run left behind.
    expect(engine.calls).toMatchObject({ filter: 1, selectColumns: 1 })

    // **And the cancellation sentence went with the run it was about.** It says
    // „angezeigt wird weiterhin das Ergebnis des vorherigen Laufs", which stops
    // being true the moment a later run publishes — a sentence that outlived its
    // run would be false about exactly the thing it exists to make trustworthy.
    // Deleting the `runNotice` reset in `startExecution` leaves it standing.
    expect(statusText(w)).not.toContain('abgebrochen')
  })

  it('takes the progress line and the cancel control away when a run simply finishes', async () => {
    // Not the cancelled path — the ordinary one. A run that outlives the reveal
    // delay and then completes has to clear the band it opened, or the pane is
    // left claiming a run is walking, with an inert cancel button beside the claim.
    // Moving the clear into the cancelled branch leaves every other case green.
    const { graph, columns } = wired()
    const clock = testClock()
    const yielder = handYield()
    const engine = countingEngine()
    const w = paneWith(graph, { engine, yielder, clock })

    await flushPromises()
    clock.at = 200
    await yielder.release(2) // Source and Filter done, Columns waiting
    await nextTick()
    expect(progressLine(w).exists()).toBe(true)
    expect(cancelButton(w).exists()).toBe(true)

    await yielder.release()
    await nextTick()

    expect(progressLine(w).exists()).toBe(false)
    expect(cancelButton(w).exists()).toBe(false)
    expect(w.find('[data-testid="editor-running"]').exists()).toBe(false)
    // …and it published, which is what makes this a completed run rather than one
    // that vanished.
    expect(await shownFor(w, columns)).toMatchObject({ rowCount: 1 })
  })

  it('leaves the keyboard somewhere when the control it was on is removed', async () => {
    // **Pressing the cancel button destroys the cancel button**, every time, by
    // construction: the run ends and `v-if="progress"` takes the row out of the
    // document. Focus then falls to `<body>` and the next Tab starts the page from
    // the top — for the one user AD-30 makes the control a real `<button>` for.
    // The band takes it instead, which is also where the sentence about what just
    // happened renders.
    const { graph } = wired()
    const clock = testClock()
    const yielder = handYield()
    const w = mount(EditorPane, {
      attachTo: document.body, // focus needs a document to be in
      props: {
        graph,
        sources: [entry()],
        canvas: StubCanvas,
        engine: countingEngine(),
        stepZero: { of: (e) => (e ? { table: handle(100) } : null) },
        clock,
        yielder,
      },
    })

    await flushPromises()
    clock.at = 200
    await yielder.release()
    await nextTick()

    const button = cancelButton(w).element
    button.focus()
    expect(document.activeElement).toBe(button)

    await cancelButton(w).trigger('click')
    await yielder.release()
    await nextTick()
    await nextTick() // the focus is restored after the row is gone

    expect(cancelButton(w).exists()).toBe(false)
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement.className).toContain('h-20')
    // The band holds the sentence, so a reader that follows focus is on it.
    expect(document.activeElement.textContent).toContain('Der Lauf wurde abgebrochen')
    w.unmount()
  })

  it('converts no Source before the run has yielded once', async () => {
    // **The pane's half of the defect that got this story reverted.** Gate 1 used
    // to ask `sourceTable(id) === null`, and in this pane that door is
    // `stepZero.of` — the conversion, measured at 548–555 ms per contributing
    // Source. The gates run synchronously inside `startRun`, so every cold
    // conversion was paid before the run could yield, report or be cancelled. The
    // pane now hands the gate a predicate over the entry's own `typing.confirmed`,
    // which is the same field `convertSource` tests before it converts.
    //
    // Deleting `sourceConfirmed` from the `startRun` call turns this red.
    const { graph } = wired()
    const converted = []
    const w = paneWith(graph, {
      engine: countingEngine(),
      yielder: handYield(),
      clock: testClock(),
      stepZero: {
        of: (e) => {
          converted.push(e?.id)
          return e ? { table: handle(100) } : null
        },
      },
    })

    // The mount's own run has been started and its gates have run.
    expect(converted).toEqual([])
    w.unmount()
  })

  it('refuses an unconfirmed Source without converting it either', async () => {
    // The other half of the predicate: it has to answer the gate's question
    // correctly, not merely cheaply. An entry whose typing is not confirmed is
    // refused by name, exactly as it was when the gate asked for a table.
    const { graph } = wired()
    const converted = []
    const w = paneWith(graph, {
      engine: countingEngine(),
      yielder: instantYield(),
      clock: testClock(),
      sources: [{ ...entry(), typing: { columns: [], confirmed: false } }],
      stepZero: {
        of: (e) => {
          converted.push(e?.id)
          return e ? { table: handle(100) } : null
        },
      },
    })
    await flushPromises()

    expect(statusText(w)).toContain('Umsatz Q1')
    expect(converted).toEqual([])
  })

  it('leaves nothing claiming to be in flight when a door throws on the way in', async () => {
    // `startRun` runs the gates synchronously, and they call a door this pane
    // supplies — so it can throw before there is a handle to hold.
    //
    // **What this case does and does not pin, stated because the round-2 patch
    // asked for exactly that.** It pins that a failed start leaves the pane usable
    // and does not swallow the throw. It does **not** pin the `inFlight = null`
    // that sits above the `try`: with the band already cleared two lines earlier,
    // a stale handle is unreachable from the template, every reader of `inFlight`
    // tolerates one, and deleting the line leaves this suite green. That is a
    // property of the design rather than a hole in the case — `inFlight` means
    // "the run that may still publish", and keeping the name true is the whole
    // reason the line is there. Nobody should read this case as covering it.
    const { graph } = wired()
    const yielder = handYield()
    const engine = countingEngine()
    const w = paneWith(graph, { engine, yielder, clock: testClock(), stepZero: undefined })
    await yielder.release(3)
    expect(engine.calls.selectColumns).toBe(1)

    // An entry that throws when the gate reads it — a programming error in a door,
    // which is the only way to reach this branch. The throw is *not* swallowed:
    // a pane that quietly stopped executing would be the worse failure.
    let thrown = null
    try {
      await w.setProps({
        sources: [
          {
            ...entry(),
            get typing() {
              throw new Error('a door that throws on the way in')
            },
          },
        ],
      })
    } catch (error) {
      thrown = error
    }
    await flushPromises()

    expect(thrown?.message).toContain('a door that throws on the way in')

    expect(progressLine(w).exists()).toBe(false)
    expect(cancelButton(w).exists()).toBe(false)

    // …and the next command runs, rather than meeting a pane that thinks something
    // is already walking.
    await w.setProps({ sources: [entry()] })
    await yielder.release(3)
    expect(engine.calls.selectColumns).toBe(2)
  })

  it('clears the band when a run rejects, rather than leaving a line with nothing behind it', async () => {
    // Everything a *Step* can do is a Diagnostic (`core/exec/execute.js` catches
    // it), so a rejection here is a programming error in the machinery around
    // them. The pane cannot report it — `ui/` is not in the register of files that
    // may name `console` — and it does not swallow it: the rejection goes on to
    // the platform's unhandled-rejection channel, which is what the handler's
    // comment now says rather than claiming Vue's error handler sees it. What the
    // pane owes the user is the band, and this is that.
    const { graph } = wired()
    const clock = testClock()
    const yielder = handYield()
    /** A table whose row count throws. `record` reads it outside every `try` in
     *  the walk, because counting a result is not something a Step does. */
    const poisoned = {
      rowCount: () => {
        throw new Error('an invariant guard nothing was supposed to reach')
      },
      schema: () => [],
    }
    const w = paneWith(graph, {
      yielder,
      clock,
      engine: {
        fromColumns: () => handle(100),
        filter: (table) => ({ table, removed: 0, boxed: 0, unreadable: [] }),
        selectColumns: () => poisoned,
      },
    })

    await flushPromises()
    clock.at = 200 // the run outlives the reveal delay before it fails
    await yielder.release(2) // Source and Filter done, Columns waiting
    await nextTick()
    expect(progressLine(w).exists()).toBe(true)

    // The rejection is the platform's to report, and the runner would otherwise
    // fail this file for it — which is exactly what "nobody holds this promise"
    // means, and is the assertion. Taken off the floor here rather than prevented,
    // because preventing it would mean the pane swallowing it.
    //
    // Through `globalThis` because the `ui` envelope is linted with the browser
    // globals alone (AD-27: a `ui` test that needs Node is usually a test in the
    // wrong project). This one is not about the DOM at all — it is about what
    // happens to a promise nobody holds, and the runner's channel for that is the
    // Node one.
    const rejected = []
    const onRejection = (reason) => rejected.push(reason)
    const proc = globalThis.process
    proc.on('unhandledRejection', onRejection)
    try {
      await yielder.release()
      await nextTick()

      expect(progressLine(w).exists()).toBe(false)
      expect(cancelButton(w).exists()).toBe(false)
      expect(rejected.map((r) => r.message)).toEqual([
        'an invariant guard nothing was supposed to reach',
      ])
    } finally {
      proc.off('unhandledRejection', onRejection)
    }
  })
})
