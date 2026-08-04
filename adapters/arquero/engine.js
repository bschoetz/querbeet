// The `TableEngine` port's one implementation (AD-19). This file and its
// siblings under `adapters/arquero/` are the only place in the tree that says
// the word `arquero`, and a lint rule says so rather than a review.
//
// AD-19's rule is that the adapter absorbs the hazards and the Step kinds never
// do. Two of them land in this file, and both are measured facts about the
// representation rather than opinions about style:
//
//   THE BOX (AD-22). A value that does not parse under its confirmed type is
//   held as a box carrying the original text, in the cell itself, so it survives
//   a join and an aggregate by construction rather than by every Step kind
//   remembering a rule. **This file is the single place that knows what a box
//   is** — `core/` cannot construct one, which is why `fromColumns` receives each
//   column split into its values and the indices that failed. And at the edges a
//   box materializes as its original text: `rows()` and `column()` never hand one
//   out, so no consumer can accidentally learn the representation and then depend
//   on it. Box identity is observable through engine operations and through the
//   caller's own `unparsed` map, and nowhere else.
//
//   `BigInt` (AD-21). Every temporal column holds nanoseconds as a `BigInt`,
//   because a `datetime2(7)` timestamp out of SQL Server is already past
//   `Number.MAX_SAFE_INTEGER` and an ordinary CSV export shape. `BigInt` and
//   `Number` do not mix in arithmetic, so the day a Step kind takes a mean over a
//   temporal column, that is this adapter's problem to have solved.
//
// It is a plain module with no Vue import and no DOM, for the reason
// `canvas-logic.js` is: this project has two Vitest projects, the `core` one
// reaches `adapters/**/*.test.js` under `environment: 'node'`, and an adapter is
// framework-free code behind a port. `engine.test.js` beside it runs there.
//
// THE ENGINE'S OWN CSV ENTRY POINTS ARE NOT USED and none is imported: parsing
// belongs to `SourceReader` (AD-19), and importing one would also pull `fetch`
// into a bundle that is asserted to contain none (AD-17).
//
// **`Table` rather than `ColumnTable`, measured rather than preferred — and the
// measurement also says what it does *not* buy.** `ColumnTable` is the subclass
// carrying the verb methods; building against it costs **58,843 bytes** in the
// artefact (781,669 against 722,826) for machinery this story's port has no
// method for. What it does not buy is a bundle without a JavaScript parser:
// `Table` imports `regroup.js`, which imports `groupby`, `rollup` and `select`,
// which import the expression parser — so **`acorn` is in the artefact either
// way**, and the belief that the base class avoids it was measured and is false.
//
// That has a consequence worth knowing before the next build goes red: acorn's
// error message for a trailing comma contains the characters `import(`, and
// AD-18's gate is a text check on the built file by design, independent of any
// browser. The gate now names that one occurrence explicitly rather than
// tolerating a count, so a *real* dynamic import still fails it.
//
// Story 6b is where verbs arrive and where the subclass question is properly
// answered — arquero's verbs are plain functions over a table, and `escape()`
// exists to hand one a function instead of a string, which is also what AD-30
// asks for (no formula, expression, query or script anywhere in the MVP). The
// ledger carries both findings so neither is rediscovered as a surprise.

import { Table } from 'arquero'

/**
 * A cell that did not parse under its column's confirmed type, carrying the
 * text that was in the file.
 *
 * A class rather than a wrapper object or a tagged string, for one reason:
 * `instanceof` against a constructor no other module can reach is the only test
 * that cannot be spoofed by data. A `{ unparsed: true, text }` sentinel is a
 * shape a *cell value* could genuinely have — a JSON column out of Parquet
 * carries objects — and a tagged string collides with the text column it would
 * live beside.
 *
 * Frozen instances, because a cell crosses Step boundaries and lands in a cache
 * entry (AD-8): a mutable box would let a cache hit replay something other than
 * what the run produced.
 */
class Unparsed {
  constructor(text) {
    this.text = text
    Object.freeze(this)
  }
}

