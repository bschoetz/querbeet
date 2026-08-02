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

import { error, unresolved, warning } from '../diagnostics/diagnostic.js'
import { TEXT, isSettableType, nativeTypeOf } from '../types/catalog.js'
import { ENCODINGS, decode, decodeBytes } from '../types/encoding.js'
import {
  bestFormat,
  candidatesFor,
  detectColumn,
  detectTable,
  scoreColumn,
  unresolvedColumns,
} from '../types/typing.js'

/**
 * The typing state as diagnostics (AD-13, CAP-34).
 *
 * Derived on every `commit` from the typing itself, never stored: a typing
 * command changes the entry, so the card's severity summary follows without any
 * command having to remember to update it, and the two can never disagree.
 *
 * `typing.unconfirmed` carries `unresolved` rather than `info`, so a Source is
 * not `clean` until a person has been through step zero. That is AD-29's first
 * gate made visible instead of implicit — the state the fourth severity was
 * introduced for is the one state the summary must not hide.
 */
const typingDiagnostics = (typing) => {
  const out = []
  for (const column of typing.columns) {
    if (column.verdict === 'unresolved' && column.chosen === null) {
      // Two questions, two codes. A locale ambiguity asks which *reading* of the
      // digits is meant; the time-against-duration ambiguity asks what the
      // column *is*, and it is answered with the type select rather than the
      // reading select. Overloading one code would make the card point at the
      // wrong control, so the alternatives (`[time, duration]`, type codes
      // rather than readings) travel under their own name.
      out.push(
        unresolved(
          column.evidence.over === 'kind' ? 'typing.ambiguous_kind' : 'typing.ambiguous_locale',
          { column: column.name, alternatives: column.evidence.alternatives },
        ),
      )
    }
    // Two units in one column is not a number column: `12 €` and `12 $` cannot
    // be summed, and a proposal of `number` would invite exactly that sum. The
    // column is text and both affixes are named, because "this column mixes
    // units" is only actionable if the user learns which two.
    if (column.mixedAffixes) {
      out.push(
        warning('typing.mixed_affixes', {
          column: column.name,
          affixes: column.mixedAffixes,
        }),
      )
    }
    // A reader is the one producer that can name a type the catalogue never
    // heard of (AD-20). The declaration was discarded on the way in — the
    // column's domain is plain `text` and detection ran on it — and the word
    // survives only as provenance, which is what this reads. Deriving it from
    // the domain instead would mean keeping `native:decimal` on the record,
    // where story 14 would serialize it into a Recipe and story 6 would read it
    // as an instruction for a conversion nothing implements.
    if (column.refusedNativeType) {
      out.push(
        warning('typing.unknown_native_type', {
          column: column.name,
          type: column.refusedNativeType,
        }),
      )
    }
    if (column.counts.unparsed > 0) {
      out.push(
        warning('typing.unparsed_values', {
          column: column.name,
          unparsed: column.counts.unparsed,
          readable: column.counts.total - column.counts.missing,
        }),
      )
    }
  }
  if (!typing.confirmed) {
    out.push(unresolved('typing.unconfirmed', { columns: typing.columns.length }))
  }
  return out
}

/**
 * What a failed read is called.
 *
 * `source.unreadable` says "damaged, password-protected, or not the format its
 * extension claims" — three guesses, and all three are wrong for a valid Parquet
 * written with a codec this build cannot decompress. An adapter that knows
 * better attaches a `code` and `values` to what it throws, and that becomes the
 * diagnostic instead. The core forwards a machine code it does not interpret;
 * the German for it lives in `ui/` like every other code (AD-13).
 */
const readFailure = (failure, fileName) =>
  typeof failure?.code === 'string' && failure.code.includes('.')
    ? error(failure.code, { fileName, ...failure.values })
    : error('source.unreadable', { fileName })

/**
 * The parse decisions that were actually in force, as the reader reports them.
 *
 * A user's explicit value is not always honoured: a header row past the end of
 * the sheet is clamped, and a named sheet that no longer exists falls back to
 * the first. Keeping the unhonoured value in `parseConfig` splits the truth in
 * two — the control shows 2 while the config holds 99 — and a later re-read
 * against a bigger sheet resurrects the 99. Adopting the effective value keeps
 * one truth, and it is also what lets a user re-choose a sheet after a fallback:
 * re-selecting the value a select already displays fires no change event.
 *
 * A field the user left to us stays `null`, except the sheet, which is adopted
 * as soon as one has been proposed — otherwise `null` and the name of the very
 * same sheet are two spellings of one state, and selecting the sheet already
 * being read would count as a switch and throw away the header row with it.
 */
