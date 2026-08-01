// The counter-check: Vite's idiomatic worker form, which R2 measured as
// emitting TWO files and throwing synchronously from file://. Built into its
// own artefact so the difference is demonstrated in this run rather than
// carried forward on trust.
const w = new Worker(new URL('./exportWorker.js', import.meta.url), { type: 'module' })
const out = document.getElementById('out')
const R = (window.__R__ = { constructed: true })
w.onmessage = (e) => { R.result = e.data; out.textContent = JSON.stringify(R); document.title = 'DONE' }
w.onerror = (e) => { R.workerError = String(e.message || e); out.textContent = JSON.stringify(R); document.title = 'DONE' }
w.postMessage({ rows: 20000 })
