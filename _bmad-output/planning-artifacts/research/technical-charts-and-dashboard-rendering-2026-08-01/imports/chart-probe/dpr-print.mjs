// Does the canvas raster in a printed PDF track devicePixelRatio? The headless
// default is 1, which would understate a real screen. Same page, two scales.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const out = {};
for (const c of ['uplot', 'chartjs', 'echarts-canvas']) {
  out[c] = {};
  for (const dsf of [1, 2, 3]) {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dsf });
    await p.goto(pathToFileURL(resolve(c, 'dist/index.html')).href);
    await p.waitForFunction(() => window.__qbChart?.ready, null, { timeout: 60000 });
    const pdf = await p.pdf({ format: 'A4', printBackground: true });
    writeFileSync(`dpr${dsf}-${c}.pdf`, pdf);
    out[c][dsf] = pdf.length;
    await b.close();
  }
}
console.log(JSON.stringify(out, null, 2));
