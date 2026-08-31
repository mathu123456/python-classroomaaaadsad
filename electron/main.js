'use strict';
/*
 * Python Classroom - proceso principal de Electron.
 *
 * Responsabilidades: crear la ventana, registrar los canales IPC y apagar
 * ordenadamente los procesos hijos (Python, terminal, pip) al cerrar.
 */

const path = require('path');
const { app, BrowserWindow, Menu, ipcMain, shell, session } = require('electron');

const store = require('./store');
const sqlite = require('./sqlite');
const runtime = require('./runtime');
const filesIpc = require('./ipc/files');
const dataIpc = require('./ipc/data');
const pythonIpc = require('./ipc/python');
const terminalIpc = require('./ipc/terminal');
const packagesIpc = require('./ipc/packages');
const systemIpc = require('./ipc/system');
const exchangeIpc = require('./ipc/exchange');

/*
 * Modo desarrollo. Instalada (empaquetada) NUNCA lo es, aunque se lance con
 * --dev: ese modo expone window.__pc y las herramientas de desarrollo, y con
 * ellas un estudiante podria llamar a los canales internos a mano.
 */
const isDev = !app.isPackaged && (process.argv.includes('--dev') || !app.isPackaged);
const permitirPruebas = !app.isPackaged && !!process.env.PC_E2E;

// Arranque en frio: se mide desde que carga el proceso principal hasta que la
// ventana esta lista para mostrarse (fase 6, seccion 7).
const T_ARRANQUE = Date.now();
let listoEnMs = null;

let mainWindow = null;
let modules = {};

app.setName('Python Classroom');
// Un solo perfil de datos, separado de la instalacion.
app.setAppUserModelId('co.pythonclassroom.app');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function ctxSend(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

const ctx = {
  getWindow: () => mainWindow,
  send: ctxSend,
  /** Datos del arranque en frio, para la pantalla de informacion (fase 6). */
  startupInfo: () => ({
    listoEnMs: listoEnMs,
    desdeInicioMs: Date.now() - T_ARRANQUE,
    empaquetada: app.isPackaged
  }),
  /*
   * Al iniciar o cerrar sesion cambia todo el contexto local: preferencias,
   * carpeta de proyectos y rutas de archivo permitidas.
   */
  onUserChange: (usuario) => {
    try { if (modules.python) modules.python.stopAll(); } catch (err) { /* nada en marcha */ }
    try { if (modules.terminal) modules.terminal.disposeAll(); } catch (err) { /* nada en marcha */ }
    try { if (modules.files) modules.files.stopWatch(); } catch (err) { /* nada en marcha */ }
    try { filesIpc.resetRoots(); } catch (err) { console.error('[main] rutas:', err.message); }
    const settings = store.getSettings();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(settings.theme === 'light' ? '#f6f7f9' : '#12151c');
    }
    console.log('[main] usuario activo:', usuario ? usuario.correo + ' (' + usuario.rol + ')' : 'ninguno');
  }
};

