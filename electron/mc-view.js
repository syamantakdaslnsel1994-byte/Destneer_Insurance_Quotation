// ManipalCigna BrowserView — shows MC's REAL quick-quote SPA inside the hub
// window (ManipalCigna tab only), instead of the replica iframe. Mirrors
// electron/care-view.js's lifecycle. get-quick-quote/ is a single
// product-picker screen covering all 8 MC products via client-side SPA
// navigation (confirmed live).
//
// Partial DOM auto-fill exists (Adults/Kids counts, per-member Age,
// Gender, Pincode — see mc_fill_script.js) after a live spike found the
// specific sequencing that avoids the reset bug three earlier full-auto-
// fill attempts hit. Gender specifically must be set LAST, after Age and
// Pincode are typed — see mc_fill_script.js's trailing comment for why
// (it silently reverts otherwise, on this page's own React re-renders).
const { app, BrowserView, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { RESULT_OBSERVER_SCRIPT } = require('./mc_result_script');
const {
  buildMcSetupScript,
  buildMcGenderScript,
  buildMcAgeRectScript,
  buildMcPincodeRectScript,
  buildMcVerifyScript,
} = require('./mc_fill_script');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Real, trusted mouse/keyboard events via webContents.sendInputEvent() —
// Chromium's own input pipeline treats these as native input, unlike a
// synthetic event dispatched from injected page-JS, which the real MC page
// was found (live) to silently revert on its own next re-render. Requires
// the window and this webContents to actually hold OS/content focus first,
// or the events go nowhere — confirmed live: omitting focus() was the
// difference between every field ending up empty and every field holding.
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

// Even with real trusted input events and generous pauses, a live re-test
// found individual keystrokes still occasionally get dropped under normal
// timing variance — sometimes the first character, sometimes the last few.
// Rather than chase a fixed delay that can't fully eliminate a race, this
// reads the field back after typing and, if it doesn't match, clears and
// retries — confirmed live this catches and fixes the cases a longer sleep
// alone did not.
async function typeIntoFieldWithRetry(webContents, rect, value, readBackFn, attempts) {
  const target = String(value);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await clickAt(webContents, rect.x, rect.y);
    await sleep(attempt === 1 ? 400 : 250);
    if (attempt > 1) { await selectAllAndClear(webContents); await sleep(150); }
    await typeText(webContents, target);
    await sleep(400);
    const firstCheck = await readBackFn();
    if (String(firstCheck) !== target) continue;
    // A live test found a field that read back CORRECTLY right after typing
    // could still silently drift to a wrong value about half a second later
    // (the real page re-formatting/re-validating asynchronously) — one
    // immediate check wasn't enough to catch that. Re-check after a longer
    // settle before trusting it.
    await sleep(600);
    const secondCheck = await readBackFn();
    if (String(secondCheck) === target) return { ok: true, attempts: attempt };
  }
  return { ok: false, attempts };
}

// Confirmed live: this single URL is a product picker ("Which cover would
// you like to go for?") for all 8 MC products; clicking one is a
// client-side SPA navigation, not a page reload.
const INIT_URL = 'https://online.manipalcigna.com/get-quick-quote/';
const MC_ORIGIN_FILTER = { urls: ['https://online.manipalcigna.com/*'] };

let mcView = null;
let mainWindowRef = null;
let isActive = false;
let lastBounds = null;

// Same file electron/main.js and electron/care-view.js already write to —
// one shared log, not a third file, so a real bug report from a packaged
// install can be diagnosed the same way the Care view's issues were.
const LOG_FILE = path.join(app.getPath('userData'), 'main.log');
function log(line) {
  const stamped = `[${new Date().toISOString()}] [McView] ${line}\n`;
  try { fs.appendFileSync(LOG_FILE, stamped); } catch (e) { /* best effort */ }
  console.log(`[McView] ${line}`);
}

function sendStatus(status) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('mc-status', status);
  }
}

function sendResult(result) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('mc-result', result);
  }
}

// Electron's webContents already tracks navigation history natively
// (canGoBack/canGoForward/goBack/goForward) — this just surfaces that
// existing capability to the hub's Back/Forward buttons, not a new
// history-tracking mechanism.
function sendNavState() {
  if (!mcView || !mainWindowRef || mainWindowRef.isDestroyed()) return;
  mainWindowRef.webContents.send('mc-nav-state', {
    canGoBack: mcView.webContents.canGoBack(),
    canGoForward: mcView.webContents.canGoForward(),
  });
}

