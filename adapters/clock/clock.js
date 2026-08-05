// The `Clock` port (AD-25) — the first inhabitant of a directory that held
// nothing but a `.gitkeep` until this story.
//
// It exists so that `core/` can stamp a run with when it started and which run it
// was without naming a platform. `Date.now()` is a browser and Node global; a
// counter is state. Neither may live in a pure core (AD-2, AD-4), and both are one
// fact about one run, so they sit behind one port with two members rather than two
// ports with one each.
//
// **No `Math.random` and no `crypto.randomUUID`, deliberately.** Every id in this
// product is minted rather than drawn (AD-14), and a run id that depends on how a
// generator was seeded cannot be reproduced by a test that counts the same way.
// What an id has to be here is unique within a session; a counter is exactly that
// and nothing more.

/**
 * A clock and an id mint.
 *
 * **Uniqueness is per instance, and the composition root makes one.** The counter
 * lives in this closure, so two clocks would count in parallel and could hand out
 * `run:…-1` twice. `app/main.js` constructs exactly one and threads it down, the
 * way it does for the engine and the canvas — the same rule AD-1 already asks for,
 * with a consequence worth stating rather than discovering.
 *
 * The prefix is the instant this clock was created, in base 36, so ids from two
 * sessions of the same file are distinguishable in an exported document (FR-37
 * carries the run identity into a filed artifact). It is a discriminator and not a
 * timestamp: `startedAt` is the timestamp, and it is read per run.
 *
 * @returns {Readonly<import('../../ports/index.js').Clock>}
 */
export function createClock() {
  const now = () => Date.now()
  const session = now().toString(36)
  let minted = 0

  const runId = () => {
    minted += 1
    return `run:${session}-${minted}`
  }

  return Object.freeze({ now, runId })
}
