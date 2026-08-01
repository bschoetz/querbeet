// querbeet R4/D3 — export-cost runner (M2, M8).
// The two export libraries are injected as source text rather than fetched,
// exactly as the Vite build would inline them: nothing is fetchable at runtime
// from file://.
// Usage: node run-export.mjs chromium | firefox
import { chromium, firefox } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const which = process.argv[2] || 'chromium';
const drivers = {
  chromium: [chromium, ['--enable-precise-memory-info', '--js-flags=--expose-gc --max-old-space-size=8192']],
  firefox: [firefox, []],
};
const [driver, args] = drivers[which];
const url = pathToFileURL(resolve('export-probe.html')).href;

const xlsx = readFileSync(resolve('node_modules/write-excel-file/bundle/write-excel-file.min.js'), 'utf8');
const hpw = readFileSync(resolve('hyparquet-writer.iife.js'), 'utf8');
// The same text goes into the page and into the worker body — one source of
// truth, so main thread and worker are demonstrably running the same code.
const libs = xlsx + '\n;\n' + hpw + '\n';

const b = await driver.launch({ args });
const p = await b.newPage();
let crashed = false;
const errors = [];
const requests = [];
p.on('pageerror', (e) => { errors.push(String(e).slice(0, 300)); process.stderr.write('[pageerror] ' + String(e).slice(0, 300) + '\n'); });
p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
p.on('request', (r) => requests.push(r.url()));
p.on('crash', () => { crashed = true; process.stderr.write('[crash] page crashed (OOM?)\n'); });
await p.addInitScript({ content: libs + '\nwindow.__LIBS__ = ' + JSON.stringify(libs) + ';' });
await p.goto(url, { waitUntil: 'commit' });

let snapshot = null, done = false;
for (let i = 0; i < 900 && !done && !crashed; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const s = await p.evaluate(() => ({ r: window.__R__ || null, done: document.title === 'DONE' }));
    if (s.r) snapshot = s.r;
    done = s.done;
  } catch (e) { crashed = true; }
}
console.log(JSON.stringify({
  browser: which, version: b.version(), done, crashed, errors,
  extraRequests: requests.filter((u) => u !== url),
  results: snapshot,
}, null, 1));
await b.close();
