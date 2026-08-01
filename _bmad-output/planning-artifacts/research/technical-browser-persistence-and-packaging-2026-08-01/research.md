---
title: 'technical research: Browser persistence and packaging'
type: 'technical'
topic: 'Browser persistence and packaging'
decision: 'How are up to half a million rows stored in the browser and packed into one portable file, from a file:// page?'
source: 'run (deep-recon, native) — research-plan.md R9'
status: partial
preset: 'standard'
validation: 'normal'
created: '2026-08-01'
updated: '2026-08-01'
claims_verified: 4
claims_unverified: 0
claims_overturned: 0
scope_note: 'Gate sub-question only (does IndexedDB work from file://). Storage layout, eviction, the Package container and the Parquet question are all still open.'
---

# technical research: Browser persistence and packaging

**Decision this research serves:** How are up to half a million rows stored in the browser and
packed into one portable file, from a `file://` page? (research-plan.md R9.)

**This run answers one sub-question only.** It was pulled forward out of R9 because a negative
answer would have invalidated PRD FR-25 as written, and because it costs minutes. Everything else
in R9 — storage layout at scale, eviction behaviour, the Package container, whether a Package
should hold Parquet internally — is untouched.

---

## The gate: does IndexedDB work from `file://`?

**Yes, in both target engines, and the data survives a browser restart. PRD FR-25 is buildable as
written.**

Measured with Playwright driving **persistent browser profiles**, so "across sessions" means the
browser process was closed and started again rather than merely reloaded. Full method and raw data:
`imports/idb-probe-measurement-2026-08-01.md` and `imports/idb-probe/`.

| | Chromium 151 | Firefox 153 |
| --- | --- | --- |
| `indexedDB` present | yes | yes |
| `location.origin` | `"file://"` | `"null"` |
| `window.isSecureContext` | true | true |
| `indexedDB.open` | 3.0 ms | 6.0 ms |
| 100,000 × 20 Source written and read back intact | yes | yes |
| readable from a different file in the same directory | yes | yes |
| readable from a file in a **different** directory | **yes** | **yes** |
| readable **after a browser restart** | **yes** | **yes** |
| page errors on any load | none | none |

Integrity was checked at both ends of the dataset rather than by length alone: `rows[0].c0` and
`rows[99999].c19` came back correct in every read.

---

## Three findings the gate question did not ask for

### The `file://` origin is one shared bucket

A page in a **different directory**, opened by its own `file://` URL, read the full 100,000-row
Source written by another directory's page — in both engines. There is no per-file and no
per-directory partition, and this cannot be fixed from inside querbeet: it is what an opaque
`file://` origin means.

Three consequences for a tool that ships as a file people copy around:

- **Two copies of `querbeet.html` on one machine share one persisted session.** Opening the second
  copy shows the first copy's Recipe and data.
- **Any other local HTML file the user opens can read querbeet's stored data**, and querbeet can
  read theirs.
- FR-25's one-action delete clears the **shared** store, not "this file's" store. And if a Package
  (FR-24) must be openable alongside a session, the discriminator has to live in the database or
  key name, because the origin will not supply one.

### `navigator.storage.persist()` never settles in Firefox from `file://`

| | Chromium 151 | Firefox 153 |
| --- | --- | --- |
| `navigator.storage.persist()` | resolves in 0.2 ms, returns `false` | **never settles** — still pending at an 8,000 ms bound |
| `navigator.storage.persisted()` | resolves, `false` | resolves in 1 ms, `false` |

Persistent storage is **not grantable from `file://` in either engine** — Chromium refuses, Firefox
does not answer. The rule is concrete: **never `await navigator.storage.persist()` on the startup
path.** Race it against a timeout, or do not call it at all; an unguarded `await` deadlocks
initialization in Firefox before the first byte is stored. This cost the probe's own first run 180
seconds. `persisted()` is safe in both.

Scope: measured from `file://` only, never compared against an `http(s)` origin.

### Storage costs about a tenth of the heap, and the two quotas differ tenfold

