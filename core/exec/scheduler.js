// The scheduler (AD-9, AD-25, CAP-38) — the asynchronous driver of the one walk.
//
// `core/exec/execute.js` owns the walk and `executeGraph` drains it in a `while`.
// This file drains the *same* generator one Step per turn of the macrotask queue:
// it awaits the `Yield` port before each Step, reads a cancellation flag at that
// point, reports progress, and resolves with a run that says which of the three
// things happened to it.
//
// WHAT IS AND IS NOT IN HERE.
//
//   The Steps are untouched. AD-4 says a Step is a pure synchronous function and
//   this file does not make one async, chunked or resumable — the yield is in the
//   loop *around* the Steps, which is exactly what AD-9 calls the scheduler.
//
//   The platform is not named. `yieldNow` and `clock` arrive as parameters and
//   this file constructs neither, so `MessageChannel` and `Date.now` stay in
//   `adapters/` where AD-1 and AD-2 put them. It is also what makes this testable
//   without timers: a test hands in a yield it releases by hand, and the repo
//   still needs no fake clock (it has never had one).
//
//   The flag is a plain closure variable, and that is **not** the flag AD-9
//   forbids. AD-9 rules out a *shared* one — `SharedArrayBuffer` across threads,
//   which is hidden from `file://` in both engines and which `typeof` lies about.
//   This run is single-threaded: the control sets the flag from the same thread,
//   and the yield is what bounds the interval between "the user clicked" and "the
//   flag is read" to one Step.
//
// WHAT A CANCELLED RUN RETURNS, AND WHY IT RETURNS NOTHING. A partially computed
// graph presented as the current result is the failure this product exists to
// prevent: some Steps would reflect the new configuration and some the old, with
// nothing on screen saying which. So a cancelled run resolves with no results at
// all and one diagnostic naming the cancellation, and the caller keeps showing
// what it was showing. The work is not lost — every Step that finished is in
// story 7a's content-addressed cache, keyed on what it is, so the next run picks
// up where this one stopped. That is why the cache came first.

import { info } from '../diagnostics/diagnostic.js'
import { CODE, EMPTY_RESULTS, mintRun, RUN_STATE, walkGraph } from './execute.js'

/**
 * Start a run and hand back a handle to it.
 *
 * @param {object} args every argument `executeGraph` takes, plus the three below
 * @param {import('../../ports/index.js').Clock} args.clock AD-25's identity
 * @param {() => Promise<void>} args.yieldNow the `Yield` port's `next`, or
 *   anything else that resolves on the macrotask queue. Awaited once per Step,
 *   **before** that Step runs.
 * @param {(progress: Readonly<{ done: number, total: number, stepId: string,
 *   kind: string }>, run: Readonly<{ id: string|null, startedAt: number|null }>)
 *   => void} [args.onProgress] called once per Step with the walk's own
 *   descriptor and the run's identity, immediately before the yield that precedes
 *   that Step. It is the caller's business whether that reaches a screen: the
 *   reveal delay is a presentation decision and lives where the presentation is.
 *
 *   **The identity is handed in rather than looked up, because the obvious
 *   callback cannot look it up.** It compares elapsed time against the run's
 *   `startedAt`, which lives on the handle this function has not returned yet —
 *   `const h = startRun({ onProgress: () => h.startedAt })` reads `h` from its own
 *   temporal dead zone and works only for as long as nothing calls back before the
 *   assignment. That is a contract held by timing, and story 7b shipped it once.
 *   The second argument makes it a contract held by the signature.
 *
 *   **It is still never called synchronously from `startRun`**, and that is worth
 *   keeping on its own terms: a caller that has not been handed its handle yet
 *   cannot cancel, cannot compare generations, and cannot tell which run is
 *   reporting. So the drain begins one microtask later — the gates have already
 *   run by then, so nothing observable moves with it — and a test pins it.
 * @returns {Readonly<{ id: string|null, startedAt: number|null,
 *                      cancel: () => void, completed: Promise<object> }>}
 *   `id` and `startedAt` are available **synchronously**, because a caller that
 *   holds two runs has to be able to tell them apart before either finishes.
 *   **Both are `null` when no clock was passed** — the clock is a door, exactly
 *   as the cache is — so a caller timing a run against `startedAt` has to test it
 *   rather than subtract it: `now() - null` is `now()`, which is every elapsed
 *   test's worst possible wrong answer.
 *
 *   `completed` resolves with the walk's return value, whose `ok` says only
 *   whether the run was *refused* (see `executeGraph`); **a cancelled run resolves
 *   `ok: true` with no results at all**, so `run.state` is what a caller deciding
 *   whether to publish must read. It *rejects* for two reasons and neither is a
 *   run outcome: a programming error escaping the walk, and a `Yield` that refused
 *   to yield.
 */
