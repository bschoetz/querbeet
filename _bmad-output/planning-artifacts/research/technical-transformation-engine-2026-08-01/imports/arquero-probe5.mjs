// Probe 5: the cost of the null-key join workarounds at realistic scale.
// src/verbs/join.js selects hashJoin for an array of keys and loopJoin for a
// predicate function. If the predicate path is O(n*m), it is unusable here.

import * as aq from 'arquero'

const N_MAIN = 100_000
const N_LOOKUP = 5_000

let seed = 7
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }

const main = Array.from({ length: N_MAIN }, (_, i) => ({
  id: i,
  // ~8% of rows carry a null key, which is what makes this question real
  k: rnd() < 0.08 ? null : 1 + Math.floor(rnd() * N_LOOKUP),
  betrag: Math.round(rnd() * 10000) / 100,
}))
const lookup = Array.from({ length: N_LOOKUP }, (_, i) => ({ k: i + 1, name: 'K' + i }))
lookup.push({ k: null, name: 'UNBEKANNT' })

const L = aq.from(main)
const R = aq.from(lookup)

const time = (label, fn, budgetMs = 30000) => {
  const t0 = performance.now()
  let res, err = null
  try { res = fn() } catch (e) { err = String(e.message).slice(0, 120) }
  const ms = Math.round((performance.now() - t0) * 10) / 10
  return { label, ms, err, rows: res && res.numRows ? res.numRows() : null, over_budget: ms > budgetMs }
}

const results = []

// Baseline: plain hash join on a key array. Nulls will not match.
results.push(time('hash_join_keys_nulls_unmatched', () => L.join_left(R, ['k', 'k'])))

// Sentinel substitution, keeping the hash join.
results.push(time('sentinel_then_hash_join', () => {
  const S = '__NULL__'
  const l = L.derive({ _k: aq.escape(d => d.k == null ? S : d.k) })
  const r = R.derive({ _k: aq.escape(d => d.k == null ? S : d.k) }).select({ _k: '_k', name: 'name' })
  return l.join_left(r, ['_k', '_k']).select(aq.not('_k'))
}))

// The predicate workaround. Expected to fall back to a nested loop join.
// Guarded: run it on a deliberately small slice first to estimate the cost.
const smallL = aq.from(main.slice(0, 2000))
const small = time('predicate_join_2k_rows', () =>
  smallL.join_left(R, (a, b) => a.k === b.k || (a.k == null && b.k == null)))
results.push(small)

if (small.ms !== null && !small.err) {
  // Extrapolate: loop join is O(n*m), so 100k rows costs 50x the 2k time.
  const projected = Math.round(small.ms * (N_MAIN / 2000))
  results.push({ label: 'predicate_join_100k_PROJECTED', ms: projected, note: 'extrapolated from the 2k measurement assuming O(n*m); not executed' })
}

console.log(JSON.stringify({ n_main: N_MAIN, n_lookup: N_LOOKUP, results }, null, 2))
