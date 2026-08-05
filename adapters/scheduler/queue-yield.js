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
  let disposed = false

  // Assigning `onmessage` starts the port; `start()` would be a second way to say
  // the same thing.
  channel.port1.onmessage = () => {
    const resolve = waiting.shift()
    if (resolve) resolve()
  }

  /**
   * One turn of the macrotask queue.
   *
   * **After `dispose` it refuses, and refusing is the only one of the three
   * answers that is true.** A closed port delivers nothing, so there are exactly
   * three things this can do once the pair is gone, and two of them are lies:
   *
   *   *Suspend* — post on the closed port and hand back a promise that never
   *   settles. The scheduler then never reaches another cancellation check and
   *   its `completed` never resolves: the run hangs holding every table it has
   *   computed, with a progress line on screen for the life of the page. Story 7b
   *   shipped this once, with a test asserting the hang as though it were the
   *   contract.
   *
   *   *Resolve on the microtask queue* — `Promise.resolve()`. It looks like a fix
   *   and it is the same failure the port exists to prevent: `ports/index.js`
   *   says in as many words that a microtask is **not** a yield here, because it
   *   drains before the engine processes input. A run drained that way walks its
   *   whole remaining graph with no turn in between, which is a blocked page and
   *   a cancel control nobody can reach. The round-1 patch asked for "resolve,
   *   not suspend" and this satisfied the letter of it.
   *
   *   *Refuse* — reject, which is what this does. A yielder that can no longer
   *   yield is not a slower yielder, and the scheduler can act on it: it closes
   *   the walk and rejects `completed`, so the run ends rather than hanging or
   *   blocking. Whoever disposed the channel is tearing the host down anyway.
   */
  const next = () =>
    disposed
      ? Promise.reject(
          Object.assign(new Error('queue-yield: the channel was disposed'), {
            name: 'YieldDisposed',
          }),
        )
      : new Promise((resolve) => {
          waiting.push(resolve)
          channel.port2.postMessage(0)
        })

  /**
   * Close the pair.
   *
   * **Nothing in the product calls this**, and it is not dead code: one pair is
   * created in `app/main.js` and lives as long as the page, so the product has
   * nothing to tear down. What has is a *test* that builds a pair per case —
   * `adapters/scheduler/queue-yield.test.js` — and a future host that owns the app
   * rather than being it. Both need the ports closed; neither should have to
   * discover what happens to the yields in flight when they are.
   *
   * **Everything still waiting is resolved first**, and that is the one place a
   * resolution is honest: those yields were already posted on a live channel, so
   * releasing them lets a run in flight reach its next cancellation check — the
   * one place it can end cleanly. It is the *next* request, made after the channel
   * is gone, that is refused rather than answered.
   */
  const dispose = () => {
    disposed = true
    channel.port1.close()
    channel.port2.close()
    while (waiting.length > 0) waiting.shift()()
  }

  return Object.freeze({ next, dispose })
}
