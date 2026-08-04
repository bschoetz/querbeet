// The per-Step cache's storage half (AD-8): bounded by total retained rows,
// least-recently-used first out.
//
// **An eviction is a miss, never a wrong answer.** That is the whole contract
// and it is what makes a bound safe to pick without knowing the graph: the
// evicted Step recomputes and produces an identical result, because the key is
// content-addressed and a Step is a pure function of its config and its inputs
// (AD-4). Nothing here has to be told when something goes stale — a changed
// Step has a different key and the old entry is unreachable rather than wrong,
// and it leaves on the same terms as any other cold entry.
//
// It is a plain `Map` in a closure, deliberately: an entry holds a `Table`
// handle, which may never enter `ref`, `reactive` or a `computed` return value
// (AD-6), and the only way to be sure of that is for it never to be reachable
// from reactive state at all. `ui/App.vue` creates it in `setup` beside Step
// zero's, which is the line that already owns a cache for the same reason.
//
// No persistence: the cache dies with the page. `SessionStore` stays the empty
// typedef it is.

/**
 * **Why the bound is 15,000,000 rows.** Research R4 measured 30 retained
 * intermediates at half a million rows costing 180 MB, against the ~550 MB the
 * memory plan works from — and that configuration *is* 15 million retained
 * rows, so it is the largest shape the research has actually licensed. The
 * number is therefore a licence rather than a measurement of this cache; the
 * figure this story measured against it is recorded in the story's Design Notes,
 * and moving the constant is the project owner's call rather than a caller's.
 */
export const DEFAULT_MAX_ROWS = 15_000_000

/**
 * A run cache: `{ get, set, rows, size, clear }`.
 *
 * Insertion- and access-ordered, which a `Map` gives for free — iteration order
 * is insertion order, and a `get` that re-inserts moves the key to the back. So
 * the least recently *used* entry is always the first key the iterator yields,
 * and eviction is one `keys().next()` rather than a second structure to keep in
 * step with this one.
 *
 * @param {{ maxRows?: number }} [options]
 */
export function createRunCache({ maxRows = DEFAULT_MAX_ROWS } = {}) {
  if (!Number.isFinite(maxRows) || maxRows < 0) {
    throw new TypeError('createRunCache needs a finite, non-negative maxRows') // programming error
  }

  /** @type {Map<string, { entry: object, rows: number }>} */
  const held = new Map()
  let rows = 0

  /** A Step that produced no table retains nothing, and an entry from before
   *  the counts existed retains nothing we can account for. Either way it costs
   *  zero against the bound rather than `NaN`, which would poison every later
   *  comparison and stop eviction altogether. */
  const rowsOf = (entry) => (Number.isFinite(entry?.rowCount) ? entry.rowCount : 0)

  const evictOldest = () => {
    const oldest = held.keys().next()
    if (oldest.done) return false
    rows -= held.get(oldest.value).rows
    held.delete(oldest.value)
    return true
  }

  return {
    /**
     * The entry for `key`, or `undefined`. A hit counts as a use: the key moves
     * to the back of the eviction order, which is the whole difference between
     * least-recently-used and first-in-first-out — the Step a user is editing
     * downstream of is read on every run and must not be the one thrown away.
     */
    get(key) {
      const slot = held.get(key)
      if (slot === undefined) return undefined
      held.delete(key)
      held.set(key, slot)
      return slot.entry
    },

    /**
     * Store an entry under its key, then evict until the bound holds.
     *
     * **A single entry larger than the whole bound is stored and becomes the
     * only entry, rather than being refused.** Refusing it would mean a table
     * that never caches while every eviction pass around it still ran — all of
     * the bookkeeping and none of the hit — and the row bound is a memory plan
     * for a *session*, not a per-Step admission test. The last-one-standing rule
     * is the stop condition below: eviction never touches the entry just
     * written.
     */
    set(key, entry) {
      const previous = held.get(key)
      if (previous !== undefined) rows -= previous.rows
      held.delete(key)

      const cost = rowsOf(entry)
      held.set(key, { entry, rows: cost })
      rows += cost

      while (rows > maxRows && held.size > 1) evictOldest()
      return entry
    },

    /** Total retained rows — what the bound is expressed in. */
    rows: () => rows,
    /** How many entries are held. For a test and for a memory report; nothing in
     *  the product branches on it. */
    size: () => held.size,
    /** Drop everything. Nothing in the product calls it yet; it is the shape a
     *  session reset needs and the shape a test needs between cases. */
    clear() {
      held.clear()
      rows = 0
    },
  }
}
