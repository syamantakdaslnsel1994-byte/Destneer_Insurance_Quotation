// Niva Bupa BrowserView — shows Niva's REAL live premium calculator inside
// the hub window (Niva tab only), instead of the replica iframe. Mirrors
// electron/care-view.js's lifecycle exactly, with one addition specific to
// Niva: the real portal (uno.nivabupa.com) is Niva's internal agent/staff
// platform, gated behind a login screen — confirmed live this sometimes
// appears on load and sometimes doesn't (session/cookie-state dependent;
// the dedicated 'persist:niva-live' partition should make it settle to
// "doesn't appear" after the first successful pass, the same way a real
// browser's persisted cookies would for a returning anonymous visitor).
// There's a "GUEST USER" path that reaches the same real calculator without
// needing real agent credentials — confirmed live via the exact click
// sequence in navigatePastLoginGate() below.
const { app, BrowserView, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { buildNivaFillScript } = require('./niva_fill_script');
const { RESULT_OBSERVER_SCRIPT } = require('./niva_result_script');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Confirmed live 27 Aug 2026 — the user identified this directly. Deep-
// linking straight to this hash route does NOT reliably skip the login
// gate (confirmed live, inconsistently — see navigatePastLoginGate), so
// this is a starting point, not a guarantee of reaching the calculator.
const INIT_URL = 'https://uno.nivabupa.com/uno/#/new-premiumcalculator';
const NIVA_ORIGIN_FILTER = { urls: ['https://uno.nivabupa.com/*'] };

let nivaView = null;
let mainWindowRef = null;
let isActive = false;
let lastBounds = null;

const LOG_FILE = path.join(app.getPath('userData'), 'main.log');
function log(line) {
  const stamped = `[${new Date().toISOString()}] [NivaView] ${line}\n`;
  try { fs.appendFileSync(LOG_FILE, stamped); } catch (e) { /* best effort */ }
  console.log(`[NivaView] ${line}`);
}

function sendStatus(status) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('niva-status', status);
  }
}

function sendResult(result) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('niva-result', result);
  }
}

