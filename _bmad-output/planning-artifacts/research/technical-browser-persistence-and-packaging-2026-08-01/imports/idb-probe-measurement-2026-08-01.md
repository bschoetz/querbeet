# IndexedDB from `file://` — gate probe measurement note

**Measured for this decision, not cited.** Every figure is read from
`idb-probe/idb-probe-results.json`; the probe pages and runner are in `idb-probe/`.

Method: Playwright drives **persistent browser profiles** (`launchPersistentContext` against a
temporary user-data directory), so "across sessions" means what PRD FR-25 means by it — the browser
process is closed and started again, not merely reloaded. Four page loads per engine:

1. `dirA/write.html` — write a marker plus a querbeet-shaped Source (100,000 rows × 20 columns of
   plain objects) through structured clone; every stage separately timed and separately bounded, so
   a hang names itself.
2. `dirA/read.html` — a **different file in the same directory** reads it back.
3. `dirB/read.html` — a **file in a different directory** tries the same.
4. `dirA/read.html` again, after the browser process was closed and relaunched on the same profile.

Host: Node 26.5.0, Playwright, Chromium 151.0.7922.34, Firefox 153.0. Date: 2026-08-01.

## The gate answer

**IndexedDB works from a `file://` origin in both engines, and the data survives a browser
restart.** PRD FR-25 is buildable as written.

| | Chromium 151 | Firefox 153 |
| --- | --- | --- |
| `indexedDB` present | yes | yes |
| `location.origin` | `"file://"` | `"null"` |
| `window.isSecureContext` | **true** | **true** |
| `indexedDB.open` | 3.0 ms | 6.0 ms |
| write marker | 1.0 ms | 1.0 ms |
| read back in **the same directory** | **yes**, 100,000 rows | **yes**, 100,000 rows |
| read back from **a different directory** | **yes**, 100,000 rows | **yes**, 100,000 rows |
| read back **after a browser restart** | **yes**, 100,000 rows | **yes**, 100,000 rows |
| page errors, any load | none | none |

Round-trip integrity was checked on both ends of the dataset, not just its length: `rows[0].c0`
and `rows[99999].c19` came back correct in every read.

## Three findings the gate question did not ask for

### 1. The `file://` origin is one shared bucket — every local HTML file sees the same database

`dirB/read.html` — a different file, in a different directory, opened by its own `file://` URL —
read the record written by `dirA/write.html` **in both engines**, including the full 100,000-row
Source. There is no per-file and no per-directory partition.

Consequences for querbeet, since it ships as a file the user copies around:

- **Two copies of `querbeet.html` on one machine share one persisted session.** Opening a second
  copy shows the first copy's Recipe and data.
- Worse in the other direction: **any other local HTML file the user ever opens can read
  querbeet's stored data**, and querbeet can read theirs. This is not a querbeet bug and cannot be
  fixed from inside querbeet — it is what an opaque `file://` origin means.
- FR-25's "one-action delete" therefore deletes the *shared* store, not "this file's" store.
- If a Package (FR-24) must be openable side by side with a session, the database key has to carry
  the discriminator — a Recipe id or Package id — because the origin will not.

### 2. `navigator.storage.persist()` never settles in Firefox from `file://`

This is a trap, and it cost the first run of this probe 180 seconds before it timed out.

| | Chromium 151 | Firefox 153 |
| --- | --- | --- |
| `navigator.storage.persist()` | resolves in **0.2 ms**, returns **`false`** | **never settles** — still pending at the 8,000 ms bound |
| `navigator.storage.persisted()` | resolves, `false` | resolves in 1 ms, `false` |

So: **persistent storage cannot be granted from a `file://` origin in either engine** — Chromium
says no, Firefox does not answer. The rule that follows is concrete: never `await`
`navigator.storage.persist()` on the startup path. Race it against a timeout or do not call it,
because in Firefox an unguarded `await` deadlocks initialization before the first byte is stored.
`navigator.storage.persisted()` is safe in both.

Scope of this claim: measured from `file://` only. It was **not** compared against an `http(s)`
origin, so this says nothing about whether the hang is specific to opaque origins.

### 3. Storage is roughly a tenth of the in-memory cost, and quotas differ tenfold

| | Chromium 151 | Firefox 153 |
| --- | --- | --- |
| quota reported before any write | 10,737,418,240 B (~10.0 GiB) | 1,238,988,800 B (~1.15 GiB) |
| usage after storing 100,000 × 20 | 8,913,424 B | 9,960,184 B |
| build the rows in memory | 301.2 ms | 490.0 ms |
| `put` 100,000 × 20 | **304.6 ms** | **731.0 ms** |
| `get` 100,000 × 20 | 194.9 ms | 825.0 ms |
| `put` 1,000 × 20 | 17.1 ms | 5.0 ms |

Two things follow, both worth carrying into the rest of R9:

- **On disk this data costs ~9–10 MB, against the ~94 MB the same 100,000 × 20 rows cost in the
  JavaScript heap** (measured in R6, `[M9]`). IndexedDB is storing it roughly an order of magnitude
  more compactly than the live object graph. Linear projection to the PRD's half-million-row target
  is **~45–50 MB stored** — comfortable against Firefox's ~1.15 GiB quota and trivial against
  Chromium's ~10 GiB.
- **Write time projects to roughly 1.5 s (Chromium) and 3.7 s (Firefox) at half a million rows.**
  R3's threshold for "long enough to freeze a tab" was ~3.3 s, so Firefox lands on that line and
  Chromium does not. Whether the write needs a worker is a real question, not a settled one — and
  it is not answered here.

Both projections are **linear extrapolations from a single 100,000-row point**, not measurements.
Storage engines are not obliged to be linear.

## What this probe does not establish

- **Nothing about eviction.** Since `persist()` returns `false` or never answers, the store is
  best-effort in both engines, and no pressure test was run. What a restored-but-incomplete session
  looks like is still open (R9's third sub-question).
- **Nothing above 100,000 rows.** The half-million target was projected, not stored.
- **Nothing about the Package container** — `fflate` vs JSZip, compression ratio and time, or
  whether a Package should hold Parquet internally.
- **Nothing about a columnar or pre-serialized layout.** Only the plain structured-clone path was
  measured; whether a compressed blob or a columnar encoding beats it is R9's second sub-question.
- **No comparison against an `http(s)` origin**, so every claim here is scoped to `file://`.
