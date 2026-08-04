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
// **`ColumnTable` rather than the base `Table`, decided 2026-08-04 with the
// project owner and measured on both sides.** Story 6a built against the base
// class, which is 58,729 bytes cheaper and had every method that story's port
// needed. This story's port needs two verbs, and the chain figure is what decided
// it: CAP-19 shows the row and column count of every Step's **full** output, so
// no intermediate is transient. Arquero's verbs share the column arrays, which
// costs ~0.0 MB for a Source → Filter → Columns chain with every Step retained; a
// hand-written filter materializes twenty fresh column arrays per link and holds
// them, measured at 19.8 MB for the same chain and ~100 MB across five Sources.
// The artefact has no stated byte budget — the single-file gate checks structure,
// not size — while memory has one.
//
// **What the base class did not buy either, and it is worth not rediscovering:**
// a bundle without a JavaScript parser. `Table` imports `regroup.js`, which
// imports `groupby`, `rollup` and `select`, which import the expression parser —
// so `acorn` is in the artefact whichever class this file builds on, and the
// belief that the base class avoids it was measured and is false. Its
// consequence: acorn's error message for a trailing comma contains the characters
// `import(`, and AD-18's gate is a text check on the built file by design. The
// gate names that one occurrence explicitly rather than tolerating a count, so a
// *real* dynamic import still fails it.
//
// **And the byte figure above has a caveat this file must not hide.** The two
// verbs below are built from `create` and `BitSet`, both of which the *base*
// `Table` also has — so the class this file builds on is, measured 2026-08-04,
// **57,829 bytes** of pure cost with the adapter's full test suite green either
// way (809,784 against 751,955). The decision to move to `ColumnTable` was taken
// against the premise that the verbs exist only as its methods, which is true and
// turned out not to be the constraint: `create` + `BitSet` is what those methods
// reduce to, and it is public. The class is **not** changed here, because the
// premise was the project owner's to weigh and reversing an approved decision on
// a measurement they have not seen would be the wrong way round. The measurement
// is in the deferred-work ledger with both numbers.
//
// **The two verbs are built from `create` and `BitSet` rather than from
// `table.filter()` and `table.select()`, and that is a decision rather than an
// oversight.** Both public methods reduce to exactly these two calls internally —
// `_filter` builds a `BitSet` and calls `table.create({ filter })`, and `_select`
// builds a column set and calls `table.create({ data, names })` — so the shared-
// column behaviour the memory measurement licensed is the same behaviour, byte
// for byte. What is avoided is what sits in front of them. `table.filter()` runs
// its argument through the expression parser, and even the `escape()` route,
// which is what AD-30 leaves open, compiles to a call that builds **one row
// object per row**, at the NFR-3 shape 100,000 objects of twenty keys per
// condition. And `table.select({ from: to })` resolves its mapping through object
// key enumeration order, where a column called `1` or `07` sorts itself to the
// front — the same hazard `fromColumns` below already guards with an explicit
// `names` array, and a Source's column names are whatever the exporter wrote.

import { BitSet, ColumnTable } from 'arquero'

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
 * The one column name that is not a name — it is `Object.prototype`'s accessor,
 * and `out[name] = value` against it is a **silent no-op** on any object that
 * inherits from `Object.prototype`.
 *
 * Measured on this adapter before it was fixed: a column called `__proto__` was
 * reported by `schema()`, answered by `column()`, and simply absent from every
 * object `rows()` yielded — the row was one key short and nothing said so.
 * Arquero's own row builder drops it too (it codegens an object literal), which
 * is why `rows()` below reads the columns rather than the engine's row objects.
 *
 * A CSV header is whatever the exporter wrote, so this is a real name, not a
 * hypothetical. `fromColumns` guards the same hazard one level up with
 * `Object.create(null)`; here the row must keep `Object.prototype` — AD-5
 * promises a *plain* object, and a consumer calling `hasOwnProperty` or
 * `JSON.stringify` on it is entitled to the usual answers — so the key is
 * written with `defineProperty` instead, which creates an own data property and
 * leaves the prototype alone.
 */
const PROTO_KEY = '__proto__'

