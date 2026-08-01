// querbeet R7 — the candidate probe.
//
// One runner, every candidate. Each candidate lives in its own folder as a real
// Vite app built with vite-plugin-singlefile, and exposes the same small API on
// `window.__qbChart`. The runner never knows which library is inside; it asks
// the same questions of all of them and writes one JSON row per candidate per
// engine.
//
// Order matters. The build gate runs before any browser opens, because R2's
// rule 2 says build success does not imply a working artefact, and R6 showed
// the `file://` failure is invisible during development. Then the artefact is
// opened from a real file:// URL and every network request is counted — the
// gate is "zero beyond the document", not "looks inlined".
//
// Usage: node run-chart-probe.mjs <chromium|firefox> [candidate ...]
//        (no candidate list = every folder with a dist/index.html)

import { chromium, firefox } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const engineName = process.argv[2];
if (!['chromium', 'firefox'].includes(engineName)) {
  console.error('usage: node run-chart-probe.mjs <chromium|firefox> [candidate ...]');
  process.exit(2);
}
const driver = engineName === 'chromium' ? chromium : firefox;

const wanted = process.argv.slice(3);
const candidates = (wanted.length ? wanted : readdirSync(here, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'node_modules')
  .map((d) => d.name))
  .filter((name) => existsSync(join(here, name, 'dist', 'index.html')));

if (!candidates.length) {
  console.error('no built candidates found — run `npx vite build` in each candidate folder first');
  process.exit(2);
}

// ---------------------------------------------------------------- build gate

// Grep hazards. R4 established these are a *question opener*, not an answer:
// the correct worker artefact contains `new Worker` twice by necessity. So the
// count is reported and the verdict is taken from the network trace below.
const HAZARDS = [
  ['dynamic import', /\bimport\s*\(/],
  ['fetch(', /\bfetch\s*\(/],
  ['new Worker', /new\s+Worker\s*\(/],
  ['importScripts', /importScripts\s*\(/],
  ['@font-face', /@font-face/],
  ['XMLHttpRequest', /XMLHttpRequest/],
];

function buildGate(candidate) {
  const distDir = resolve(here, candidate, 'dist');
  const distFile = join(distDir, 'index.html');
  const html = readFileSync(distFile, 'utf8');
  const distFiles = readdirSync(distDir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile()).map((d) => d.name);
  return {
    distFiles,
    singleFile: distFiles.length === 1,
    bytes: statSync(distFile).size,
    hazards: Object.fromEntries(
      HAZARDS.map(([name, re]) => [name, (html.match(new RegExp(re.source, 'g')) || []).length])
    ),
    // A url() that is not a data: URI is a runtime fetch waiting to happen —
    // this is exactly how @maxgraph/core failed R6's gate, with four .gif files.
    nonDataUrls: [...html.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)]
      .map((m) => m[2])
      .filter((u) => !u.startsWith('data:') && !u.startsWith('#')),
  };
}

// ------------------------------------------------------------------ the run

const results = { engine: engineName, date: new Date().toISOString().slice(0, 10), candidates: {} };

const browser = await driver.launch({
  args: engineName === 'chromium' ? ['--enable-precise-memory-info', '--js-flags=--expose-gc'] : [],
});
results.version = browser.version();

for (const candidate of candidates) {
  process.stderr.write(`\n=== ${candidate} (${engineName}) ===\n`);
  const out = { build: buildGate(candidate), errors: [], requests: [] };
  results.candidates[candidate] = out;

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => out.errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('request', (r) => out.requests.push(r.url()));

  const url = pathToFileURL(resolve(here, candidate, 'dist', 'index.html')).href;
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__qbChart && window.__qbChart.ready, null, { timeout: 60000 });

    // Everything beyond the document. The document itself is request 1.
    out.extraRequests = out.requests.filter((u) => u !== url);

    out.mountMs = await page.evaluate(() => window.__qbChart.mountMs);
    out.heapMB = await page.evaluate(() => {
      if (!performance.memory) return null;        // Firefox exposes none — R4's note
      return +(performance.memory.usedJSHeapSize / 1048576).toFixed(1);
    });

    // 1. The app-supplied tick formatter. Not "does the option exist" — does the
    //    string it returns actually reach the rendered axis? Canvas renderers
    //    have no DOM text, so they report their own count instead.
    out.formatter = await page.evaluate(() => window.__qbChart.api.formatterHit());

    // 2. Frozen input. querbeet holds Object.freeze'd data; a library that
    //    sorts in place throws here rather than in the product.
    out.frozen = await page.evaluate(() => window.__qbChart.api.frozenProbe());

    // 3. Resize through the three preset steps FR-35 defines, including the
    //    hidden-container case that is the classic tile-grid bug.
    out.resize = await page.evaluate(() => window.__qbChart.api.resizeSteps());

    // 4. The static snapshot FR-37 needs: what comes out, and is it standalone?
    out.snapshot = await page.evaluate(() => window.__qbChart.api.exportSnapshot());

    // 5. The volume counter-case. Climbs until it hurts, so the failure mode is
    //    observed rather than projected.
    out.volume = await page.evaluate(() => window.__qbChart.api.volumeLadder());

    // 6. Print. The candidate answer for FR-37's PDF half is the browser's own
    //    print-to-PDF over a print stylesheet, and a canvas that comes out blank
    //    would kill it. Chromium only — Playwright's PDF is Chromium-only.
    if (engineName === 'chromium') {
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      out.print = { bytes: pdf.length, wrote: `print-${candidate}.pdf` };
      const { writeFileSync } = await import('node:fs');
      writeFileSync(resolve(here, `print-${candidate}.pdf`), pdf);
    }
  } catch (e) {
    out.fatal = String(e).slice(0, 500);
    process.stderr.write(`  FATAL: ${out.fatal}\n`);
  }
  await page.close();
}

await browser.close();
process.stdout.write(JSON.stringify(results, null, 2) + '\n');