function buildMenu() {
  // La ventana no tiene marco: este menu existe solo para registrar los
  // aceleradores nativos de edicion (copiar, pegar, deshacer...).
  const template = [
    {
      label: 'Archivo',
      submenu: [
        { label: 'Nuevo archivo', accelerator: 'CmdOrCtrl+N', click: () => ctxSend('menu', 'file:new') },
        { label: 'Abrir archivo...', accelerator: 'CmdOrCtrl+O', click: () => ctxSend('menu', 'file:open') },
        { label: 'Abrir carpeta...', accelerator: 'CmdOrCtrl+K', click: () => ctxSend('menu', 'folder:open') },
        { type: 'separator' },
        { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: () => ctxSend('menu', 'file:save') },
        { label: 'Guardar como...', accelerator: 'CmdOrCtrl+Shift+S', click: () => ctxSend('menu', 'file:saveAs') },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' }
      ]
    },
    {
      // Deshacer/rehacer/seleccionar-todo los gestiona CodeMirror: si usaramos
      // los roles nativos, Chromium intentaria deshacer por su cuenta y
      // romperia el historial del editor.
      label: 'Editar',
      submenu: [
        { label: 'Deshacer', accelerator: 'CmdOrCtrl+Z', click: () => ctxSend('menu', 'edit:undo') },
        { label: 'Rehacer', accelerator: 'CmdOrCtrl+Y', click: () => ctxSend('menu', 'edit:redo') },
        { label: 'Rehacer', accelerator: 'CmdOrCtrl+Shift+Z', visible: false, click: () => ctxSend('menu', 'edit:redo') },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { label: 'Seleccionar todo', accelerator: 'CmdOrCtrl+A', click: () => ctxSend('menu', 'edit:selectAll') },
        { type: 'separator' },
        { label: 'Buscar', accelerator: 'CmdOrCtrl+F', click: () => ctxSend('menu', 'edit:find') },
        { label: 'Reemplazar', accelerator: 'CmdOrCtrl+H', click: () => ctxSend('menu', 'edit:find') },
        { label: 'Comentar', accelerator: 'CmdOrCtrl+/', click: () => ctxSend('menu', 'edit:comment') }
      ]
    },
    {
      label: 'Ejecutar',
      submenu: [
        { label: 'Ejecutar archivo', accelerator: 'CmdOrCtrl+Return', click: () => ctxSend('menu', 'run:start') },
        { label: 'Detener', accelerator: 'CmdOrCtrl+Shift+C', click: () => ctxSend('menu', 'run:stop') },
        { label: 'Limpiar consola', accelerator: 'CmdOrCtrl+L', click: () => ctxSend('menu', 'console:clear') }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Pantalla completa', accelerator: 'F11', click: () => { if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen()); } },
        { label: 'Acercar', accelerator: 'CmdOrCtrl+=', click: () => ctxSend('menu', 'zoom:in') },
        { label: 'Alejar', accelerator: 'CmdOrCtrl+-', click: () => ctxSend('menu', 'zoom:out') },
        { label: 'Restablecer zoom', accelerator: 'CmdOrCtrl+0', click: () => ctxSend('menu', 'zoom:reset') },
        { type: 'separator' },
        { label: 'Herramientas de desarrollo', accelerator: 'CmdOrCtrl+Shift+I', click: () => { if (mainWindow) mainWindow.webContents.toggleDevTools(); } },
        { label: 'Recargar interfaz', accelerator: 'CmdOrCtrl+R', click: () => { if (mainWindow) mainWindow.reload(); } }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const settings = store.getSettings();
  const sessionData = store.getSession();
  const bounds = sessionData.bounds || {};

  mainWindow = new BrowserWindow({
    width: bounds.width || 1360,
    height: bounds.height || 860,
    x: bounds.x,
    y: bounds.y,
    /*
     * Se permite bajar hasta tamano de telefono: la interfaz es adaptable
     * (src/css/responsive.css) y con el minimo anterior -900x600- no habia forma
     * de usarla en una ventana estrecha ni de comprobar ese diseno.
     */
    minWidth: 360,
    minHeight: 420,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: settings.theme === 'light' ? '#f6f7f9' : '#12151c',
    title: 'Python Classroom',
    icon: path.join(__dirname, '..', 'assets', 'icons', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      webviewTag: false,
      devTools: !app.isPackaged,
      // En desarrollo la interfaz expone window.__pc para depurar y para las
      // pruebas automatizadas (scripts/e2e.js). Empaquetada, ni una cosa ni otra.
      additionalArguments: (isDev ? ['--pc-dev'] : []).concat(permitirPruebas ? ['--pc-e2e'] : [])
    }
  });

  if (bounds.maximized) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    listoEnMs = Date.now() - T_ARRANQUE;
    console.log('[main] ventana lista en', listoEnMs, 'ms');
    mainWindow.show();
    if (isDev && process.argv.includes('--devtools')) mainWindow.webContents.openDevTools({ mode: 'bottom' });
    if (permitirPruebas) {
      const runner = path.join(__dirname, '..', 'scripts', 'e2e.js');
      try {
        require(runner)(mainWindow, app);
      } catch (err) {
        console.error('[e2e] no se pudo iniciar:', err);
        app.exit(1);
      }
    }
  });

  if (isDev) {
    // En desarrollo, los mensajes de la interfaz se ven en la consola de Node.
    const levels = ['debug', 'info', 'warn', 'error'];
    mainWindow.webContents.on('console-message', (event) => {
      const level = levels[event.level] || 'info';
      console.log('[renderer:' + level + '] ' + event.message +
        (event.lineNumber ? '  (' + event.sourceId + ':' + event.lineNumber + ')' : ''));
    });
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      console.error('[renderer] proceso terminado:', details.reason);
    });
    mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
      console.error('[preload] error en', preloadPath, error);
    });
  }

  mainWindow.on('maximize', () => ctxSend('win:state', { maximized: true }));
  mainWindow.on('unmaximize', () => ctxSend('win:state', { maximized: false }));
  mainWindow.on('enter-full-screen', () => ctxSend('win:state', { fullScreen: true }));
  mainWindow.on('leave-full-screen', () => ctxSend('win:state', { fullScreen: false }));
  mainWindow.on('focus', () => ctxSend('win:state', { focused: true }));
  mainWindow.on('blur', () => ctxSend('win:state', { focused: false }));

  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const maximized = mainWindow.isMaximized();
    const b = mainWindow.getNormalBounds();
    store.setSession({ bounds: { x: b.x, y: b.y, width: b.width, height: b.height, maximized: maximized } });
  };
  mainWindow.on('close', saveBounds);

  // Nada de ventanas emergentes ni navegacion fuera de la app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function registerIpc() {
  modules.files = filesIpc.register(ipcMain, ctx);
  modules.data = dataIpc.register(ipcMain, ctx);
  modules.python = pythonIpc.register(ipcMain, ctx);
  modules.terminal = terminalIpc.register(ipcMain, ctx);
  modules.packages = packagesIpc.register(ipcMain, ctx);
  modules.system = systemIpc.register(ipcMain, ctx);
  modules.exchange = exchangeIpc.register(ipcMain, ctx);
}

