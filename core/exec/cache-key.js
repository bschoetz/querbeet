// What a Step *is*, as a string — AD-8's `key(step) = hash(canonical(config) +
// key(inputs))` with the base case `key(source) = hash(byteDigest + parseConfig
// + encoding)`.
//
// THE ONE RULE THE WHOLE FILE SERVES: **a Source id is never part of a key, and
// neither is a name or a position.** An encoding change, a delimiter change, a
// header-row change and a re-read all produce different bytes or a different
// parse behind an unchanged id (CAP-2, CAP-3, CAP-7), so an id-keyed cache
// serves the previous parse and is a wrong answer rather than a slow one. A
// rename and a move change nothing a Step computes, so a key that saw them would
// throw the whole graph away over a word on a card.
//
// THERE IS ONE CANONICAL SERIALIZER AND THIS IS IT. Story 14's Recipe file needs
// the same fixed key order over the same values (the architecture's consistency
// table says so in as many words: "one canonical serializer, key order fixed,
// used for both the file and the cache key hash"), so `canonical` is written to
// be adopted unchanged rather than re-derived. It refuses what it cannot encode
// deterministically instead of quietly producing a key two different configs
// share — a collision here is not a slow path, it is one Step's table served as
// another's.
//
// WHY A PURE-JS HASH AND NOT `crypto.subtle` — measured, not argued (2026-08-04,
// Node v26.5.1, best of three over synthetic buffers): FNV-1a-128 as four lanes
// costs 5.0 ms at 4 MB, 25.0 ms at 20 MB and 94.7 ms at 100 MB, against 4.4 /
// 14.2 / 70.1 ms for `crypto.subtle.digest('SHA-256')`. SHA-256 is ~1.8× faster
// and costs far more than it saves: it returns a promise, so `executeGraph`
// would become async two stories before the scheduler that is meant to make it
// async, and it is a browser API that `core/` may not name at all (AD-1, AD-2).
// The byte digest is taken **once when bytes arrive**, in `addSource`, which is
// already async and already inside its per-Source chain; a run never hashes
// bytes. 25 ms lands beside the 548–555 ms Step zero already costs at the same
// shape. Confirmed in the engines that actually run the artefact rather than
// left as a Node figure — AD-9's lesson about `file://` behaving differently
// from the documentation: measured from `file://` against the built
// `dist/index.html`, 20 MB costs 43.6 ms in Chromium and 47.0 ms in Firefox,
// and all three engines return the same 32 hex characters for the same bytes.
//
// There is deliberately **no `Hasher` port**. AD-4 sends a clock through a port
// because a clock is a reading of the world; a hash of a value is a function of
// that value and nothing else, so a port would buy an indirection and no
// testability.

/** FNV-1a's 32-bit prime. */
const PRIME = 16777619

/**
 * Four 32-bit lanes over one pass of the bytes, for a 128-bit output.
 *
 * **Why 128 bits and not 32.** A collision is not a slow path here, it is a
 * wrong answer: two Steps sharing a key means one Step's table is served as the
 * other's, which is the one outcome AD-8 rules out even for an eviction.
 *
 * **Why these four constants and not any four.** The lanes run the identical
 * update over the identical bytes and differ only in where they start, and that
 * makes one trap real: `h mod 2^k` after every step is a function of `h mod 2^k`
 * before it and of the byte, so **two lanes whose bases agree modulo 2^k agree
 * modulo 2^k forever** — a pair of bases sharing a low byte would waste 8 of
 * every lane's 32 bits. These are the four byte-rotations of FNV-1a's standard
 * offset basis `0x811c9dc5`; their low bytes are `c5`, `1c`, `9d`, `81`, all
 * distinct, and no two agree in any low-bit prefix. This is not a cryptographic
 * hash and does not claim 128 independent bits; it claims enough of them that
 * the birthday bound sits far above the number of Steps a session can hold.
 */
