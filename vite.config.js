import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const dir = (p) => fileURLToPath(new URL(p, import.meta.url))

// AD-12 — a Consumer must be able to read the build version back to the Author.
// That only works if the string identifies *which source* produced the artefact,
// so it is derived from the commit rather than counted. A counter would need
// stored state: in the repo it dirties the tree on every build, outside it two
// machines number the same source differently — and the Author, handed a number,
// could not check out what the Consumer ran.
//
// The `+` marks a tree that had uncommitted changes. It is the load-bearing part:
// it says the artefact came from a state that exists in no repository, which is
// exactly when remote diagnosis otherwise goes in circles.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

function buildVersion() {
  const { version } = JSON.parse(readFileSync(dir('./package.json'), 'utf8'))
  const stamp = new Date()
  const local = new Date(stamp.getTime() - stamp.getTimezoneOffset() * 60_000)
  const when = local.toISOString().slice(0, 16).replace('T', ' ')
  try {
    const commit = git('rev-parse', '--short', 'HEAD')
    const dirty = git('status', '--porcelain') === '' ? '' : '+'
    return `${version} (${commit}${dirty}, ${when})`
  } catch {
    // A build from a source tarball or an exported directory has no git. Say so
    // rather than inventing a hash — an unidentifiable build is worth knowing about.
    return `${version} (no commit, ${when})`
  }
}

// The build emits exactly one HTML file, opened by double-click from the local
// filesystem (C-1). `npm run build` chains scripts/assert-single-file.mjs, which
// is where that claim is allowed to fail (AD-18).
export default defineConfig({
  // A file:// page has no server root. Every URL the document contains must be
  // relative or a data: URI (AD-17).
  base: './',

  plugins: [vue(), tailwindcss(), viteSingleFile()],

  // Substituted at compile time, so the artefact carries the string and asks
  // nothing at runtime — a file:// page could not look it up anyway (AD-17).
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion()),
  },

  resolve: {
    // The layer aliases exist so a cross-layer import is visible in the
    // specifier itself, which is what makes AD-1 lintable rather than reviewable.
    alias: {
      '@core': dir('./core'),
      '@ports': dir('./ports'),
      '@adapters': dir('./adapters'),
      '@ui': dir('./ui'),
      '@app': dir('./app'),
    },
  },

  worker: {
    // Classic scripts from a blob URL are the only worker form measured to work
    // from file:// in both engines. Vite's idiomatic module worker emits a
    // separate chunk, silently breaks the single-file build, and fails at
    // runtime with no build-time signal (AD-15). Import workers as
    // `?worker&inline`; this setting is the other half of that rule.
    format: 'iife',
  },

  build: {
    // Everything inlines. The plugin sets these too; they are repeated here so
    // a reader of this file does not have to know the plugin's defaults.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    reportCompressedSize: false,

    // Vite otherwise injects a modulepreload polyfill that walks
    // `<link rel="modulepreload">` and calls `fetch(el.href)`. In a single-file
    // build there is nothing to preload, so the code is dead — but it is real
    // `fetch(` in the artefact, and AD-17 does not have an exception for dead
    // code. The one-file assertion caught this on the first build; leave it off.
    modulePreload: false,
  },
})