export function startRun({ clock = null, yieldNow, onProgress = null, ...graph }) {
  const identity = mintRun(clock)
  let cancelled = false

  const walk = walkGraph({ ...graph, run: identity })

  // **The first `next()` is synchronous, and that is the gates.** Everything above
  // the walk's loop — the Result-Step check and AD-29's gate 1 — runs here, before
  // any promise exists, so a refused run is refused at the moment it was asked for
  // rather than a turn of the queue later. It is also why an empty graph costs no
  // yield at all: the generator returns without ever reaching its loop.
  let step = walk.next()

  const cancelledAt = (progress) =>
    Object.freeze({
      ok: true,
      results: EMPTY_RESULTS,
      diagnostics: Object.freeze([
        // No `stepId`: this is about the run and not about the Step it stopped
        // in front of, and a mark on that Step's card would read as something
        // wrong with the Step. `info`, because the user asked for it — a
        // cancellation is a thing that succeeded.
        info(CODE.runCancelled, { done: progress.done, total: progress.total }),
      ]),
      run: Object.freeze({ ...identity, state: RUN_STATE.cancelled }),
    })

  const drain = async () => {
    while (!step.done) {
      if (onProgress !== null) onProgress(step.value, identity)
      // **A yield that refuses ends the run rather than being walked past.** The
      // `Yield` port promises a turn of the macrotask queue; a port that can no
      // longer give one — `adapters/scheduler/queue-yield.js` after `dispose`, a
      // host tearing its channel down — has to say so, because the two
      // alternatives are worse. Suspending for good would hang the run holding
      // every table it has computed, and resolving anyway would drain the rest of
      // the graph with no engine turn between Steps, which is the blocking run
      // this whole port exists to prevent. So the rejection propagates to
      // `completed`, and the generator is closed first: the walk must not be left
      // suspended mid-graph with its `results` reachable from a promise nobody
      // will resume.
      try {
        await yieldNow()
      } catch (refused) {
        walk.return(undefined)
        throw refused
      }
      // **Between two Steps.** The engine has had a turn, so a click on the cancel
      // control has been delivered and the flag it set is this read.
      if (cancelled) {
        // Closes the generator where it stands. Nothing was computed for the node
        // whose descriptor `step.value` carries, so `done` is a count of Steps
        // that finished rather than of Steps that were started.
        walk.return(undefined)
        return cancelledAt(step.value)
      }
      step = walk.next()
    }
    return step.value
  }

  return Object.freeze({
    id: identity.id,
    startedAt: identity.startedAt,
    /**
     * Ask the run to stop before its next Step.
     *
     * Idempotent, and safe after the run has finished: a flag nobody reads again
     * changes nothing. It does **not** settle `completed` early — the run ends at
     * its next cancellation check, which is at most one Step away.
     */
    cancel: () => {
      cancelled = true
    },
    // One microtask before the first `onProgress`, for the reason the parameter's
    // documentation gives. Not a yield and not a scheduling decision: the walk's
    // gates ran above, and this promise is already the thing every caller awaits.
    completed: Promise.resolve().then(drain),
  })
}