const writeCell = (row, name, value) => {
  if (name === PROTO_KEY) {
    Object.defineProperty(row, name, { value, enumerable: true, writable: true, configurable: true })
  } else {
    row[name] = value
  }
}

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

  /**
   * Plain frozen row objects, one at a time (AD-5) — this is an edge, and an
   * edge is where rows are allowed to exist at all. A generator rather than an
   * array so a preview reading fifty rows of a hundred thousand pays for fifty:
   * the engine's own `objects()` builds the whole thing unless it is handed a
   * limit, and a caller that forgot the limit would be a silent copy of the
   * dataset.
   *
   * **Built from the columns rather than from the engine's own row objects**,
   * for two reasons that arrived together. Arquero's row builder codegens an
   * object literal, so a column called `__proto__` is missing from every row it
   * makes and nothing says so — reading through it would put the defect one
   * layer out of reach. And going through it allocated a second object per row
   * on the one path AD-5 says is called for preview, export and the
   * SessionStore.
   *
   * What that costs is honouring the view ourselves: a filtered or ordered table
   * is walked through `indices()`, which materializes and caches a
   * `Uint32Array` of the backing row count — so it is asked for **only** when
   * there is a filter or an order to honour, and an ordinary table counts up
   * instead and allocates nothing.
   */
  const columns = names.map((name) => t.column(name))

  function* rows() {
    const order = t.isFiltered() || t.isOrdered() ? t.indices() : null
    const n = t.numRows()
    for (let r = 0; r < n; r += 1) {
      const at = order === null ? r : order[r]
      const out = {}
      for (let c = 0; c < names.length; c += 1) {
        writeCell(out, names[c], unbox(columns[c].at(at)))
      }
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

// --- the comparison, and the two things only this file may know -----------
//
// AD-22: a comparison never matches a box. AD-21: a temporal value is
// nanoseconds as a `BigInt`, and `core/` may not construct one — so a temporal
// comparison value crosses the port as an ISO 8601 string and is converted here,
// **once per condition** rather than once per row.

const NANOS_PER_MILLI = 1_000_000n
const NANOS_PER_SECOND = 1_000_000_000n

/** `YYYY-MM-DD`, and nothing looser: a canonical machine value is not a display
 *  form, so a two-digit year or a dotted date is a value this side refuses
 *  rather than guesses at. */
const ISO_DATE = /^(-?\d{4,6})-(\d{2})-(\d{2})$/
/** `YYYY-MM-DDTHH:MM[:SS[.f…]][Z|±HH:MM]`, with a space accepted for the `T`
 *  because that is what every database export writes. */
const ISO_DATETIME =
  /^(-?\d{4,6})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?$/
/** `HH:MM[:SS[.f…]]` — ISO 8601's extended time, bounded to a clock position. */
const ISO_TIME = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/
/** A duration is a quantity rather than a clock position, so its hours field is
 *  unbounded and it may be negative — the same shape `core/types` reads out of a
 *  time-account export. */
const CLOCK_DURATION = /^(-)?(\d+):([0-5]\d)(?::([0-5]\d))?$/

/** Nine digits is the representation's own resolution (AD-21), and `.5` and
 *  `.500000000` are the same quantity — so the digits are right-padded rather
 *  than parsed as a decimal, which is also what keeps this in integer range. */
const fractionNanos = (fraction) => (fraction ? BigInt(fraction.padEnd(9, '0')) : 0n)

/**
 * UTC midnight of a calendar day, in epoch milliseconds.
 *
 * `Date.UTC` maps years 0–99 onto 1900–1999. The pattern above requires four
 * digits, so the fast path covers everything it can match; the guard stays
 * because a year is a number this function is handed, not one it parsed.
 */
function utcMidnightMillis(year, month, day) {
  if (year >= 100 && year <= 9999) return Date.UTC(year, month - 1, day)
  const d = new Date(0)
  d.setUTCFullYear(year, month - 1, day)
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime()
}

const offsetMinutes = (zone) => {
  if (!zone || zone === 'Z') return 0
  const sign = zone[0] === '-' ? -1 : 1
  return sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)))
}

/**
 * A comparison value as the Table holds it, or `null` where the string is not a
 * canonical form of that type.
 *
 * `null` is a return value rather than a throw: an unreadable comparison value is
 * a state of the configuration, and the port carries it back as `unreadable` so
 * `core/steps/` can mint a Diagnostic naming the column and the value.
 */
