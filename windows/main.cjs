const { app, BrowserWindow, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PRODUCT_ORIGIN = 'app://knowledge-ball';
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function webRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'web') : path.resolve(__dirname, '..', 'dist');
}

function installProductProtocol() {
  protocol.handle('app', request => {
    const url = new URL(request.url);
    if (url.host !== 'knowledge-ball') return new Response('Not found', { status: 404 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/Knowledge-Ball\/?/, '').replace(/^\/+/, '') || 'index.html';
    const root = webRoot();
    const requested = path.resolve(root, relative);
    if (requested !== root && !requested.startsWith(`${root}${path.sep}`)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(requested).toString());
  });
}

function isExternal(url) {
  try { return !url.startsWith(PRODUCT_ORIGIN) && ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol); }
  catch { return false; }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#02040b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(PRODUCT_ORIGIN)) return;
    event.preventDefault();
    if (isExternal(url)) void shell.openExternal(url);
  });
  void window.loadURL(`${PRODUCT_ORIGIN}/Knowledge-Ball/index.html`);
  return window;
}

app.whenReady().then(() => {
  installProductProtocol();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
