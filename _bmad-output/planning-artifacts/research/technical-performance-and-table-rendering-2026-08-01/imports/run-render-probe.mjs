// Runs render-probe.html from a real file:// URL in Chromium and Firefox, headless.
// Usage: node run-render-probe.mjs
import { chromium, firefox } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const url = pathToFileURL(resolve('render-probe.html')).href;
const out = {};

for (const [name, driver, args] of [
  ['chromium', chromium, ['--enable-precise-memory-info', '--js-flags=--expose-gc']],
  ['firefox', firefox, []],
]) {
  const browser = await driver.launch({ args });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  try {
    await page.waitForFunction(() => document.title === 'DONE', null, { timeout: 300000 });
  } catch (e) {
    errors.push('TIMEOUT waiting for probe to finish');
  }
  out[name] = {
    version: browser.version(),
    errors,
    results: await page.evaluate(() => window.__RESULTS__ || null),
    text: await page.evaluate(() => document.getElementById('out').textContent),
  };
  await browser.close();
}

console.log(JSON.stringify(out, null, 1));
