---
title: 'Story 7a — The per-Step cache: content-addressed, diagnostics replayed, bounded'
type: 'feature'
created: '2026-08-04'
status: 'in-review'
review_loop_iteration: 1
baseline_commit: 'b812172e92d10366207a1871bd6ba05cf1fc9634'
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every run recomputes every Step from scratch — `core/exec/execute.js:6-11` says so in as many words, and the measured cost is a factor of 20 to 26 on the case users actually hit (editing the last Step of a 30-Step graph: 24.1/54 ms cached against 496.4/1394 ms recomputed). The one cache that does exist, `createStepZeroCache` in `core/exec/convert.js:217-241`, is keyed on the *object identity* of a frozen registry entry, which works only because the store re-mints an entry on every change; it holds a table and no diagnostics, and it is bounded by the number of Sources rather than by anything the memory plan can reason about.

**Approach:** Give execution a content-addressed cache: `key(step) = hash(canonical(config) + key(inputs))` over a base case `key(source) = hash(byteDigest + parseConfig + encoding)`, so what a Step *is* decides the entry and what it is *called* or *where it sits* does not. One entry carries the table and its diagnostics together and a hit replays both, because a repeat run that reports clean over warnings it never re-emitted is the exact failure this product exists to prevent. The cache is bounded by total retained rows with least-recently-used eviction, and an eviction is a miss and never a wrong answer.

## Boundaries & Constraints

**Always:**

- `key(step) = hash(canonical(config) + key(inputs))`; `key(source) = hash(byteDigest + parseConfig + encoding)`. **A Source id is never part of a key** (AD-8) — an encoding change, a delimiter change, a header-row change and a re-read all produce different bytes or a different parse from an unchanged id.
- `name`, `x` and `y` are **never** in a key. Renaming or moving a Step must not evict anything; that is already the interim recompute rule's contract (`ui/EditorPane.test.js:394-412`) and the cache must not weaken it.
- **A cache entry holds `{ table, rowCount, columnCount, diagnostics }` together**, exactly the object `core/exec/execute.js:180-191` already records, and a hit puts that object into `results` unchanged — same frozen diagnostics, same `stepId` stamps, no re-derivation.
- The hash is **pure, synchronous and browser-free**: `core/` may not become async and may not name a platform API (AD-1, AD-2). `executeGraph` stays a synchronous function.
- The cache is a plain `Map` in a closure. **No table and no cache handle may enter `ref`, `reactive` or a `computed`** (AD-6).
- The canonical serializer is **one implementation** and is written so story 14's Recipe file can adopt it unchanged. It refuses what it cannot serialize deterministically rather than silently producing a key that two different configs share.
- Configs are guaranteed plain frozen data by `core/graph/graph.js:322-332` — strings, numbers, booleans, arrays, objects, no cycles, no `BigInt`. The serializer relies on that and asserts it.
- An eviction is a **miss**, never a wrong answer: the evicted Step recomputes and produces an identical result.

**Ask First:**

- If the measured memory per retained row at design scale disagrees materially with research R4's 180 MB for 30 intermediates at half a million rows, the row bound changes the whole memory plan (~550 MB) — **HALT and report the measurement before picking a different constant.**
- If `canonical()` turns out to need a case the frozen guarantee does not cover (a `BigInt`, a `Date`, a class instance reaching a config from a Step kind added later), **HALT** rather than inventing an encoding — story 14 has to round-trip whatever is decided.

**Never:**

- No `crypto.subtle`, no `Worker`, no async anywhere on the execution path. `crypto.subtle.digest` is a promise and would make `executeGraph` async two stories before the scheduler that is supposed to make it async.
- No cancellation, no progress, no yield point, no run identity, no mode switch, no row threshold — 7b and 7c.
- No change to what a Step computes, to any Step kind, to the engine adapter, or to the interim recompute rule in `ui/EditorPane.vue:68-88`. A cached run and an uncached run must be indistinguishable except in time.
- No new diagnostic code and no new German sentence. A replayed warning is the warning, not a report about the cache.
- No persistence — the cache dies with the page. `SessionStore` stays the empty typedef it is.
- No sampling shortcut in the byte digest. A digest over part of a file is a wrong answer waiting for a file that differs elsewhere.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Repeat run, nothing changed | A confirmed Source → Filter → Columns chain, run twice | Second run calls no Step's `apply`; every result carries the same rows, counts and diagnostics as the first | N/A |
| A config returns to a previous value | Filter value `10` → `20` → `10` | The third state is a hit; nothing recomputes | N/A |
| A Step is renamed or moved | `renameStep` / `moveStep`, then a run | Hit at that Step and at everything downstream — the key never saw the name or the position | N/A |
| A Source is re-parsed | Delimiter changed from `,` to `;` on the same file | Miss at Step zero and at every Step downstream of it; the id did not change and must not decide | N/A |
| A different file is re-read into the same Source | Same Source id, different bytes, unchanged parse config | Miss — the byte digest differs | N/A |
| A Step is configured for the first time | `config: null` set to the kind's `defaultConfig()` | Hit, not a miss: `null` and the default config canonicalize identically | N/A |
| The row bound is exceeded | Retained rows over the bound after a store | Least-recently-used entries evicted until the bound holds; an evicted Step recomputes to an identical result | N/A |
| A Step throws | `kind.apply` throws, `exec.step_threw` recorded | Nothing is stored for that Step; the next run calls it again and records the same diagnostic | Existing `try/catch` at `core/exec/execute.js:240-248` is unchanged |
| A run is refused at a gate | An unconfirmed Source in the frontier | The cache is neither read nor written; `refused()` is returned as today | N/A |
| A config the serializer cannot encode | A value that is not a string, number, boolean, array, plain object or `null` | `canonical()` throws with the offending path named | Throws — a silent key collision would serve one Step's table as another's |

