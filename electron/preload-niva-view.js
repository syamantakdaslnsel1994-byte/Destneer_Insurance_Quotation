// Preload attached to the Niva Bupa BrowserView's own webContents (NOT the
// main hub window — see preload-hub.js for that one). Runs inside Niva's
// real page's origin. Exposes exactly one bridge function so a
// MutationObserver injected later (via executeJavaScript, see
// niva_result_script.js) can push a captured result back to the main
// process — executeJavaScript can only return a value to its caller, it
// can't spontaneously push afterward. Same pattern as preload-care-view.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__nivaBridge', {
  reportResult: (payload) => ipcRenderer.send('niva-result-html', payload),
});
