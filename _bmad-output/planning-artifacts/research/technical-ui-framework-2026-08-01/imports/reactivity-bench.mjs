// Original measurement for querbeet R2 (UI framework research), 2026-08-01.
// Question: what does a deep-reactive proxy layer cost over a 100k-row dataset,
// and does Object.freeze() actually keep rows out of the proxy system?
//
// Run one case per process: node --expose-gc reactivity-bench.mjs <build> <case>
//   build: 3.1.1 (Alpine 3.15.12's pinned @vue/reactivity) | latest
//   case:  plain | reactive | frozen | shallow

const [, , buildArg, caseArg] = process.argv;
const file = buildArg === 'latest' ? './vue-reactivity-latest.mjs' : './vue-reactivity-3.1.1.mjs';
const mod = await import(file);
const { reactive, shallowReactive, toRaw, effect } = mod;

const ROWS = 100_000;
const COLS = 20;

function makeRows() {
  const rows = new Array(ROWS);
  for (let i = 0; i < ROWS; i++) {
    const r = {};
    for (let c = 0; c < COLS; c++) {
      r['col' + c] = c % 3 === 0 ? i * c : 'value-' + i + '-' + c;
    }
    rows[i] = r;
  }
  return rows;
}

// Cases ending in "-effect" run the traversal inside a reactive effect. That is the
// realistic case: a render or computed reading the data registers a dependency for
// every key it touches, and those dep sets are where the real memory goes. Without
// an active effect, reads are tracked into nothing.
const inEffect = caseArg.endsWith('-effect');
const baseCase = inEffect ? caseArg.slice(0, -'-effect'.length) : caseArg;

function gc() { global.gc(); global.gc(); }
function heap() { return process.memoryUsage().heapUsed; }

// Build the data first and measure it on its own, so the reported delta is the
// cost the reactivity layer adds — not the cost of the data.
gc();
const before = heap();
let rows = makeRows();
if (baseCase === 'frozen') { for (let i = 0; i < ROWS; i++) Object.freeze(rows[i]); Object.freeze(rows); }
gc();
const afterData = heap();

// Read every property of every row. Vue converts nested objects lazily on
// property get, so this is what actually materialises one proxy per row.
function traverse(target) {
  let sink = 0;
  for (let i = 0; i < ROWS; i++) {
    const r = target[i];
    for (let c = 0; c < COLS; c++) {
      const v = r['col' + c];
      sink += typeof v === 'number' ? v : v.length;
    }
  }
  return sink;
}

let view;
const t0 = process.hrtime.bigint();
if (baseCase === 'plain') view = rows;
else if (baseCase === 'reactive') view = reactive(rows);
else if (baseCase === 'frozen') view = reactive(rows);
else if (baseCase === 'shallow') view = shallowReactive ? shallowReactive(rows) : reactive(rows);
const t1 = process.hrtime.bigint();
let sink = 0;
if (inEffect) effect(() => { sink = traverse(view); });
else sink = traverse(view);
const t2 = process.hrtime.bigint();

gc();
const afterReactive = heap();

// Identity checks: did a proxy get created at all?
const arrayIsProxy = view !== rows;
const rowIsProxy = view[0] !== rows[0];
const rawIdentity = toRaw ? toRaw(view) === rows : null;

console.log(JSON.stringify({
  build: buildArg,
  case: caseArg,
  rows: ROWS,
  cols: COLS,
  data_heap_mb: +((afterData - before) / 1048576).toFixed(1),
  bytes_per_row_plain: +((afterData - before) / ROWS).toFixed(0),
  reactivity_overhead_mb: +((afterReactive - afterData) / 1048576).toFixed(1),
  bytes_per_row_overhead: +((afterReactive - afterData) / ROWS).toFixed(0),
  wrap_ms: +(Number(t1 - t0) / 1e6).toFixed(1),
  traverse_ms: +(Number(t2 - t1) / 1e6).toFixed(1),
  array_is_proxy: arrayIsProxy,
  row_is_proxy: rowIsProxy,
  toRaw_identity_holds: rawIdentity,
  sink_checksum: sink,
}));