</frozen-after-approval>

## Code Map

**The walk, and where the two seams are:**

- `core/exec/execute.js:144` `executeGraph({ steps, resultId, engine, sourceTable })` — the only entry point, plain synchronous `function`, **two callers**: `ui/EditorPane.vue:157` (inside `recompute()`) and the test file. `:40-43` states "Nothing here holds state between calls" — that sentence changes with this story and the cache arrives as a parameter rather than as module state, so the file keeps its purity and the owner stays outside.
- `core/exec/execute.js:107-125` `inDependencyOrder(nodes, frontier)` — DFS post-order; `:193` `for (const node of order)` is the loop. **Keys are computed in this loop and in this order**, because a Step's key needs its inputs' keys and dependency order guarantees they exist.
- `core/exec/execute.js:161-173` — the gate loop runs over the whole order **before anything computes**; a refusal returns early. The cache must be neither read nor written above this line.
- `core/exec/execute.js:180-191` `record(node, table, diagnostics)` — builds the frozen `{ kind, table, rowCount, columnCount, diagnostics }`. **This object is the cache entry**; nothing new needs designing.
- `core/exec/execute.js:193-196` — Source nodes record `sourceTable(node.id)` with empty diagnostics. Source diagnostics live on the registry entry (`core/exec/source-store.js:369-373`), not in the run, so a Source entry has nothing to replay — its key exists to be an *input* key.
- `core/exec/execute.js:223-224` — `const config = node.config ?? kind.defaultConfig()`. **The `null` fallback is the canonicalization trap**: key the resolved config, never the raw field, or the first `configureStep` to the default is a spurious miss.
- `core/exec/execute.js:240-248` — `kind.apply(...)` in `try/catch`. Lookup goes immediately before, store immediately after `record(...)` at `:254-260`.
- `core/exec/execute.js:254-260` — diagnostics are `stepId`-stamped here once. A replayed entry is already stamped; **do not stamp twice**.
- `core/exec/execute.js:269-287` — `exec.run_incomplete` is computed from `results` and the return concatenates every Step's diagnostics. **So storing diagnostics in the entry is the whole of "a hit replays them"** — the run stream reassembles itself with no extra code.
- `core/exec/execute.js:55-65` `CODE` / `EXEC_CODES` — untouched by this story; no new code is minted, so `ui/graph-labels.js:437-447` stays green without an edit.

**What a key is made of, and what does not exist yet:**

