// querbeet R7 — the parts of the probe that must be identical across candidates.
//
// Every candidate answers the same six questions, so the *asking* lives here and
// only the library-specific answering lives in each App.vue. Where a question
// cannot be asked the same way of a canvas renderer and an SVG renderer — the
// formatter one — both forms are collected rather than picking one and calling
// the other unanswerable.

import { MARKER } from './shared-data.js';

export const SIZE_STEPS = [
  { name: 'S', w: 380, h: 200 },
  { name: 'M', w: 620, h: 300 },
  { name: 'L', w: 1100, h: 460 },
];

// A cheap fingerprint of the input. Taken before and after every render, so a
// library that sorts or rewrites the caller's array is caught even when the
// array is not frozen at the level the write happens on.
export function checksum(data) {
  let h = 2166136261;
  const feed = (x) => {
    const s = String(x);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  };
  const walk = (v) => {
    if (Array.isArray(v) || ArrayBuffer.isView(v)) { feed('['); for (let i = 0; i < v.length; i++) walk(v[i]); feed(']'); }
    else if (v && typeof v === 'object') { for (const k of Object.keys(v)) { feed(k); walk(v[k]); } }
    else feed(v);
  };
  walk(data);
  return h >>> 0;
}

// The app-supplied formatter, wrapped so the probe can prove it was called even
// when the output lands on a canvas where no DOM assertion is possible.
export function countingFormatter(fn) {
  const wrapped = (...args) => { wrapped.calls++; return fn(...args); };
  wrapped.calls = 0;
  return wrapped;
}

// What FR-37 actually needs out of a chart: something that can be written into a
// static HTML file and still look right with no network. So the question is not
// only "is it SVG" but "does the serialized form still reference anything".
export function inspectSvg(node) {
  const xml = new XMLSerializer().serializeToString(node);
  const urls = [...xml.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)]
    .map((m) => m[2]).filter((u) => !u.startsWith('data:') && !u.startsWith('#'));
  return {
    kind: 'svg',
    bytes: new Blob([xml]).size,
    externalRefs: urls,
    // Observable Plot is documented as applying a *default stylesheet* via a
    // class name. If that stylesheet lives in the document rather than inside
    // the SVG, a serialized snapshot arrives unstyled — the difference between
    // a working and a broken static export.
    hasStyleChild: /<style[\s>]/.test(xml),
    hasClassRefs: /class="/.test(xml),
    markerCount: (xml.match(new RegExp(MARKER, 'g')) || []).length,
    sample: xml.slice(0, 220),
  };
}

export function inspectDataUrl(url) {
  const comma = url.indexOf(',');
  const meta = url.slice(0, comma);
  return {
    kind: 'raster',
    mime: meta,
    bytes: Math.round((url.length - comma - 1) * 3 / 4),
    externalRefs: [],
    hasStyleChild: false,
    markerCount: null,     // nothing to read: the text is pixels
    sample: meta,
  };
}

export function countMarkerInDom(root) {
  let n = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (walker.currentNode.nodeValue.includes(MARKER)) n++;
  return n;
}

export async function frame() {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

export function ms(fn) {
  const t = performance.now();
  const r = fn();
  return { ms: +(performance.now() - t).toFixed(1), value: r };
}

export async function msAsync(fn) {
  const t = performance.now();
  const r = await fn();
  await frame();
  return { ms: +(performance.now() - t).toFixed(1), value: r };
}

export function registerProbe(api) {
  window.__qbChart = {
    ready: true,
    mountMs: +(performance.now() - (window.__qbMountStart ?? 0)).toFixed(1),
    api,
  };
}
