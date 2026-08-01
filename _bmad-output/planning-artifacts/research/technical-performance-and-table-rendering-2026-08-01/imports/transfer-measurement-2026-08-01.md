# Original measurement — structured clone across a worker boundary (querbeet R4/D3, M1)

**Date:** 2026-08-01 · **Harness:** `transfer-probe.html` + `run-transfer.mjs`, headless Playwright
1.62, real `file://` URL · **Engines:** Chromium 151.0.7922.34 (`--enable-precise-memory-info
--js-flags=--expose-gc --max-old-space-size=8192`), Firefox 153.0 · **Raw:**
`transfer-chromium.json`, `transfer-firefox.json`.

The worker is a **classic script from a `blob:` URL**, per R2's settled construction rule. It
spawned in 0.1 ms (Chromium) / 0 ms (Firefox) and answered a ping in 13.1 / 28 ms. Worker
construction from `file://` is re-confirmed here incidentally; it was not the question.

## What was measured, and why these particular numbers

The question D3 exists to answer is not "is the work faster off-thread" but **"does the transfer
eat the win"**. So the load-bearing figure is not the round trip — it is **`postBlock`**, how long
`postMessage()` blocks the *calling* thread, because structured-clone serialization happens
synchronously inside that call. A worker that costs 500 ms of main-thread block to feed has
already frozen the tab it was supposed to keep responsive.

Four payload shapes, identical values in all of them, 20 columns throughout:

| Shape | What it is | Why it is here |
| --- | --- | --- |
| `rows` | array of `Object.freeze`d row objects | what the parser produces (R2's boundary rule) |
| `cols` | object of 20 plain arrays | **literally what an Arquero table is** — in Arquero 8, `t.column(name)` returns the backing array itself |
| `typed` | 10 `Float64Array` + 10 string arrays | prices the option of keeping numeric columns typed |
| `buf` | one `ArrayBuffer`, **transferred** not cloned | the zero-copy control |

## Results

`postBlock` = main-thread block inside `postMessage()`. `roundTrip` = main-thread wall clock from
`postMessage()` to holding the echoed payload. `sameThread` = `structuredClone()` in place
(serialize + deserialize, no worker), as an independent check on the two legs.

### Chromium 151

| Shape | Rows | Payload heap | postBlock | worker deser | sameThread clone | roundTrip |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| rows | 100,000 | 84.8 MB | **109.4 ms** | 74.9 ms | 202.4 ms | 308.4 ms |
| cols | 100,000 | 47.3 MB | **65.2 ms** | 88.4 ms | 166.4 ms | 308.0 ms |
| typed | 100,000 | 34.0 MB | **48.7 ms** | 35.2 ms | 81.0 ms | 181.6 ms |
| buf | 100,000 | 15.3 MB | **0.1 ms** | 0.3 ms | 8.9 ms | 0.2 ms |
| rows | 500,000 | 438.7 MB | **510.8 ms** | 496.7 ms | 911.0 ms | 1,578.6 ms |
| cols | 500,000 | 251.8 MB | **366.9 ms** | 548.1 ms | 865.6 ms | 1,772.7 ms |
| typed | 500,000 | 171.2 MB | **196.5 ms** | 277.3 ms | 456.5 ms | 971.2 ms |
| buf | 500,000 | 76.3 MB | **0.7 ms** | 0.3 ms | 34.1 ms | 0.3 ms |

### Firefox 153

Firefox exposes no `performance.memory`, so heap columns are blank by platform, not by omission.

| Shape | Rows | postBlock | sameThread clone | roundTrip |
| --- | ---: | ---: | ---: | ---: |
| rows | 100,000 | **132 ms** | 258 ms | 551 ms |
| cols | 100,000 | **65 ms** | 147 ms | 303 ms |
| typed | 100,000 | **62 ms** | 98 ms | 157 ms |
| buf | 100,000 | **0 ms** | 13 ms | 0 ms |
| rows | 500,000 | **627 ms** | 1,370 ms | 2,686 ms |
| cols | 500,000 | **402 ms** | 820 ms | 1,720 ms |
| typed | 500,000 | **199 ms** | 440 ms | 796 ms |
| buf | 500,000 | **0 ms** | 58 ms | 0 ms |

## Engine difference: where the deserialize lands

The two engines put the deserialize cost in different places, and the probe caught it by
timestamping the worker's `onmessage` entry *before* `.data` is touched:

| | Chromium 151 | Firefox 153 |
| --- | --- | --- |
| `rows` 500k: send → worker dispatch | 510.9 ms | 1,315 ms |
| `rows` 500k: cost of touching `.data` | 496.7 ms | 4 ms |

**Chromium deserializes lazily, on first `MessageEvent.data` access. Firefox deserializes eagerly,
before the event dispatches.** Same total, different scheduling — and in Chromium the receiving
thread can therefore *defer* paying for a message it has already received, which Firefox cannot.

This also cost the probe its first run: a timestamp taken at the top of `onmessage` reported
Chromium's deserialize leg as 0.1 ms, wrong by three orders of magnitude. Every deserialize figure
above is the timed cost of the `.data` access itself.

## Notes on method

- Each case builds its payload, settles with two forced GCs, measures, then releases. `heapBefore`
  / `heapAfter` bracket the build, so `payload heap` is the shape's own cost, not cumulative.
- 100k runs precede 500k runs in every shape, so a 500k OOM would still have left the 100k row
  filled in. No case OOMed and no page error was raised in either engine.
- `sameThread clone` is an independent check: it should be ≈ postBlock + deserialize, and it is —
  Chromium `rows` 100k, 109.4 + 74.9 = 184.3 against 202.4 measured.
- The `buf` control confirms the comparison is sound: a transferred `ArrayBuffer` of 76.3 MB costs
  0.7 ms to send and 0.3 ms round trip. Transfer is genuinely free; cloning is genuinely not.