- `core/graph/graph.js:86-103` `makeNode` — a node is `{ id, kind, name, x, y, inputs, config }`; `:96-101` `config` is "this file's one opaque field". `:303-309` `configureStep` `deepFreeze`s it; `:322-332` **guarantees plain data with no cycles and no `BigInt`** — the licence for a serializer with no cycle guard.
- `core/graph/graph-store.js:43-55` `freezeStep` — **a new frozen step object on every commit**, so step identity is not stable across commands; only the `config` sub-object's identity is. That is exactly why entry-identity keying (the `convert.js` trick) cannot be lifted to Steps and why a content hash is the answer.
- `core/graph/graph.js:379-395` `contributingTo` — returns a `Set<string>` of ids, unordered.
- `core/exec/source-store.js:369-375` `commit` — the one funnel every entry passes through; it spreads what it is handed and freezes. The field list it is handed is spelled out at `:562-575` (`addSource`): `id, name, fileName, extension, bytes, encoding, parseConfig, table, typing, proposal, damage, readDiagnostics`. **`byteDigest` joins that list at `:562` and nowhere else** — every other `commit` call site spreads `...entry` or `...current` and carries the digest over for free.
- `core/exec/source-store.js:567` — `bytes` is the raw `ArrayBuffer`; **nothing anywhere derives anything from it**. `:542` — `parseConfig` is exactly `{ delimiter, headerRow, sheet }`; `:677-682` `reconfigureParse` rebuilds it. `:543,550,614` — `encoding` is `{ chosen, source, override }` and is **a separate field**, so a key built from `parseConfig` alone would serve a UTF-8 parse for a Latin-1 one.
- `core/exec/source-store.js:529` `addSource({ bytes, fileName })` — **the only place bytes ever arrive.** `:1-4` and `:469-471` state AD-7's rule and `:486,490` prove it: `reRead` always re-parses `entry.bytes` and never takes new ones, so a re-parse changes the *parse* half of `key(source)` and never the digest half. `:346-358` `serialize(id, work)` is the per-Source promise chain `addSource` runs in; the digest is computed there, once per ingest, never per run. **Consequence for the matrix row "a different file under the same Source id": no store command produces that state today** — a new file is a new `addSource` with a newly minted id (`:317` `mintId`, AD-14 never reuses one). The row is a property of `sourceKey` and is tested where it lives, in `cache-key.test.js`, not through the store.
- `core/exec/source-store.js:462-465` — `entry.typing = { columns, confirmed }`; a column carries `{ name, type, format, counts, verdict, evidence, missingTokens, domain, annotation, chosen }` (`core/types/typing.js:1743-1752`), all strings, numbers, arrays and `null`. **This is Step zero's config** and it canonicalizes.
- `core/exec/convert.js:192-215` `convertSource(entry, engine)` → `{ table, unparsed }` or `null` when typing is unconfirmed; `:217-241` the cache doc — **read `:221-227` before writing anything**: it already argues AD-8's case and explains why entry identity was chosen as the interim. `:239-266` `createStepZeroCache(engine)` → `{ of, release, size }`; `:249-261` `of(entry)` hits iff `hit.entry === entry`.
- `ui/App.vue:50` — `createStepZeroCache(props.engine)` in `setup`, passed as a prop at `:99` and `:109`; released at `ui/SourcesPane.vue:663-670`. **The owner of any new cache is this line**, for the reasons story 6b measured (two caches convert the same Source twice at 545–555 ms and retain it twice at 39.3 MB).
- `ui/SourcesPane.vue:160,180,195,669` `markMemo` — a *second* identity-keyed memo with the same lifecycle. Out of scope, named so the next reader knows it was seen.
- `ports/index.js:19-30` `Table` — `rowCount()` is the row accounting this story bounds against, already called once per Step at `core/exec/execute.js:186`. `:364-369` `Clock` is declared and unimplemented — **7b's, not this story's.** There is no `Hasher` port and this story does not add one: a hash is deterministic and pure, so AD-4's reason for the `Clock` port does not apply.
- `core/diagnostics/diagnostic.js:32-37` — the freeze is **already justified by AD-8 in the source**: "it crosses Step boundaries and lands in a cache entry alongside the table it describes — a mutable one would let a cache hit replay something other than what the run emitted." Diagnostics are replayable as they stand; nothing needs cloning.

**Absent, and therefore this story's to create:**

- **No hashing of any kind anywhere.** `grep -niE "hash|digest|crypto|subtle"` over all non-vendored source returns two prose hits (`vite.config.js:34`, `tests/e2e/single-file.spec.js:138`). This story writes the first.
- **No canonical or stable-key-order serializer anywhere.** The `CANONICAL` in `core/types/typing.js:1551` is a reader table and the "canonical text" in the XLSX/Parquet readers is cell text; neither serializes a config.
- **No LRU, no eviction, no row-budget accounting** — `grep -i "lru|evict"` returns zero source hits.

**Tests:**

- `core/exec/execute.test.js:1-14` — real graph store, real Arquero engine reached by dynamic import so no static import leaves `core/` (AD-1); helpers `typed()`, `run(graph, confirmed)`, `codesOf`, `chain()` at `:16-59`.
- `core/exec/convert.test.js:491-555` `describe('the Step-zero cache')` — six cases covering exactly the semantics this story re-keys. **The template; each case must still pass, with identity swapped for the content key.**
- `ui/EditorPane.test.js:303-334` `countingEngine()` — counts `filter`/`selectColumns` calls, and `:394-412` already asserts that a rename and a move recompute nothing. **This is the harness that proves a hit is a hit**, and it lives in the `ui` project.
- `vitest.config.js:52-88` — projects `core` (node) and `ui` (happy-dom). `playwright.config.js:19-30` — `file://` only, chromium + firefox.

## Tasks & Acceptance

**Execution:**

