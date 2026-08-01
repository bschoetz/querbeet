// querbeet R4/D4 — M6. Editor / table contention at 6 and 30 Steps.
//
// The brief names the mechanism to watch: every Vue Flow node carries a
// ResizeObserver, and those observers fire during the same layout the table's
// window swap needs. So the measurement is not "does the canvas feel slow" but
// the swap's own cost — 4.1 ms with nothing else on the thread (R4/D1) — under
// three conditions: canvas idle, a node being dragged with a real pointer, and
// every node body resizing at once.
//
// Usage: node run-contention.mjs
import { chromium, firefox } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, statSync, readdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, 'editor-table-app/dist');
const distFile = resolve(distDir, 'index.html');

// The build gate first, before any browser opens — R2's rule 2. `new Worker`
// is counted but not treated as fatal here: this build has no worker, and the
// count exists so a false positive can be told apart from a real one.
const HAZARDS = [
  ['dynamic import', /\bimport\s*\(/],
  ['fetch(', /\bfetch\s*\(/],
  ['new Worker', /new\s+Worker\s*\(/],
  ['importScripts', /importScripts\s*\(/],
  ['@font-face', /@font-face/],
  ['XMLHttpRequest', /XMLHttpRequest/],
];
const html = readFileSync(distFile, 'utf8');
const distFiles = readdirSync(distDir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
const build = {
  distFiles,
  singleFile: distFiles.length === 1,
  bytes: statSync(distFile).size,
  hazards: Object.fromEntries(HAZARDS.map(([name, re]) => [name, (html.match(new RegExp(re.source, 'g')) || []).length])),
  nonDataUrls: [...html.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)].map((m) => m[2]).filter((u) => !u.startsWith('data:') && !u.startsWith('#')),
};

const url = pathToFileURL(distFile).href;
const results = { build, engines: {} };

for (const [engine, driver] of [['chromium', chromium], ['firefox', firefox]]) {
  const browser = await driver.launch({
    args: engine === 'chromium' ? ['--enable-precise-memory-info', '--js-flags=--expose-gc'] : [],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('request', (r) => requests.push(r.url()));

  const out = { engine, version: browser.version(), errors, cases: [] };
  results.engines[engine] = out;

  try {
    await page.goto(url + '?steps=6');
    await page.waitForFunction(() => !!window.__qbPerf, null, { timeout: 60000 });

    // A real pointer drag on a real node, run concurrently with the swap loop.
    const dragANode = async () => {
      const box = await page.locator('.vue-flow__node').nth(3).boundingBox();
      if (!box) return null;
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 30; i++) {
        await page.mouse.move(x + i * 6, y + Math.sin(i / 3) * 40);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      return true;
    };

    const swapLoop = (n) => page.evaluate((n) => {
      window.__qbPerf.perf.startLoop(n);
      return window.__qbPerf.perf.waitForLoop();
    }, n);

    const measure = async (label, steps, { drag = false, table = true, grow = 0 } = {}) => {
      const stats = await page.evaluate(async ({ steps, table }) => {
        await window.__qbPerf.setTable(table);
        const s = await window.__qbPerf.buildGraph(steps);
        if (window.gc) window.gc();
        return s;
      }, { steps, table });
      const growMs = await page.evaluate((g) => window.__qbPerf.growAllNodes(g), grow);
      const heights = await page.evaluate(() => window.__qbPerf.nodeHeights());
      const loop = swapLoop(200);
      const dragged = drag ? await dragANode() : null;
      const perf = await loop;
      const rec = {
        label, steps, table, drag: !!dragged, growMs,
        mountMs: stats.mountMs, nodesInDom: stats.nodesInDom, heapMB: stats.heapMB,
        nodeHeightSpread: heights.length ? [Math.min(...heights), Math.max(...heights)] : null,
        ...perf,
      };
      out.cases.push(rec);
      process.stderr.write(`${engine} ${label}: swap p50 ${rec.swapP50} p95 ${rec.swapP95} max ${rec.swapMax} · frame p95 ${rec.frameP95} max ${rec.frameMax} · long ${rec.longFrames}\n`);
      return rec;
    };

    await measure('6 Steps, canvas idle', 6);
    await measure('6 Steps, node dragging', 6, { drag: true });
    await measure('30 Steps, canvas idle', 30);
    await measure('30 Steps, node dragging', 30, { drag: true });
    await measure('30 Steps, all bodies resized', 30, { grow: 6 });
    await measure('30 Steps, no table pane, dragging', 30, { table: false, drag: true });
    await measure('30 Steps, table back, dragging', 30, { drag: true });

    out.extraRequests = requests.filter((u) => u !== url && u !== url + '?steps=6');
  } catch (err) {
    out.fatal = String(err).slice(0, 400);
    process.stderr.write(`[${engine}] FATAL ${err}\n`);
  }
  await browser.close();
}

console.log(JSON.stringify(results, null, 1));