app.whenReady().then(() => {
  store.ensureDirs();
  const dbInfo = sqlite.open() && sqlite.info();
  console.log('[main] SQLite en', dbInfo.path, '- esquema', dbInfo.schemaVersion);
  // La sesion la restaura Firebase Auth en el renderer, que despues avisa por
  // el canal data:setSession. Aqui se arranca sin usuario activo.

  // Cabecera CSP estricta: la interfaz solo carga recursos propios.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: Object.assign({}, details.responseHeaders, {
        // Firebase usa scripts dinamicos para el transporte long-polling de
        // Realtime Database, aunque el SDK principal va empaquetado localmente.
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline' https://*.firebaseio.com; style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: blob: https://res.cloudinary.com; font-src 'self'; frame-src https://*.firebaseio.com; object-src 'none'; base-uri 'none'; " +
          "connect-src 'self' " +
          'https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com ' +
          'https://*.firebasedatabase.app wss://*.firebasedatabase.app ' +
          'https://identitytoolkit.googleapis.com https://securetoken.googleapis.com ' +
          'https://api.cloudinary.com https://res.cloudinary.com ' +
          'http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*'
        ]
      })
    });
  });

  registerIpc();
  buildMenu();
  createWindow();

  // Calienta la deteccion del runtime para que la interfaz la reciba al instante.
  setTimeout(() => { try { runtime.get(); } catch (err) { /* se reporta en la UI */ } }, 0);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function shutdown() {
  try { sqlite.close(); } catch (err) { console.error('[main] no se pudo cerrar SQLite:', err.message); }
  try { if (modules.python) modules.python.stopAll(); } catch (err) { /* ya cerrado */ }
  try { if (modules.terminal) modules.terminal.disposeAll(); } catch (err) { /* ya cerrado */ }
  try { if (modules.packages) modules.packages.cancelAll(); } catch (err) { /* ya cerrado */ }
  try { if (modules.system) modules.system.stopSetup(); } catch (err) { /* ya cerrado */ }
  try { if (modules.files) modules.files.stopWatch(); } catch (err) { /* ya cerrado */ }
}

app.on('before-quit', shutdown);
app.on('window-all-closed', () => {
  shutdown();
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  console.error('[main] excepcion no controlada:', err);
  ctxSend('app:error', { message: String(err && err.message || err) });
});