- [x] `core/exec/cache-key.js` (new) + `cache-key.test.js` -- covers the matrix row "a different file under the same Source id" as a `sourceKey` property, since no store command can produce that state (see Code Map); plus `canonical(value)` (recursive, keys sorted, typed prefixes so `1` and `"1"` and `true` cannot collide, throws naming the path on anything outside string/number/boolean/null/array/plain-object), `digest(text)` and `digestBytes(bytes)` (128-bit FNV-1a as four lanes, lowercase hex), `sourceKey({ byteDigest, parseConfig, encoding })`, `stepKey(kind, config, inputKeys)` -- one serializer, written so story 14 adopts it unchanged
- [x] `core/exec/source-store.js` + tests -- compute `byteDigest` from `bytes` in `addSource` (`:562`, the only place bytes arrive) and carry it on the frozen entry through `commit`; assert a re-parse (`reconfigureParse`, `overrideEncoding`) leaves the digest untouched while changing `parseConfig`/`encoding`, and that two different files digest differently -- the base case of every key, computed once per ingest rather than once per run
- [x] `core/exec/cache.js` (new) + `cache.test.js` -- `createRunCache({ maxRows })` → `{ get(key), set(key, entry), rows(), size(), clear() }`, insertion/access-ordered `Map` evicting least-recently-used until `rows()` fits `maxRows`; a single entry larger than the bound is stored and immediately the only entry rather than refused -- an eviction is a miss, never a wrong answer
- [x] `core/exec/execute.js` + test -- accept `cache` and `sourceKey(id)` as two new optional doors; compute each node's key inside the existing `:193` loop (Source → `sourceKey(id)`, Step → `stepKey(node.kind, resolvedConfig, inputKeys)`); look up before `kind.apply`, store the recorded entry after; **key the resolved config, not `node.config`**; no store for a Step that threw; nothing read or written above the gate loop -- absent `cache`, behaviour is byte-for-byte what it is today, so every existing test stays honest
- [x] `core/exec/convert.js` + test -- re-key `createStepZeroCache` from entry identity to `stepKey('typing', entry.typing, [sourceKey(entry)])`, keeping `{ of, release, size }` and the release-on-unconfirm rule; update the `:217-241` doc block to state the content key and why identity was the interim -- one key scheme, so the two stores cannot disagree about staleness
- [x] `ui/App.vue` + `ui/EditorPane.vue` -- create the run cache beside `stepZero` in `setup` (never in a `ref`), pass it to `EditorPane`, and hand `executeGraph` the cache plus a `sourceKey(id)` derived from the Source entry -- the owner is the line that already owns the other cache
- [x] `core/exec/execute.test.js` + `ui/EditorPane.test.js` -- the I/O matrix as cases: repeat run computes nothing, a config returned to a previous value hits, rename and move hit, a re-parse misses at Step zero and downstream, `null` → default config hits, an evicted Step recomputes identically, a throwing Step is never stored; use `countingEngine()` for the "computed nothing" assertions -- a cache that cannot be observed to hit is a cache nobody can trust
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append one entry: `ui/SourcesPane.vue`'s `markMemo` is a second identity-keyed memo over the same entries and now the only one left on the old scheme -- ledger hygiene, not this story's edit

**Review round 1 — the cache's edges (see Spec Change Log). Fix these; do not re-derive anything above.**

- [x] `core/exec/execute.js` + `core/exec/convert.js` + tests -- contain the key computation at both call sites so a `canonical` refusal becomes `key = null` (a miss on the path the executor already has) instead of a `TypeError` leaving the module; make `stepZeroKey`'s guard symmetric so a missing `encoding`, `parseConfig` or `typing` returns `null` exactly as a missing `byteDigest` already does; surface the refusal message where a developer sees it without minting a Diagnostic -- a run with a cache and a run without one must produce the same answer for every config the kind validators admit, which today they do not
- [x] `core/exec/cache.js` + `cache.test.js` -- add an entry ceiling beside the row ceiling (`maxEntries`, with a stated default) and evict while **either** is exceeded; reject `maxRows: 0` with the same programming-error `TypeError` as `-1` -- a bound a zero-row entry is invisible to does not bound the `Map`
- [x] `core/exec/execute.js` + test -- store only when `table !== null`, so an executor-returned refusal is treated exactly as a throw already is -- the Design Notes' rule is about the entry, not about which failure path produced it
- [x] `ui/App.vue` + `ui/SourcesPane.vue` + tests -- clear the run cache when a Source is removed or its typing unconfirmed, beside the existing `stepZero.release(id)`; `clear()` already exists and is the honest primitive for a content-keyed store with no id to release by -- AD-29: a table computed from types nobody vouches for must not survive the withdrawal
- [x] `ui/App.test.js` (new) -- mount `App` with a `countingEngine()`, run a graph, switch to the Sources tab and back, assert the engine was not asked again -- today deleting `:cache="runCache"` from `ui/App.vue:124` leaves all 994 tests green, so the one line that makes the feature exist in the product is unprotected
- [x] `core/exec/convert.test.js` (or `source-store.test.js`) -- one case that ingests through the real `createSourceStore`, confirms typing, and asserts `typeof stepZeroKey(entry) === 'string'` -- every current key test hand-builds its typing object, so a `core/types/typing.js` change that adds a `Date`, a `Set` or an explicit `undefined` to a column record blanks the Sources pane with the suite green
- [x] `core/exec/convert.js` -- do not store a conversion under a `null` key; return it unstored -- retention with no possible hit
- [x] `core/exec/cache.test.js` + `ui/EditorPane.test.js` -- correct the eviction case's comment (at `maxRows: 1` the Filter's insert evicts nothing; the Columns insert does, and the survivor counted is Columns) and add a partial-eviction case where some entries survive; rename the "misses when the Source behind it was re-read, id unchanged" case so it does not assert a store state the Code Map shows cannot occur -- a test whose name contradicts the spec teaches the wrong invariant
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append the four deferred findings named in the review: a failed `reRead` commits a `parseConfig` that never happened while keeping the previous table; `digest('')` and `digestBytes(new ArrayBuffer(0))` collide by design, which matters when story 14 puts both in one namespace; the engine is not in the key while `createStepZeroCache(engine)` binds one; re-measure the row bound when a kind that materializes new columns lands (Aggregate/Join)

