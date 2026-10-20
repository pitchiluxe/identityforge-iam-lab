// electron/main.cjs
// Main process for Meridian IAM Range, the installed desktop edition.
//
// What it owns:
//   - serving the production build from a private app:// scheme, so storage
//     has a stable origin across updates and relative URLs work as in dev
//   - proxying /ollama/* to the local Ollama from here, where no browser
//     Origin header is sent (Ollama refuses file:// and unknown origins)
//   - one running copy at a time, because two would fight over the same saved
//     world and settings
//   - opening real web links in the user's own browser
//   - auto-update from GitHub Releases through electron-updater
//
// The renderer stays sandboxed with no Node access. Everything it needs
// crosses preload.cjs as a named channel.

const { app, BrowserWindow, ipcMain, net, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Kept in step with src/product.ts by tests/branding.test.ts.
const PRODUCT_NAME = 'Meridian IAM Range';
const WINDOW_TITLE = 'Meridian IAM Range: Healthcare Identity Operations Workstation';

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  autoUpdater = null; // dev launch without the dependency: no updates, nothing else changes
}

const DIST = path.join(__dirname, '..', 'dist');
const OLLAMA = 'http://127.0.0.1:11434';
const SCHEME = 'app';
const HOST = 'range';
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;

// ---------------------------------------------------------------------------
// Serving the app and the Ollama proxy
// ---------------------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

async function handle(request) {
  const url = new URL(request.url);
  if (url.host !== HOST) return new Response('Not found', { status: 404 });

  if (url.pathname.startsWith('/ollama/')) {
    const target = OLLAMA + url.pathname.slice('/ollama'.length) + url.search;
    const post = request.method === 'POST';
    try {
      return await net.fetch(target, {
        method: post ? 'POST' : 'GET',
        headers: post ? { 'Content-Type': 'application/json' } : undefined,
        body: post ? await request.arrayBuffer() : undefined,
      });
    } catch (err) {
      return new Response(String(err && err.message ? err.message : err), { status: 502 });
    }
  }

  // Resolve inside dist only. A path that escapes it is refused, not served.
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(DIST, rel);
  if (!file.startsWith(path.resolve(DIST) + path.sep)) return new Response('Forbidden', { status: 403 });
  const exists = fs.existsSync(file) && fs.statSync(file).isFile();
  const served = exists ? file : path.join(DIST, 'index.html');
  const res = await net.fetch(pathToFileURL(served).toString());
  const type = TYPES[path.extname(served).toLowerCase()];
  return new Response(res.body, { status: 200, headers: type ? { 'Content-Type': type } : {} });
}

// ---------------------------------------------------------------------------
// Auto-update
// ---------------------------------------------------------------------------

/** 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' */
let updateState = autoUpdater ? 'idle' : 'unsupported';
let updateInfo = null;
let updateError = null;
let lastCheck = null;

function status() {
  return { state: updateState, info: updateInfo, error: updateError, lastCheck, version: app.getVersion() };
}

function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', status());
}

function setupUpdater() {
  if (!autoUpdater || !app.isPackaged) {
    updateState = 'unsupported';
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => { updateState = 'checking'; updateError = null; broadcast(); });
  autoUpdater.on('update-available', (info) => { updateState = 'available'; updateInfo = { version: info.version }; broadcast(); });
  autoUpdater.on('update-not-available', () => { updateState = 'idle'; updateInfo = null; lastCheck = new Date().toISOString(); broadcast(); });
  autoUpdater.on('download-progress', (p) => { updateState = 'downloading'; updateInfo = { ...(updateInfo || {}), progress: Math.round(p.percent) }; broadcast(); });
  autoUpdater.on('update-downloaded', (info) => { updateState = 'downloaded'; updateInfo = { version: info.version }; lastCheck = new Date().toISOString(); broadcast(); });
  // A failed check is a failure, never "you're up to date".
  autoUpdater.on('error', (err) => { updateState = 'error'; updateError = String((err && err.message) || err || 'Unknown updater error'); broadcast(); });
  const check = () => autoUpdater.checkForUpdates().catch((err) => { updateState = 'error'; updateError = String(err && err.message ? err.message : err); broadcast(); });
  setTimeout(check, 8000);
  setInterval(check, UPDATE_INTERVAL_MS);
}

ipcMain.handle('update:status', () => status());
ipcMain.handle('update:check', async () => {
  if (updateState === 'unsupported') return status();
  try { await autoUpdater.checkForUpdates(); } catch (err) { updateState = 'error'; updateError = String(err && err.message ? err.message : err); }
  return status();
});
ipcMain.handle('update:install', () => {
  if (updateState !== 'downloaded') return false;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
});
ipcMain.on('env:sync', (event) => { event.returnValue = { desktop: true, version: app.getVersion(), product: PRODUCT_NAME }; });

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: WINDOW_TITLE,
    backgroundColor: '#0b1a2c',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => { mainWindow.maximize(); mainWindow.show(); });
  mainWindow.on('page-title-updated', (e) => { e.preventDefault(); mainWindow.setTitle(WINDOW_TITLE); });

  // Real web links (Microsoft Learn, the real portals) open in the user's own browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}/`)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('did-finish-load', broadcast);
  // Release smoke test: MERIDIAN_SMOKE=<folder> captures the window and the
  // Ollama proxy's answer, writes them there, and exits.
  if (process.env.MERIDIAN_SMOKE) {
    mainWindow.webContents.once('did-finish-load', () => setTimeout(async () => {
      const dir = process.env.MERIDIAN_SMOKE;
      try {
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(dir, 'smoke.png'), image.toPNG());
        const probe = await mainWindow.webContents.executeJavaScript("fetch('/ollama/api/tags').then(r => r.status).catch(e => String(e))");
        const title = await mainWindow.webContents.executeJavaScript('document.title');
        fs.writeFileSync(path.join(dir, 'smoke.json'), JSON.stringify({ version: app.getVersion(), title, ollamaStatus: probe, update: status() }, null, 2));
      } finally {
        app.quit();
      }
    }, 4000));
  }
  mainWindow.loadURL(`${SCHEME}://${HOST}/index.html`);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  app.setAppUserModelId('com.mydigitalsolutions.meridianiamrange');
  protocol.handle(SCHEME, handle);
  createWindow();
  setupUpdater();
});

app.on('window-all-closed', () => app.quit());
