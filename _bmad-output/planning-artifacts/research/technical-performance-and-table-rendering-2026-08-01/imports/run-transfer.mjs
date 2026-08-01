// querbeet R4/D3 — transfer-cost runner. Polls window.__R__ so a 500k OOM
// still yields everything measured up to that point.
// Usage: node run-transfer.mjs chromium | firefox
import { chromium, firefox } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const which = process.argv[2] || 'chromium';
const drivers = {
  chromium: [chromium, ['--enable-precise-memory-info', '--js-flags=--expose-gc --max-old-space-size=8192']],
  firefox: [firefox, []],
};
const [driver, args] = drivers[which];
const url = pathToFileURL(resolve('transfer-probe.html')).href;

const b = await driver.launch({ args });
const p = await b.newPage();
let crashed = false;
const errors = [];
p.on('pageerror', (e) => { errors.push(String(e).slice(0, 300)); process.stderr.write('[pageerror] ' + String(e).slice(0, 300) + '\n'); });
p.on('crash', () => { crashed = true; process.stderr.write('[crash] page crashed (OOM?)\n'); });
// The probe runs long synchronous blocks; 'load' may not arrive in time.
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
console.log(JSON.stringify({ browser: which, version: b.version(), done, crashed, errors, results: snapshot }, null, 1));
await b.close();
