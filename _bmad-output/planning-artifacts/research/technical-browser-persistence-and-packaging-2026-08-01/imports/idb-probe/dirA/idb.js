// Minimal IndexedDB helpers. No library — this is a gate probe, not an app.
window.DB_NAME = 'querbeet-gate';
window.STORE = 'kv';

window.openDb = function () {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); }
    catch (e) { reject(new Error('indexedDB.open threw synchronously: ' + e)); return; }
    if (!req) { reject(new Error('indexedDB.open returned falsy')); return; }
    const timer = setTimeout(() => reject(new Error('open() never settled within 10s (blocked)')), 10000);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
    req.onerror = () => { clearTimeout(timer); reject(new Error('open onerror: ' + (req.error && req.error.name) + ' ' + (req.error && req.error.message))); };
    req.onblocked = () => { clearTimeout(timer); reject(new Error('open onblocked')); };
  });
};

window.put = function (db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(new Error('put: ' + (tx.error && tx.error.name) + ' ' + (tx.error && tx.error.message)));
    tx.onabort = () => reject(new Error('put aborted: ' + (tx.error && tx.error.name) + ' ' + (tx.error && tx.error.message)));
  });
};

window.get = function (db, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('get: ' + (req.error && req.error.name)));
  });
};

// A querbeet-shaped Source: plain row objects, the structured-clone path.
window.makeRows = function (n, cols) {
  const keys = Array.from({ length: cols }, (_, i) => 'c' + i);
  const out = new Array(n);
  for (let r = 0; r < n; r++) {
    const o = {};
    for (let c = 0; c < cols; c++) o[keys[c]] = c === 0 ? r : 'v' + r + '_' + c;
    out[r] = o;
  }
  return out;
};

window.estimate = async function () {
  if (!navigator.storage || !navigator.storage.estimate) return { unsupported: true };
  try { return await navigator.storage.estimate(); } catch (e) { return { threw: String(e) }; }
};
