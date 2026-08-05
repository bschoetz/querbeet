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
 * **What the prefix is, and what it is not.** It is the instant this clock was
 * created, in base 36 — a discriminator rather than a timestamp, since `startedAt`
 * is the timestamp and is read per run. What it guarantees is that ids from two
 * clocks created in *different* milliseconds differ, which covers two sessions of
 * the same file opened by hand. **It does not guarantee that two sessions are
 * distinguishable**, and the first version of this comment claimed it did: two
 * clocks constructed inside one millisecond share a prefix and emit identical id
 * streams. Nothing in the product can reach that state today — `app/main.js`
 * builds one clock per page — and nothing in the product depends on cross-session
 * distinctness either; FR-37's filed document does not exist yet. When it does,
 * the honest fix is a discriminator the *document* carries (the build version and
 * the file's own name are both already at hand in `app/`), not a wider counter
 * here: a clock cannot see the other session, so it cannot solve this alone.
 *
 * The claim this adapter does make, and the one every caller relies on: **an id is
 * unique within the clock that minted it.**
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
