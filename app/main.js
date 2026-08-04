// The composition root. This is the only place that names a concrete adapter
// (AD-1), and it owns startup and the build version (AD-12 — a Consumer must be
// able to read the build version back to the Author).
//
// The source store receives its readers keyed by extension; ui/ sees the store
// and issues its named commands (AD-10), never the adapter behind it.

import { createApp } from 'vue'
import App from '@ui/App.vue'
import '@ui/style.css'
import { createSourceStore } from '@core/exec/source-store.js'
import { createGraphStore } from '@core/graph/graph-store.js'
import { csvReader } from '@adapters/csv/csv-reader.js'
import { xlsxReader } from '@adapters/xlsx/xlsx-reader.js'
import { parquetReader } from '@adapters/parquet/parquet-reader.js'
import { createArqueroEngine } from '@adapters/arquero/engine.js'
import GraphCanvas from '@adapters/vueflow/GraphCanvas.vue'

// Substituted by vite.config.js at compile time: the package version, the commit
// that produced this file, and when it was built. `+` after the commit means the
// tree was dirty, so the artefact came from a state no repository holds (AD-12).
export const BUILD_VERSION = __BUILD_VERSION__

// Keyed by file extension. Legacy `.xls`, `.xlsb` and `.ods` are deliberately
// absent: neither library can read them, and an extension with no reader is a
// named refusal rather than a half-read table.
const store = createSourceStore({ csv: csvReader, xlsx: xlsxReader, parquet: parquetReader })

// The Pipeline. It holds ids and positions and never a table (AD-6); the Source
// nodes in it are reconciled from the store above through one command in one
// direction, never minted twice.
const graph = createGraphStore()

// The `TableEngine` port's implementation, named here and nowhere else (AD-1).
// It is what turns a confirmed Source into a typed Table as Step zero, and it is
// the only module in the tree that knows the engine's name, that a boxed cell
// exists, or that a temporal value is a `BigInt` (AD-19, AD-21, AD-22).
const engine = createArqueroEngine()

// The `GraphView` port's implementation, named here and nowhere else (AD-1).
// `ui/EditorPane.vue` receives it as a prop and knows nothing about Vue Flow.
createApp(App, {
  buildVersion: BUILD_VERSION,
  store,
  graph,
  engine,
  canvas: GraphCanvas,
}).mount('#app')
