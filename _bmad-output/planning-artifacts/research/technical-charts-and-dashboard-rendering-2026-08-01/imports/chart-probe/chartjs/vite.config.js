import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';

// R2's build rules: never pass a `build` object through the plugin's
// overrideConfig (shallow merge discards the plugin's own settings), keep
// nothing in public/, and turn the modulePreload polyfill off.
export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  build: { modulePreload: { polyfill: false }, assetsInlineLimit: 100000000 },
  worker: { format: 'iife' },
});
