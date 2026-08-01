// querbeet R4/D2 — the runner actually used for the reported measurement.
// Usage: node run-arquero-probe.mjs chromium | firefox   (needs 'npm i playwright arquero')
import { chromium, firefox } from 'playwright';
import { pathToFileURL } from 'node:url'; import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const which = process.argv[2] || 'chromium';
const drivers = { chromium: [chromium, ['--enable-precise-memory-info','--js-flags=--expose-gc']], firefox: [firefox, []] };
const [driver, args] = drivers[which];
const url = pathToFileURL(resolve('arquero-browser-probe.html')).href;
const arquero = readFileSync(resolve('node_modules/arquero/dist/arquero.min.js'),'utf8');
const b = await driver.launch({ args });
const p = await b.newPage();
p.on('console', m => process.stderr.write('[console] '+m.text().slice(0,200)+'\n'));
p.on('pageerror', e => process.stderr.write('[pageerror] '+String(e).slice(0,400)+'\n'));
await p.addInitScript({ content: arquero });
await p.goto(url);
let ok = true;
try { await p.waitForFunction(()=>document.title==='DONE', null, {timeout: 150000}); }
catch(e){ ok=false; process.stderr.write('[TIMEOUT] last output:\n'+(await p.evaluate(()=>document.getElementById('out').textContent)).slice(-1500)+'\n'); }
if (ok) console.log(JSON.stringify({browser:which, version:b.version(), results: await p.evaluate(()=>window.__R__)}, null, 1));
await b.close();
process.exit(ok?0:1);
