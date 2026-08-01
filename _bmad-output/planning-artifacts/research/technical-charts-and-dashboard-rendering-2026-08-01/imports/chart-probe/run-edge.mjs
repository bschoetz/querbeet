// querbeet R7 tripwire runner. Same file:// discipline as the candidate probe.
// Usage: node run-edge.mjs <chromium|firefox>
import { chromium, firefox } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const eng = process.argv[2];
const driver = eng === 'firefox' ? firefox : chromium;
const b = await driver.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1200 } });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 250)); });
await p.goto(pathToFileURL(resolve(here, 'edge/dist/index.html')).href);
await p.waitForFunction(() => window.__qbChart?.ready, null, { timeout: 60000 });
const cases = await p.evaluate(() => window.__qbChart.api.inspect());
await p.screenshot({ path: resolve(here, `edge-${eng}.png`), fullPage: true });
await b.close();
console.log(JSON.stringify({ engine: eng, errors, cases }, null, 2));
