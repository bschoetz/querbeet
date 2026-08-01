// querbeet R4/D3 — M8. Can a wasm-derived SharedArrayBuffer cross to a worker
// from a file:// page? Usage: node run-sab.mjs
import { chromium, firefox } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const url = pathToFileURL(resolve('sab-probe.html')).href;
const out = {};
for (const [name, driver] of [['chromium', chromium], ['firefox', firefox]]) {
  const b = await driver.launch();
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await p.goto(url);
  await p.waitForFunction(() => document.title === 'DONE', null, { timeout: 30000 }).catch(() => {});
  out[name] = { version: b.version(), errors, ...(await p.evaluate(() => window.__R__)) };
  await b.close();
}
console.log(JSON.stringify(out, null, 1));
