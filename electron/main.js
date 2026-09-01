const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Matches the override pattern every server/*.js already supports
// (combined_server.js itself defaults to 3000 the same way) — lets a
// second, isolated instance run for testing without colliding with an
// already-running one on the default port.
const PORT = Number(process.env.PORT) || 3000;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const LOG_FILE = path.join(app.getPath('userData'), 'main.log');
function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  try { fs.appendFileSync(LOG_FILE, stamped); } catch (e) { /* best effort */ }
  console.log(line);
}

process.on('uncaughtException', err => {
  log(`uncaughtException: ${err && err.stack || err}`);
  showFatalError(String(err && err.stack || err));
});
process.on('unhandledRejection', err => {
  log(`unhandledRejection: ${err && err.stack || err}`);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(start);
}

function start() {
  log(`Starting. origin=${ORIGIN} logFile=${LOG_FILE}`);

  process.env.PORT = String(PORT);
  process.env.PUBLIC_ORIGIN_CARE = ORIGIN;
  process.env.PUBLIC_ORIGIN_NIVA = `${ORIGIN}/niva`;
  process.env.PUBLIC_ORIGIN_MC   = `${ORIGIN}/mc`;
  process.env.PUBLIC_ORIGIN_STAR = `${ORIGIN}/star`;

  try {
    require('../server/combined_server.js');
    log('combined_server.js required successfully.');
  } catch (err) {
    log(`combined_server.js require failed: ${err && err.stack || err}`);
    showFatalError(String(err && err.stack || err));
    return;
  }

  waitForServer(() => createWindow(), 0);
}

function waitForServer(onReady, attempt) {
  if (attempt > 50) {
    log('Readiness poll gave up after 50 attempts (5s). Server never answered.');
    showFatalError(
      `The app server never became reachable on ${ORIGIN} after 5 seconds.\n\n` +
      `This usually means port ${PORT} is already used by another program on this computer. ` +
      `Close that program (or restart this computer) and try again.`
    );
    return;
  }
  const req = http.get(`${ORIGIN}/login`, res => { res.resume(); log(`Readiness poll ok (attempt ${attempt}).`); onReady(); });
  req.on('error', err => {
    if (attempt === 0 || attempt % 10 === 0) log(`Readiness poll attempt ${attempt} failed: ${err.code || err.message}`);
    setTimeout(() => waitForServer(onReady, attempt + 1), 100);
  });
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Insurance Premium Hub',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-hub.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const careView = require('./care-view');
  try {
    careView.createCareView(mainWindow);
  } catch (err) {
    log(`care-view createCareView failed: ${err && err.stack || err}`);
  }

  const mcView = require('./mc-view');
  try {
    mcView.createMcView(mainWindow);
  } catch (err) {
    log(`mc-view createMcView failed: ${err && err.stack || err}`);
  }

  const nivaView = require('./niva-view');
  try {
    nivaView.createNivaView(mainWindow);
  } catch (err) {
    log(`niva-view createNivaView failed: ${err && err.stack || err}`);
  }

  const starView = require('./star-view');
  try {
    starView.createStarView(mainWindow);
  } catch (err) {
    log(`star-view createStarView failed: ${err && err.stack || err}`);
  }

  // All four BrowserViews are window-level overlays, independent of
  // whatever URL mainWindow's own webContents is currently showing —
  // neither auto-hides just because the underlying page navigated
  // elsewhere. insurance_hub.html's own script is what calls
  // setActive(true) for whichever one is the active tab, and that can fire
  // and attach a view *before* an async client-side auth check (elsewhere
  // on that same page) discovers the session is invalid and redirects to
  // /login — leaving the real page visibly stuck on top of the login
  // screen. Whenever the main window ends up anywhere that isn't /hub,
  // force all four hidden here regardless of what the page's own JS did
  // or didn't do.
  mainWindow.webContents.on('did-navigate', (event, url) => {
    if (!url.includes('/hub')) {
      log(`main window navigated to ${url} — forcing embedded BrowserViews hidden`);
      careView.hide();
      mcView.hide();
      nivaView.hide();
      starView.hide();
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // Sub-frame failures (the hub embeds each calculator in an iframe) are
    // not fatal — only a failed load of the top-level /hub page is. -3 is
    // ERR_ABORTED, which fires on ordinary redirects/cancelled navigations
    // and never means "server unreachable", so it's ignored even for the
    // main frame.
    if (!isMainFrame || errorCode === -3) {
      log(`did-fail-load (ignored, subframe or aborted) url=${validatedURL} code=${errorCode} desc=${errorDescription}`);
      return;
    }
    log(`did-fail-load url=${validatedURL} code=${errorCode} desc=${errorDescription}`);
    showFatalError(
      `The app window could not reach ${validatedURL}.\n\n` +
      `Browser error: ${errorDescription} (${errorCode})`
    );
  });

  mainWindow.loadURL(`${ORIGIN}/hub`);
}

function showFatalError(message) {
  const html = `data:text/html,${encodeURIComponent(`
    <html><body style="font-family:sans-serif;padding:40px;background:#0f172a;color:#e2e8f0">
    <h2>Insurance Premium Hub couldn't start</h2>
    <pre style="white-space:pre-wrap;background:#1e293b;padding:16px;border-radius:8px">${escapeHtml(message)}</pre>
    <p style="color:#94a3b8;font-size:13px">Details were also written to:<br>${escapeHtml(LOG_FILE)}</p>
    </body></html>
  `)}`;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(html);
    return;
  }

  const win = new BrowserWindow({ width: 900, height: 600, title: 'Insurance Premium Hub — Error', autoHideMenuBar: true });
  win.loadURL(html);
  mainWindow = win;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

app.on('window-all-closed', () => app.quit());
