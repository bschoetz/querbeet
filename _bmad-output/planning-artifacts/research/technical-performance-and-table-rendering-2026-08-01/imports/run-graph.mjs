// querbeet R4 / Checkpoint D2-a runner. Polls window.__R__ so a crash still yields
// everything measured up to that point — the probe deliberately pushes memory.
// Usage: node run-graph.mjs chromium | firefox
import { chromium, firefox } from 'playwright';
import { pathToFileURL } from 'node:url'; import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const which = process.argv[2] || 'chromium';
const drivers = {
  chromium: [chromium, ['--enable-precise-memory-info','--js-flags=--expose-gc --max-old-space-size=8192']],
  firefox: [firefox, []],
};
const [driver, args] = drivers[which];
const url = pathToFileURL(resolve('arquero-graph-probe.html')).href;
const arquero = readFileSync(resolve('node_modules/arquero/dist/arquero.min.js'),'utf8');
const b = await driver.launch({ args });
const p = await b.newPage();
let crashed = false;
p.on('pageerror', e => process.stderr.write('[pageerror] '+String(e).slice(0,300)+'\n'));
p.on('crash', () => { crashed = true; process.stderr.write('[crash] page crashed (OOM?)\n'); });
await p.addInitScript({ content: arquero });
// The probe runs long synchronous blocks, so 'load' may never arrive in time.
await p.goto(url, { waitUntil: 'commit' });

let snapshot = null, done = false;
for (let i = 0; i < 600 && !done && !crashed; i++) {
  await new Promise(r => setTimeout(r, 1000));
  try {
    const s = await p.evaluate(() => ({ r: window.__R__ || null, done: document.title === 'DONE' }));
    if (s.r) snapshot = s.r;
    done = s.done;
  } catch (e) { crashed = true; }
}
console.log(JSON.stringify({ browser: which, version: b.version(), done, crashed, results: snapshot }, null, 1));
await b.close();
