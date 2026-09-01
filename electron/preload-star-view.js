// Preload attached to the Star Health BrowserView's own webContents (NOT
// the main hub window — see preload-hub.js for that one). Runs inside
// Star's real page's origin. Mirrors preload-niva-view.js's shape exactly
// — exposes one bridge function for a future result-observer script
// (star_result_script.js, not built yet — see electron/star-view.js's
// header comment) to push a captured result back to the main process.
// Structurally ready, unused until that script exists.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__starBridge', {
  reportResult: (payload) => ipcRenderer.send('star-result-html', payload),
});
