// One measurement function, run unchanged in Node, Chromium and Firefox.
//
// It answers what story 6d's stub left open about ordering: what `orderby` and a
// row limit cost at C-3's 100,000 rows, whether the engine's own comparator is
// safe with the two representations this product's tables carry (a box, AD-22;
// a `BigInt` nanosecond, AD-21), and what a locale-correct German order costs
// against the engine's default.
//
// Everything is deterministic — no `Math.random`, no clock beyond the timer —
// so two engines are compared on the same rows.

import * as aq from 'arquero'
import { BitSet } from 'arquero'

/** The adapter's box, reconstructed here: `adapters/arquero/engine.js` keeps its
 *  own private and the spike may not import it. Only its *shape* matters — an
 *  object that no relational operator compares meaningfully. */
class Unparsed {
  constructor(text) {
    this.text = text
    Object.freeze(this)
  }
}

const N = 100_000

const rows = () => {
  let seed = 12345
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const name = new Array(N)
  const amount = new Array(N)
  const when = new Array(N)
  for (let i = 0; i < N; i += 1) {
    // 20 % of the names carry an umlaut, which is where the two collations part.
    name[i] = `Kunde ${Math.floor(next() * 50_000)}${next() < 0.2 ? 'Ä' : ''}`
    const r = next()
    amount[i] = r < 0.02 ? null : r < 0.04 ? new Unparsed('1.234,56 €') : Math.round(r * 1e6) / 100
    when[i] = 1_700_000_000_000_000_000n + BigInt(Math.floor(next() * 86_400) * 1_000_000_000)
  }
  return { name, amount, when }
}

const time = (f) => {
  const t0 = performance.now()
  const value = f()
  return { ms: Number((performance.now() - t0).toFixed(1)), value }
}

/** Median of three, because one run on a cold JIT is not a number worth
 *  comparing across engines. */
const median3 = (f) => {
  const runs = [time(f).ms, time(f).ms, time(f).ms].sort((a, b) => a - b)
  return runs[1]
}

// --- the comparator the adapter would install ------------------------------
//
// `create({ order })` takes a row comparator, which is the door the engine's own
// `orderby` reduces to. Installing our own is what lets a box and a `null` be
// placed rather than compared.

const unordered = (v) => v === null || v === undefined || v instanceof Unparsed

const comparatorFor = (column, direction, compare) => (a, b) => {
  const x = column.at(a)
  const y = column.at(b)
  const ra = unordered(x) ? 1 : 0
  const rb = unordered(y) ? 1 : 0
  if (ra !== rb) return ra - rb
  if (ra === 1) return 0
  const c = compare(x, y)
  return direction === 'desc' ? -c : c
}

const relational = (x, y) => (x < y ? -1 : x > y ? 1 : 0)

const firstRows = (table, n) => {
  const index = table.indices()
  const keep = new BitSet(table.totalRows())
  for (let i = 0; i < Math.min(n, index.length); i += 1) keep.set(index[i])
  return table.create({ filter: keep })
}

export function measureOrdering() {
  const { name, amount, when } = rows()
  const t = aq.table({ name, amount, when })
  const collator = new Intl.Collator('de-DE')

  const nameColumn = t.column('name')
  const amountColumn = t.column('amount')
  const whenColumn = t.column('when')

  const cost = {
    engineOrderbyNumber: median3(() => t.orderby('amount').indices()),
    engineOrderbyText: median3(() => t.orderby('name').indices()),
    ownComparatorNumber: median3(() =>
      t.create({ order: comparatorFor(amountColumn, 'asc', relational) }).indices(),
    ),
    ownComparatorBigInt: median3(() =>
      t.create({ order: comparatorFor(whenColumn, 'desc', relational) }).indices(),
    ),
    ownComparatorCollated: median3(() =>
      t.create({ order: comparatorFor(nameColumn, 'asc', collator.compare) }).indices(),
    ),
    ownComparatorCodeUnit: median3(() =>
      t.create({ order: comparatorFor(nameColumn, 'asc', relational) }).indices(),
    ),
  }

  const ordered = t.create({ order: comparatorFor(amountColumn, 'desc', relational) })
  ordered.indices()
  cost.firstTenAfterOrder = median3(() => firstRows(ordered, 10).numRows())
  cost.firstFiftyThousand = median3(() => firstRows(ordered, 50_000).numRows())

  // --- what the two orders mean --------------------------------------------

  const words = ['Zebra', 'Äpfel', 'Apfel', 'Öl', 'Osten', 'Straße', 'Strasse', 'apfel']
  const wordTable = aq.table({ v: words })
  const readOut = (table, column) => [...table.indices()].map((r) => table.column(column).at(r))

  const collation = {
    codeUnit: readOut(
      wordTable.create({ order: comparatorFor(wordTable.column('v'), 'asc', relational) }),
      'v',
    ),
    collated: readOut(
      wordTable.create({ order: comparatorFor(wordTable.column('v'), 'asc', collator.compare) }),
      'v',
    ),
  }

  // The engine's own comparator against a box: does one unreadable cell move the
  // rows around it? This is the hazard AD-19 says the adapter must absorb.
  const hazardTable = aq.table({
    v: [9, 8, 7, new Unparsed('x'), 6, 5, 4, 3, 2, 1],
    id: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  })
  const label = (table) =>
    [...table.indices()].map((r) => {
      const v = table.column('v').at(r)
      return v instanceof Unparsed ? 'BOX' : String(v)
    })

  const box = {
    engineOrderby: label(hazardTable.orderby('v')),
    ownComparatorAsc: label(
      hazardTable.create({ order: comparatorFor(hazardTable.column('v'), 'asc', relational) }),
    ),
    ownComparatorDesc: label(
      hazardTable.create({ order: comparatorFor(hazardTable.column('v'), 'desc', relational) }),
    ),
  }

  const nullTable = aq.table({ v: [3, null, 1, null, 2] })
  const nulls = {
    engineOrderbyAsc: label(nullTable.orderby('v')),
    ownComparatorAsc: label(
      nullTable.create({ order: comparatorFor(nullTable.column('v'), 'asc', relational) }),
    ),
    ownComparatorDesc: label(
      nullTable.create({ order: comparatorFor(nullTable.column('v'), 'desc', relational) }),
    ),
  }

  // Ties keep their input order, or they do not. "The first 10" is only
  // reproducible if they do.
  const tieTable = aq.table({ k: ['b', 'a', 'b', 'a', 'b', 'a'], id: [0, 1, 2, 3, 4, 5] })
  const stable = [...tieTable.create({ order: comparatorFor(tieTable.column('k'), 'asc', relational) }).indices()]
    .map((r) => `${tieTable.column('k').at(r)}${tieTable.column('id').at(r)}`)

  // A limit over an ordered table keeps the order, and composes with another.
  const top3 = firstRows(ordered, 3)
  const composition = {
    keepsOrder: top3.isOrdered(),
    rowCount: top3.numRows(),
    limitOfLimit: firstRows(top3, 2).numRows(),
  }

  return { rows: N, cost, collation, box, nulls, stable, composition }
}
