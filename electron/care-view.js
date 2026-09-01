// Care Health BrowserView — shows Care's REAL live calculator page inside
// the hub window (Care tab only), instead of the replica iframe. Mirrors
// how server/combined_server.js is factored out of main.js: this owns the
// whole feature's lifecycle so main.js itself stays thin.
const { app, BrowserView, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { buildFillScript } = require('./care_fill_script');
const { RESULT_OBSERVER_SCRIPT } = require('./care_result_script');
const { parsePremium, parseAddons } = require('../server/care_scrapers');

// Same page confirmed live earlier this session — see server/care_automation.js.
const INIT_URL = 'https://abacus.careinsurance.com/religare/partner/generic-religare-know-popup';
const CARE_ORIGIN_FILTER = { urls: ['https://abacus.careinsurance.com/*'] };

let careView = null;
let mainWindowRef = null;
let isActive = false;
let lastBounds = null;

// Same file electron/main.js's own log() writes to — reusing it (not a
// second log file) is what makes it possible to diagnose this feature at
// all once the app is launched normally (double-clicked, not run from a
// terminal), where console.log has nowhere to go. Confirmed missing this
// was the reason a real bug report from a packaged install couldn't be
// diagnosed: main.log had zero [CareView] lines across every session,
// even ones where the feature must have at least attempted to run.
const LOG_FILE = path.join(app.getPath('userData'), 'main.log');
function log(line) {
  const stamped = `[${new Date().toISOString()}] [CareView] ${line}\n`;
  try { fs.appendFileSync(LOG_FILE, stamped); } catch (e) { /* best effort */ }
  console.log(`[CareView] ${line}`);
}

function sendStatus(status) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('care-status', status);
  }
}

function sendResult(result) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('care-result', result);
  }
}

// Header-stripping — scoped to abacus.careinsurance.com on this DEDICATED
// partition only. Never touches session.defaultSession, so nothing else
// the app loads is affected. Deletes x-frame-options outright; strips only
// the frame-ancestors directive out of the CSP rather than the whole
// header, so the rest of Care's own CSP still applies.
function stripFramingHeaders(careSession) {
  careSession.webRequest.onHeadersReceived(CARE_ORIGIN_FILTER, (details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'x-frame-options') delete headers[key];
      if (key.toLowerCase() === 'content-security-policy') {
        headers[key] = headers[key].map(v =>
          v.split(';').filter(part => !part.trim().toLowerCase().startsWith('frame-ancestors')).join(';'));
      }
    }
    callback({ cancel: false, responseHeaders: headers });
  });
}

function createCareView(mainWindow) {
  log('createCareView() called');
  mainWindowRef = mainWindow;
  const careSession = session.fromPartition('persist:care-live');
  stripFramingHeaders(careSession);

  careView = new BrowserView({
    webPreferences: {
      session: careSession,
      preload: path.join(__dirname, 'preload-care-view.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  careView.webContents.on('did-finish-load', () => {
    log(`did-finish-load url=${careView.webContents.getURL()}`);
    careView.webContents.executeJavaScript(RESULT_OBSERVER_SCRIPT).then(r =>
      log(`result-observer armed: ${r}`)).catch(e =>
      log(`result-observer inject failed: ${e.message}`));
    sendStatus('ready');
  });

  careView.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // subframe or aborted — not fatal, same pattern as main.js
    log(`did-fail-load url=${validatedURL} code=${errorCode} desc=${errorDescription}`);
    sendStatus('unreachable');
  });

  // A residual frame-busting tripwire — see design notes: classic
  // window.top!==window.self busting can't fire against a BrowserView at
  // all (no parent-frame relationship), but an unexpected navigation away
  // from Care's own domain is still worth flagging.
  careView.webContents.on('did-navigate', (event, url) => {
    if (!url.includes('careinsurance.com')) {
      log(`unexpected navigation away from Care's domain: ${url}`);
      sendStatus('suspect');
    }
  });

  sendStatus('loading');
  careView.webContents.loadURL(INIT_URL).catch(e => {
    log(`initial loadURL failed: ${e.message}`);
    sendStatus('unreachable');
  });

  registerIpc();
  return careView;
}

