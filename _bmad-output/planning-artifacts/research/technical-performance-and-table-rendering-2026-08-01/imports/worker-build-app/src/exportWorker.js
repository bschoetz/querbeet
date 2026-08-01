// A real export worker, not a stub: it pulls in hyparquet-writer, which is the
// dependency that made the build step mandatory in the first place (ESM only,
// R3), and fflate's gzipSync, which is what makes a GZIP Parquet file readable
// (M2). If those inline into the worker chunk, everything smaller will too.
import { parquetWriteBuffer } from 'hyparquet-writer'
import { gzipSync } from 'fflate'

self.onmessage = (e) => {
  const { rows } = e.data
  const t0 = performance.now()
  const columnData = [
    { name: 'id', data: Array.from({ length: rows }, (_, i) => i), type: 'INT32' },
    { name: 'label', data: Array.from({ length: rows }, (_, i) => 'v' + i), type: 'STRING' },
  ]
  const buf = parquetWriteBuffer({ columnData, codec: 'GZIP', compressors: { GZIP: (b) => gzipSync(b) } })
  self.postMessage({ bytes: buf.byteLength, ms: performance.now() - t0 })
}
