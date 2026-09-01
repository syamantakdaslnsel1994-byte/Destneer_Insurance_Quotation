// Preload attached to the Care BrowserView's own webContents (NOT the main
// hub window — see preload-hub.js for that one). Runs inside Care's real
// page's origin. Exposes exactly one bridge function so a MutationObserver
// injected later (via executeJavaScript, see care_result_script.js) can push
// a captured result back to the main process — executeJavaScript can only
// return a value to its caller, it can't spontaneously push afterward.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__careBridge', {
  reportResult: (html) => ipcRenderer.send('care-result-html', html),
});