| | Chromium 151 | Firefox 153 |
| --- | --- | --- |
| quota before any write | 10,737,418,240 B (~10.0 GiB) | 1,238,988,800 B (~1.15 GiB) |
| usage after storing 100,000 × 20 | 8,913,424 B | 9,960,184 B |
| `put` 100,000 × 20 | 304.6 ms | 731.0 ms |
| `get` 100,000 × 20 | 194.9 ms | 825.0 ms |

The same 100,000 × 20 rows cost **~94 MB in the JavaScript heap** (measured in R6), so IndexedDB
stores them roughly an order of magnitude more compactly than the live object graph.

Linear projection to the PRD's half-million-row target — **an extrapolation from a single point,
not a measurement** — puts storage at ~45–50 MB, comfortable against Firefox's ~1.15 GiB quota and
trivial against Chromium's ~10 GiB, and write time at ~1.5 s (Chromium) and ~3.7 s (Firefox). R3's
threshold for "long enough to freeze a tab" was ~3.3 s, so **Firefox lands on that line and
Chromium does not**. Whether the write needs a worker is a real open question, not a settled one.

---

## Recommendations

1. **Build FR-25 on IndexedDB as specified — the requirement holds.** *Confidence: high*, measured
   in both engines with a real browser restart. Feeds the architecture spine.
2. **Never `await navigator.storage.persist()` unguarded.** *Confidence: high*, measured. Treat
   storage as best-effort in both engines, because neither grants persistence from `file://`.
3. **Put a discriminator in the database or key name from the first commit.** *Confidence: high* on
   the shared-bucket measurement; the design response is a judgement call. FR-24's Package and
   FR-25's session will otherwise collide, and so will two copies of the app.
4. **Tell the user what "stored on this computer" means.** *Confidence: high* on the mechanism.
   Data stored from a `file://` page is readable by any other local page and is evictable without
   warning — a product decision for the PRD, not only an implementation note.

---

## Open questions — the rest of R9

1. **Storage cost and write time at half a million rows**, measured rather than extrapolated, and
   whether a serialized columnar or compressed blob beats plain structured clone.
2. **Whether the write needs a worker**, given Firefox's projected ~3.7 s.
3. **Eviction.** Persistence cannot be granted, so the store is best-effort in both engines and no
   pressure test was run. What a restored-but-incomplete session should do is unanswered.
4. **The Package container** — `fflate` versus JSZip on size and on synchronous versus asynchronous
   API. R3 established that `hyparquet-writer` needs a *synchronous* compressor and that the
   browser-native `CompressionStream` is async and therefore unusable there.
5. **Compression ratio and time for report-shaped data**, and whether that needs a worker.
6. **Should a Package store its data as Parquet internally?** The reader and writer are already in
   the bundle — but it would make the container readable by DuckDB or pandas, which may be a
   feature or an unwanted disclosure surface.
7. **No `http(s)` comparison was run**, so every claim here is scoped to `file://`.

## Source appendix

Every finding in this run is a measurement produced by the run itself; no web sources were consulted.

| # | Claim / finding it supports | Source | Date | Confidence |
| --- | --- | --- | --- | --- |
| [G1] | IndexedDB works from `file://` in both engines and survives a browser restart | `imports/idb-probe/idb-probe-results.json` | 2026-08-01 | high |
| [G2] | The `file://` origin is one shared bucket across files and directories | `imports/idb-probe/idb-probe-results.json` | 2026-08-01 | high |
| [G3] | `navigator.storage.persist()` never settles in Firefox from `file://`; Chromium returns `false` | `imports/idb-probe/idb-probe-results.json` | 2026-08-01 | high |
| [G4] | Storage cost, quota and read/write timings for 100,000 × 20 | `imports/idb-probe/idb-probe-results.json` | 2026-08-01 | high |

## Staleness map

Browser-behaviour claims of this kind age with browser releases rather than on a calendar. The
`file://` storage partition is the one to watch: both engines have tightened opaque-origin storage
before, and a future change would break FR-25 silently rather than loudly.

| Re-check by | Claims |
| --- | --- |
| **On each lead-browser major upgrade** | [G1] the gate itself, [G2] the shared bucket, [G3] `persist()` behaviour |
| 2027-08-01 | [G4] storage cost and timings |

The probe re-runs in under two minutes: `node imports/idb-probe/run-idb-probe.mjs`.
