// Star Health BrowserView — shows Star's REAL live quotation portal inside
// the hub window (Star tab only), instead of the replica iframe. Mirrors
// electron/mc-view.js's lifecycle most closely among the three existing
// insurers — like MC's Sarvah page, this one's text-input pincode field
// needs genuinely trusted keyboard input, not just Niva/Care's plain
// synthetic clicks.
//
// The real portal is atompro.starhealth.in — already referenced in this
// app's own existing code (server/sh_server.js spoofs it as origin/
// referer on every proxied API call; public/calculators/sh_index.html's
// own "Continue" button already hands off to its /v1/product-customize/
// path), not a guess. That path turned out to sit behind a login wall —
// confirmed live. The user then identified the actual guest entry point
// directly: /v1/quickquote/ redirects to /v1/home/?guest=true and reaches
// the REAL quote form with no login at all — confirmed live: a pincode
// field with working live city lookup ("400001" -> "Mumbai City,
// Maharashtra"), product category/product/policy-plan/policy-type
// selectors, and per-member count + age fields, all reachable and
// interactive as a guest. This is the entry point now used.
const { app, BrowserView, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  buildStarSetupScript,
  buildStarPincodeRectScript,
  buildStarPincodeReadScript,
  buildStarContinueRectScript,
} = require('./star_fill_script');
const { RESULT_OBSERVER_SCRIPT } = require('./star_result_script');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Real, trusted mouse/keyboard events via webContents.sendInputEvent() —
// same technique and same reason as mc-view.js's own clickAt()/typeText():
// confirmed live that a synthetic native-setter-plus-input-event (and even
// a fuller synthetic keydown/keypress/input/keyup sequence) on the pincode
// field never triggered the page's own city-lookup, while these real
// trusted events do.
async function clickAt(webContents, x, y) {
  webContents.sendInputEvent({ type: 'mouseMove', x, y });
  await sleep(30);
  webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await sleep(30);
  webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

async function typeText(webContents, text) {
  for (const ch of String(text)) {
    webContents.sendInputEvent({ type: 'keyDown', keyCode: ch });
    webContents.sendInputEvent({ type: 'char', keyCode: ch });
    webContents.sendInputEvent({ type: 'keyUp', keyCode: ch });
    await sleep(150);
  }
}

async function selectAllAndClear(webContents) {
  webContents.sendInputEvent({ type: 'keyDown', keyCode: 'a', modifiers: ['control'] });
  webContents.sendInputEvent({ type: 'keyUp', keyCode: 'a', modifiers: ['control'] });
  await sleep(80);
  webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
  webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
  await sleep(80);
}

// Same read-back-and-retry discipline as mc-view.js's
// typeIntoFieldWithRetry() — confirmed there that trusted input events can
// still drop a keystroke under normal timing variance, and a longer fixed
// delay alone doesn't fully eliminate it.
async function typeIntoFieldWithRetry(webContents, rect, value, readBackFn, attempts) {
  const target = String(value);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await clickAt(webContents, rect.x, rect.y);
    await sleep(attempt === 1 ? 400 : 250);
    if (attempt > 1) { await selectAllAndClear(webContents); await sleep(150); }
    await typeText(webContents, target);
    await sleep(400);
    const check1 = await readBackFn();
    if (String(check1) !== target) continue;
    await sleep(600);
    const check2 = await readBackFn();
    if (String(check2) === target) return { ok: true, attempts: attempt };
  }
  return { ok: false, attempts };
}

// Confirmed live 31 Aug 2026 — the user identified this directly.
const INIT_URL = 'https://atompro.starhealth.in/v1/quickquote/';
const STAR_ORIGIN_FILTER = { urls: ['https://atompro.starhealth.in/*'] };

let starView = null;
let mainWindowRef = null;
let isActive = false;
let lastBounds = null;

const LOG_FILE = path.join(app.getPath('userData'), 'main.log');
function log(line) {
  const stamped = `[${new Date().toISOString()}] [StarView] ${line}\n`;
  try { fs.appendFileSync(LOG_FILE, stamped); } catch (e) { /* best effort */ }
  console.log(`[StarView] ${line}`);
}