const BASES = Object.freeze([0x811c9dc5, 0x9dc5811c, 0xc5811c9d, 0x1c9dc581])

const hex = (lane) => (lane >>> 0).toString(16).padStart(8, '0')

/**
 * The 128-bit digest of raw bytes, as 32 lowercase hex characters.
 *
 * **No sampling.** A digest over part of a file is a wrong answer waiting for
 * the file that differs elsewhere, and the whole reason `key(source)` exists is
 * that the id cannot be trusted to have changed.
 *
 * @param {ArrayBuffer|ArrayBufferView} bytes
 */
export function digestBytes(bytes) {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : ArrayBuffer.isView(bytes)
        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : null
  if (view === null) throw new TypeError('digestBytes needs an ArrayBuffer or a view of one')

  // The four lanes are unrolled rather than looped over an array: this is the
  // one hot loop in the file (20 MB is 20 million iterations at the design
  // shape) and it is the loop the 25.0 ms above was measured on.
  let a = BASES[0]
  let b = BASES[1]
  let c = BASES[2]
  let d = BASES[3]
  for (let i = 0; i < view.length; i += 1) {
    const byte = view[i]
    a = Math.imul(a ^ byte, PRIME)
    b = Math.imul(b ^ byte, PRIME)
    c = Math.imul(c ^ byte, PRIME)
    d = Math.imul(d ^ byte, PRIME)
  }
  return hex(a) + hex(b) + hex(c) + hex(d)
}

/**
 * The 128-bit digest of a string, as 32 lowercase hex characters.
 *
 * Each UTF-16 code unit is fed as its two bytes, low first. That mapping is
 * injective — a fixed two bytes per unit, so no two different strings produce
 * the same byte sequence — which is the property the digest needs and is also
 * why nothing here reaches for `TextEncoder`: UTF-8 would be a second encoding
 * to agree about with story 14 for no gain.
 */
export function digest(text) {
  const s = String(text)
  let a = BASES[0]
  let b = BASES[1]
  let c = BASES[2]
  let d = BASES[3]
  for (let i = 0; i < s.length; i += 1) {
    const unit = s.charCodeAt(i)
    const low = unit & 0xff
    a = Math.imul(a ^ low, PRIME)
    b = Math.imul(b ^ low, PRIME)
    c = Math.imul(c ^ low, PRIME)
    d = Math.imul(d ^ low, PRIME)
    const high = unit >>> 8
    a = Math.imul(a ^ high, PRIME)
    b = Math.imul(b ^ high, PRIME)
    c = Math.imul(c ^ high, PRIME)
    d = Math.imul(d ^ high, PRIME)
  }
  return hex(a) + hex(b) + hex(c) + hex(d)
}