export function comparisonValue(type, value) {
  if (type === 'date') {
    const m = ISO_DATE.exec(value)
    if (!m) return null
    return BigInt(utcMidnightMillis(Number(m[1]), Number(m[2]), Number(m[3]))) * NANOS_PER_MILLI
  }
  if (type === 'datetime') {
    const m = ISO_DATETIME.exec(value)
    if (!m) return null
    const millis =
      utcMidnightMillis(Number(m[1]), Number(m[2]), Number(m[3])) +
      ((Number(m[4]) * 60 + Number(m[5])) * 60 + Number(m[6] ?? 0)) * 1000 -
      offsetMinutes(m[8]) * 60_000
    return BigInt(millis) * NANOS_PER_MILLI + fractionNanos(m[7])
  }
  if (type === 'time') {
    const m = ISO_TIME.exec(value)
    if (!m || Number(m[1]) > 23) return null
    return (
      BigInt(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)) * NANOS_PER_SECOND +
      fractionNanos(m[4])
    )
  }
  if (type === 'duration') {
    const m = CLOCK_DURATION.exec(value)
    if (!m) return null
    const magnitude =
      (BigInt(m[2]) * 3600n + BigInt(Number(m[3]) * 60 + Number(m[4] ?? 0))) * NANOS_PER_SECOND
    return m[1] ? -magnitude : magnitude
  }
  // `text`, `number` and `boolean` compare as themselves. The Step kind has
  // already refused a value whose JavaScript kind disagrees with the column.
  return value
}

const TEMPORAL = new Set(['date', 'datetime', 'time', 'duration'])

/**
 * Is this cell empty?
 *
 * `null`, the empty string and a whitespace-only string alike — CAP-15 states it
 * in as many words and `ui/` says so in German beside the operator. A box is
 * never asked: it is excluded before this is reached.
 */
const isEmptyCell = (value) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '')

/**
 * Whether one cell satisfies one operator.
 *
 * A `null` matches no ordering or equality operator, and that is a guard rather
 * than a convention: `null < 5` is `true` in JavaScript, so an absent value would
 * quietly join every "smaller than" filter in the product.
 */
function matches(op, cell, target) {
  if (op === 'empty') return isEmptyCell(cell)
  if (op === 'not_empty') return !isEmptyCell(cell)
  if (cell === null || cell === undefined) return false
  switch (op) {
    case 'eq':
      return cell === target
    case 'ne':
      return cell !== target
    case 'lt':
      return cell < target
    case 'lte':
      return cell <= target
    case 'gt':
      return cell > target
    /* c8 ignore next 2 -- the vocabulary is closed in core/steps/filter.js */
    case 'gte':
      return cell >= target
    default:
      throw new TypeError(`unknown comparison operator: ${op}`)
  }
}

/**
 * The engine `app/` wires into the `TableEngine` port (AD-1).
 *
 * A factory rather than a module-level singleton, so a test gets its own and
 * nothing accumulates across one.
 */
