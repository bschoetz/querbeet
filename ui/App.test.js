// The composition of the two panes, in the `ui/` envelope (AD-27, R10).
//
// **Why this file exists at all, and it is one line's worth of reason.** Story
// 7a's caches are created in `ui/App.vue`'s `setup` and handed down as props,
// because the Editor is `v-if` and a cache owned there would be thrown away by
// every trip to the Sources pane — which is exactly the moment a user comes back
// to a graph they have not changed. Every other test in this project mounts a
// pane. Deleting `:cache="runCache"` from `ui/App.vue` therefore left all 994
// tests green in review round 1: the wiring that makes the feature exist in the
// product was the one thing nothing asserted.
//
// The store here is the **real** `createSourceStore` behind a stub reader. A
// hand-built entry would be a second opinion about what an entry is, and the
// property under test — that a key survives a view switch — is a property of
// what the store actually mints (`byteDigest`, `parseConfig`, `encoding`, a real
// typing). The engine is counted, the way `ui/EditorPane.test.js` counts one,
// lifted one level up.

import { flushPromises, mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { createRunCache } from '@core/exec/cache.js'
import { createSourceStore } from '@core/exec/source-store.js'
import { createGraphStore } from '@core/graph/graph-store.js'
import App from './App.vue'

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

/** One column per name, cells verbatim — enough for detection to settle both and
 *  for the gate to open. */
const reader = {
  media: 'text',
  read: () => ({
    table: {
      columns: [
        { name: 'Kunde', domain: 'text', cells: ['Anna', 'Bernd'] },
        { name: 'Betrag', domain: 'text', cells: ['1000', '500'] },
      ],
      rowCount: 2,
    },
    proposal: { delimiter: ',', headerRow: 1 },
    damage: { mismatches: [], unclosedQuoteRow: null },
    diagnostics: [],
  }),
}

/** A `Table` handle wide enough for Step zero, the executor and the panel. */
const handle = (names) => ({
  rowCount: () => 2,
  schema: () => names.map((name) => ({ name, type: 'text' })),
  column: () => [],
  *rows() {
    yield Object.fromEntries(names.map((name) => [name, 'x']))
  },
})

/** An engine that counts the verbs a run asks it for — `ui/EditorPane.test.js`'s
 *  idiom, one level up. */
const countingEngine = () => {
  const calls = { fromColumns: 0, filter: 0, selectColumns: 0 }
  return {
    calls,
    fromColumns: (columns) => {
      calls.fromColumns += 1
      return handle(columns.map((c) => c.name))
    },
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

/**
 * A confirmed Source in the real store, and a graph of **two** cacheable Steps
 * over it.
 *
 * Two rather than one, and that is what makes the default bounds observable: a
 * one-entry chain fits inside any `maxEntries`, so a default factory quietly
 * built with `createRunCache({ maxEntries: 1 })` would still hit. Round 3 mutated
 * exactly that and the suite stayed green.
 */
const wired = async () => {
  const store = createSourceStore({ csv: reader })
  const { source } = await store.addSource({
    bytes: new TextEncoder().encode('egal'),
    fileName: 'umsatz.csv',
  })
  store.confirmTyping(source.id)

  const graph = createGraphStore()
  graph.syncSources([{ id: source.id, name: source.name }])
  const filter = graph.addStep('filter', { name: 'Nur Große' }).id
  const columns = graph.addStep('columns', { name: 'Nur Kunde' }).id
  graph.connect(source.id, filter, 0)
  graph.connect(filter, columns, 0)
  // Configured, because an empty selection is the identity and `columns.apply`
  // answers it without asking the engine — an unconfigured Step would be a
  // second cacheable entry that no counter can see.
  graph.configureStep(columns, { columns: [{ from: 'Kunde', to: 'Kunde' }] })
  graph.setResult(columns)

  return { store, graph, sourceId: source.id, sourceName: source.name, filter, columns }
}

/**
 * Mount `App`.
 *
 * **With no `runCache` unless a case asks for one**, which is the difference
 * round 3 turned on. `app/main.js` passes no such prop, so App's own default
 * factory is the only thing that gives the shipped artefact a cache — and a
 * helper that defaulted the argument meant every case injected and none
 * exercised that expression. Mutating the default to `null`, or to a cache too
 * small to hold the graph, left the whole suite green.
 *
 * A case that needs to *read* `size()` still has to hold the cache, and passes
 * one. The engine is the observation everywhere else.
 */
/**
 * The `Clock` and the `Yield` of story 7b (AD-25, AD-9).
 *
 * **These *are* passed by every case, and that is not the hole round 3 closed.**
 * `runCache` has a default factory in `App.vue` because `createRunCache` lives in
 * `core/` and this layer may build one; a clock and a message queue are adapters,
 * which `ui/` may not name at all (AD-1), so both are required props with no
 * default and a missing one is a `TypeError` on the first run rather than a
 * quietly degraded product. What proves they are wired all the way from
 * `app/main.js` is `tests/e2e/execution.spec.js`, in the built artefact.
 *
 * The yield resolves on the microtask queue so `flushPromises()` drains a whole
 * run; the macrotask contract is `adapters/scheduler/queue-yield.test.js`'s.
 */
const testClock = () => {
  let minted = 0
  return { now: () => 0, runId: () => `run:${(minted += 1)}` }
}
const instantYield = () => ({ next: () => Promise.resolve() })

const render = async (store, graph, engine, runCache) => {
  const props = {
    buildVersion: 'test',
    store,
    graph,
    engine,
    canvas: StubCanvas,
    clock: testClock(),
    yielder: instantYield(),
  }
  if (runCache !== undefined) props.runCache = runCache
  const w = mount(App, { props })
  await flushPromises()
  await nextTick()
  return w
}

const tab = (w, label) => w.findAll('nav button').find((b) => b.text() === label)
const show = async (w, label) => {
  await tab(w, label).trigger('click')
  await nextTick()
  // The Editor starts a run the moment it mounts, and a run is asynchronous as of
  // story 7b. `flushPromises()` is a macrotask, so with the microtask yield above
  // it drains the whole walk — what the case reads afterwards is a finished run.
  await flushPromises()
}

describe('the caches App owns', () => {
  it('gives the product a working cache with no cache passed to it at all', async () => {
    // **Mounted the way `app/main.js` mounts it**, which is the whole point of
    // this case: no `runCache` prop, so what is under test is App's own default
    // factory — the one expression that gives the shipped artefact a cache, and
    // the one nothing covered through three review rounds. Every earlier version
    // of this file injected a cache and then asserted that the injected cache
    // worked.
    //
    // The Editor is genuinely `v-if`, so the view switch is a real unmount —
    // CAP-11's "leaving and re-entering loses no Step configuration" is asserted
    // that way deliberately. What must also survive is the work: a graph nobody
    // touched must not be recomputed because the user looked at their Sources.
    const { store, graph } = await wired()
    const engine = countingEngine()
    const w = await render(store, graph, engine)

    await show(w, 'Editor')
    expect(engine.calls).toMatchObject({ filter: 1, selectColumns: 1 })

    await show(w, 'Quellen')
    await show(w, 'Editor')

    expect(engine.calls).toMatchObject({ filter: 1, selectColumns: 1 })
  })

  it('converts each Source once, whichever pane is asking', async () => {
    // The other cache, and the reason there is one of it (measured story 6b:
    // two caches convert the same Source twice at 545–555 ms and retain it twice
    // at 39.3 MB). The Sources pane marks the preview from Step zero and the
    // Editor executes from it.
    const { store, graph } = await wired()
    const engine = countingEngine()
    const w = await render(store, graph, engine)

    await show(w, 'Editor')
    await show(w, 'Quellen')
    await show(w, 'Editor')

    expect(engine.calls.fromColumns).toBe(1)
  })

  it('lets go of everything derived from a Source that is removed', async () => {
    // AD-29 from the run cache's side: it is content-keyed and has no id to
    // release by, so `ui/SourcesPane.vue` clears it. The cache is injected here
    // because `size()` is the observation — after a removal the run refuses at
    // the frontier, so the engine is called zero times whether anything was
    // cleared or not, which is how round 1's version of this case passed with
    // `:run-cache` deleted.
    const { store, graph, sourceId, sourceName } = await wired()
    const cache = createRunCache()
    const w = await render(store, graph, countingEngine(), cache)

    await show(w, 'Editor')
    expect(cache.size()).toBeGreaterThan(0)

    await show(w, 'Quellen')
    // Derived from the fixture, so renaming it fails as a name mismatch rather
    // than as an empty find three lines later.
    await w.find(`[aria-label="Entfernen: ${sourceName}"]`).trigger('click')
    await nextTick()

    expect(store.get(sourceId)).toBeNull()
    expect(cache.size()).toBe(0)
  })

  it('lets go of everything derived from a typing that was withdrawn', async () => {
    const { store, graph, sourceId, sourceName } = await wired()
    const cache = createRunCache()
    const w = await render(store, graph, countingEngine(), cache)

    await show(w, 'Editor')
    expect(cache.size()).toBeGreaterThan(0)

    await show(w, 'Quellen')
    await w.find(`[aria-label="Bestätigung aufheben: ${sourceName}"]`).trigger('click')
    await nextTick()

    // Both halves, so the pair is symmetric with its sibling above: the store
    // really did withdraw, and the cache really did let go. Asserting only the
    // second would pass over a pane that cleared the cache and forgot the command.
    expect(store.get(sourceId).typing.confirmed).toBe(false)
    expect(cache.size()).toBe(0)
  })
})
