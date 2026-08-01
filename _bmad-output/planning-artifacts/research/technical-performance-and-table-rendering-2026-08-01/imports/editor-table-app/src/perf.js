// R4/D4 — M6. The contention harness.
//
// The question is not "does the canvas feel slow". It is whether the table's
// 50-row window swap — 4.1 ms with nothing else on the thread (R4/D1) — still
// costs that when 30 Vue Flow nodes, each carrying its own ResizeObserver, are
// live on the same main thread and one of them is being dragged.
//
// So two things are recorded during every run: the synchronous cost of a swap
// (set offset → rebuild → forced reflow), and the interval between animation
// frames, because contention that a swap does not see still shows up as a
// dropped frame.

import { nextTick } from 'vue'

const q = (a) => (p) => {
  const s = a.slice().sort((x, y) => x - y)
  return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2) : null
}

export function createPerf({ table, viewport, rowCount }) {
  let swaps = []
  let frames = []
  let running = false
  let rafId = null

  // A swap is not done when scrollTo() returns — Vue patches on the microtask
  // queue, so a layout read taken synchronously measures the OLD DOM and
  // reports ~0.1 ms. (It did, in this probe's first run.) Awaiting nextTick and
  // only then forcing layout is what makes this the same quantity D1 measured:
  // rebuild the window, patch it into the document, lay it out.
  async function oneSwap(i) {
    // With the table pane hidden there is nothing to swap; the loop still runs
    // so frame intervals are recorded, which is the whole point of that case.
    if (!table.value || !viewport.value) return null
    const target = (i * 977) % Math.max(1, rowCount - 60) // stride, never the same row twice
    const t0 = performance.now()
    table.value.scrollTo(target)
    await nextTick()
    void viewport.value.offsetHeight
    return performance.now() - t0
  }

  function startLoop(n) {
    swaps = []
    frames = []
    running = true
    let i = 0
    let last = performance.now()
    const tick = async (ts) => {
      if (!running || i >= n) { running = false; return }
      const gap = ts - last
      last = ts
      if (i > 0) frames.push(gap)
      const d = await oneSwap(i)
      if (d !== null) swaps.push(d)
      i++
      if (running) rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
  }

  function stop() {
    running = false
    if (rafId) cancelAnimationFrame(rafId)
  }

  async function waitForLoop(timeoutMs = 30000) {
    const deadline = performance.now() + timeoutMs
    while (running && performance.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    const timedOut = running
    running = false
    return { ...results(), timedOut }
  }

  function results() {
    const qs = q(swaps)
    const qf = q(frames)
    return {
      swaps: swaps.length,
      swapP50: qs(0.5), swapP95: qs(0.95), swapMax: swaps.length ? +Math.max(...swaps).toFixed(2) : null,
      frameP50: qf(0.5), frameP95: qf(0.95), frameMax: frames.length ? +Math.max(...frames).toFixed(2) : null,
      longFrames: frames.filter((f) => f > 50).length,
    }
  }

  // A single synchronous swap, measured with nothing else scheduled — the
  // direct comparison against D1's 4.1 ms.
  async function swapOnce(i) { return +(await oneSwap(i)).toFixed(2) }

  return { startLoop, stop, waitForLoop, results, swapOnce }
}