**Acceptance Criteria:**

- Given a config the kind's own `validate` accepts but `canonical` cannot encode, when the graph runs with a cache, then it produces exactly the result it produces without one and nothing throws out of `executeGraph`.
- Given a session that stores many entries retaining no rows, when the entry ceiling is reached, then least-recently-used entries are evicted and the held count stops growing.
- Given a cached chain over a Source, when that Source is removed or its typing unconfirmed, then no table derived from it remains reachable from the run cache.
- Given a Source → Filter → Columns chain that has run once, when the same run is requested again with nothing changed, then no Step's `apply` is called and the run's diagnostics are identical in order, code, severity, values and `stepId` to the first run's.
- Given a Step whose warning was raised on the first run, when a later run serves that Step from the cache, then the warning is present in the run's diagnostic stream and `runStatus` reports the same counts as the first run — a repeat run never reports clean over a warning it did not re-emit.
- Given a graph whose Steps have all been cached, when a Step is renamed and another is moved, then a subsequent run computes nothing at all.
- Given a cached chain over a CSV, when the delimiter is corrected and the Source re-parsed, then Step zero and every Step downstream of it recompute and the Result reflects the corrected parse — no key survives a re-parse.
- Given the cache is at its row bound, when a new entry pushes it over, then least-recently-used entries are evicted until the bound holds, and a subsequent run over an evicted Step produces the same rows, counts and diagnostics as before the eviction.
- Given `executeGraph` is called without a cache, when a graph runs, then every Step computes exactly as it does today — the parameter is a door, not a mode.

## Spec Change Log

**2026-08-05 — review round 1. The spec specified the cache's semantics and never its edges.**

*Triggering findings.* Three review layers, run independently, converged on one class: this spec said in exhaustive detail what a key is made of and what an entry holds, and said nothing at all about what the cache does when the world hands it something it cannot key, cannot cost, or has withdrawn. Four consequences, all confirmed against the tree rather than argued:

1. `stepKey` at `core/exec/execute.js:303` and `stepZeroKey` at `core/exec/convert.js:283` call `canonical`, which **throws**, and neither call is guarded. Reproduced end to end with the real graph store, the real Arquero engine and the real `first` kind: `configureStep(id, { count: 3, end: undefined })` returns `ok: true` (`core/steps/first.js:79` admits an explicitly-`undefined` `end` by construction), the graph then runs and returns 3 rows **without** a cache and throws `TypeError: canonical: cannot serialize undefined at $step.config.end` **with** one. `configureStep` also accepts arbitrary extra fields — `{ combine: 'all', conditions: [], note: new Date(0) }` is stored verbatim — so the kind validators admit a whole family of configs `canonical` refuses. `executeGraph` is called from a `watch` in `ui/EditorPane.vue` and `of()` from `ui/SourcesPane.vue`'s template via `marksFor`, so either throw is an uncaught render error: the blank Editor that `core/exec/execute.js`'s own `try`/`catch` doctrine exists to prevent. **This directly violates the frozen rule "a cached run and an uncached run must be indistinguishable except in time."** Not reachable through the shipped UI today (`ui/StepPanel.vue:146,271` defaults every field to a concrete value); reachable the moment story 14 imports a Recipe, which `core/steps/first.js` already names as a source of hostile configs.
2. The bound is expressed only in rows, and `rowsOf` costs a non-finite `rowCount` as zero, so an entry that retains a table of zero rows — or an executor refusal with `table: null` — can never push `rows()` past `maxRows` and the eviction loop never runs for it. `held` grows one permanent entry per distinct config a user types.
3. Nothing releases run-cache entries when a Source is removed or its typing unconfirmed. `ui/SourcesPane.vue:663-670` releases the Step-zero conversion and `markMemo`; the run cache is not even passed to that pane (`ui/App.vue:124` hands it to `EditorPane` alone), and `clear()` ships documented as "nothing in the product calls it yet".
4. A Step that *returns* `{ table: null }` is stored, while a Step that *throws* is not — the Design Notes justify the second with "an entry with no table is not a result to replay", which applies identically to the first.

