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
import { csvReader } from '@adapters/csv/csv-reader.js'

export const BUILD_VERSION = '0.0.0'

const store = createSourceStore({ csv: csvReader })

createApp(App, { buildVersion: BUILD_VERSION, store }).mount('#app')
