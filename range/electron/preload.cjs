// electron/preload.cjs
// The only bridge between the page and the main process. Node and Electron
// APIs are never handed to the page; it gets named calls and nothing else.

const { contextBridge, ipcRenderer } = require('electron');

let env = {};
try {
  env = ipcRenderer.sendSync('env:sync') || {};
} catch {
  env = {};
}

contextBridge.exposeInMainWorld('meridianDesktop', {
  desktop: true,
  version: env.version || '',
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (fn) => {
    const handler = (_event, s) => fn(s);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },
});