*What was amended.* The **Cache edges** section below, four new tasks, and two acceptance criteria. The frozen block is untouched — its "indistinguishable except in time" rule was already the correct answer to finding 1 and needed no renegotiation.

*Known-bad state avoided.* Shipping 7b's scheduler on top of a cache that can throw out of a Vue watcher and whose entry count is unbounded. 7b makes `executeGraph` a generator driven from the UI, which multiplies both.

*KEEP — what worked and must survive.* The key scheme and its measurements are sound and no reviewer attacked them: `canonical`'s prefix-free typed encoding with sorted keys, the four-lane FNV-1a-128 and the reasoning that rejected `crypto.subtle`, keying the **resolved** config rather than `node.config`, the entry-as-recorded-object identity that makes diagnostics replay for free, one key scheme across both stores via `stepZeroKey`, and the `null`-key-propagates-as-uncacheable rule already implemented at `core/exec/execute.js:240-246`. All 994 tests, the full matrix coverage and the two measurement campaigns stay. **Fix the edges; do not re-derive the middle.**

*Owner decisions taken this round.* The 15,000,000-row bound **stays** (Ask First, resolved by the owner 2026-08-05) — see the corrected reading of the retention measurement below. Route: patch forward rather than revert; the code was already pushed.

## Design Notes

**Cache edges — what the first version of this spec left unspecified, added in review round 1.**

*An unkeyable input is a miss, never a throw.* `canonical` throwing is correct and stays exactly as the frozen matrix specifies — a silent key collision would serve one Step's table as another's. What was missing is the other half: **the throw must not leave the module that asked for a key.** `core/exec/execute.js` and `core/exec/convert.js` are the two callers, both on a render path, and both turn a refusal into `key = null`, which the executor already propagates as "not cacheable" — the same safe category as an eviction and an undigested Source. A config the serializer cannot encode costs its Step a cache entry and costs the user nothing. The refusal is not silent: it is the one place the cache may not simply swallow a signal, so the throw's message is surfaced where a developer sees it without a Diagnostic being minted (no new code — the frozen Never still holds). `stepZeroKey`'s guard becomes symmetric while this is done: today a missing `byteDigest` returns `null` and a missing `encoding`, `parseConfig` or `typing` throws, which is the same bug wearing two faces.

*The bound is rows **and** entries.* Rows are what memory costs when a table is real, and they are the frozen rule. They are not a bound on the `Map` itself: a zero-row table and a refusal both cost nothing and both occupy a slot forever. A second ceiling on entry count sits beside the row ceiling and the eviction loop honours whichever is exceeded. This does not weaken the frozen "bounded by total retained rows" — it completes it, because a bound that a whole class of entries is invisible to is not one.

*A withdrawn Source withdraws its cache.* AD-29 says a table computed from types nobody vouches for must not survive the withdrawal. The Step-zero store honours this per Source id; the run cache **cannot**, because it is content-keyed on purpose and has no id to release by. The honest primitive is therefore the one already built and unused: removing a Source or unconfirming its typing clears the run cache. That is coarse — it throws away entries belonging to Sources nobody touched — and it is correct, which the alternative (a reverse index from Source id to key, a second bookkeeping scheme) is not obviously worth being. The frozen rule that an eviction is a miss and never a wrong answer is what makes coarse acceptable.

*A Step that produced no table is not stored, however it failed.* The Design Notes' own sentence — "an entry with no table is not a result to replay" — is the rule, and it is about the entry, not about which of the two failure paths produced it. `table === null` is the condition; a throw is one way to reach it.

**Why a pure-JS hash and not `crypto.subtle` — measured 2026-08-04 rather than argued.** `key(source)` needs a digest over the raw bytes, and there was no hash in this project to reuse. Both candidates were timed over synthetic buffers at the three shapes that matter (Node v26.5.1, best of three):

