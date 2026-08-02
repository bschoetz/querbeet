// AD-7 — the registry holds, per Source, the original bytes and the raw parsed
// table. The bytes are what an encoding change, a delimiter or header change,
// and the damaged raw rows all read from — discarding them makes those
// capabilities unbuildable, so every re-read below starts from `entry.bytes`
// and never from the file.
//
// All change goes through named commands (AD-10); ui/ never mutates an entry,
// and every entry is frozen. The commands validate their own arguments — the
// boundary does not rely on the UI staying polite. The readers arrive injected
// by app/ as `{ extension → SourceReader }` — this file names no adapter (AD-1).

import { error, unresolved } from '../diagnostics/diagnostic.js'
import { ENCODINGS, decode, decodeBytes } from '../types/encoding.js'
import { detectColumn, detectTable, scoreColumn, unresolvedColumns } from '../types/typing.js'

const slugify = (name) => {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks NFKD split off (ä → a)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'source'
}

// The one trap the ladder cannot see (C-10): BOM-less UTF-16 with ASCII content
// is *valid* UTF-8 — NUL is a legal UTF-8 byte — so the strict probe passes and
// every second character of the decoded text is U+0000. The ladder stays exactly
// as frozen (BOM → probe → 1252); the trap is surfaced instead of parsed over:
// an unresolved question pointing at the encoding override, which already
// carries utf-16le/be. Also covers a UTF-32 BOM misread as UTF-16.
const nulDiagnostics = (text) => {
  const count = text.split('\u0000').length - 1
  return count === 0 ? [] : [unresolved('encoding.nul_bytes', { count })]
}

/**
 * @param {Record<string, import('../../ports/index.js').SourceReader>} readers
 */
