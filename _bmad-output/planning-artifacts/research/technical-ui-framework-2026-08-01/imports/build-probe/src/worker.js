// Does the plugin inline this, or emit a sibling file that file:// cannot load?
self.onmessage = (e) => { self.postMessage('worker-alive:' + (e.data * 2)) }