const isPlainObject = (value) => {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const describe = (value) => {
  if (value === undefined) return 'undefined'
  if (typeof value === 'bigint') return 'a BigInt'
  if (typeof value === 'function') return 'a function'
  if (typeof value === 'symbol') return 'a symbol'
  if (typeof value === 'number') return `the number ${String(value)}`
  const tag = Object.prototype.toString.call(value).slice(8, -1)
  // A class instance and a plain object are both `[object Object]`, and the
  // whole point of the refusal is that the reader can tell which one they wrote.
  if (tag === 'Object') return `an instance of ${value.constructor?.name ?? 'a null-prototype class'}`
  return `a ${tag}`
}

/**
 * A value as one deterministic string — the same string for the same value, a
 * different string for every different value, on every engine and every run.
 *
 * THE GRAMMAR, and it is **prefix-free on purpose**. Every form carries a tag
 * and every variable-length form carries its length, so a concatenation of two
 * encodings can be read back exactly one way. Without that, `{a: 'b1', c: null}`
 * and `{a: 'b', c: '1n'}` are one key apart from each other by luck:
 *
 *   null      `n`
 *   boolean   `t` / `f`
 *   number    `#` + `String(value)` + `;`      — terminated, digits vary in length
 *   string    `s` + length + `:` + the characters
 *   array     `a` + count + `:` + each item's encoding
 *   object    `o` + count + `:` + each key's *string* encoding then its value's,
 *                                keys sorted by code unit
 *
 * The tags are what make `1`, `"1"` and `true` three different keys rather than
 * one — the collision a naive `JSON.stringify`-and-hope would not have either,
 * but which a hand-rolled `String(value)` join would.
 *
 * **What it refuses, and why refusing is the feature.** A config is guaranteed
 * plain frozen data by `core/graph/graph.js` (`deepFreeze`: selects and typed
 * inputs producing arrays, objects, strings, numbers and booleans — no cycles,
 * no `BigInt`), and this function asserts that guarantee rather than trusting
 * it. Anything else — `undefined`, a `BigInt`, a `Date`, a class instance, a
 * function, `NaN`, `Infinity` — throws and names the path where it sits. The
 * alternative is a key that two different configs share, which serves one Step's
 * table as another's. `NaN` and `Infinity` are refused with the rest rather than
 * given a spelling: they are `number`s the frozen guarantee admits, but JSON has
 * no form for either, so story 14 could not round-trip a key this file had
 * already blessed. If a Step kind added later genuinely needs one, that is a
 * decision about the Recipe format, not a case to invent here.
 *
 * There is no cycle guard for the same reason `deepFreeze` has none: a cycle
 * cannot be built out of what the grammar admits.
 *
 * @param {unknown} value
 * @param {string} [path] the name the refusal uses; callers pass a root of their own
 */
export function canonical(value, path = '$') {
  if (value === null) return 'n'
  if (value === true) return 't'
  if (value === false) return 'f'

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonical: cannot serialize ${describe(value)} at ${path}`)
    }
    // `String` is the specified number-to-string algorithm — shortest round-
    // tripping decimal, identical on every engine. `-0` renders as `0`, which
    // makes it the same key as `0`: the two compute the same table everywhere a
    // config can put a number, so that collision is a merge rather than a fault.
    return `#${String(value)};`
  }

  if (typeof value === 'string') return `s${value.length}:${value}`

  if (Array.isArray(value)) {
    let out = `a${value.length}:`
    for (let i = 0; i < value.length; i += 1) out += canonical(value[i], `${path}[${i}]`)
    return out
  }

  if (typeof value === 'object' && isPlainObject(value)) {
    // Own enumerable keys, sorted: insertion order is a property of how the
    // object was built, and two configs that differ only in that are the same
    // config. `Object.keys` is code-unit sorted by `sort()` with no comparator,
    // which is locale-independent by specification — a `localeCompare` here
    // would make the key depend on the machine's language.
    const keys = Object.keys(value).sort()
    let out = `o${keys.length}:`
    for (const key of keys) {
      out += canonical(key, path)
      out += canonical(value[key], `${path}.${key}`)
    }
    return out
  }

  throw new TypeError(`canonical: cannot serialize ${describe(value)} at ${path}`)
}

/**
 * `key(source)` — the raw parse, and nothing about which Source it is.
 *
 * AD-8 writes it as `hash(byteDigest + parseConfig)`. In this codebase
 * `entry.parseConfig` is exactly `{ delimiter, headerRow, sheet }` and
 * `entry.encoding` is a **separate** frozen field, so the same bytes decoded as
 * UTF-8 and as CP1252 produce different tables from an identical `parseConfig`
 * — and `overrideEncoding` is one of the three commands that re-parse. A key
 * built from `parseConfig` alone would serve a UTF-8 parse for a Latin-1 one, so
 * the encoding is in the key and this sentence is here rather than left for
 * whoever changes an encoding and gets the old table back.
 *
 * The digest is the one the registry took when the bytes arrived; this function
 * never touches bytes.
 */