export function createSourceStore(readers) {
  /** @type {Map<string, object>} id → frozen entry */
  const sources = new Map()

  // AD-14 — ids are minted here, unique, and never reused after a removal, so
  // a Recipe referencing a deleted Source can never silently bind to a new one.
  const mintedIds = new Set()

  const mintId = (name) => {
    const base = `src:${slugify(name)}`
    let id = base
    for (let n = 2; mintedIds.has(id); n += 1) id = `${base}-${n}`
    mintedIds.add(id)
    return id
  }

  const extensionOf = (fileName) => {
    const match = /\.([^.]+)$/.exec(fileName)
    return match ? match[1].toLowerCase() : null
  }

  const must = (id) => {
    const entry = sources.get(id)
    if (!entry) throw new Error(`no source with id ${id}`) // programming error, not a Diagnostic
    return entry
  }

  const commit = (entry) => {
    const frozen = Object.freeze(entry)
    sources.set(frozen.id, frozen)
    return frozen
  }

  /**
   * Step zero, re-run against a freshly parsed table (CAP-9). Two things are
   * carried across a re-read and one is not.
   *
   * An annotation is the user's own sentence, so it follows its column by name:
   * losing what someone wrote because they corrected a delimiter would be
   * hostile. A type the user chose follows the same way — they answered a
   * question and the question has not changed, only the values behind it, and
   * the hit rate is re-scored so a now-wrong choice is visible rather than
   * silent.
   *
   * The confirmation does not survive, ever. A re-read can change every value in
   * the table even when the column names are identical — a different encoding is
   * exactly that — so a confirmation carried across would be a person vouching
   * for data they never saw. That is the failure AD-29's gate exists to prevent.
   */
  const retype = (table, previous) => {
    const detected = detectTable(table)
    if (!previous) return detected

    const before = new Map(previous.columns.map((c) => [c.name, c]))
    return Object.freeze({
      columns: Object.freeze(
        detected.columns.map((column) => {
          const old = before.get(column.name)
          if (!old) return column
          const carried = { ...column, annotation: old.annotation, chosen: old.chosen }
          if (!old.chosen) return Object.freeze(carried)
          const cells = table.columns.find((c) => c.name === column.name).cells
          return Object.freeze({
            ...carried,
            ...scoreColumn(cells, { ...old.chosen, missingTokens: old.missingTokens }),
            annotation: old.annotation,
            chosen: old.chosen,
            name: column.name,
          })
        }),
      ),
      confirmed: false,
    })
  }

  /** The column record a command names, with the position it sits at — both,
   *  because a command has to rebuild the list around it. */
  const columnAt = (entry, name) => {
    const at = entry.typing.columns.findIndex((c) => c.name === name)
    if (at === -1) throw new Error(`no column ${name} in source ${entry.id}`) // programming error
    return { at, column: entry.typing.columns[at] }
  }

  /** Rebuild the typing with one column replaced. `confirmed` is passed rather
   *  than assumed: changing a type unmakes a confirmation, writing a sentence
   *  about a column does not. */
  const withColumn = (entry, at, column, confirmed) => {
    const columns = [...entry.typing.columns]
    columns[at] = Object.freeze(column)
    return Object.freeze({ columns: Object.freeze(columns), confirmed })
  }

  /**
   * Re-read from the retained bytes (AD-7) — never from the file. A reader
   * throw here must not escape into the UI: the previous table state is kept
   * (the bytes still are the truth) and the failure becomes a Diagnostic, the
   * same courtesy addSource extends.
   */
  const reRead = (entry, { encoding, parseConfig }) => {
    const reader = readers[entry.extension]
    try {
      let result
      let extra = []
      if (reader.media === 'text') {
        const text = decodeBytes(entry.bytes, encoding.chosen)
        extra = nulDiagnostics(text)
        result = reader.read(text, parseConfig)
      } else {
        result = reader.read(entry.bytes, parseConfig)
      }
      return commit({
        ...entry,
        encoding,
        parseConfig,
        table: result.table,
        typing: retype(result.table, entry.typing),
        proposal: result.proposal,
        damage: result.damage,
        diagnostics: Object.freeze([...extra, ...result.diagnostics]),
      })
    } catch {
      return commit({
        ...entry,
        encoding,
        parseConfig,
        diagnostics: Object.freeze([error('source.unreadable', { fileName: entry.fileName })]),
      })
    }
  }

  /**
   * AD-10 command. Failure is per file (a Diagnostic, no Source) so one broken
   * or unsupported file never touches the Sources already loaded.
   *
   * @param {{ bytes: ArrayBuffer, fileName: string }} input
   * @returns {{ source: object | null, diagnostics: ReadonlyArray<object> }}
   */
  function addSource({ bytes, fileName }) {
    const extension = extensionOf(fileName)
    const reader = extension === null ? undefined : readers[extension]
    if (!reader) {
      // JSON, XLSX, Parquet are Stories 4 and 17 — until then an unknown
      // extension is a named error, not a half-read table.
      return {
        source: null,
        diagnostics: [error('source.unsupported_format', { fileName, extension: extension ?? '' })],
      }
    }

    const parseConfig = Object.freeze({ delimiter: null, headerRow: null })
    let encoding = Object.freeze({ chosen: null, source: null, override: null })
    let extra = []
    let result
    try {
      if (reader.media === 'text') {
        // One decode: the ladder's own text is what the reader parses.
        const { text, chosen, source } = decode(bytes)
        encoding = Object.freeze({ chosen, source, override: null })
        extra = nulDiagnostics(text)
        result = reader.read(text, parseConfig)
      } else {
        result = reader.read(bytes, parseConfig)
      }
    } catch {
      return { source: null, diagnostics: [error('source.unreadable', { fileName })] }
    }

    const name = fileName.replace(/\.[^.]+$/, '')
    const entry = commit({
      id: mintId(name),
      name,
      fileName,
      extension,
      bytes,
      encoding,
      parseConfig,
      table: result.table,
      typing: retype(result.table, null),
      proposal: result.proposal,
      damage: result.damage,
      diagnostics: Object.freeze([...extra, ...result.diagnostics]),
    })
    return { source: entry, diagnostics: entry.diagnostics }
  }

  /** AD-10 command. The id stays minted — never reused (AD-14). */
  function removeSource(id) {
    must(id)
    sources.delete(id)
  }

  /**
   * AD-10 command. The name is display state; the id never follows it. A name
   * that trims to nothing would leave the card unidentifiable, so it is
   * refused by keeping the current one — the entry returns unchanged.
   */
  function renameSource(id, name) {
    const entry = must(id)
    const trimmed = String(name).trim()
    if (trimmed === '') return entry
    return commit({ ...entry, name: trimmed })
  }

  /**
   * AD-10 command, CAP-2. Re-decodes the retained bytes under the chosen
   * encoding and re-parses; the user's parse corrections survive.
   */
  function overrideEncoding(id, chosen) {
    const entry = must(id)
    if (!ENCODINGS.includes(chosen)) throw new TypeError(`unknown encoding: ${chosen}`)

    return reRead(entry, {
      encoding: Object.freeze({ chosen, source: 'override', override: chosen }),
      parseConfig: entry.parseConfig,
    })
  }

  /**
   * AD-10 command, CAP-3. Explicit fields become user corrections and survive
   * every later re-read; omitted fields keep their current state. Invalid
   * values are a programming error at the command boundary (AD-10) — thrown,
   * not passed through for a reader to misread.
   */
  function reconfigureParse(id, patch) {
    const entry = must(id)

    if (
      patch.delimiter !== undefined &&
      patch.delimiter !== null &&
      (typeof patch.delimiter !== 'string' || patch.delimiter.length === 0)
    ) {
      throw new TypeError('delimiter must be a non-empty string or null')
    }
    if (
      patch.headerRow !== undefined &&
      patch.headerRow !== null &&
      (!Number.isInteger(patch.headerRow) || patch.headerRow < 1)
    ) {
      throw new TypeError('headerRow must be a positive integer or null')
    }

    const parseConfig = Object.freeze({
      delimiter: patch.delimiter !== undefined ? patch.delimiter : entry.parseConfig.delimiter,
      headerRow: patch.headerRow !== undefined ? patch.headerRow : entry.parseConfig.headerRow,
    })

    return reRead(entry, { encoding: entry.encoding, parseConfig })
  }

  /**
   * AD-10 command, CAP-9. The user answers the question detection could not,
   * or overrides an answer it gave. The hit rate is re-scored under the choice
   * immediately, because a choice whose cost is invisible is not a choice —
   * picking mm/dd on a column of German dates has to *show* what it breaks.
   *
   * `patch` carries `{ type, format }`, `{ missingTokens }`, or both. Passing
   * `type: null` returns the column to what detection proposed.
   */
  function setColumnTyping(id, name, patch) {
    const entry = must(id)
    const { at, column } = columnAt(entry, name)

    if (patch.missingTokens !== undefined && !Array.isArray(patch.missingTokens)) {
      throw new TypeError('missingTokens must be an array of strings')
    }

    const missingTokens =
      patch.missingTokens !== undefined
        ? Object.freeze([...patch.missingTokens].map(String))
        : column.missingTokens
    const cells = entry.table.columns[at].cells

    const chosen =
      patch.type === null
        ? null // back to whatever detection proposes
        : patch.type !== undefined
          ? Object.freeze({ type: patch.type, format: patch.format ?? null })
          : column.chosen // only the missing tokens moved

    // With no choice standing, the column is re-detected rather than remembered,
    // so it is exactly what a freshly loaded one would be — and an ambiguity
    // stays an ambiguity. Declaring a missing token must not silently settle a
    // question the user never answered.
    const scored = chosen
      ? scoreColumn(cells, { ...chosen, missingTokens })
      : detectColumn(cells, { domain: column.domain, missingTokens })

    return commit({
      ...entry,
      typing: withColumn(
        entry,
        at,
        { ...scored, name, annotation: column.annotation, chosen, domain: column.domain },
        false,
      ),
    })
  }

  /**
   * AD-10 command, CAP-10 / FR-10. Free text on a column. It is documentation,
   * not configuration: it never touches a type, a hit rate or the gate, which is
   * why this is the one column edit that leaves a confirmation standing.
   */
  function annotateColumn(id, name, text) {
    const entry = must(id)
    const { at, column } = columnAt(entry, name)

    return commit({
      ...entry,
      typing: withColumn(
        entry,
        at,
        { ...column, annotation: String(text ?? '') },
        entry.typing.confirmed,
      ),
    })
  }

  /**
   * AD-10 command, CAP-9 and the first of AD-29's three gates. Refused while a
   * column is genuinely undecided — the names come back so the refusal can say
   * which, rather than that something is wrong. Refusal is a return value, not
   * a throw: an unanswered question is a state of the data, not a caller's bug.
   */
  function confirmTyping(id) {
    const entry = must(id)
    const blocking = unresolvedColumns(entry.typing)
    if (blocking.length > 0) return { source: entry, unresolved: blocking }

    const typing = Object.freeze({ columns: entry.typing.columns, confirmed: true })
    return { source: commit({ ...entry, typing }), unresolved: Object.freeze([]) }
  }

  /** AD-10 command. Reopening the question is always allowed; the gate exists
   *  to stop an unconfirmed run, never to trap a user in a confirmation. */
  function unconfirmTyping(id) {
    const entry = must(id)
    return commit({
      ...entry,
      typing: Object.freeze({ columns: entry.typing.columns, confirmed: false }),
    })
  }

  return {
    addSource,
    removeSource,
    renameSource,
    overrideEncoding,
    reconfigureParse,
    setColumnTyping,
    annotateColumn,
    confirmTyping,
    unconfirmTyping,
    get: (id) => sources.get(id) ?? null,
    list: () => [...sources.values()],
  }
}
