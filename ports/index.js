// The interfaces the core calls outward through.
//
// A port is a noun of role, not of technology — `SourceReader`, never `PapaParse`.
// The only place a library name appears is an adapter, and the only place a
// concrete adapter is named is app/ (AD-1).
//
// Every port lives here as a JSDoc contract while it has no shape beyond its
// signature. One splits into its own file when it grows a contract worth reading
// on its own; `ports/` stays the whole outward surface either way.
//
// Two properties of this product decided the paradigm and are worth restating
// where the ports are declared. A Recipe enters through three doors — the Editor,
// the clipboard, and a loaded file or Package — and CAP-28 requires identical
// validation at each, which one core makes structural instead of a discipline.
// And every hard constraint sits at an edge: the opaque file:// origin, the
// absent network, the single-file build, blob-URL classic workers. A core that
// knows nothing about them is immune to them and testable outside a browser.

/**
 * @typedef {object} Table
 * AD-5 — what crosses a Step boundary. Narrow on purpose: `schema()` is mandatory
 * because CAP-13's column union, CAP-16's enumeration, CAP-21's Input Contract and
 * CAP-26's Column Profile all need columns and types without materializing rows.
 * `rows()` yields plain frozen row objects and is called only at real edges —
 * preview, export, SessionStore, worker transfer.
 * @property {() => Iterable<Readonly<Record<string, unknown>>>} rows
 * @property {() => number} rowCount
 * @property {() => ReadonlyArray<{ name: string, type: string }>} schema
 * @property {(name: string) => ReadonlyArray<unknown>} column
 */

/**
 * @typedef {object} SourceReader
 * AD-20 — a reader declares the domain of every cell it delivers: `text`, or
 * `native:<type>` for XLSX and Parquet, which carry real types where CSV and JSON
 * carry strings. Step zero honours the declaration instead of assuming strings,
 * which is what keeps CAP-9's gate from degrading into a rubber stamp for the
 * natively typed formats.
 * @property {(bytes: ArrayBuffer, config: object) => object} read
 */

/**
 * @typedef {object} TableEngine
 * AD-19 — the adapter absorbs the measured hazards, not the Step kinds. Null join
 * keys drop rows silently while the obvious sentinel fix multiplies them; a
 * column-set mismatch on concatenation drops columns silently; the engine's own
 * CSV entry points are not used, since parsing belongs to SourceReader.
 */

/**
 * @typedef {object} TableWriter
 * CSV, JSON, XLSX and Parquet output (CAP-36). AD-15: this adapter owns the only
 * two workers querbeet's own code creates, and they are classic scripts from a
 * blob URL.
 */

/**
 * @typedef {object} DocumentWriter
 * AD-28 — the self-contained HTML and the paginated PDF of CAP-37, separate from
 * TableWriter, whose contract is a table rather than a paginated document.
 * **No adapter implements this yet.** The research is written and unrun, so the
 * port is defined and the capability is absent rather than half-built.
 */

/**
 * @typedef {object} SessionStore
 * AD-16 — the database name and keys carry a discriminator. That makes collisions
 * legible; it does not isolate anything. The file:// origin is one bucket shared
 * across directories in both engines and querbeet cannot partition it from the
 * inside, so no interface text may imply otherwise.
 */

/**
 * @typedef {object} ChartRenderer
 * AD-26 — registers the SVG renderer alone. With both registered, asking for SVG
 * returns a PNG silently and CAP-37's vector-with-selectable-text guarantee dies
 * quietly. One lifecycle: create, update, resize, dispose. The adapter never
 * outlives its tile.
 */

/**
 * @typedef {object} GraphView
 * The Editor canvas (CAP-11, CAP-12). The app's model owns the truth; this is a
 * projection pushed from one watcher. The cycle guard sits in front of the
 * library's mutation API, which contains no cycle detection at all.
 */

/**
 * @typedef {object} Clipboard
 * AD-23 — one disclosure value, and only this port accepts it. Everything that may
 * leave for a model is assembled in core/profile into one `Disclosure` carrying
 * exactly what will be sent, and this signature accepts nothing else, so no code
 * path can send anything the user did not see.
 */

/**
 * @typedef {object} Clock
 * AD-25 — a run has an identity and a start time, taken from here so AD-4's purity
 * holds. A compliance artifact that cannot say when it was produced is not one.
 * @property {() => number} now
 */

export {}
