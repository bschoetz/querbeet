// esbuild entry that turns hyparquet-writer (ESM only — R3's finding that makes
// the build step mandatory) into an IIFE the probe can inject as source text:
//   npx esbuild hpw-entry.mjs --bundle --format=iife --outfile=hyparquet-writer.iife.js
import { parquetWriteBuffer } from 'hyparquet-writer'
globalThis.HPW = { parquetWriteBuffer }
