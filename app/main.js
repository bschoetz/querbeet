// The composition root. This is the only place that names a concrete adapter
// (AD-1), and it owns startup and the build version (AD-12 — a Consumer must be
// able to read the build version back to the Author).
//
// Nothing is wired yet: no adapter exists. What this file proves today is that
// the driving adapter mounts and the core is reachable from it without the core
// reaching back.

import { createApp } from 'vue'
import App from '@ui/App.vue'
import '@ui/style.css'

export const BUILD_VERSION = '0.0.0'

createApp(App, { buildVersion: BUILD_VERSION }).mount('#app')
