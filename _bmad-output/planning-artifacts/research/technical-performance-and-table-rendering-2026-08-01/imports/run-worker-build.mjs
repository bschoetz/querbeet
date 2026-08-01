// querbeet R4/D3 — M4. The one-file build gate, with a real Worker in it.
//
// R2 established two rules that have never been exercised together: import a
// worker as `./w.js?worker&inline`, and gate the build on "dist/ contains
// exactly one file", because on this path build success does not imply a
// working artefact. The Editor spike's build contains zero `new Worker`
// occurrences, so the rules were carried forward untested. This tests them.
//
// Usage: node run-worker-build.mjs   (expects worker-build-app/dist/index.html)
import { chromium, firefox } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, statSync, readdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));

// Two artefacts: the form R2's rule 1 mandates, and the idiomatic Vite form it
// warns against — so the difference is demonstrated here rather than inherited.
const VARIANTS = [
  { name: 'inline (?worker&inline)', dir: 'worker-build-app/dist', file: 'index.html' },
  { name: 'idiomatic (new Worker(new URL))', dir: 'worker-build-app/dist-idiomatic', file: 'index-idiomatic.html' },
];

const HAZARDS = [
  ['dynamic import', /\bimport\s*\(/],
  ['fetch(', /\bfetch\s*\(/],
  ['new Worker', /new\s+Worker\s*\(/],
  ['importScripts', /importScripts\s*\(/],
  ['@font-face', /@font-face/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['blob: URL construction', /createObjectURL/],
];
const results = { variants: {} };

for (const v of VARIANTS) {
  const distDir = resolve(here, v.dir);
  const distFile = resolve(distDir, v.file);
  const html = readFileSync(distFile, 'utf8');
  const distFiles = readdirSync(distDir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
  const build = {
    distFiles,
    singleFile: distFiles.length === 1,
    bytes: statSync(distFile).size,
    hazards: Object.fromEntries(HAZARDS.map(([n, re]) => [n, (html.match(new RegExp(re.source, 'g')) || []).length])),
    externalSrc: [...html.matchAll(/<(?:script|link)[^>]*\s(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:') && !u.startsWith('#')),
    nonDataUrls: [...html.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)].map((m) => m[2]).filter((u) => !u.startsWith('data:') && !u.startsWith('#')),
  };
  const url = pathToFileURL(distFile).href;
  const engines = {};
  for (const [engine, driver] of [['chromium', chromium], ['firefox', firefox]]) {
    const b = await driver.launch();
    const p = await b.newPage();
    const errors = [], requests = [], failed = [];
    p.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
    p.on('request', (r) => requests.push(r.url()));
    p.on('requestfailed', (r) => failed.push(r.url()));
    await p.goto(url);
    await p.waitForFunction(() => document.title === 'DONE', null, { timeout: 20000 }).catch(() => {});
    engines[engine] = {
      version: b.version(),
      errors,
      extraRequests: requests.filter((u) => u !== url),
      failedRequests: failed,
      probe: await p.evaluate(() => window.__R__ || null),
    };
    process.stderr.write(`${v.name} / ${engine}: files=${distFiles.length} errors=${errors.length} probe=${JSON.stringify(engines[engine].probe)}\n`);
    await b.close();
  }
  results.variants[v.name] = { build, engines };
}
console.log(JSON.stringify(results, null, 1));
