// Rule 1 from R2, exercised: `?worker&inline`, never `new Worker(new URL(...))`.
// The idiomatic Vite form builds successfully and emits two files, and from
// file:// the constructor throws synchronously. This form must emit one.
import ExportWorker from './exportWorker.js?worker&inline'

const out = document.getElementById('out')
const R = (window.__R__ = { constructed: false })

try {
  const w = new ExportWorker()
  R.constructed = true
  w.onmessage = (e) => {
    R.result = e.data
    out.textContent = JSON.stringify(R, null, 1)
    document.title = 'DONE'
  }
  w.onerror = (e) => {
    R.workerError = String(e.message || e)
    out.textContent = JSON.stringify(R, null, 1)
    document.title = 'DONE'
  }
  w.postMessage({ rows: 20000 })
} catch (err) {
  R.constructError = String(err)
  out.textContent = JSON.stringify(R, null, 1)
  document.title = 'DONE'
}
