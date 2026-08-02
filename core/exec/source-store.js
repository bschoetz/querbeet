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

  return {
    addSource,
    removeSource,
    renameSource,
    overrideEncoding,
    reconfigureParse,
    get: (id) => sources.get(id) ?? null,
    list: () => [...sources.values()],
  }
}