const effectiveConfig = (sent, proposal = {}) =>
  Object.freeze({
    delimiter: sent.delimiter === null ? null : (proposal.delimiter ?? sent.delimiter),
    headerRow: sent.headerRow === null ? null : (proposal.headerRow ?? sent.headerRow),
    sheet: proposal.sheet ?? sent.sheet,
  })

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
 * The three commands that parse — `addSource`, `overrideEncoding` and
 * `reconfigureParse` — return a Promise; every other command is synchronous.
 * The split is not a style choice: neither binary reader can be synchronous
 * (fflate unzips through a callback, hyparquet reads through an async buffer),
 * and AD-7 requires a re-read to start from the retained bytes rather than from
 * a decoded copy held on the side. Argument validation still throws
 * synchronously, because a bad argument is a caller's bug and not a state of the
 * data.
 *
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

  /**
   * One parse at a time per Source, in the order the commands were issued.
   *
   * A re-read reads bytes and returns seconds later; on the binary formats,
   * seconds of ordinary clicking. Without this, two commands overlap and the
   * one that *resolves* last wins rather than the one that was *asked* last:
   * choose a sheet, correct the header row before the sheet lands, and the
   * sheet switch is gone — the file is read on the wrong sheet, with a card
   * that says otherwise. Serializing also means each command reads its starting
   * entry after the one before it has committed, so corrections merge instead of
   * clobbering.
   *
   * The chain continues through a rejection, or one failed read would wedge the
   * Source for the rest of the session.
   */
  /** @type {Map<string, Promise<unknown>>} id → the tail of its parse chain */
  const parsing = new Map()

  const serialize = (id, work) => {
    const queued = (parsing.get(id) ?? Promise.resolve()).then(work, work)
    // The stored link never rejects, or one failed read would wedge the Source;
    // the returned one still does, so a caller sees its own failure.
    const settled = queued.then(
      () => undefined,
      () => undefined,
    )
    parsing.set(id, settled)
    return queued
  }

  const must = (id) => {
    const entry = sources.get(id)
    if (!entry) throw new Error(`no source with id ${id}`) // programming error, not a Diagnostic
    return entry
  }

  // `readDiagnostics` is what the read itself produced; `diagnostics` is that
  // slice plus the typing state, recomputed here so no command can ship an
  // entry whose summary describes the typing it replaced.
  const commit = (entry) => {
    const frozen = Object.freeze({
      ...entry,
      diagnostics: Object.freeze([...entry.readDiagnostics, ...typingDiagnostics(entry.typing)]),
    })
    sources.set(frozen.id, frozen)
    return frozen
  }

  /**
   * Step zero, re-run against a freshly parsed table (CAP-9). Three things are
   * carried across a re-read and one is not.
   *
   * An annotation is the user's own sentence, so it follows its column by name:
   * losing what someone wrote because they corrected a delimiter would be
   * hostile. A type the user chose follows the same way — they answered a
   * question and the question has not changed, only the values behind it — and
   * so do the missing tokens they declared, which are part of the typing rather
   * than a display setting: dropping them back to the defaults would move the
   * null share, the hit rate and later the join matching, silently. All three
   * are re-scored against the new values, so a now-wrong choice is visible.
   *
   * The confirmation does not survive, ever. A re-read can change every value in
   * the table even when the column names are identical — a different encoding is
   * exactly that — so a confirmation carried across would be a person vouching
   * for data they never saw. That is the failure AD-29's gate exists to prevent.
   *
   * Carry-over is keyed by name because a name is the only thing a re-read
   * preserves (FR-10). A header may repeat one, so each old column is claimed
   * once and in order: the second `Datum` inherits from the second old `Datum`,
   * not from the first.
   */
  const retype = (table, previous) => {
    const detected = detectTable(table)
    if (!previous) return detected

    const unclaimed = new Map()
    for (const column of previous.columns) {
      const queue = unclaimed.get(column.name)
      if (queue) queue.push(column)
      else unclaimed.set(column.name, [column])
    }

    return Object.freeze({
      columns: Object.freeze(
        detected.columns.map((column, at) => {
          const old = unclaimed.get(column.name)?.shift()
          if (!old) return column

          const cells = table.columns[at].cells
          const domain = table.columns[at].domain
          const missingTokens = old.missingTokens

          // A type the user chose does not survive a column *becoming* native.
          // A sheet switch can do exactly that — the same column name, strings
          // on one sheet and real numbers on the next — and a native column is
          // never retyped (AD-20). The declaration wins over the older answer.
          const chosen = nativeTypeOf(domain) === null ? old.chosen : null
          const rescored = chosen
            ? scoreColumn(cells, { ...chosen, missingTokens, domain })
            : detectColumn(cells, { domain, missingTokens })

          return Object.freeze({
            ...rescored,
            name: column.name,
            annotation: old.annotation,
            chosen,
          })
        }),
      ),
      confirmed: false,
    })
  }

  /**
   * The column record a command addresses.
   *
   * By position, not by name. A CSV header may repeat a name — the reader
   * passes header cells through verbatim, and a trailing delimiter yields two
   * columns called `''` — and a name-keyed command would edit the first of them
   * every time while the second stayed permanently unreachable, including by
   * the gate that is supposed to hold the Source shut over it.
   */
  const columnAt = (entry, index) => {
    if (!Number.isInteger(index) || index < 0 || index >= entry.typing.columns.length) {
      throw new RangeError(`no column ${index} in source ${entry.id}`) // programming error
    }
    return entry.typing.columns[index]
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
   * same courtesy addSource extends. A rejected promise is the same failure and
   * is caught the same way.
   *
   * Awaited, because the two binary readers cannot be synchronous: `read-excel-
   * file` unzips through fflate's callback API and parses XML in interruptible
   * chunks, and `hyparquet` reads through an async buffer. Every command that
   * re-parses is therefore async — see the note on `createSourceStore`.
   */
  const reRead = async (entry, { encoding, parseConfig }) => {
    const reader = readers[entry.extension]
    try {
      let result
      let extra = []
      if (reader.media === 'text') {
        const text = decodeBytes(entry.bytes, encoding.chosen)
        extra = nulDiagnostics(text)
        result = await reader.read(text, parseConfig)
      } else {
        result = await reader.read(entry.bytes, parseConfig)
      }
      // The entry as it stands *now*, not as it stood when the read began. A
      // read takes seconds on a binary format, and an annotation or a type the
      // user set meanwhile lives on the current entry; committing over the
      // captured one would throw their edit away without a word.
      const current = sources.get(entry.id) ?? entry
      return commit({
        ...current,
        encoding,
        parseConfig: effectiveConfig(parseConfig, result.proposal),
        table: result.table,
        typing: retype(result.table, current.typing),
        proposal: result.proposal,
        damage: result.damage,
        readDiagnostics: Object.freeze([...extra, ...result.diagnostics]),
      })
    } catch (failure) {
      const current = sources.get(entry.id) ?? entry
      return commit({
        ...current,
        encoding,
        parseConfig,
        readDiagnostics: Object.freeze([readFailure(failure, entry.fileName)]),
      })
    }
  }

  /**
   * AD-10 command. Failure is per file (a Diagnostic, no Source) so one broken
   * or unsupported file never touches the Sources already loaded.
   *
   * @param {{ bytes: ArrayBuffer, fileName: string }} input
   * @returns {Promise<{ source: object | null, diagnostics: ReadonlyArray<object> }>}
   */
  async function addSource({ bytes, fileName }) {
    const extension = extensionOf(fileName)
    const reader = extension === null ? undefined : readers[extension]
    if (!reader) {
      // JSON and NDJSON are story 17; legacy .xls/.xlsb/.ods no reader in this
      // tree can open at all. Until then an unknown extension is a named error,
      // not a half-read table.
      return {
        source: null,
        diagnostics: [error('source.unsupported_format', { fileName, extension: extension ?? '' })],
      }
    }

    const parseConfig = Object.freeze({ delimiter: null, headerRow: null, sheet: null })
    let encoding = Object.freeze({ chosen: null, source: null, override: null })
    let extra = []
    let result
    try {
      if (reader.media === 'text') {
        // One decode: the ladder's own text is what the reader parses.
        const { text, chosen, source } = decode(bytes)
        encoding = Object.freeze({ chosen, source, override: null })
        extra = nulDiagnostics(text)
        result = await reader.read(text, parseConfig)
      } else {
        result = await reader.read(bytes, parseConfig)
      }
    } catch (failure) {
      return { source: null, diagnostics: [readFailure(failure, fileName)] }
    }

    const name = fileName.replace(/\.[^.]+$/, '')
    const entry = commit({
      id: mintId(name),
      name,
      fileName,
      extension,
      bytes,
      encoding,
      parseConfig: effectiveConfig(parseConfig, result.proposal),
      table: result.table,
      typing: retype(result.table, null),
      proposal: result.proposal,
      damage: result.damage,
      readDiagnostics: Object.freeze([...extra, ...result.diagnostics]),
    })
    return { source: entry, diagnostics: entry.readDiagnostics }
  }

  /** AD-10 command. The id stays minted — never reused (AD-14). */
  function removeSource(id) {
    must(id)
    sources.delete(id)
    parsing.delete(id)
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
    must(id)
    if (!ENCODINGS.includes(chosen)) throw new TypeError(`unknown encoding: ${chosen}`)

    // The entry is fetched inside the queue, not captured outside it: a parse
    // ahead of this one in the chain may still change the parse config, and an
    // encoding change must re-read under the config that is in force when it
    // runs rather than the one that was in force when it was clicked.
    return serialize(id, () => {
      const entry = sources.get(id)
      if (!entry) return null // removed while the queue was busy
      return reRead(entry, {
        encoding: Object.freeze({ chosen, source: 'override', override: chosen }),
        parseConfig: entry.parseConfig,
      })
    })
  }

  /**
   * AD-10 command, CAP-3. Explicit fields become user corrections and survive
   * every later re-read; omitted fields keep their current state. Invalid
   * values are a programming error at the command boundary (AD-10) — thrown,
   * not passed through for a reader to misread.
   */
  function reconfigureParse(id, patch) {
    must(id)

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
    // A sheet is named, not numbered: a workbook's sheets can be reordered
    // between two exports of the same report while their names hold, and the
    // name is also what the proposal lists and what a re-read carries.
    if (
      patch.sheet !== undefined &&
      patch.sheet !== null &&
      (typeof patch.sheet !== 'string' || patch.sheet.length === 0)
    ) {
      throw new TypeError('sheet must be a non-empty string or null')
    }

    // Merged inside the queue against the config the command before it left
    // behind. Merging outside would make two overlapping corrections race, and
    // the one that finished reading last would win rather than the one asked
    // last — a sheet switch silently undone by a header-row correction issued
    // while it was still reading.
    return serialize(id, () => {
      const entry = sources.get(id)
      if (!entry) return null // removed while the queue was busy

      const sheet = patch.sheet !== undefined ? patch.sheet : entry.parseConfig.sheet
      // A sheet switch changes what the columns even are, so a header-row
      // correction made against the sheet being left does not travel with it —
      // the new sheet proposes its own, exactly as a freshly loaded one would.
      // Both sides are the effective name by now (see `effectiveConfig`), so
      // choosing the sheet already being read is not a switch.
      const switched = sheet !== entry.parseConfig.sheet
      const headerRow =
        patch.headerRow !== undefined
          ? patch.headerRow
          : switched
            ? null
            : entry.parseConfig.headerRow

      const parseConfig = Object.freeze({
        delimiter: patch.delimiter !== undefined ? patch.delimiter : entry.parseConfig.delimiter,
        headerRow,
        sheet,
      })

      return reRead(entry, { encoding: entry.encoding, parseConfig })
    })
  }

  /**
   * The reading a chosen type is scored under.
   *
   * An omitted format is not "no reading" — it means the user picked a type and
   * left the reading to us, so detection scores the candidates and the best one
   * wins. Handing over the first candidate instead would give every column
   * switched to `number` the German reading, and an Anglo column a collapsed hit
   * rate with nothing on screen to say the other candidate scored better.
   *
   * A named format is resolved against the candidate list rather than trusted:
   * a reading no candidate offers would be scored as zero readable and then
   * confirmed, which is worse than being refused.
   */
  const resolveFormat = (cells, type, format, missingTokens) => {
    if (type === TEXT) return null
    // `time` and `duration` offer no reading at all: the choice between them is
    // the type, and it has already been made by the time this runs. A column
    // with no candidates has no reading to demand and none to refuse.
    const candidates = candidatesFor(type)
    if (candidates.length === 0) return null
    if (format === undefined) return bestFormat(cells, type, missingTokens)
    if (format === null) throw new TypeError(`a ${type} column needs a reading`)

    const key = format.pattern ?? format.locale
    const found = candidates.find((c) => (c.pattern ?? c.locale) === key)
    if (!found) throw new TypeError(`unknown ${type} reading: ${key}`)
    return found
  }

  /**
   * AD-10 command, CAP-9. The user answers the question detection could not,
   * or overrides an answer it gave. The hit rate is re-scored under the choice
   * immediately, because a choice whose cost is invisible is not a choice —
   * picking mm/dd on a column of German dates has to *show* what it breaks.
   *
   * `patch` carries `{ type, format }`, `{ missingTokens }`, or both; `format`
   * may be omitted to take the best-scoring reading for the type. Passing
   * `type: null` returns the column to what detection proposed.
   *
   * The arguments are checked here rather than trusted, per this file's own
   * rule: a type outside the settable set, or a reading no candidate offers,
   * would be stored, scored as fully readable, and confirmed.
   */
  function setColumnTyping(id, index, patch) {
    const entry = must(id)
    const column = columnAt(entry, index)

    if (patch.type === undefined && patch.missingTokens === undefined) {
      throw new TypeError('setColumnTyping needs a type or missingTokens')
    }
    // The reader's own declaration, not the column record's copy of it. The two
    // agree everywhere except on a refused declaration, which the record no
    // longer carries at all — and a refused column is settable, because nothing
    // about it was settled by its format.
    const declared = entry.table.columns[index].domain

    // Guarded by domain, not by type. A `native:number` column has type
    // `number`, which is perfectly settable — what makes it unretypeable is that
    // its format declared it, not that detection proposed it (AD-20). The pane
    // renders no type control for one, so reaching here is a caller's bug.
    //
    // `type: null` is exempt, and deliberately. It is not a retype: it withdraws
    // a choice and hands the column back to whatever the reader and detection
    // propose, which for a native column is the declaration it already has. Story
    // 3 shipped "Zurück zum Vorschlag" as the fix for a closed defect — a reset
    // that refused would be that defect again, on the columns least able to
    // recover from it.
    const isReset = patch.type === null && patch.format === undefined
    if (
      nativeTypeOf(declared) !== null &&
      !isReset &&
      (patch.type !== undefined || patch.format !== undefined)
    ) {
      throw new TypeError(`column ${index} of ${entry.id} is typed by its format and cannot be retyped`)
    }
    if (patch.type !== undefined && patch.type !== null && !isSettableType(patch.type)) {
      throw new TypeError(`unknown type: ${patch.type}`)
    }
    if (patch.format !== undefined && patch.type === undefined) {
      throw new TypeError('a reading cannot be set without a type')
    }
    if (patch.missingTokens !== undefined && !Array.isArray(patch.missingTokens)) {
      throw new TypeError('missingTokens must be an array of strings')
    }

    const missingTokens =
      patch.missingTokens !== undefined
        ? Object.freeze([...patch.missingTokens].map(String))
        : column.missingTokens
    const cells = entry.table.columns[index].cells

    const chosen =
      patch.type === null
        ? null // back to whatever detection proposes
        : patch.type !== undefined
          ? Object.freeze({
              type: patch.type,
              format: resolveFormat(cells, patch.type, patch.format, missingTokens),
            })
          : column.chosen // only the missing tokens moved

    // With no choice standing, the column is re-detected rather than remembered,
    // so it is exactly what a freshly loaded one would be — and an ambiguity
    // stays an ambiguity. Declaring a missing token must not silently settle a
    // question the user never answered.
    const scored = chosen
      ? scoreColumn(cells, { ...chosen, missingTokens, domain: declared })
      : detectColumn(cells, { domain: declared, missingTokens })

    return commit({
      ...entry,
      typing: withColumn(
        entry,
        index,
        { ...scored, name: column.name, annotation: column.annotation, chosen },
        false,
      ),
    })
  }

  /**
   * AD-10 command, CAP-10 / FR-10. Free text on a column. It is documentation,
   * not configuration: it never touches a type, a hit rate or the gate, which is
   * why this is the one column edit that leaves a confirmation standing.
   */
  function annotateColumn(id, index, text) {
    const entry = must(id)
    const column = columnAt(entry, index)

    return commit({
      ...entry,
      typing: withColumn(
        entry,
        index,
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
    /** The extensions a reader was registered for, in registration order. The
     *  drop zone and the unsupported-format refusal both name the readable
     *  formats to the user, and a hand-kept list in `ui/` would be a third copy
     *  of what `app/` already decides — the same restatement `core/types/
     *  catalog.js` was written in this story to end. */
    formats: () => Object.freeze(Object.keys(readers)),
  }
}