/** What a cell looks like at an edge. The one place the box is undone. */
const unbox = (value) => (value instanceof Unparsed ? value.text : value)

/**
 * The `Table` handle of AD-5 — `rows()`, `rowCount()`, `schema()`,
 * `column(name)`, and deliberately nothing else. Narrow on purpose: CAP-13's
 * column union, CAP-16's enumeration, CAP-21's Input Contract and CAP-26's
 * Column Profile all need columns and types without materializing rows.
 *
 * `types` is carried beside the engine table rather than read out of it. An
 * engine table knows what is *in* a column, not what the column *is* — a `text`
 * column of digits and a `number` column hold different JavaScript, but a `date`
 * and a `duration` column both hold `BigInt`, and asking the values would make
 * `schema()` guess at exactly the distinction AD-21 exists to keep.
 */
function handleFor(t, types) {
  const names = t.columnNames()
  const schema = Object.freeze(
    names.map((name) => Object.freeze({ name, type: types.get(name) })),
  )

  /** Plain frozen row objects, one at a time (AD-5) — this is an edge, and an
   *  edge is where rows are allowed to exist at all. A generator rather than an
   *  array so a preview reading fifty rows of a hundred thousand pays for fifty:
   *  the engine's own `objects()` builds the whole thing unless it is handed a
   *  limit, and a caller that forgot the limit would be a silent copy of the
   *  dataset. Iterating the engine table (rather than indexing the columns) is
   *  what keeps a filtered or ordered table honest. */
  function* rows() {
    for (const row of t) {
      const out = {}
      for (const name of names) out[name] = unbox(row[name])
      yield Object.freeze(out)
    }
  }

  return Object.freeze({
    rows,
    rowCount: () => t.numRows(),
    schema: () => schema,
    column(name) {
      if (!types.has(name)) throw new TypeError(`no column ${name} in this table`)
      // `array` extracts one column, honouring the table's filter and order, and
      // is the allocation-free-per-row read path; the unboxing is in place on
      // the array it already had to build.
      const out = t.array(name)
      for (let i = 0; i < out.length; i += 1) {
        if (out[i] instanceof Unparsed) out[i] = out[i].text
      }
      return Object.freeze(out)
    },
  })
}

/**
 * The engine `app/` wires into the `TableEngine` port (AD-1).
 *
 * A factory rather than a module-level singleton, so a test gets its own and
 * nothing accumulates across one.
 */
export function createArqueroEngine() {
  return {
    /**
     * Build a Table from columns — Step zero's one door in.
     *
     * Column by column, with no intermediate array of row objects anywhere: at
     * the NFR-3 shape that array is 30.6 MB of row-object overhead that would
     * exist only to be dropped again, and the absence of a row-shaped entry point
     * is what keeps it from being built. The engine copies nothing here either —
     * its own table constructor holds the arrays it is handed.
     *
     * **`values` is handed over, not borrowed.** The boxes are written into the
     * array in place, so the caller must not read or reuse it afterwards. That is
     * what keeps a converted column at one copy: the registry's raw text (AD-7)
     * is the only other one, and nothing ever holds a third.
     *
     * @param {ReadonlyArray<import('../../ports/index.js').EngineColumn>} columns
     */
    fromColumns(columns) {
      // Null-prototype, because a column may be called `__proto__` or
      // `constructor` — a CSV header is whatever the exporter wrote. On a plain
      // object the first would not become an own property at all and the second
      // would collide with something that was already there.
      const data = Object.create(null)
      const names = []
      const types = new Map()

      for (const { name, type, values, unparsed } of columns) {
        if (types.has(name)) {
          throw new TypeError(`a table cannot hold two columns called ${name}`)
        }
        for (const at of unparsed) values[at] = new Unparsed(values[at])
        data[name] = values
        names.push(name)
        types.set(name, type)
      }

      // `names` explicitly rather than key enumeration order: a column called
      // `1` or `07` would otherwise sort itself to the front, because an
      // integer-like key is enumerated before every string one — and a Source's
      // column names come from whatever the exporter wrote in the header row.
      return handleFor(new Table(data, names), types)
    },
  }
}