// Confirmed live this session: neither the picker page nor the
// lifetime-health form sets x-frame-options/frame-ancestors at all, and
// Care's own BrowserView loaded fine even before this kind of stripping
// turned out to matter for that mechanism. Kept anyway, scoped to this
// dedicated partition only, as cheap insurance against a future Electron
// version — or a future MC deploy — behaving differently.
function stripFramingHeaders(mcSession) {
  mcSession.webRequest.onHeadersReceived(MC_ORIGIN_FILTER, (details, callback) => {
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

function createMcView(mainWindow) {
  log('createMcView() called');
  mainWindowRef = mainWindow;
  const mcSession = session.fromPartition('persist:mc-live');
  stripFramingHeaders(mcSession);

  mcView = new BrowserView({
    webPreferences: {
      session: mcSession,
      preload: path.join(__dirname, 'preload-mc-view.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mcView.webContents.on('did-finish-load', () => {
    log(`did-finish-load url=${mcView.webContents.getURL()}`);
    mcView.webContents.executeJavaScript(RESULT_OBSERVER_SCRIPT).then(r =>
      log(`result-observer armed: ${r}`)).catch(e =>
      log(`result-observer inject failed: ${e.message}`));
    sendStatus('ready');
    sendNavState();
  });

  mcView.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // subframe or aborted — not fatal
    log(`did-fail-load url=${validatedURL} code=${errorCode} desc=${errorDescription}`);
    sendStatus('unreachable');
  });

  // Same residual tripwire as Care's view — a BrowserView has no parent
  // frame at all, so classic frame-busting can't fire against it; this
  // just flags an unexpected navigation away from MC's own domain.
  mcView.webContents.on('did-navigate', (event, url) => {
    if (!url.includes('manipalcigna.com')) {
      log(`unexpected navigation away from ManipalCigna's domain: ${url}`);
      sendStatus('suspect');
    }
    sendNavState();
  });

  // MC's product-picker -> per-product entry form transition is a
  // client-side SPA route change (confirmed live — the URL updates with
  // no network navigation), which fires THIS event, not 'did-navigate' —
  // without listening here too, the Back/Forward buttons would never
  // learn that history actually grew from a picker->form click.
  mcView.webContents.on('did-navigate-in-page', () => {
    log(`did-navigate-in-page url=${mcView.webContents.getURL()}`);
    sendNavState();
  });

  sendStatus('loading');
  mcView.webContents.loadURL(INIT_URL).catch(e => {
    log(`initial loadURL failed: ${e.message}`);
    sendStatus('unreachable');
  });

  registerIpc();
  return mcView;
}

function show() {
  if (!mcView || !mainWindowRef || mainWindowRef.isDestroyed()) {
    log(`show() called but preconditions failed — mcView=${!!mcView} mainWindowRef=${!!mainWindowRef} destroyed=${mainWindowRef && mainWindowRef.isDestroyed()}`);
    return;
  }
  log(`show() — attaching BrowserView, lastBounds=${JSON.stringify(lastBounds)}`);
  mainWindowRef.addBrowserView(mcView);
  isActive = true;
  if (lastBounds) {
    mcView.setBounds(lastBounds);
  } else if (mainWindowRef.webContents) {
    mainWindowRef.webContents.send('mc-request-bounds');
  }
}

function hide() {
  if (!mcView || !mainWindowRef || mainWindowRef.isDestroyed()) return;
  log('hide() — detaching BrowserView');
  isActive = false;
  mainWindowRef.removeBrowserView(mcView);
}

function registerIpc() {
  log('registerIpc() called');
  let firstBoundsLogged = false;
  ipcMain.on('mc-bounds', (_ev, rect) => {
    lastBounds = {
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.round(rect.width), height: Math.round(rect.height),
    };
    if (!firstBoundsLogged) { firstBoundsLogged = true; log(`first mc-bounds received: ${JSON.stringify(lastBounds)}`); }
    if (isActive && mcView) mcView.setBounds(lastBounds);
  });

  ipcMain.on('mc-active', (_ev, active) => {
    log(`mc-active received: ${active}`);
    if (active) show(); else hide();
  });

  ipcMain.on('mc-nav-back', () => {
    if (!mcView) return;
    if (mcView.webContents.canGoBack()) { log('mc-nav-back — going back'); mcView.webContents.goBack(); }
    else log('mc-nav-back received but canGoBack() is false — ignored');
  });
  ipcMain.on('mc-nav-forward', () => {
    if (!mcView) return;
    if (mcView.webContents.canGoForward()) { log('mc-nav-forward — going forward'); mcView.webContents.goForward(); }
    else log('mc-nav-forward received but canGoForward() is false — ignored');
  });
  ipcMain.on('mc-nav-home', () => {
    if (!mcView) return;
    log('mc-nav-home — loading INIT_URL');
    mcView.webContents.loadURL(INIT_URL).catch(e => log(`mc-nav-home loadURL failed: ${e.message}`));
  });

  // Sent by the generic result-detector injected via mc_result_script.js —
  // a JSON string ({keyword, amount, context, pageTitle, url}), not HTML,
  // since (unlike Care) there's no per-product selector to run a shared
  // regex parser against yet.
  ipcMain.on('mc-result-html', (_ev, payload) => {
    let parsed;
    try { parsed = JSON.parse(payload); } catch (e) { log(`mc-result-html JSON parse failed: ${e.message}`); return; }
    log(`mc-result-html received, amount=${parsed.amount} keyword=${parsed.keyword}`);
    sendResult({ ok: true, ...parsed });
  });

  // Tells the hub which MC product the operator has actually navigated to
  // inside the real page (e.g. ".../get-quick-quote/sarvah" -> "sarvah"),
  // for the API-based Fill flow — this happens to be the exact same key
  // server/mc_server.js's own PLAN_CONFIG already uses, so no separate
  // mapping table is needed. Null when still on the product picker (no
  // specific product path segment yet) or when the view doesn't exist.
  ipcMain.handle('mc-get-current-plan-id', () => {
    if (!mcView) return null;
    const url = mcView.webContents.getURL();
    const m = /get-quick-quote\/([a-z0-9-]+)/i.exec(url || '');
    return m ? m[1] : null;
  });

  // Partial auto-fill of the real page's OWN form — Adults/Kids counts,
  // per-member Age, Pincode. See mc_fill_script.js for exactly what this
  // does and does not touch, and why. Confirmed live only against
  // Sarvah's entry form.
  //
  // Age/Pincode typing is driven from here (not injected page-JS) via
  // trusted sendInputEvent mouse+keyboard events — see mc_fill_script.js's
  // header comment for why injected synthetic events don't hold on this
  // page. The window and view need real focus for those events to land.
  ipcMain.handle('mc-autofill', async (_ev, params) => {
    if (!mcView) return { ok: false, errors: [{ field: '(fill)', reason: 'MC view not created yet' }] };
    const errors = [];
    try {
      // A live end-to-end test caught a real race: the very first time the
      // MC tab is activated, the hub calls autoFill() in the same tick as
      // switchRight()/setActive(true) — but the BrowserView's actual on-
      // screen bounds only arrive after an async 'mc-request-bounds' round
      // trip to the renderer (see show()/registerIpc() above). Filling
      // before that lands means the page's own viewport is still 0x0, so
      // every element's getBoundingClientRect() comes back degenerate and
      // every click misses. Wait for real bounds first.
      let boundsGuard = 0;
      while (boundsGuard < 30) {
        const b = mcView.getBounds();
        if (b && b.width > 0 && b.height > 0) break;
        await sleep(100);
        boundsGuard++;
      }
      if (boundsGuard >= 30) {
        log('mc-autofill: gave up waiting for non-zero BrowserView bounds');
        return { ok: false, errors: [{ field: '(fill)', reason: 'MC view never received real screen bounds' }] };
      }

      const setup = await mcView.webContents.executeJavaScript(buildMcSetupScript(params));
      log(`mc-autofill setup: ok=${setup && setup.ok} applied=${setup && (setup.applied || []).join(',')} ageFieldCount=${setup && setup.ageFieldCount}`);
      if (!setup || !setup.ok) {
        return { ok: false, errors: (setup && setup.errors) || [{ field: '(setup)', reason: 'setup script failed' }] };
      }

      // These pauses look generous, but each is load-bearing — confirmed
      // live: 150ms in every one of these spots dropped the first
      // keystroke(s) after focus/click roughly half the time (the field
      // ends up empty or missing its leading character), while these
      // longer values held correctly across repeated live re-runs. Even so,
      // a live re-test found occasional dropped keystrokes persist under
      // normal timing variance regardless of pause length — that's what
      // typeIntoFieldWithRetry's read-back-and-retry is for.
      if (mainWindowRef && !mainWindowRef.isDestroyed()) mainWindowRef.focus();
      mcView.webContents.focus();
      await sleep(600);

      const ages = Array.isArray(params && params.ages) ? params.ages : [];
      const ageFieldCount = setup.ageFieldCount || 0;
      for (let i = 0; i < ageFieldCount && i < ages.length; i++) {
        const rect = await mcView.webContents.executeJavaScript(buildMcAgeRectScript(i));
        if (!rect) { errors.push({ field: `age[${i}]`, reason: 'field not found when about to type' }); continue; }
        const readBack = () => mcView.webContents.executeJavaScript(
          `(Array.from(document.querySelectorAll('input[placeholder="Enter Age"]')).filter(e=>e.offsetParent)[${i}]||{}).value`
        );
        const outcome = await typeIntoFieldWithRetry(mcView.webContents, rect, ages[i], readBack, 3);
        if (!outcome.ok) errors.push({ field: `age[${i}]`, reason: `did not hold after ${outcome.attempts} attempts` });
      }

      if (params && params.pincode) {
        const pinRect = await mcView.webContents.executeJavaScript(buildMcPincodeRectScript());
        if (!pinRect) {
          errors.push({ field: 'pincode', reason: 'field not found' });
        } else {
          const readBack = () => mcView.webContents.executeJavaScript(
            `(document.querySelector('input[placeholder="Enter Pincode"]')||{}).value`
          );
          const outcome = await typeIntoFieldWithRetry(mcView.webContents, pinRect, params.pincode, readBack, 3);
          if (!outcome.ok) errors.push({ field: 'pincode', reason: `did not hold after ${outcome.attempts} attempts` });
        }
      }

      // Gender MUST be set after Age/Pincode, not before — confirmed live it
      // gets silently wiped by the React re-renders those trusted keystrokes
      // trigger if set any earlier (see mc_fill_script.js's trailing
      // comment). This is the last DOM write before reading anything back.
      const genderResult = await mcView.webContents.executeJavaScript(buildMcGenderScript(params && params.genders));
      if (genderResult && genderResult.errors) errors.push(...genderResult.errors);

      // Read back the REAL DOM values rather than trusting that issuing the
      // input events means they held — this is what the earlier version of
      // this handler got wrong.
      const verify = await mcView.webContents.executeJavaScript(buildMcVerifyScript());
      const appliedFields = [];
      (verify.ages || []).forEach((v, i) => {
        if (String(v) === String(ages[i])) appliedFields.push(`age[${i}]`);
        else errors.push({ field: `age[${i}]`, reason: `expected "${ages[i]}", page shows "${v}"` });
      });
      if (params && params.pincode) {
        if (String(verify.pincode) === String(params.pincode)) appliedFields.push('pincode');
        else errors.push({ field: 'pincode', reason: `expected "${params.pincode}", page shows "${verify.pincode}"` });
      }
      const genders = Array.isArray(params && params.genders) ? params.genders : [];
      (verify.genders || []).forEach((v, i) => {
        if (genders[i] == null) return; // no gender was requested for this row — nothing to check
        if (String(v) === String(genders[i])) appliedFields.push(`gender[${i}]`);
        else errors.push({ field: `gender[${i}]`, reason: `expected "${genders[i]}", page shows "${v}"` });
      });
      appliedFields.push(...setup.applied.filter((f) => !f.startsWith('gender[')));

      const result = { ok: errors.length === 0, appliedFields, errors };
      log(`mc-autofill result: ok=${result.ok} applied=${appliedFields.join(',')} errors=${JSON.stringify(errors)}`);
      return result;
    } catch (e) {
      log(`mc-autofill threw: ${e && e.message}`);
      return { ok: false, errors: errors.concat([{ field: '(fill)', reason: String(e && e.message || e) }]) };
    }
  });
}

module.exports = { createMcView, show, hide };