// Same cheap-insurance pattern as Care/MC — confirmed live uno.nivabupa.com
// sends `X-Frame-Options: SAMEORIGIN`, which (like Care/MC's own real
// pages) doesn't actually block a BrowserView at all, only `<iframe>`
// embedding this app doesn't use for the real page. Kept anyway in case a
// future Electron version — or a future Niva deploy — behaves differently.
function stripFramingHeaders(nivaSession) {
  nivaSession.webRequest.onHeadersReceived(NIVA_ORIGIN_FILTER, (details, callback) => {
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

// Confirmed live: a fresh load sometimes lands directly on the calculator
// (Step 1's own "DD/MM/YYYY" DOB field is present) and sometimes lands on
// the agent-login gate ("GUEST USER" button present) instead — the same
// URL, different outcomes, session-state dependent. This detects which one
// actually happened and, if it's the gate, clicks through "Guest User" ->
// "Premium Calculator" to reach the same real calculator either way. Polls
// rather than assuming a fixed settle time, since this app's own load
// timing varies noticeably between runs (confirmed live).
const NAV_GATE_SCRIPT = `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // A live end-to-end test found element-level text matching (querying
  // button/a/div/span for an exact trimmed match) unreliable on this
  // specific app — a check that found "GUEST USER" in document.body.
  // innerText moments earlier came up with zero element matches on a
  // re-query, even restricted to elements merely CONTAINING that text.
  // Whatever this app's own re-render timing is doing, plain substring
  // search against the whole page's rendered text is far more robust than
  // trying to pin down which specific element currently holds it — so
  // that's what detection uses. Only the final click step needs an actual
  // element, and even then picks the smallest (most specific) match
  // rather than assuming a fixed tag.
  const bodyHas = (text) => (document.body.innerText || '').toLowerCase().includes(text.toLowerCase());

  function findClickableWithText(text) {
    const needle = text.toLowerCase();
    const all = Array.from(document.querySelectorAll('button, a, ion-button, [role="button"], div, span'));
    const matches = all.filter((el) => el.offsetParent && (el.textContent || '').toLowerCase().includes(needle));
    if (!matches.length) return null;
    // Smallest text length wins — the most specific element actually
    // wrapping just this label, not a huge ancestor that happens to
    // contain it among lots of other content.
    matches.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    return matches[0];
  }

  async function waitForEither(maxMs) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (document.querySelector('input[placeholder="DD/MM/YYYY"]')) return 'calculator';
      if (bodyHas('GUEST USER')) return 'gate';
      await sleep(300);
    }
    return 'timeout';
  }

  const first = await waitForEither(15000);
  if (first === 'calculator') return { ok: true, path: 'direct' };
  if (first === 'timeout') return { ok: false, reason: 'neither calculator nor login gate appeared within 15s' };

  await sleep(500); // let whatever just rendered the gate settle before querying for the clickable element
  const guestBtn = findClickableWithText('GUEST USER');
  if (!guestBtn) return { ok: false, reason: 'page text has "GUEST USER" but no clickable element wrapping it was found' };
  guestBtn.click();
  await sleep(1500);

  let guard = 0;
  let calcTile = null;
  while (guard < 20 && !calcTile) {
    if (bodyHas('Premium Calculator')) calcTile = findClickableWithText('Premium Calculator');
    if (!calcTile) await sleep(300);
    guard++;
  }
  if (!calcTile) return { ok: false, reason: '"Premium Calculator" tile not found after Guest User click' };
  calcTile.click();
  await sleep(1000);

  const second = await waitForEither(15000);
  if (second === 'calculator') return { ok: true, path: 'guest' };
  return { ok: false, reason: 'calculator still not reached after Guest User -> Premium Calculator (state: ' + second + ')' };
})()`;

async function navigatePastLoginGate() {
  if (!nivaView) return;
  try {
    const result = await nivaView.webContents.executeJavaScript(NAV_GATE_SCRIPT);
    log(`navigatePastLoginGate: ${JSON.stringify(result)}`);
    return result;
  } catch (e) {
    log(`navigatePastLoginGate threw: ${e && e.message}`);
    return { ok: false, reason: String(e && e.message || e) };
  }
}

function createNivaView(mainWindow) {
  log('createNivaView() called');
  mainWindowRef = mainWindow;
  const nivaSession = session.fromPartition('persist:niva-live');
  stripFramingHeaders(nivaSession);

  nivaView = new BrowserView({
    webPreferences: {
      session: nivaSession,
      preload: path.join(__dirname, 'preload-niva-view.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  nivaView.webContents.on('did-finish-load', () => {
    log(`did-finish-load url=${nivaView.webContents.getURL()}`);
    navigatePastLoginGate().then((r) => {
      nivaView.webContents.executeJavaScript(RESULT_OBSERVER_SCRIPT).then((armed) =>
        log(`result-observer armed: ${armed}`)).catch((e) =>
        log(`result-observer inject failed: ${e.message}`));
      sendStatus((r && r.ok) ? 'ready' : 'suspect');
    });
  });

  nivaView.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    log(`did-fail-load url=${validatedURL} code=${errorCode} desc=${errorDescription}`);
    sendStatus('unreachable');
  });

  nivaView.webContents.on('did-navigate', (event, url) => {
    if (!url.includes('nivabupa.com')) {
      log(`unexpected navigation away from Niva's domain: ${url}`);
      sendStatus('suspect');
    }
  });

  sendStatus('loading');
  nivaView.webContents.loadURL(INIT_URL).catch((e) => {
    log(`initial loadURL failed: ${e.message}`);
    sendStatus('unreachable');
  });

  registerIpc();
  return nivaView;
}

function show() {
  if (!nivaView || !mainWindowRef || mainWindowRef.isDestroyed()) {
    log(`show() called but preconditions failed — nivaView=${!!nivaView} mainWindowRef=${!!mainWindowRef} destroyed=${mainWindowRef && mainWindowRef.isDestroyed()}`);
    return;
  }
  log(`show() — attaching BrowserView, lastBounds=${JSON.stringify(lastBounds)}`);
  mainWindowRef.addBrowserView(nivaView);
  isActive = true;
  if (lastBounds) {
    nivaView.setBounds(lastBounds);
  } else if (mainWindowRef.webContents) {
    mainWindowRef.webContents.send('niva-request-bounds');
  }
}

function hide() {
  if (!nivaView || !mainWindowRef || mainWindowRef.isDestroyed()) return;
  log('hide() — detaching BrowserView');
  isActive = false;
  mainWindowRef.removeBrowserView(nivaView);
}

function registerIpc() {
  log('registerIpc() called');
  ipcMain.removeHandler?.('niva-autofill');
  let firstBoundsLogged = false;
  ipcMain.on('niva-bounds', (_ev, rect) => {
    lastBounds = {
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.round(rect.width), height: Math.round(rect.height),
    };
    if (!firstBoundsLogged) { firstBoundsLogged = true; log(`first niva-bounds received: ${JSON.stringify(lastBounds)}`); }
    if (isActive && nivaView) nivaView.setBounds(lastBounds);
  });

  ipcMain.on('niva-active', (_ev, active) => {
    log(`niva-active received: ${active}`);
    if (active) show(); else hide();
  });

  // Step-1-only auto-fill (member counts + DOB) — see niva_fill_script.js
  // for exactly what this does and why it stops there.
  ipcMain.handle('niva-autofill', async (_ev, params) => {
    if (!nivaView) return { ok: false, errors: [{ field: '(fill)', reason: 'Niva view not created yet' }] };
    try {
      // Same race MC's build found live: the first time a tab is activated,
      // autoFill() can be called before the BrowserView's real on-screen
      // bounds arrive (an async round trip — see show()/registerIpc()
      // above), leaving the page's own viewport at 0x0 and every element
      // query degenerate. Wait for real bounds first.
      let boundsGuard = 0;
      while (boundsGuard < 30) {
        const b = nivaView.getBounds();
        if (b && b.width > 0 && b.height > 0) break;
        await sleep(100);
        boundsGuard++;
      }
      if (boundsGuard >= 30) {
        log('niva-autofill: gave up waiting for non-zero BrowserView bounds');
        return { ok: false, errors: [{ field: '(fill)', reason: 'Niva view never received real screen bounds' }] };
      }

      const script = buildNivaFillScript(params);
      const result = await nivaView.webContents.executeJavaScript(script);
      log(`niva-autofill result: ok=${result && result.ok} applied=${result && (result.appliedFields || []).join(',')}`);
      return result;
    } catch (e) {
      log(`niva-autofill executeJavaScript threw: ${e && e.message}`);
      return { ok: false, errors: [{ field: '(fill)', reason: String(e && e.message || e) }] };
    }
  });

  // Fires whenever the operator finishes a quote by hand on the real page
  // — the only way a result is ever captured, since auto-fill stops at
  // Step 1. Payload shape matches mc-view.js's own 'mc-result-html'
  // handler (a JSON string, not raw HTML — see niva_result_script.js).
  ipcMain.on('niva-result-html', (_ev, payload) => {
    let parsed;
    try { parsed = JSON.parse(payload); } catch (e) { log(`niva-result-html JSON parse failed: ${e.message}`); return; }
    log(`niva-result-html received, amount=${parsed.amount} keyword=${parsed.keyword}`);
    sendResult({ ok: true, ...parsed });
  });
}

module.exports = { createNivaView, show, hide };
