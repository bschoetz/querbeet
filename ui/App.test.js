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
  const calls = { fromColumns: 0, filter: 0 }
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
    selectColumns: (table) => table,
  }
}

/** A confirmed Source in the real store, and a graph that filters it. */
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
  graph.connect(source.id, filter, 0)
  graph.setResult(filter)

  return { store, graph, sourceId: source.id, filter }
}

/** The cache is passed in rather than left to `App`'s own default, so the test
 *  can *observe* it. The withdrawal rule is a statement about what the cache
 *  holds, and counting engine calls cannot see it: after a withdrawal the run
 *  refuses at the frontier and calls the engine zero times whether or not
 *  anything was cleared, which is how the round-1 version of this file passed
 *  with `:run-cache` deleted. */
const render = async (store, graph, engine, runCache = createRunCache()) => {
  const w = mount(App, {
    props: { buildVersion: 'test', store, graph, engine, canvas: StubCanvas, runCache },
  })
  await flushPromises()
  await nextTick()
  return w
}

const tab = (w, label) => w.findAll('nav button').find((b) => b.text() === label)
const show = async (w, label) => {
  await tab(w, label).trigger('click')
  await nextTick()
}

describe('the caches App owns', () => {
  it('survives the Editor being unmounted and remounted by a view switch', async () => {
    // The Editor is genuinely `v-if`, so this is a real unmount — CAP-11's
    // "leaving and re-entering loses no Step configuration" is asserted that way
    // deliberately. What must also survive is the work: a graph nobody touched
    // must not be recomputed because the user looked at their Sources.
    const { store, graph } = await wired()
    const engine = countingEngine()
    const w = await render(store, graph, engine)

    await show(w, 'Editor')
    const afterFirstRun = engine.calls.filter
    expect(afterFirstRun).toBeGreaterThan(0)

    await show(w, 'Quellen')
    await show(w, 'Editor')

    expect(engine.calls.filter).toBe(afterFirstRun)
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
    // release by, so `ui/SourcesPane.vue` clears it.
    const { store, graph, sourceId } = await wired()
    const cache = createRunCache()
    const w = await render(store, graph, countingEngine(), cache)

    await show(w, 'Editor')
    expect(cache.size()).toBeGreaterThan(0)

    await show(w, 'Quellen')
    await w.find('[aria-label="Entfernen: umsatz"]').trigger('click')
    await nextTick()

    expect(store.get(sourceId)).toBeNull()
    expect(cache.size()).toBe(0)
  })

  it('lets go of everything derived from a typing that was withdrawn', async () => {
    const { store, graph } = await wired()
    const cache = createRunCache()
    const w = await render(store, graph, countingEngine(), cache)

    await show(w, 'Editor')
    expect(cache.size()).toBeGreaterThan(0)

    await show(w, 'Quellen')
    await w.find('[aria-label="Bestätigung aufheben: umsatz"]').trigger('click')
    await nextTick()

    expect(cache.size()).toBe(0)
  })
})
