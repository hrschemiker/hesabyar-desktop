'use strict';
const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const D = require('./db');
const core = require('./core');
const rates = require('./rates');
const sync = require('./sync');
const { createServer } = require('./server');

let mainWindow = null;
let serverPort = 0;

function wasmPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'sql-wasm.wasm');
  return require.resolve('sql.js/dist/sql-wasm.wasm');
}
function rendererDir() {
  return path.join(__dirname, '..', 'renderer');
}

function buildMenu() {
  const template = [
    {
      label: 'حساب‌یار',
      submenu: [
        { label: 'بارگذاری مجدد', role: 'reload' },
        { label: 'ابزار توسعه', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'خروج', role: 'quit' }
      ]
    },
    {
      label: 'ویرایش',
      submenu: [
        { label: 'واگرد', role: 'undo' }, { label: 'ازنو', role: 'redo' }, { type: 'separator' },
        { label: 'برش', role: 'cut' }, { label: 'کپی', role: 'copy' }, { label: 'چسباندن', role: 'paste' }, { label: 'انتخاب همه', role: 'selectAll' }
      ]
    },
    {
      label: 'نمایش',
      submenu: [
        { label: 'بزرگ‌نمایی', role: 'zoomIn' }, { label: 'کوچک‌نمایی', role: 'zoomOut' }, { label: 'اندازهٔ عادی', role: 'resetZoom' }, { type: 'separator' }, { label: 'تمام‌صفحه', role: 'togglefullscreen' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function boot() {
  const userData = app.getPath('userData');
  if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
  await D.init(userData, wasmPath());
  core.setUploadDir(path.join(userData, 'uploads'));

  // auto rate update on startup (best-effort, non-blocking)
  const s = core.settings();
  if (s.auto_rate_update) { rates.fetchAndStore().catch(() => {}); }

  const server = createServer(rendererDir());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverPort = server.address().port;

  // Save-As dialog for backup downloads
  session.defaultSession.on('will-download', (event, item) => {
    const name = item.getFilename() || 'download.json';
    const savePath = dialog.showSaveDialogSync(mainWindow, { defaultPath: path.join(app.getPath('downloads'), name) });
    if (savePath) item.setSavePath(savePath); else item.cancel();
  });

  createWindow();

  // Auto full-sync on launch (silent), then refresh the view if data changed.
  sync.autoSync().then((res) => { if (res && res.ok && mainWindow) mainWindow.reload(); }).catch(() => {});
  // Periodically re-sync; effectively "sync whenever internet is available".
  setInterval(() => {
    sync.autoSync().then((res) => {
      if (res && res.ok && mainWindow && !mainWindow.isDestroyed()) {
        const u = mainWindow.webContents.getURL();
        // don't yank the page out from under an active form
        if (!/hpa_edit_|hpa_tab=transactions|hpa_tab=assets|hpa_tab=settings/.test(u)) mainWindow.reload();
      }
    }).catch(() => {});
  }, 10 * 60 * 1000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 600,
    backgroundColor: '#0f172a',
    title: 'حساب‌یار',
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  mainWindow.loadURL('http://127.0.0.1:' + serverPort + '/?hpa_tab=dashboard');
  // open external links in the OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1')) return { action: 'allow' };
    shell.openExternal(url); return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  buildMenu();
  boot().catch((e) => {
    dialog.showErrorBox('خطای راه‌اندازی حساب‌یار', String(e && e.stack ? e.stack : e));
    app.quit();
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { D.save(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { D.save(); });
