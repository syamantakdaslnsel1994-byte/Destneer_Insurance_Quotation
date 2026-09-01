// Preload attached to the ManipalCigna BrowserView's own webContents (NOT
// the main hub window — see preload-hub.js for that one). Runs inside MC's
// real page's origin. Exposes exactly one bridge function so the generic
// result-detector injected later (via executeJavaScript, see
// mc_result_script.js) can push a captured result back to the main
// process — executeJavaScript can only return a value to its caller, it
// can't spontaneously push afterward. Mirrors preload-care-view.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__mcBridge', {
  reportResult: (payload) => ipcRenderer.send('mc-result-html', payload),
});
