// The `Yield` port (AD-9), and the first message-queue code in this project.
//
// The scheduler in `core/exec/scheduler.js` awaits this once per Step. What it
// buys is the only thing that makes cancellation between Steps mean anything: the
// engine gets a turn, so a pointer or keyboard event on the cancel control is
// *delivered* — and therefore the flag the next check reads is the one the user
// just set. Exit latency is then one Step (R4: 578.6 ms Chromium / 1,156 ms
// Firefox for the heaviest single Step) rather than one whole run.
//
// THREE CANDIDATES, AND TWO OF THEM FAIL FOR MEASURED REASONS RATHER THAN TASTE.
//
//   `queueMicrotask` / `await Promise.resolve()`. The microtask queue drains
//   before the engine processes input, so the click never lands until the run is
//   over. It is not a yield for this purpose at all — it is a continuation.
//
//   `setTimeout(…, 0)`. A real macrotask, and clamped: both engines raise the
//   minimum to 4 ms once timer nesting reaches depth five, which every run past
//   its fifth Step is. At 30 Steps that is over 100 ms of pure clamp added to the
//   worst case this port exists for, and it would arrive as "the cancellable run
//   is slower than the one it replaced".
//
//   `MessageChannel`. A macrotask with no clamp. R4 measured the round trip at
//   3.0 ms (Chromium) / 2 ms (Firefox), which is what licenses yielding once per
//   Step instead of once per chunk.
//
// **`SharedArrayBuffer` and `Atomics` are not on this list and cannot be.** AD-9
// records the measurement: `SharedArrayBuffer` is hidden from `file://` in both
// engines and a `typeof` check reports the opposite of the truth. This scheduler
// is single-threaded and the cancellation flag is a plain closure variable, which
// is the design AD-9 describes rather than the trap it names.

/**
 * One port pair, created once and reused for every yield.
 *
 * A channel per yield would allocate two ports per Step and leave the old pair to
 * be collected; one pair costs one `postMessage` per Step and nothing else.
 * Messages on a port are delivered in the order they were posted and `waiting` is
 * drained from the front, so the *n*-th message resolves the *n*-th promise even
 * when two yields are in flight — which they are the moment two runs overlap,
 * because a superseded run is still awaiting its own yield when the new one
 * starts.
 *
 * @returns {Readonly<import('../../ports/index.js').Yield & { dispose: () => void }>}
 */
export function createQueueYield() {
  const channel = new MessageChannel()
  /** @type {Array<() => void>} */
  const waiting = []

  // Assigning `onmessage` starts the port; `start()` would be a second way to say
  // the same thing.
  channel.port1.onmessage = () => {
    const resolve = waiting.shift()
    if (resolve) resolve()
  }

  const next = () =>
    new Promise((resolve) => {
      waiting.push(resolve)
      channel.port2.postMessage(0)
    })

  /**
   * Close the pair.
   *
   * **Everything still waiting is resolved first, and that is deliberate.** A
   * closed port delivers nothing, so a scheduler suspended on this promise would
   * never resume and its `completed` would never settle — a hang rather than a
   * stop. Resolving lets the run reach its next cancellation check, which is the
   * one place it can end cleanly. Nothing in the product disposes today; a test
   * that creates a channel per case does, and so would a host that tears one down.
   */
  const dispose = () => {
    channel.port1.close()
    channel.port2.close()
    while (waiting.length > 0) waiting.shift()()
  }

  return Object.freeze({ next, dispose })
}
