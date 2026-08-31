'use strict';
/*
 * Preferencias y sesion de trabajo en disco, separadas de la instalacion para
 * que una actualizacion nunca borre datos del usuario.
 *
 *   <userData>/settings.json              preferencias antes de iniciar sesion
 *   <userData>/session.json               sesion de trabajo sin usuario
 *   <userData>/auth.json                  quien tiene la sesion iniciada
 *   <userData>/data/*.json                base de datos local (electron/db.js)
 *   <userData>/usuarios/<id>/settings.json  preferencias de ese usuario
 *   <userData>/usuarios/<id>/session.json   pestanas y carpeta abiertas
 *   <userData>/usuarios/<id>/proyectos/     proyectos de ese usuario
 *   <userData>/tmp/                       scripts temporales de ejecucion
 *
 * Cada usuario tiene su propia configuracion y sus propios proyectos: en un
 * computador compartido del colegio, dos estudiantes no se pisan.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  theme: 'dark',                 // 'dark' | 'light'
  fontSize: 14,
  tabSize: 4,
  wordWrap: false,
  lineNumbers: true,
  minimapGutter: true,
  autoSave: true,
  autoSaveDelay: 1200,
  highlightActiveLine: true,
  bracketPairs: true,
  autocomplete: true,
  autocompleteOnType: true,
  runTimeoutMs: 30000,           // 0 = sin limite
  clearConsoleOnRun: true,
  terminalShell: null,           // null = shell por defecto del sistema
  showWelcome: true,
  consoleFontSize: 13,
  panelHeight: 260,
  sidebarWidth: 260,

  // Fase 6: actualizaciones y marca del primer arranque ya preparado.
  updateRepo: null,              // "usuario/repositorio" de GitHub
  updateCheckOnStart: false,
  preparadoEn: null              // fecha de la ultima comprobacion de instalacion
};

let settingsCache = null;
let activeUserId = null;

/* --------------------------------------------------------------- rutas */

function dir() { return app.getPath('userData'); }

function usersRoot() {
  const d = path.join(dir(), 'usuarios');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function userDir(userId) {
  const d = path.join(usersRoot(), String(userId));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function settingsFile() {
  return activeUserId
    ? path.join(userDir(activeUserId), 'settings.json')
    : path.join(dir(), 'settings.json');
}

function sessionFile() {
  return activeUserId
    ? path.join(userDir(activeUserId), 'session.json')
    : path.join(dir(), 'session.json');
}

function authFile() { return path.join(dir(), 'auth.json'); }


function tmpDir() {
  const d = path.join(dir(), 'tmp');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Carpeta de proyectos: propia de cada usuario cuando hay sesion iniciada. */
function workspacesDir() {
  const d = activeUserId
    ? path.join(userDir(activeUserId), 'proyectos')
    : path.join(dir(), 'workspaces');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function ensureDirs() {
  for (const d of [dir(), usersRoot(), workspacesDir(), tmpDir(), path.join(dir(), 'data')]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

/* ------------------------------------------------------------- lectura */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/* --------------------------------------------------------- usuario activo */

/** Cambia el usuario cuyas preferencias y proyectos se usan. */
function setActiveUser(userId) {
  if (activeUserId === (userId || null)) return activeUserId;
  activeUserId = userId || null;
  settingsCache = null;             // las preferencias son distintas por usuario
  if (activeUserId) {
    userDir(activeUserId);
    workspacesDir();
  }
  return activeUserId;
}

function getActiveUser() { return activeUserId; }

/* ------------------------------------------------------------ preferencias */

function getSettings() {
  if (!settingsCache) {
    settingsCache = Object.assign({}, DEFAULTS, readJson(settingsFile(), {}));
  }
  return Object.assign({}, settingsCache);
}

function setSettings(patch) {
  const merged = Object.assign({}, getSettings(), patch || {});
  const clean = {};
  for (const key of Object.keys(DEFAULTS)) clean[key] = merged[key];
  settingsCache = clean;
  writeJsonAtomic(settingsFile(), clean);
  return Object.assign({}, clean);
}

function resetSettings() {
  settingsCache = Object.assign({}, DEFAULTS);
  writeJsonAtomic(settingsFile(), settingsCache);
  return Object.assign({}, settingsCache);
}

/* --------------------------------------------------- sesion de trabajo */

function getSession() {
  return readJson(sessionFile(), { workspace: null, openFiles: [], activeFile: null, recent: [] });
}

function setSession(patch) {
  const next = Object.assign(getSession(), patch || {});
  if (Array.isArray(next.recent)) next.recent = next.recent.slice(0, 10);
  writeJsonAtomic(sessionFile(), next);
  return next;
}

function pushRecent(folder) {
  const s = getSession();
  const recent = [folder].concat((s.recent || []).filter((r) => r !== folder)).slice(0, 10);
  return setSession({ recent: recent });
}

/* ------------------------------------------------- sesion de autenticacion */

function getAuthSession() {
  return readJson(authFile(), null);
}

function setAuthSession(data) {
  if (!data) {
    try { fs.unlinkSync(authFile()); } catch (err) { /* no existia */ }
    return null;
  }
  writeJsonAtomic(authFile(), data);
  return data;
}

module.exports = {
  DEFAULTS,
  ensureDirs,
  getSettings,
  setSettings,
  resetSettings,
  getSession,
  setSession,
  pushRecent,
  getAuthSession,
  setAuthSession,
  setActiveUser,
  getActiveUser,
  tmpDir,
  workspacesDir,
  usersRoot,
  userDir,
  userDataDir: dir
};