function sendStatus(status) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('star-status', status);
  }
}

function sendResult(result) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('star-result', result);
  }
}

// Same cheap-insurance pattern as Care/MC/Niva — confirmed live
// atompro.starhealth.in sends `X-Frame-Options: Deny` (stricter than the
// other three insurers' SAMEORIGIN), which by the same mechanism already
// confirmed this session should not affect a BrowserView at all (it only
// restricts actual <iframe>/<frame> elements). Kept as insurance in case
// that assumption doesn't hold for this specific site or a future Chromium
// version.
function stripFramingHeaders(starSession) {
  starSession.webRequest.onHeadersReceived(STAR_ORIGIN_FILTER, (details, callback) => {
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

function createStarView(mainWindow) {
  log('createStarView() called');
  mainWindowRef = mainWindow;
  const starSession = session.fromPartition('persist:star-live');
  stripFramingHeaders(starSession);

  starView = new BrowserView({
    webPreferences: {
      session: starSession,
      preload: path.join(__dirname, 'preload-star-view.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  starView.webContents.on('did-finish-load', () => {
    log(`did-finish-load url=${starView.webContents.getURL()}`);
    starView.webContents.executeJavaScript(RESULT_OBSERVER_SCRIPT).then((armed) =>
      log(`result-observer armed: ${armed}`)).catch((e) =>
      log(`result-observer inject failed: ${e.message}`));
    sendStatus('ready');
  });

  starView.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    log(`did-fail-load url=${validatedURL} code=${errorCode} desc=${errorDescription}`);
    sendStatus('unreachable');
  });

  starView.webContents.on('did-navigate', (event, url) => {
    if (!url.includes('starhealth.in')) {
      log(`unexpected navigation away from Star's domain: ${url}`);
      sendStatus('suspect');
    }
  });

  sendStatus('loading');
  starView.webContents.loadURL(INIT_URL).catch((e) => {
    log(`initial loadURL failed: ${e.message}`);
    sendStatus('unreachable');
  });

  registerIpc();
  return starView;
}

function show() {
  if (!starView || !mainWindowRef || mainWindowRef.isDestroyed()) {
    log(`show() called but preconditions failed — starView=${!!starView} mainWindowRef=${!!mainWindowRef} destroyed=${mainWindowRef && mainWindowRef.isDestroyed()}`);
    return;
  }
  log(`show() — attaching BrowserView, lastBounds=${JSON.stringify(lastBounds)}`);
  mainWindowRef.addBrowserView(starView);
  isActive = true;
  if (lastBounds) {
    starView.setBounds(lastBounds);
  } else if (mainWindowRef.webContents) {
    mainWindowRef.webContents.send('star-request-bounds');
  }
}

function hide() {
  if (!starView || !mainWindowRef || mainWindowRef.isDestroyed()) return;
  log('hide() — detaching BrowserView');
  isActive = false;
  mainWindowRef.removeBrowserView(starView);
}

function registerIpc() {
  log('registerIpc() called');
  ipcMain.removeHandler?.('star-autofill');
  let firstBoundsLogged = false;
  ipcMain.on('star-bounds', (_ev, rect) => {
    lastBounds = {
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.round(rect.width), height: Math.round(rect.height),
    };
    if (!firstBoundsLogged) { firstBoundsLogged = true; log(`first star-bounds received: ${JSON.stringify(lastBounds)}`); }
    if (isActive && starView) starView.setBounds(lastBounds);
  });

  ipcMain.on('star-active', (_ev, active) => {
    log(`star-active received: ${active}`);
    if (active) show(); else hide();
  });

  // Fills the real quote form at /v1/quickquote/ — pincode (trusted typed,
  // see clickAt/typeText above), then "Continue" (trusted clicked, same
  // reason: no need to gamble on whether a MUI Button tolerates a
  // synthetic click when a trusted one is just as easy here), then
  // everything Continue reveals (product/plan/members/PED — synthetic
  // dispatch is enough for those, see star_fill_script.js). Deliberately
  // stops before "Get Quote" — same discipline as every insurer this
  // session: auto-fill handles the mechanical data entry, the operator
  // reviews and submits themselves.
  ipcMain.handle('star-autofill', async (_ev, params) => {
    if (!starView) return { ok: false, errors: [{ field: '(fill)', reason: 'Star view not created yet' }] };
    const errors = [];
    try {
      // Same race condition Care/MC/Niva all hit — see their own
      // registerIpc() comments for the full explanation.
      let boundsGuard = 0;
      while (boundsGuard < 30) {
        const b = starView.getBounds();
        if (b && b.width > 0 && b.height > 0) break;
        await sleep(100);
        boundsGuard++;
      }
      if (boundsGuard >= 30) {
        log('star-autofill: gave up waiting for non-zero BrowserView bounds');
        return { ok: false, errors: [{ field: '(fill)', reason: 'Star view never received real screen bounds' }] };
      }

      if (mainWindowRef && !mainWindowRef.isDestroyed()) mainWindowRef.focus();
      starView.webContents.focus();
      await sleep(300);

      const appliedFields = [];
      if (params && params.pincode) {
        const pinRect = await starView.webContents.executeJavaScript(buildStarPincodeRectScript());
        if (!pinRect) {
          errors.push({ field: 'pincode', reason: 'field not found' });
        } else {
          const readBack = () => starView.webContents.executeJavaScript(buildStarPincodeReadScript());
          const outcome = await typeIntoFieldWithRetry(starView.webContents, pinRect, params.pincode, readBack, 3);
          if (outcome.ok) appliedFields.push('pincode');
          else errors.push({ field: 'pincode', reason: `did not hold after ${outcome.attempts} attempts` });
        }
      }

      if (errors.length === 0) {
        // Give the city-lookup a moment to resolve before Continue is
        // clickable — confirmed live this appears within ~2s of a valid
        // pincode.
        await sleep(2200);
        const contRect = await starView.webContents.executeJavaScript(buildStarContinueRectScript());
        if (!contRect) {
          errors.push({ field: '(continue)', reason: 'Continue button not found — pincode may not have resolved to a valid city' });
        } else {
          await clickAt(starView.webContents, contRect.x, contRect.y);
          appliedFields.push('continue');
          await sleep(1500); // let the rest of the form render before targeting it
        }
      }

      if (errors.length === 0) {
        const setup = await starView.webContents.executeJavaScript(buildStarSetupScript(params));
        log(`star-autofill setup: ok=${setup && setup.ok} applied=${setup && (setup.applied || []).join(',')}`);
        if (setup) {
          appliedFields.push(...(setup.applied || []));
          errors.push(...(setup.errors || []));
        } else {
          errors.push({ field: '(setup)', reason: 'setup script returned nothing' });
        }
      }

      const result = { ok: errors.length === 0, appliedFields, errors };
      log(`star-autofill result: ok=${result.ok} applied=${appliedFields.join(',')} errors=${JSON.stringify(errors)}`);
      return result;
    } catch (e) {
      log(`star-autofill threw: ${e && e.message}`);
      return { ok: false, errors: errors.concat([{ field: '(fill)', reason: String(e && e.message || e) }]) };
    }
  });

  // Fires whenever the operator picks one plan (clicks "Proceed" on a
  // recommendations card) and its own detail screen renders — see
  // star_result_script.js. Same flat single-quote shape as Care/MC/Niva.
  ipcMain.on('star-result-html', (_ev, payload) => {
    let parsed;
    try { parsed = JSON.parse(payload); } catch (e) { log(`star-result-html JSON parse failed: ${e.message}`); return; }
    log(`star-result-html received, amount=${parsed.amount} planName=${parsed.planName}`);
    sendResult({ ok: true, ...parsed });
  });
}

module.exports = { createStarView, show, hide };