| Bytes | FNV-1a-128, pure JS, synchronous | `crypto.subtle.digest('SHA-256')`, async |
|---|---|---|
| 4 MB (~20k × 20) | **5.0 ms** | 4.4 ms |
| 20 MB (~100k × 20, one Source at design scale) | **25.0 ms** | 14.2 ms |
| 100 MB (~500k × 20, the whole C-3 session budget) | **94.7 ms** | 70.1 ms |

SHA-256 is roughly 1.8× faster and costs far more than it saves: it returns a promise, so either `executeGraph` becomes async two stories before the scheduler that is meant to make it async, or the digest is computed somewhere else and threaded — and it is a browser API, so `core/` could not name it and a port plus an adapter would exist to save 11 ms once per ingest. The digest is computed **once when bytes arrive**, in `addSource`/`reRead`, which are already async and already inside `serialize`'s per-Source chain; a run never hashes bytes. 25 ms lands beside the 548–555 ms that Step zero already costs at the same shape. A four-bytes-per-iteration variant of the same function measured 7.7 ms at 20 MB and was not taken: each lane would see only every fourth byte, which is a weaker function bought with 17 ms nobody is spending. Measured in Node first, and **confirmed in both browser engines afterwards — the table immediately below** — because this project has been caught once already by a platform that behaves differently from `file://` than the documentation says (AD-9's `SharedArrayBuffer`).

**The same function in the two engines that actually run the artefact — measured 2026-08-04, from `file://`, against `dist/index.html`.** The identical four-lane loop, injected into the loaded page and timed there, best of three per size:

| Bytes | Node v26.5.1 | Chromium (`file://`) | Firefox (`file://`) |
|---|---|---|---|
| 4 MB | 5.0 ms | **9.0 ms** | **10.0 ms** |
| 20 MB | 25.0 ms | **43.6 ms** | **47.0 ms** |
| 100 MB | 94.7 ms | **219.5 ms** | **225.0 ms** |

**What this measurement does and does not establish**, recorded in review round 1 because the first wording overstated it: the loop was *injected* into the loaded page and timed there, not driven through `addSource`. So it pins the speed of the four-lane loop in each engine and the fact that all three engines agree on the 32 hex characters for the same input — but it does not exercise the bundled, minified `digestBytes` in `dist/index.html`. That the shipped function agrees with the Node one is covered instead by `npm run test:e2e` being green over an artefact whose Sources all key through it. The browser cost is 1.7–1.9× Node's at every size and the two engines are within 8 % of each other, so the check's own threshold — "more than roughly double the Node figure is worth reporting before shipping" — is not crossed. At the design shape this is **43.6 / 47.0 ms once per ingest**, beside the 548–555 ms Step zero already costs on the same file; a run never pays it.

**Why 128 bits and not 32.** A collision is not a slow path here, it is a wrong answer: two different Steps sharing a key means one Step's table is served as another's, which is the one outcome AD-8's bounded-cache sentence rules out even for eviction. Four 32-bit FNV-1a lanes with different offset bases give a 128-bit output for one pass over the bytes, and the measurement above is of that four-lane function.

**Why `parseConfig` alone is not the parse config.** AD-8 writes `key(source) = hash(byteDigest + parseConfig)`. In this codebase `entry.parseConfig` is exactly `{ delimiter, headerRow, sheet }` (`core/exec/source-store.js:542`) and `entry.encoding` is a separate frozen field (`:543`). The same bytes decoded as UTF-8 and as Latin-1 produce different tables from an identical `parseConfig`, and `overrideEncoding` is one of the three commands that re-parse. So the key takes both, and the rule is written down here rather than left to be discovered by whoever changes an encoding and gets the old table back.

