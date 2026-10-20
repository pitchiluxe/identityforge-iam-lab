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

const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, net, protocol, screen, shell } = require('electron');
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
// ---------------------------------------------------------------------------
// Screen Pen: screenshots and recordings
// ---------------------------------------------------------------------------
// capturePage, not desktopCapturer: the page gets a picture of this window and
// nothing else, silently. Photographing the rest of the real desktop goes
// through the recording picker below, which always asks.
ipcMain.handle('capture:screen', async (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return null;
  try {
    const image = await mainWindow.webContents.capturePage();
    return image.isEmpty() ? null : image.toDataURL();
  } catch {
    return null;
  }
});

// Writes the bytes under Documents\Meridian IAM Range\Captures. The page names
// the file, so the name is checked: no folders, no traversal, only .png/.webm.
const MAX_CAPTURE_BYTES = 1024 * 1024 * 1024;
ipcMain.handle('capture:save', async (event, name, bytes) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return null;
  if (typeof name !== 'string' || !/^[\w.-]{1,80}\.(png|webm)$/i.test(name) || name.includes('..')) return null;
  if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) return null;
  const buf = Buffer.from(bytes instanceof ArrayBuffer ? bytes : bytes.buffer);
  if (!buf.length || buf.length > MAX_CAPTURE_BYTES) return null;
  const dir = path.join(app.getPath('documents'), PRODUCT_NAME, 'Captures');
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  if (path.dirname(file) !== dir) return null;
  await fs.promises.writeFile(file, buf);
  return file;
});

/**
 * The main window's session holds only the workstation's own page (Chrome's
 * websites run in webviews with their own partitions), so permissions there,
 * including the camera and microphone for Screen Pen, are granted to that page
 * and to nothing loaded from anywhere else.
 */
function installMediaPermissions(session) {
  const ours = (url) => String(url || '').startsWith(`${SCHEME}://${HOST}/`);
  session.setPermissionRequestHandler((contents, _permission, callback, details) => {
    callback(ours(details && details.requestingUrl ? details.requestingUrl : contents.getURL()));
  });
  session.setPermissionCheckHandler((_contents, _permission, origin) => ours(`${origin}/`));
  // getDisplayMedia is denied in Electron without a handler. The user picks
  // what to record every time; cancelling grants nothing.
  session.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!mainWindow || request.frame !== mainWindow.webContents.mainFrame) return callback({});
      const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      const choices = [`This window (${PRODUCT_NAME})`, ...screens.map((s, i) => (screens.length > 1 ? `Entire screen ${i + 1}` : 'Entire screen')), 'Cancel'];
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question', title: 'Choose what to share', message: 'What should Screen Pen record or capture?',
        detail: 'Recording stops when you press Stop on the Screen Pen toolbar.', buttons: choices, cancelId: choices.length - 1, defaultId: 0, noLink: true,
      });
      if (response === choices.length - 1) return callback({});
      const windowSource = { id: mainWindow.getMediaSourceId(), name: PRODUCT_NAME };
      const video = response === 0 ? windowSource : screens[response - 1];
      // 'loopback' is system audio on Windows, only when the page asked for audio.
      callback(request.audioRequested && process.platform === 'win32' ? { video, audio: 'loopback' } : { video });
    } catch (err) {
      console.error('[capture] display media request failed', err);
      callback({});
    }
  }, { useSystemPicker: false });
}

ipcMain.on('env:sync', (event) => { event.returnValue = { desktop: true, version: app.getVersion(), product: PRODUCT_NAME }; });

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

// Window size and position, remembered between launches like any Windows app.
// The first launch opens at a comfortable size, centred, not maximised.
const BOUNDS_FILE = () => path.join(app.getPath('userData'), 'window.json');

function initialBounds() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const fallback = { width: Math.min(1366, Math.round(area.width * 0.82)), height: Math.min(860, Math.round(area.height * 0.85)) };
  try {
    const saved = JSON.parse(fs.readFileSync(BOUNDS_FILE(), 'utf8'));
    const visible = screen.getAllDisplays().some((d) => saved.x >= d.bounds.x - 50 && saved.y >= d.bounds.y - 50 && saved.x < d.bounds.x + d.bounds.width - 100 && saved.y < d.bounds.y + d.bounds.height - 100);
    if (visible && saved.width >= 1024 && saved.height >= 640) return saved;
  } catch {
    /* first launch or unreadable: use the default */
  }
  return fallback;
}

function saveBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    fs.writeFileSync(BOUNDS_FILE(), JSON.stringify({ ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() }));
  } catch {
    /* not fatal: the next launch uses the default size */
  }
}

function createWindow() {
  const bounds = initialBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    center: bounds.x === undefined,
    minWidth: 1024,
    minHeight: 640,
    title: WINDOW_TITLE,
    backgroundColor: '#0b1a2c',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, webviewTag: true },
  });
  mainWindow.setMenuBarVisibility(false);
  installMediaPermissions(mainWindow.webContents.session);
  mainWindow.once('ready-to-show', () => { if (bounds.maximized) mainWindow.maximize(); mainWindow.show(); });
  mainWindow.on('close', saveBounds);
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
        const checked = await mainWindow.webContents.executeJavaScript('window.meridianDesktop ? window.meridianDesktop.checkForUpdates() : null');
        fs.writeFileSync(path.join(dir, 'smoke.json'), JSON.stringify({ version: app.getVersion(), title, ollamaStatus: probe, updateCheck: checked }, null, 2));
      } finally {
        app.quit();
      }
    }, 4000));
  }
  mainWindow.loadURL(`${SCHEME}://${HOST}/index.html`);
}

// Chrome inside the workstation shows real websites in <webview> tags. Each one
// gets no preload and no Node, may only load http(s), and opens pop-ups in place.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    if (!/^https?:\/\//i.test(params.src || '')) e.preventDefault();
  });
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) contents.loadURL(url);
      return { action: 'deny' };
    });
  }
});

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
