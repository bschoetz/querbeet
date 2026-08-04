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
 *
 * `media` names what `read` receives. A `text` reader gets a string the
 * encoding ladder in core/types decoded from the registry's retained bytes
 * (AD-3, AD-7) — decoding is never a reader's concern. A `binary` reader gets
 * the bytes themselves (XLSX, Parquet).
 *
 * A cell is always **canonical text**, whatever the format's own types were: a
 * number as its shortest round-trip decimal, a date as `yyyy-MM-dd`, a datetime
 * as ISO 8601 UTC, a boolean as `true`/`false`, an absent value as `''`. The
 * typed-ness lives in `domain`, never in the values — Step zero's sweep, the
 * preview and the annotations are all string-based, and a `Date` object crossing
 * here would stringify to a local-zone sentence and stay mutable inside a frozen
 * registry entry. Converting a cell into an engine value is story 6's (AD-21,
 * AD-22).
 *
 * `config` is format-specific; `null` fields mean "propose", explicit values
 * are user corrections and survive re-reads. CSV takes `{ delimiter, headerRow }`,
 * XLSX takes `{ headerRow, sheet }`, Parquet takes none — its schema is
 * authoritative. `read` returns, or resolves to,
 *
 *   {
 *     table: { columns: [{ name, domain, cells }], rowCount },
 *     proposal: { ...the effective, correctable parse decisions },
 *     damage: { mismatches: [{ row, fields, raw }], unclosedQuoteRow },
 *     diagnostics: Diagnostic[],
 *   }
 *
 * `proposal` is also what tells a caller which controls a format even has: CSV
 * proposes a `delimiter` and a `headerRow`, XLSX a `headerRow`, the chosen
 * `sheet` and the `sheets` available, Parquet nothing at all.
 *
 * **`read` may return a Promise.** The two binary readers cannot be synchronous:
 * `read-excel-file` unzips through fflate's callback API and parses XML in
 * interruptible chunks, and `hyparquet` reads through an async buffer. The store
 * awaits either shape, which is why its three parsing commands — `addSource`,
 * `overrideEncoding`, `reconfigureParse` — are async and the rest are not.
 *
 * Damaged rows are excluded from the table but kept raw and inspectable in
 * `damage` — never padded or guessed into alignment (CAP-39, C-10).
 * @property {'text' | 'binary'} media
 * @property {(data: string | ArrayBuffer, config: object) => object | Promise<object>} read
 */

/**
 * @typedef {object} EngineColumn
 * One column on the way into an engine Table — what Step zero hands over.
 * @property {string} name
 * @property {string} type one of `core/types/catalog.js`'s codes; what `schema()` reports
 * @property {Array<unknown>} values one entry per row, in row order
 * @property {ReadonlyArray<number>} unparsed the indices of `values` the adapter boxes
 */