export function createArqueroEngine() {
  /**
   * Handle → the engine table behind it, and the column types beside it.
   *
   * A `WeakMap` rather than a field on the handle: AD-5 froze the interface at
   * four methods, and a fifth reachable property would be a fact about the
   * representation that a consumer could come to depend on. It is per engine
   * instance rather than per module for the same reason the factory exists —
   * a test gets its own, and a handle from another engine is a caller's bug that
   * is caught rather than silently half-working.
   */
  const backing = new WeakMap()

  const wrap = (t, types) => {
    const handle = handleFor(t, types)
    backing.set(handle, { t, types })
    return handle
  }

  const behind = (table) => {
    const found = backing.get(table)
    if (!found) throw new TypeError('this Table was not produced by this engine')
    return found
  }

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
      // **Every precondition first, then the mutation.** The boxing below writes
      // into the caller's arrays in place, and a refusal raised halfway through
      // would leave the caller holding columns that are partly boxed — which the
      // port says it may not read, so it could neither use them nor recover
      // them. Two passes is the price of a refusal that changes nothing.
      const types = new Map()
      for (const { name, type } of columns) {
        if (types.has(name)) {
          throw new TypeError(`a table cannot hold two columns called ${name}`)
        }
        types.set(name, type)
      }

      const data = Object.create(null)
      const names = []

      for (const { name, values, unparsed } of columns) {
        for (const at of unparsed) values[at] = new Unparsed(values[at])
        data[name] = values
        names.push(name)
      }

      // `names` explicitly rather than key enumeration order: a column called
      // `1` or `07` would otherwise sort itself to the front, because an
      // integer-like key is enumerated before every string one — and a Source's
      // column names come from whatever the exporter wrote in the header row.
      return wrap(new ColumnTable(data, names), types)
    },

    /**
     * Keep the rows the conditions admit (CAP-15).
     *
     * **The box is why this returns counts rather than a bare Table.** A value
     * that did not parse under its confirmed type is held as a box (AD-22) and
     * this file is the only one that can see one, so it is also the only one that
     * can say how many rows a box excluded. `core/steps/filter.js` turns the
     * numbers into Diagnostics; the German is `ui/`'s (AD-13).
     *
     * The comparison value is converted **once per condition**: a temporal value
     * arrives as an ISO 8601 string and becomes a `BigInt` here, before the row
     * loop, rather than 100,000 times inside it.
     *
     * A `BitSet` over the backing rows, and `create({ filter })` to hang it on a
     * new table: the columns are shared, so a chain of filters costs one
     * `Uint32Array` per link — ~12.5 kB at the NFR-3 shape — and no column data
     * at all. An existing filter is honoured by walking the current mask rather
     * than the full row range, exactly as the engine's own `_filter` does.
     */
    filter(table, { conditions = [], combine = 'all' } = {}) {
      const { t, types } = behind(table)

      // Every condition prepared before the walk, and an unreadable value
      // reported before a single row is examined — a filter nobody can evaluate
      // must not produce a table that is merely a different one.
      const prepared = []
      const unreadable = []
      for (const condition of conditions) {
        const type = types.get(condition.column)
        if (type === undefined) {
          // Refused one layer up, against the input schema, where it can be a
          // Diagnostic. Reaching here is a caller's bug.
          throw new TypeError(`no column ${condition.column} in this table`)
        }
        const valueless = condition.op === 'empty' || condition.op === 'not_empty'
        const target = valueless ? undefined : comparisonValue(type, condition.value)
        if (!valueless && TEMPORAL.has(type) && target === null) {
          unreadable.push(Object.freeze({ column: condition.column, type, value: condition.value }))
          continue
        }
        prepared.push({ op: condition.op, column: t.column(condition.column), target })
      }
      if (unreadable.length > 0) {
        return Object.freeze({
          table: null,
          removed: 0,
          boxed: 0,
          unreadable: Object.freeze(unreadable),
        })
      }

      const total = t.totalRows()
      const mask = t.mask()
      const kept = new BitSet(total)
      let boxed = 0

      const admits = (row) => {
        let anyMatch = false
        let sawBox = false
        for (const { op, column, target } of prepared) {
          const cell = column.at(row)
          // AD-22 — a box matches no operator, and it matches none of them
          // *including* `not_empty`, whose strict complement would otherwise
          // smuggle every unreadable cell through as non-empty text.
          if (cell instanceof Unparsed) {
            sawBox = true
            if (combine === 'all') return { pass: false, sawBox: true }
            continue
          }
          const ok = matches(op, cell, target)
          if (combine === 'all') {
            if (!ok) return { pass: false, sawBox }
          } else if (ok) {
            anyMatch = true
          }
        }
        return { pass: combine === 'all' ? true : anyMatch, sawBox }
      }

      const consider = (row) => {
        // No condition is the identity, and it is written as a branch rather
        // than falling out of the loop so a freshly added Filter costs nothing
        // per row at all.
        if (prepared.length === 0) {
          kept.set(row)
          return
        }
        const verdict = admits(row)
        if (verdict.pass) kept.set(row)
        // Counted only where the box actually decided the outcome: under `any`,
        // a row with a box in one column and a match in another is kept, and
        // reporting it as dropped would be a number about nothing.
        else if (verdict.sawBox) boxed += 1
      }

      if (mask) {
        for (let i = mask.next(0); i >= 0; i = mask.next(i + 1)) consider(i)
      } else {
        for (let i = 0; i < total; i += 1) consider(i)
      }

      const before = t.numRows()
      const next = wrap(t.create({ filter: kept }), types)
      return Object.freeze({
        table: next,
        removed: before - next.rowCount(),
        boxed,
        unreadable: Object.freeze([]),
      })
    },

    /**
     * The columns that leave, under the names they leave with, in the order the
     * config lists them (CAP-16).
     *
     * `create({ data, names })` is what arquero's own `select` reduces to once
     * its selection helpers have resolved: the column arrays are **shared** with
     * the input table, so this costs a new names array and nothing else, and the
     * table's filter is inherited rather than reified. `names` is explicit for
     * the reason it is explicit in `fromColumns` — a column called `1` would
     * otherwise sort itself to the front of any key enumeration.
     *
     * A repeated `to` and an unknown `from` both throw. Both are refused one
     * layer up where they can be Diagnostics — the first at configure time, the
     * second against the input schema — so reaching here is a caller's bug.
     */
    selectColumns(table, ordered) {
      const { t, types } = behind(table)

      const data = Object.create(null)
      const names = []
      const nextTypes = new Map()

      for (const { from, to } of ordered) {
        if (!types.has(from)) throw new TypeError(`no column ${from} in this table`)
        if (nextTypes.has(to)) throw new TypeError(`a table cannot hold two columns called ${to}`)
        data[to] = t.column(from)
        names.push(to)
        nextTypes.set(to, types.get(from))
      }

      return wrap(t.create({ data, names }), nextTypes)
    },
  }
}