export function sourceKey({ byteDigest, parseConfig, encoding }) {
  if (typeof byteDigest !== 'string') {
    throw new TypeError('sourceKey needs the byteDigest the registry took on ingest')
  }
  return digest(`source${canonical({ byteDigest, parseConfig, encoding }, '$source')}`)
}

/**
 * `key(step)` — what the Step is, over what its inputs are.
 *
 * `kind` is in the key because a config alone does not say what is done with it,
 * and the input keys are in it in **slot order**, because a Join's left and
 * right are not interchangeable.
 *
 * The caller passes the **resolved** config — `node.config ?? kind.defaultConfig()`
 * — never the raw field. Keying the raw one would make the first `configureStep`
 * that writes a kind's own default look like a change and recompute a Step whose
 * output is provably identical.
 *
 * A missing input key is a caller's bug rather than a state: the walk computes
 * keys in dependency order precisely so a Step's inputs already have theirs, and
 * a Step whose input has no key is a Step that must not be cached at all.
 */
export function stepKey(kind, config, inputKeys) {
  if (typeof kind !== 'string') throw new TypeError('stepKey needs the Step kind')
  const inputs = [...inputKeys]
  for (const key of inputs) {
    if (typeof key !== 'string') throw new TypeError('stepKey needs a key for every input')
  }
  return digest(`step${canonical({ kind, config, inputs }, '$step')}`)
}

/**
 * A key, or `null` where one could not be minted — **the only form the two
 * callers use.**
 *
 * `canonical` throwing is correct and is what the I/O matrix specifies: a silent
 * key collision would serve one Step's table as another's. What must not happen
 * is the throw *leaving the module that asked for a key*. Both callers sit on a
 * render path — `executeGraph` runs inside a `watch` in `ui/EditorPane.vue` and
 * `createStepZeroCache.of` inside `ui/SourcesPane.vue`'s template — so an escape
 * reaches the user as a blank pane, and it would break the frozen rule that a
 * cached run and an uncached run are indistinguishable except in time: without a
 * cache the graph runs, with one it throws.
 *
 * **The family is wider than any one field, which is why this is contained here
 * rather than fixed in a validator.** A kind's `validate` is a check on what that
 * kind can execute, not on what a serializer can encode, and the two do not have
 * to agree: `configureStep(id, { count: 3, end: undefined })` is accepted by
 * `core/steps/first.js` by construction, and `{ combine: 'all', conditions: [],
 * note: new Date(0) }` is accepted by `core/steps/filter.js` because extra fields
 * are stored verbatim. Reproduced 2026-08-05: the first of those returns 3 rows
 * without a cache and threw `canonical: cannot serialize undefined at
 * $step.config.end` with one. Tightening the validators would make `canonical`'s
 * refusal unreachable *today* and leave it reachable the moment story 14 loads a
 * Recipe somebody else wrote.
 *
 * **The refusal is reported, not swallowed.** It is the one signal in this cache
 * that means a programming or format error rather than a cold entry, and a
 * developer who never sees it will conclude the cache works and wonder why it
 * never hits. It goes to `console.warn` and nowhere else: no Diagnostic is minted
 * (the frozen Never — no new code, no new German sentence), because the user has
 * nothing to do about it and the run they get is correct. That is the whole of
 * the exception to "diagnostics are the only reporting channel"; this file is the
 * only one in `core/` that names `console`, and the lint config says so.
 *
 * @param {() => string} mint the key computation to contain
 * @returns {string|null}
 */
export function keyOrNull(mint) {
  try {
    return mint()
  } catch (refusal) {
    // Not de-duplicated, deliberately: a run repeats the refusal because the
    // state repeats, and a warning that appears once and then goes quiet is one
    // a developer scrolls past. The path is unreachable through the shipped UI.
    console.warn(`querbeet: not cacheable — ${refusal?.message ?? refusal}`)
    return null
  }
}
