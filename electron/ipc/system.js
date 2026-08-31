'use strict';
/*
 * IPC de sistema: preferencias, sesion, ventana, informacion de la app y
 * reinstalacion del runtime de Python desde la propia interfaz.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, shell, clipboard, dialog } = require('electron');
const { spawn } = require('child_process');

const store = require('../store');
const runtime = require('../runtime');
const sqlite = require('../sqlite');
const firebaseConfig = require('../firebase-config');
const cloudinary = require('../cloudinary');
const updates = require('../updates');
const users = require('../repos/users');
const work = require('../repos/work');
const courses = require('../repos/courses');

let setupChild = null;

function register(ipcMain, ctx) {
  /* ------------------------------------------------------- preferencias */
  ipcMain.handle('cfg:get', () => store.getSettings());
  ipcMain.handle('cfg:set', (_e, patch) => store.setSettings(patch));
  ipcMain.handle('cfg:reset', () => store.resetSettings());
  ipcMain.handle('cfg:session', () => store.getSession());
  ipcMain.handle('cfg:setSession', (_e, patch) => store.setSession(patch));
  ipcMain.handle('cfg:paths', () => ({
    userData: store.userDataDir(),
    workspaces: store.workspacesDir(),
    datos: sqlite.info().path,
    tmp: store.tmpDir(),
    logs: app.getPath('logs'),
    home: os.homedir()
  }));

  ipcMain.handle('app:resetLocalData', async () => {
    const root = store.userDataDir();
    sqlite.close();
    for (const name of [
      'python-classroom.db', 'python-classroom.db-shm', 'python-classroom.db-wal',
      'auth.json', 'settings.json', 'session.json', 'data', 'usuarios', 'workspaces', 'tmp', 'backups'
    ]) {
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
    try {
      await require('electron').session.defaultSession.clearStorageData({
        storages: ['appcache', 'cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
      });
    } catch (err) { /* el reinicio sigue siendo util aunque no haya cache */ }
    setTimeout(() => { app.relaunch(); app.exit(0); }, 100);
    return { ok: true };
  });

  /* --------------------------------------------------------------- app */
  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osVersion: os.release(),
    packaged: app.isPackaged,
    cpu: (os.cpus()[0] || {}).model || 'desconocido',
    memoryGb: Math.round(os.totalmem() / 1073741824)
  }));

  ipcMain.handle('app:openExternal', async (_e, url) => {
    const u = String(url || '');
    if (!/^https?:\/\//i.test(u)) return { ok: false, error: 'URL no permitida.' };
    await shell.openExternal(u);
    return { ok: true };
  });

  ipcMain.handle('app:copy', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
  ipcMain.handle('app:paste', () => clipboard.readText());

  ipcMain.handle('app:confirm', async (_e, options) => {
    const opts = options || {};
    const res = await dialog.showMessageBox(ctx.getWindow(), {
      type: opts.type || 'question',
      title: opts.title || 'Python Classroom',
      message: opts.message || '',
      detail: opts.detail || '',
      buttons: opts.buttons || ['Cancelar', 'Aceptar'],
      defaultId: typeof opts.defaultId === 'number' ? opts.defaultId : 1,
      cancelId: typeof opts.cancelId === 'number' ? opts.cancelId : 0,
      noLink: true
    });
    return res.response;
  });

  /* ------------------------------------------------------------ ventana */
  ipcMain.handle('win:minimize', () => { const w = ctx.getWindow(); if (w) w.minimize(); });
  ipcMain.handle('win:maximize', () => {
    const w = ctx.getWindow();
    if (!w) return false;
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
    return w.isMaximized();
  });
  ipcMain.handle('win:close', () => { const w = ctx.getWindow(); if (w) w.close(); });
  ipcMain.handle('win:isMaximized', () => {
    const w = ctx.getWindow();
    return !!(w && w.isMaximized());
  });
  ipcMain.handle('win:toggleFullScreen', () => {
    const w = ctx.getWindow();
    if (!w) return false;
    w.setFullScreen(!w.isFullScreen());
    return w.isFullScreen();
  });
  ipcMain.handle('win:isFullScreen', () => {
    const w = ctx.getWindow();
    return !!(w && w.isFullScreen());
  });
  ipcMain.handle('win:setTitle', (_e, title) => {
    const w = ctx.getWindow();
    if (w) w.setTitle(String(title || 'Python Classroom'));
    return true;
  });
  ipcMain.handle('win:reload', () => { const w = ctx.getWindow(); if (w) w.reload(); });
  ipcMain.handle('win:devtools', () => {
    const w = ctx.getWindow();
    if (w) w.webContents.toggleDevTools();
  });

  /* ------------------------------------------- instalar/reparar runtime */
  ipcMain.handle('runtime:setup', (_e, options) => {
    if (setupChild) return { ok: false, error: 'Ya hay una instalacion en curso.' };
    const root = runtime.projectRoot();
    const script = path.join(root, 'scripts', 'setup-python.js');
    if (!fs.existsSync(script)) {
      return { ok: false, error: 'No se encontro scripts/setup-python.js en ' + root };
    }
    const args = [script];
    if (options && options.force) args.push('--force');
    if (options && options.full) args.push('--full');
    if (options && options.noPackages) args.push('--no-packages');

    // Electron puede actuar como Node con ELECTRON_RUN_AS_NODE=1.
    setupChild = spawn(process.execPath, args, {
      cwd: root,
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const send = (type, extra) => ctx.send('runtime:event', Object.assign({ type: type }, extra || {}));
    send('start', {});
    setupChild.stdout.on('data', (b) => send('log', { data: b.toString('utf8') }));
    setupChild.stderr.on('data', (b) => send('log', { data: b.toString('utf8'), stream: 'stderr' }));
    setupChild.on('error', (err) => send('log', { data: 'Error: ' + err.message + '\n', stream: 'stderr' }));
    setupChild.on('close', (code) => {
      setupChild = null;
      runtime.invalidate();
      const rt = runtime.get(true);
      send('done', { code: code, ok: code === 0 && rt.ok, runtime: { ok: rt.ok, version: rt.version, embedded: rt.embedded } });
    });
    return { ok: true };
  });

  ipcMain.handle('runtime:cancelSetup', () => {
    if (!setupChild) return { ok: false };
    require('./python').killTree(setupChild.pid);
    return { ok: true };
  });

  /* ------------------------------- preparacion del runtime (fase 6) */

  /*
   * Estado de la preparacion: dice si hace falta copiar el runtime a la carpeta
   * del usuario porque la carpeta de instalacion es de solo lectura.
   */
  ipcMain.handle('runtime:prepareState', () => runtime.prepareState());

  /**
   * Deja el runtime en un sitio donde pip pueda escribir. Va informando del
   * progreso por el canal runtime:event para la pantalla de primer arranque.
   */
  ipcMain.handle('runtime:prepare', (_e, options) => {
    const send = (type, extra) => ctx.send('runtime:event', Object.assign({ type: type }, extra || {}));
    const estado = runtime.prepareState();
    send('prepare-start', estado);
    try {
      const res = runtime.ensureWritable((p) => {
        send('prepare-progress', {
          hechos: p.hechos,
          total: p.total,
          porcentaje: p.total ? Math.round((p.hechos / p.total) * 100) : 100
        });
      }, options || {});
      send('prepare-done', { ok: res.ok, copiado: res.copiado, motivo: res.motivo });
      return res;
    } catch (err) {
      const mensaje = err && err.message ? err.message : String(err);
      send('prepare-done', { ok: false, error: mensaje });
      return { ok: false, error: mensaje };
    }
  });

  /* ---------------------------------- copias, arranque y actualizaciones */

  /** Cuanto tardo la aplicacion en estar lista (arranque en frio). */
  ipcMain.handle('app:startup', () => ctx.startupInfo ? ctx.startupInfo() : { listoEnMs: null });

  ipcMain.handle('updates:config', () => updates.config());
  ipcMain.handle('updates:setConfig', (_e, patch) => updates.setConfig(patch || {}));
  ipcMain.handle('updates:check', () => updates.check());

  /* -------------------------------------------- fotos de perfil (Cloudinary) */

  /*
   * La imagen llega ya recortada y comprimida por la interfaz (canvas), como
   * data URL. Aqui solo se sube y se guarda la URL: ninguna imagen entra en la
   * base de datos, ni local ni remota.
   */
  ipcMain.handle('photo:config', () => {
    const cfg = cloudinary.get();
    return {
      listo: cfg.listo,
      cloudName: cfg.cloudName,
      uploadPreset: cfg.uploadPreset,
      carpeta: cfg.carpeta,
      maxKb: Math.round(cfg.maxBytes / 1024),
      archivo: cfg.archivo
    };
  });

  ipcMain.handle('photo:setConfig', (_e, patch) => {
    users.requireTeacher();          // es configuracion del equipo, no del alumno
    const cfg = cloudinary.set(patch || {});
    return { ok: true, listo: cfg.listo, cloudName: cfg.cloudName, uploadPreset: cfg.uploadPreset };
  });

  ipcMain.handle('photo:upload', async (_e, dataUrl) => {
    const yo = users.requireUser();
    const res = await cloudinary.subir(dataUrl, { publicId: 'perfil_' + yo.uid });
    if (!res.ok) return res;
    const vista = users.setPhoto(yo.uid, res.url);
    ctx.send('data:changed', { motivo: 'foto de perfil', at: Date.now() });
    return {
      ok: true,
      url: res.url,
      kb: Math.round((res.bytes || 0) / 1024),
      formato: res.formato,
      usuario: vista
    };
  });

  ipcMain.handle('photo:remove', () => {
    const yo = users.requireUser();
    const vista = users.setPhoto(yo.uid, null);
    ctx.send('data:changed', { motivo: 'foto de perfil', at: Date.now() });
    return { ok: true, usuario: vista };
  });

  /** URL lista para mostrar en un tamano concreto (recorte y formato automaticos). */
  ipcMain.handle('photo:url', (_e, url, lado) => cloudinary.urlOptimizada(url, lado));

  /* ------------------------------------------------- configuracion firebase */
  ipcMain.handle('cfg:firebase', () => firebaseConfig.get());
  ipcMain.handle('cfg:setFirebase', (_e, patch) => firebaseConfig.set(patch || {}));

  /* --------------------------------------------------- exportar backup */
  /*
   * "Exportar mis datos" (seccion 49). Un estudiante se lleva su perfil, su
   * progreso y sus proyectos; un profesor se lleva ademas la informacion
   * academica del curso. Las contrasenas nunca salen del equipo.
   */
  ipcMain.handle('app:exportData', async () => {
    const usuario = users.active();
    const sugerido = usuario
      ? 'python-classroom-' + String(usuario.email).split('@')[0] + '.json'
      : 'python-classroom-datos.json';

    const res = await dialog.showSaveDialog(ctx.getWindow(), {
      title: 'Exportar mis datos',
      defaultPath: sugerido,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };

    const payload = {
      exportadoEn: new Date().toISOString(),
      app: { nombre: app.getName(), version: app.getVersion() },
      esquema: sqlite.SCHEMA_VERSION,
      configuracion: store.getSettings(),
      sesionDeTrabajo: store.getSession(),
      runtime: (function () {
        const rt = runtime.get();
        return { ok: rt.ok, version: rt.version, embebido: rt.embedded, ejecutable: rt.executable };
      }())
    };

    if (usuario) {
      payload.perfil = usuario;
      payload.progreso = work.progressFor(usuario.uid);
      if (usuario.rol === 'profesor') {
        // Solo LO SUYO -su curso-, no el colegio entero (sección 49: "un
        // profesor se lleva además la información académica DEL CURSO").
        const cursoId = courses.courseIdFor(usuario.uid);
        payload.academico = {
          usuarios: users.list(),
          temarios: sqlite.all('SELECT * FROM topics'),
          ejercicios: sqlite.all('SELECT * FROM exercises WHERE courseId = ?', [cursoId]),
          clases: sqlite.all('SELECT * FROM classes WHERE courseId = ?', [cursoId]),
          retos: sqlite.all('SELECT * FROM challenges WHERE courseId = ?', [cursoId]),
          entregas: sqlite.all('SELECT * FROM submissions WHERE courseId = ?', [cursoId]),
          feedback: sqlite.all('SELECT * FROM feedback WHERE courseId = ?', [cursoId]),
          historialNotas: sqlite.all('SELECT * FROM grade_history WHERE courseId = ?', [cursoId])
        };
      } else {
        const cursoId = courses.courseIdFor(usuario.uid);
        payload.academico = {
          temarios: sqlite.all('SELECT * FROM topics'),
          ejercicios: sqlite.all(
            "SELECT * FROM exercises WHERE courseId = ? AND status IN ('published','active')", [cursoId]),
          entregas: sqlite.all('SELECT * FROM submissions WHERE studentId = ?', [usuario.uid]),
          feedback: sqlite.all(
            'SELECT f.* FROM feedback f JOIN submissions s ON s.id = f.submissionId WHERE s.studentId = ?',
            [usuario.uid])
        };
      }
    }

    fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, path: res.filePath };
  });

  return {
    stopSetup: () => { if (setupChild) require('./python').killTree(setupChild.pid); }
  };
}

module.exports = { register };
