// Preload for the main hub window only. Exposes a minimal, explicit surface
// for the Care Health BrowserView feature — contextIsolation stays on,
// nodeIntegration stays off; the hub page (plain HTML/JS) only ever sees
// window.careView, never raw ipcRenderer/electron internals.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('careView', {
  // Renderer reports where the Care panel's placeholder div currently sits,
  // in window coordinates — main process uses this to position the
  // BrowserView on top of it.
  reportBounds: (rect) => ipcRenderer.send('care-bounds', rect),
  // Renderer reports whether the Care tab is the one currently showing —
  // main process only actually applies bounds while this is true, so a
  // background resize observer firing on another tab can't pop the
  // Care BrowserView back into view.
  setActive: (active) => ipcRenderer.send('care-active', !!active),
  // Main process pushes status changes (loading/ready/unreachable/suspect)
  // so the hub can show/hide its own fallback banner + replica iframe.
  onStatus: (cb) => ipcRenderer.on('care-status', (_ev, status) => cb(status)),
  // Main process pushes a captured quote result (parsed premium/addons)
  // whenever the embedded real page's own Calculate finishes — whether the
  // operator drove it manually or the app auto-filled it.
  onResult: (cb) => ipcRenderer.on('care-result', (_ev, result) => cb(result)),
  // Ask main process to auto-fill the embedded real page from the hub's
  // own set-params payload (same shape the replica iframe already accepts).
  autoFill: (params) => ipcRenderer.invoke('care-autofill', params),
  // Main process asks for a fresh bounds report — it needs one right when
  // activating and doesn't yet have one (setActive/reportBounds are two
  // independent IPC messages, so activation can arrive first).
  onRequestBounds: (cb) => ipcRenderer.on('care-request-bounds', () => cb()),
});

// Same shape as window.careView above, for the ManipalCigna BrowserView
// (electron/mc-view.js).
//
// getCurrentPlanId() asks which product page the operator has navigated
// to, so the hub can drive server/mc_server.js's already-working raw-API
// backend directly (confirmed live: still returns real tiered premiums
// today for 5 of MC's 8 products).
//
// autoFill() IS partial DOM automation — Adults/Kids counts, per-member
// Age, Pincode only (see electron/mc_fill_script.js). Three earlier
// full-form attempts all independently found the real page's member-list
// state resets unpredictably; a live spike found the specific sequencing
// (counts set before any age data exists, each field paced with a real
// pause) that avoids it for this slice. Gender is deliberately left for
// the operator — confirmed live only against Sarvah's entry form.
//
// Plus nav controls (goBack/goForward/goHome) that Care doesn't need —
// Care's real page is single-page (everything happens via in-page AJAX),
// but MC's real flow is genuinely multi-page (a product picker -> a
// per-product entry form -> presumably a results page beyond that), and
// a BrowserView has no browser chrome of its own — confirmed live the
// operator had no way back once they navigated forward.
contextBridge.exposeInMainWorld('mcView', {
  reportBounds: (rect) => ipcRenderer.send('mc-bounds', rect),
  setActive: (active) => ipcRenderer.send('mc-active', !!active),
  onStatus: (cb) => ipcRenderer.on('mc-status', (_ev, status) => cb(status)),
  onResult: (cb) => ipcRenderer.on('mc-result', (_ev, result) => cb(result)),
  onRequestBounds: (cb) => ipcRenderer.on('mc-request-bounds', () => cb()),
  goBack: () => ipcRenderer.send('mc-nav-back'),
  goForward: () => ipcRenderer.send('mc-nav-forward'),
  goHome: () => ipcRenderer.send('mc-nav-home'),
  // Main process pushes canGoBack/canGoForward whenever the real page
  // navigates, so the hub can enable/disable the Back/Forward buttons
  // instead of showing controls that would silently do nothing.
  onNavState: (cb) => ipcRenderer.on('mc-nav-state', (_ev, state) => cb(state)),
  getCurrentPlanId: () => ipcRenderer.invoke('mc-get-current-plan-id'),
  autoFill: (params) => ipcRenderer.invoke('mc-autofill', params),
});

// Same shape as window.careView above, for the Niva Bupa BrowserView
// (electron/niva-view.js). No nav controls (unlike mcView) — Niva's real
// flow, like Care's, is a single SPA route, not genuinely multi-page.
//
// autoFill() is Step-1-only DOM automation (member counts + DOB — see
// electron/niva_fill_script.js). Confirmed live this needed no trusted-
// input machinery (unlike MC's Sarvah page) — Niva's DOB field is a
// click-driven Angular Material calendar, and plain clicks work fine.
contextBridge.exposeInMainWorld('nivaView', {
  reportBounds: (rect) => ipcRenderer.send('niva-bounds', rect),
  setActive: (active) => ipcRenderer.send('niva-active', !!active),
  onStatus: (cb) => ipcRenderer.on('niva-status', (_ev, status) => cb(status)),
  onResult: (cb) => ipcRenderer.on('niva-result', (_ev, result) => cb(result)),
  autoFill: (params) => ipcRenderer.invoke('niva-autofill', params),
  onRequestBounds: (cb) => ipcRenderer.on('niva-request-bounds', () => cb()),
});

// Same shape again, for the Star Health BrowserView (electron/star-view.js).
// autoFill() currently always resolves { ok: false, ... } — Star's real
// portal (atompro.starhealth.in) appears to sit behind a login wall with
// no confirmed guest path, so the actual fill script hasn't been written
// yet (see star-view.js's header comment). onResult never fires yet
// either, for the same reason. Both are wired now so only the IPC
// handler's body needs replacing once that's resolved.
contextBridge.exposeInMainWorld('starView', {
  reportBounds: (rect) => ipcRenderer.send('star-bounds', rect),
  setActive: (active) => ipcRenderer.send('star-active', !!active),
  onStatus: (cb) => ipcRenderer.on('star-status', (_ev, status) => cb(status)),
  onResult: (cb) => ipcRenderer.on('star-result', (_ev, result) => cb(result)),
  autoFill: (params) => ipcRenderer.invoke('star-autofill', params),
  onRequestBounds: (cb) => ipcRenderer.on('star-request-bounds', () => cb()),
});
