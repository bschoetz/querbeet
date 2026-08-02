<script setup>
// The driving adapter. ui/ issues commands and renders projections; it may import
// core/ and ports/, never adapters/ (AD-1). A browser File, DragEvent or
// ClipboardEvent never reaches core/ — ui/ unwraps it and issues a command
// carrying bytes and a name (AD-3).
//
// German is rendered here and only here. core/ emits codes and structured values;
// this layer turns them into the sentences a user reads (AD-13, C-6).
//
// The scaffold's demo section is gone: its role — proving the core→ui
// diagnostics chain — is carried by the Sources pane now, which renders real
// diagnostics from real files.

import SourcesPane from '@ui/SourcesPane.vue'

const props = defineProps({
  buildVersion: { type: String, required: true },
  store: { type: Object, required: true },
})
</script>

<template>
  <main class="p-8 font-sans text-slate-800">
    <h1 class="text-2xl font-semibold">
      querbeet
    </h1>
    <p class="mt-1 text-sm text-slate-500">
      Berichte rein, konsolidierte Tabelle raus. —
      <span data-testid="build-version">Build {{ props.buildVersion }}</span>
    </p>

    <SourcesPane
      :store="props.store"
      class="mt-8"
    />
  </main>
</template>