function show() {
  if (!careView || !mainWindowRef || mainWindowRef.isDestroyed()) {
    log(`show() called but preconditions failed — careView=${!!careView} mainWindowRef=${!!mainWindowRef} destroyed=${mainWindowRef && mainWindowRef.isDestroyed()}`);
    return;
  }
  log(`show() — attaching BrowserView, lastBounds=${JSON.stringify(lastBounds)}`);
  mainWindowRef.addBrowserView(careView);
  isActive = true;
  // lastBounds can genuinely still be null here — the renderer's bounds
  // report and its activation call are two separate, independently-ordered
  // IPC messages, so activation can win the race. Rather than silently
  // leaving the view at BrowserView's zero-size default until whatever
  // bounds report eventually arrives, ask the renderer for a fresh one
  // right now so there's no visible gap.
  if (lastBounds) {
    careView.setBounds(lastBounds);
  } else if (mainWindowRef.webContents) {
    mainWindowRef.webContents.send('care-request-bounds');
  }
}

function hide() {
  if (!careView || !mainWindowRef || mainWindowRef.isDestroyed()) return;
  log('hide() — detaching BrowserView');
  isActive = false;
  mainWindowRef.removeBrowserView(careView);
}

function registerIpc() {
  log('registerIpc() called');
  ipcMain.removeHandler?.('care-autofill');
  let firstBoundsLogged = false;
  ipcMain.on('care-bounds', (_ev, rect) => {
    lastBounds = {
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.round(rect.width), height: Math.round(rect.height),
    };
    if (!firstBoundsLogged) { firstBoundsLogged = true; log(`first care-bounds received: ${JSON.stringify(lastBounds)}`); }
    if (isActive && careView) careView.setBounds(lastBounds);
  });

  ipcMain.on('care-active', (_ev, active) => {
    log(`care-active received: ${active}`);
    if (active) show(); else hide();
  });

  ipcMain.handle('care-autofill', async (_ev, params) => {
    if (!careView) return { ok: false, errors: [{ field: '(fill)', reason: 'Care view not created yet' }] };
    const script = buildFillScript(params);
    const result = await careView.webContents.executeJavaScript(script);
    if (result && result.ok) {
      // #partnerAbacus's own live .value, not PartnerPreviewForm[plan_id]'s
      // hidden field — confirmed live the hidden field never updates when
      // the plan changes (stays frozen at whatever the page loaded with),
      // so parsePremium's regex-based planId is unreliable for this. Read
      // it directly off the live DOM in the same executeJavaScript round
      // trip that already grabs outerHTML, rather than a second call.
      const snapshot = await careView.webContents.executeJavaScript(
        `({ html: document.documentElement.outerHTML, livePlanId: (document.querySelector('#partnerAbacus') || {}).value || null })`
      );
      const parsed = parsePremium(snapshot.html, null);
      if (snapshot.livePlanId) parsed.planId = snapshot.livePlanId;
      const addons = parseAddons(snapshot.html);
      const captured = { ...parsed, addons };
      sendResult(captured);
      return { ...result, captured };
    }
    return result;
  });

  ipcMain.on('care-result-html', (_ev, payload) => {
    let html, livePlanId;
    try {
      const obj = JSON.parse(payload);
      html = obj.html; livePlanId = obj.livePlanId;
    } catch (e) {
      html = payload; // tolerate an older/raw-HTML sender, if any
    }
    const parsed = parsePremium(html, null);
    if (livePlanId) parsed.planId = livePlanId;
    const addons = parseAddons(html);
    log(`care-result-html received, parsed.ok=${parsed.ok} discounted=${parsed.discounted} planId=${parsed.planId}`);
    sendResult({ ...parsed, addons });
  });
}

module.exports = { createCareView, show, hide };
