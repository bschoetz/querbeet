// querbeet R7 — the data every candidate probe is handed.
//
// Three shapes, because the plan gate refused to assume the first one is the
// only one that occurs:
//
//   tileBar   — what a Dashboard tile is *supposed* to get: an aggregate, tens
//               of categories. FR-35's bar tile is grouping column + measured
//               column + aggregation + row limit, so this is its real shape.
//   tileLine  — a daily time series over two years. Still an aggregate, but the
//               point count is a different order of magnitude than the bar.
//   rawLine   — the counter-case the plan gate asked for: a line chart over a
//               time series that was *not* pre-aggregated. If a user groups a
//               half-million-row Result by timestamp, this is what arrives.
//
// Everything is Object.freeze'd, at both levels, because that is how querbeet
// holds data (R2) and a library that sorts its input in place must fail here
// rather than in the product.

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = [
  'Nordrhein-Westfalen', 'Bayern', 'Baden-Württemberg', 'Niedersachsen',
  'Hessen', 'Sachsen', 'Rheinland-Pfalz', 'Berlin', 'Schleswig-Holstein',
  'Brandenburg', 'Sachsen-Anhalt', 'Thüringen', 'Hamburg', 'Mecklenburg-Vorpommern',
  'Saarland', 'Bremen',
];

export function tileBar(n = 12) {
  const rnd = mulberry32(1);
  return Object.freeze(
    CATEGORIES.slice(0, n).map((label) =>
      Object.freeze({ label, value: Math.round(rnd() * 900000) / 100 })
    )
  );
}

export function tileLine(days = 730) {
  const rnd = mulberry32(2);
  const start = Date.UTC(2024, 0, 1);
  let v = 5000;
  const out = new Array(days);
  for (let i = 0; i < days; i++) {
    v += (rnd() - 0.48) * 180;
    out[i] = Object.freeze({ t: start + i * 86400000, value: Math.round(v * 100) / 100 });
  }
  return Object.freeze(out);
}

// Same series, columnar — uPlot and ECharts both prefer arrays of arrays, and
// the shape difference is itself worth measuring rather than hiding.
export function tileLineColumnar(days = 730) {
  const rows = tileLine(days);
  return Object.freeze([
    Object.freeze(rows.map((r) => r.t / 1000)),
    Object.freeze(rows.map((r) => r.value)),
  ]);
}

export function rawLine(n = 100000) {
  const rnd = mulberry32(3);
  const start = Date.UTC(2024, 0, 1) / 1000;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let v = 5000;
  for (let i = 0; i < n; i++) {
    v += (rnd() - 0.5) * 40;
    xs[i] = start + i * 60;
    ys[i] = v;
  }
  return Object.freeze([xs, ys]);
}

export function rawLineObjects(n = 100000) {
  const [xs, ys] = rawLine(n);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = Object.freeze({ x: xs[i] * 1000, y: ys[i] });
  return Object.freeze(out);
}

// The application-supplied tick formatter. R5 owns what German formatting
// actually is; this probe only establishes that a candidate will call a
// function the app hands it, and that the function's output reaches the axis.
// The marker character is what the DOM assertion looks for.
export const MARKER = '‹';
export function appTickFormat(v) {
  return MARKER + new Intl.NumberFormat('de-DE').format(v);
}
export function appDateFormat(ms) {
  return MARKER + new Intl.DateTimeFormat('de-DE').format(new Date(ms));
}
