// Frozen dataset shaped like a querbeet Source: 100,000 rows x 20 columns,
// Object.freeze'd per row and on the array, exactly as R2's architecture rule requires.
export function makeFrozenTable(rows = 100000, cols = 20) {
  const keys = Array.from({ length: cols }, (_, i) => 'c' + i)
  const out = new Array(rows)
  for (let r = 0; r < rows; r++) {
    const o = {}
    for (let c = 0; c < cols; c++) o[keys[c]] = c === 0 ? r : 'v' + r + '_' + c
    out[r] = Object.freeze(o)
  }
  return Object.freeze(out)
}
