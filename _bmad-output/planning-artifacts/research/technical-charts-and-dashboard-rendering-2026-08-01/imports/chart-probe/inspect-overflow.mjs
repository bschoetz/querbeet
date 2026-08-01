import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1200 } });
await p.goto(pathToFileURL(resolve(here, 'edge/dist/index.html')).href);
await p.waitForFunction(() => window.__qbChart?.ready, null, { timeout: 60000 });
const out = await p.evaluate(() => {
  const res = {};
  for (const sec of document.querySelectorAll('section')) {
    const id = sec.querySelector('h2').textContent.split(' ')[0];
    const svg = sec.querySelector('svg'); if (!svg) continue;
    const W = svg.viewBox.baseVal.width || svg.clientWidth;
    const bad = [];
    for (const n of svg.querySelectorAll('text')) {
      const bb = n.getBBox();
      if (bb.x < -1 || bb.x + bb.width > W + 1)
        bad.push({ text: n.textContent, x: +bb.x.toFixed(1), w: +bb.width.toFixed(1),
                   anchor: n.getAttribute('text-anchor'), transform: n.getAttribute('transform'),
                   parentTransform: n.parentElement?.getAttribute('transform') });
    }
    // The series bars only: ECharts tags them, so read the series group.
    const rects = [...svg.querySelectorAll('path')].map(n => {
      const bb = n.getBBox();
      return { d: (n.getAttribute('d')||'').slice(0,40), x:+bb.x.toFixed(1), y:+bb.y.toFixed(1), w:+bb.width.toFixed(1), h:+bb.height.toFixed(1), fill: n.getAttribute('fill') };
    });
    res[id] = { W, overflowTexts: bad, paths: rects };
  }
  return res;
});
await b.close();
console.log(JSON.stringify(out, null, 1));