/**
 * @typedef {object} TableEngine
 * AD-19 — the adapter absorbs the measured hazards, not the Step kinds. Null join
 * keys drop rows silently while the obvious sentinel fix multiplies them; a
 * column-set mismatch on concatenation drops columns silently; the engine's own
 * CSV entry points are not used, since parsing belongs to SourceReader.
 *
 * **`fromColumns` is Step zero's one door into the engine** (CAP-9, AD-7): a
 * confirmed Source is converted column by column and handed over here. There is
 * deliberately no row-shaped entry point — an intermediate array of row objects
 * is 30.6 MB of row-object overhead at the NFR-3 shape that nothing ever needs to
 * exist, so the absence of the door is what keeps it from being built.
 *
 * **Two hazards live behind this signature and neither reaches a Step kind.**
 *
 *   1. THE BOX (AD-22). A value that does not parse under its confirmed type is
 *      held as a box carrying the original text, in the cell itself, so it
 *      survives joins and aggregates by construction. **The box representation is
 *      private to the adapter and `core/` never constructs one** — which is why
 *      the column arrives split rather than boxed: at every index in `unparsed`,
 *      `values` holds the *original text*, and the adapter boxes exactly those
 *      positions. **At the edges a boxed cell materializes as its original
 *      text** — the same text export writes — so `rows()` and `column(name)`
 *      never hand a box out. Box identity is observable only through engine
 *      operations and through the caller's own `unparsed` map.
 *   2. `BigInt` (AD-21). Every temporal column holds nanoseconds as a `BigInt` —
 *      a date UTC-midnight epoch ns, a datetime UTC epoch ns, a `time` ns since
 *      midnight, a `duration` plain ns. `BigInt` and `Number` do not mix in
 *      arithmetic, so a mean over a temporal column throws rather than coerces,
 *      and absorbing that is the adapter's job under this rule rather than every
 *      Step author's.
 *
 * **`values` is handed over, not borrowed.** The adapter takes ownership of each
 * array and boxes in place; the caller must not read or reuse it afterwards. That
 * is what keeps the converted column at one copy rather than two — the registry's
 * raw text (AD-7) is the only other one, and nothing ever holds a third.
 *
 * **`filter` and `selectColumns` are the two operations story 6b added, and they
 * exist so that a Step kind never touches a cell.** Both take a `Table` this
 * engine produced — a handle from another engine is a caller's bug and throws.
 *
 *   filter(table, { conditions, combine })
 *     `conditions` is `[{ column, op, value }]` in **canonical machine form**
 *     (CAP-15): a number is a `number`, a text value a string, a boolean a
 *     boolean, and a temporal value an ISO 8601 **string** — never a display
 *     form and never a `BigInt`, because `core/` may not construct one. The
 *     adapter converts a temporal comparison value to nanoseconds **once** per
 *     condition, on this side of the port. `combine` is `'all'` or `'any'`.
 *
 *     `op` is one of `eq ne lt lte gt gte empty not_empty`. `empty` matches
 *     `null`, the empty string and a whitespace-only string alike; `not_empty`
 *     is its exact complement **over non-boxed values**. A `null` cell matches
 *     no ordering or equality operator — `null < 5` is `true` in JavaScript and
 *     that is not a comparison anybody asked for.
 *
 *     **A box matches no operator** (AD-22), which is why the return value is
 *     not a bare Table: only this side of the port can see a box, so only it can
 *     count the rows a box excluded. The return is
 *
 *       { table, removed, boxed, unreadable }
 *
 *     `removed` is how many rows the filter took out, `boxed` how many of those
 *     were excluded with a box in one of the compared columns, and `unreadable`
 *     names the conditions whose temporal value could not be read as ISO 8601
 *     (`[{ column, type, value }]`). When `unreadable` is non-empty `table` is
 *     `null` — a filter nobody can evaluate produces no table rather than a
 *     silently different one. The three counters are plain numbers and plain
 *     data: `core/` mints the Diagnostics from them (AD-13).
 *
 *   selectColumns(table, ordered)
 *     `ordered` is `[{ from, to }]` and **its order is the output column order**
 *     (CAP-16). A `to` that repeats, or a `from` no column answers to, is a
 *     caller's bug and throws: both are refused one layer up, at configure time
 *     and at execution respectively, where the refusal can be a Diagnostic.
 *     Columns are shared with the input table rather than copied.
 *
 * @property {(columns: ReadonlyArray<EngineColumn>) => Table} fromColumns
 * @property {(table: Table, spec: { conditions: ReadonlyArray<{ column: string, op: string, value?: unknown }>, combine: 'all' | 'any' }) => { table: Table|null, removed: number, boxed: number, unreadable: ReadonlyArray<{ column: string, type: string, value: unknown }> }} filter
 * @property {(table: Table, ordered: ReadonlyArray<{ from: string, to: string }>) => Table} selectColumns
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
 * The Editor canvas (CAP-11, CAP-12). **The app's model owns the truth and this
 * is a view over it** — design B, decided by the Editor spike and measured: under
 * the adapter's `applyDefault: false` the library's own mutation API stops being
 * able to mutate, so every edge on screen exists because our model produced it.
 * The cycle guard is therefore not merely in front of the library's mutation API;
 * that API cannot mutate. The library ships no cycle detection at all.
 *
 * **What the host pushes.** Two projections, and nothing else:
 *
 *   nodes  [{ id, kind, x, y, slots, dimmed }]  — `slots` is how many input slots
 *          the Step has, which is what decides how many anchors the frame renders;
 *          `dimmed` marks a Step on no path to the Result Step.
 *   edges  [{ id, source, target, slot, dimmed }] — `slot` is the *target's*
 *          input position, and `id` is minted by `core/graph`'s `edgeId`.
 *
 * Neither carries a table, a row or a `Table` handle (AD-6), and neither carries
 * a German word: the view renders a per-node body from a scoped slot the host
 * supplies, so no prose reaches the adapter (AD-13).
 *
 * **What the host receives.** Six reports, each already interpreted — three
 * about what changed, two about the pointer gesture that connects, and one about
 * where the user is looking:
 *
 *   move        (id, x, y)                 a Step was dragged or arrow-keyed
 *   remove      (id)                       a Step was deleted
 *   disconnect  (target, slot)             an edge was deleted *by the user*
 *   connect     (source, target, slot)     a drop the guard accepted
 *   refused     (source, target, slot)     a drop the guard turned down
 *   select      (id | null)                the selected Step, or none
 *
 * `refused` exists because a refused drop never reaches `connect`, and the
 * gesture is where the user finds out. It carries the connection that was
 * attempted and no reason: the host owns the refusal text, asks its own guard
 * again to get it, and there is therefore one refusal from one place rather than
 * two sentences that could differ. It is reported only where the gesture actually
 * ended on a handle — the guard is asked of every handle the pointer passes over,
 * so a drag abandoned over empty canvas is not a refusal anybody made.
 *
 * **A removal reports its own target and slot.** No host parses an edge id to
 * find out which slot was emptied — the library's remove change already carries
 * `target` and `targetHandle`, and where it does not, the adapter resolves it
 * through `core/graph`'s `parseEdgeId`, the single owner of that grammar.
 *
 * **A node removal is not a set of disconnects, and the adapter is what knows
 * that.** The library reports the edges a deleted node drags with it *before* it
 * reports the node, and both arrive as `remove`; read naively they are
 * indistinguishable from a user emptying those slots one by one. The adapter
 * absorbs the ordering (AD-19) and reports only the disconnects a user actually
 * asked for, so a Step that lost an upstream comes out **broken and naming what
 * it lost** rather than merely short of an input.
 *
 * **What the host supplies.** The connection guard —
 * `guard(source, target, slot) => boolean` — which the adapter wires on the
 * handles at **both** ends of a drag, never as a component-level prop: the
 * store-level prop is also applied to every existing edge on every projection,
 * where a cycle guard evaluates edges that already exist and silently drops the
 * whole graph. And the per-node body, as a scoped slot receiving the node.
 *
 * **Selection state stays the library's, and the host is told which Step it is.**
 * The `select` change is still the one thing handed back to the library, so the
 * adapter remains the only owner of what is highlighted — but story 6b's per-Step
 * configuration and preview live in a side panel outside the canvas, and a panel
 * that cannot learn which Step the user selected is a panel with no subject. So
 * the id crosses outward as one report and nothing else does: the host mirrors
 * the id, never a node, and it never pushes a selection back in. A deselection —
 * a click on the background, the selected Step removed — reports `null`.
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
