import { chromium, firefox } from 'playwright';
import { pathToFileURL } from 'node:url'; import { resolve } from 'node:path';
const url = pathToFileURL(resolve('scrollext.html')).href; const out={};
for (const [n,d] of [['chromium',chromium],['firefox',firefox]]) {
  const b=await d.launch(); const p=await b.newPage(); await p.goto(url);
  await p.waitForFunction(()=>document.title==='DONE',null,{timeout:120000});
  out[n]={version:b.version(), ladder:await p.evaluate(()=>window.__R__)}; await b.close();
}
console.log(JSON.stringify(out,null,1));