**Where Step zero fits, so there is one scheme rather than two.** AD-7 says the per-column type record "is applied by the engine as Step zero of every Source and caches like any other Step". That makes the shape obvious: `key(source)` is the raw parse — bytes plus how they were read — and Step zero is a Step over it whose config is the typing, so `key(stepZero) = stepKey('typing', entry.typing, [sourceKey(entry)])`. The Step-zero store keeps its own `Map` and its own bound of one entry per Source, which is tighter than a row budget and matches its lifecycle (a Source's removal releases it). **Two stores, one key scheme** — and AD-8's *Prevents* clause is about two invalidation schemes disagreeing about staleness, not about the number of Maps. Both stores derive every key through `cache-key.js`, so there is exactly one answer to "is this stale".

**Why the resolved config and not `node.config`.** `core/exec/execute.js:223-224` reads `node.config ?? kind.defaultConfig()`. Keying the raw field would make the first `configureStep` that sets a kind's default look like a change, recomputing a Step whose output is provably identical — a miss the user pays for and cannot see a reason for. Keying the resolved value costs nothing and makes `null` and the default the same Step, which they are.

**Why the row bound is 15,000,000 and where the number comes from.** Research R4 measured 30 retained intermediates at half a million rows costing 180 MB, against the ~550 MB the memory plan works from. That configuration is 15 million retained rows, so it is the largest shape the research has actually licensed, and it is the default `maxRows`. **This is a licence, not a measurement of this cache**: the story measures retained bytes per retained row at design scale before shipping and records the figure here, and if it disagrees materially with 180 MB the bound is the owner's call, not the implementer's (Ask First).

**What a retained row actually costs — measured 2026-08-04. It does not refute R4; it measures something R4 was not measuring.** The shape R4 named: 30 chained Steps over one Source of 500,000 rows × 20 columns (10 numeric, 10 text with distinct values), every intermediate retained in `createRunCache`, so `rows()` reports 15.0 million — the bound exactly. Node v26.5.1, `--expose-gc`, `heapUsed + arrayBuffers` before and after the run (an early pass read `heapUsed` alone and reported 0.3 MB; typed-array backing stores are not on the JS heap, and that measurement was wrong rather than encouraging):

| The 30 Steps | Retained | Per retained row | Cold run | Warm run |
|---|---|---|---|---|
| Filter (`engine.filter` — shares every column, keeps a `BitSet`) | **2.1 MB** | 0.14 B | 484 ms | **1.4 ms** |
| First (`engine.firstRows` — shares every column, keeps a row index) | **59.3 MB** | 4.14 B | 3,097 ms | **0.8 ms** |

**Read the caveat before the number, because the number is the smaller half of what happened.** Both Step kinds that exist today share their input's columns and retain only a mask or a row index — that is `adapters/arquero/engine.js`'s decision and it is stated there. So 2.1 and 59.3 MB describe the cost of *sharing*, while R4's 180 MB describes retained intermediates in a sense this measurement never reproduces. The two figures are not in contradiction; they are not about the same thing, and "it disagrees with R4 by two orders of magnitude" — the first wording — was an apples-to-oranges reading corrected in review round 1. A kind that materializes new column data (Aggregate and Join, stories 8 and 9) would retain real bytes and would be the measurement that actually tests R4.

**Owner decision, 2026-08-05: the bound stays at 15,000,000.** Ask First was triggered and resolved by the owner, on exactly the reasoning above — 15 M remains the only figure the research licenses, the measurement in hand does not license a larger one, and the kinds that would test it do not exist yet. Re-measure when Aggregate or Join lands; the ledger carries that.

The same table shows what the story is for from the other side: a repeat run over 30 Steps at half a million rows costs **0.8–1.4 ms against 484–3,097 ms**.

**What is deliberately not cached.** A Step that produced no table stores nothing, by either route: `core/exec/execute.js:240-248` records `exec.step_threw` with no table, and an executor that *returns* `{ table: null }` — `columns`' `unknown_column`, `filter`'s `type_mismatch` — is the same entry with the same nothing to replay. The next run calls the Step again and gets the same diagnostic, which is what a user correcting the cause needs. A refused run stores nothing either, because the gate loop returns before any Step has a key.

## Verification

**Commands:**

- `npx vitest run --project core` -- expected: green, including the six re-keyed Step-zero cases in `core/exec/convert.test.js` and the new `cache-key` and `cache` suites
- `npx vitest run --project ui` -- expected: green; `graphLabelGaps()` and `kindLabelGaps()` still `[]` (this story mints no code, so nothing should have moved)
- `npm run lint` -- expected: clean
- `npm run test:e2e` -- expected: green, unchanged — a cached run and an uncached run are indistinguishable to every e2e assertion, and that is the point
- `npm run build` -- expected: `assert-single-file.mjs` passes

**Manual checks:**

- ~~Confirm the digest figure in the built artefact from `file://` in **both** Chromium and Firefox~~ — **done 2026-08-04, recorded in the Design Notes.** 43.6 ms (Chromium) / 47.0 ms (Firefox) at 20 MB against Node's 25.0 ms, so 1.7–1.9× and under the "roughly double" threshold; both engines return the same 32 hex characters. Measured by injecting the identical four-lane loop into the loaded `dist/index.html` and timing it there, rather than by driving a ~20 MB CSV through the file input — the digest is one call inside an `addSource` that is already awaiting a reader, and timing the whole ingest would have reported the reader.
- ~~Measure retained bytes per retained row at design scale and check the 15,000,000-row bound against it~~ — **done 2026-08-04, recorded in the Design Notes.** 2.1 MB (30 Filters) and 59.3 MB (30 First Steps) for the full 15.0 million retained rows, against R4's 180 MB. It disagrees materially and in the safe direction, so per Ask First **the constant was not changed** and the disagreement is reported instead: whether the bound should now be larger is the owner's call. The caveat that belongs with it: both Step kinds that exist today share their input's columns, so no measurement here covers a kind that materializes new column data (Aggregate, Join — stories 8 and 9).
