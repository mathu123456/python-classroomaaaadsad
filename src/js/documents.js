/*
 * Documentos abiertos y pestanas.
 *
 * Cada documento guarda su propio EditorState, asi que al cambiar de pestana se
 * conservan el historial de deshacer, la seleccion y el desplazamiento.
 * El contenido tambien se copia a IndexedDB como borrador: si la aplicacion se
 * cierra de golpe, nada se pierde.
 */

import * as editor from './editor.js';
import { drafts } from './storage.js';
import { $, el, icon, clear, toast, confirmDialog, promptDialog, debounce } from './ui.js';

const docs = [];
let activeId = null;
let seq = 0;
let settings = {};
let hooks = {};
let tabsHost = null;

const autoSaveNow = debounce(() => { persistActive(true); }, 900);

function iconFor(name) {
  const ext = (name || '').toLowerCase().split('.').pop();
  if (ext === 'py' || ext === 'pyw') return 'py';
  if (ext === 'json') return 'json';
  if (ext === 'csv' || ext === 'tsv') return 'table';
  if (ext === 'md' || ext === 'txt') return 'text';
  return 'file';
}

export function init(appSettings, appHooks) {
  settings = appSettings;
  hooks = appHooks || {};
  tabsHost = $('#tabs');
}

export function updateSettings(next) { settings = next; }

export function all() { return docs.slice(); }
export function current() { return docs.find((d) => d.id === activeId) || null; }
export function count() { return docs.length; }

function makeDoc(name, path, text) {
  seq += 1;
  return {
    id: 'doc' + seq,
    name,
    path: path || null,
    state: editor.makeState(text || '', settings),
    savedText: text || '',
    dirty: false,
    untitled: !path,
    mtime: 0
  };
}

/* ------------------------------------------------------------- pestanas */

export function renderTabs() {
  if (!tabsHost) return;
  clear(tabsHost);
  for (const doc of docs) {
    const tab = el('div', {
      class: 'tab' + (doc.id === activeId ? ' active' : '') + (doc.dirty ? ' dirty' : ''),
      title: doc.path || doc.name,
      onclick: (e) => { if (!e.target.closest('.tab-close')) activate(doc.id); },
      onauxclick: (e) => { if (e.button === 1) close(doc.id); },
      oncontextmenu: (e) => {
        e.preventDefault();
        if (hooks.onTabContextMenu) hooks.onTabContextMenu(e, doc);
      }
    },
      icon(iconFor(doc.name), 14),
      el('span', { class: 'name' }, doc.name),
      el('button', {
        class: 'tab-close',
        title: 'Cerrar (Ctrl+W)',
        onclick: (e) => { e.stopPropagation(); close(doc.id); }
      }, icon('close', 12))
    );
    tabsHost.append(tab);
  }
  const active = tabsHost.querySelector('.tab.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  updateEmptyState();
}

function updateEmptyState() {
  const host = $('#editor-host');
  const empty = $('#editor-empty');
  if (!host || !empty) return;
  const has = docs.length > 0;
  host.classList.toggle('visible', has);
  empty.style.display = has ? 'none' : 'grid';
  // El editor se monta oculto: al mostrarlo hay que pedirle que vuelva a medir.
  if (has) {
    const view = editor.getView();
    if (view) requestAnimationFrame(() => view.requestMeasure());
  }
}

/* --------------------------------------------------------------- estado */

/** Guarda en el documento activo el estado real del editor. */
function syncActive() {
  const doc = current();
  if (!doc) return null;
  const state = editor.getState();
  if (state) doc.state = state;
  return doc;
}

function refreshDirty(doc) {
  const text = doc.state.doc.toString();
  const dirty = text !== doc.savedText;
  if (dirty !== doc.dirty) {
    doc.dirty = dirty;
    renderTabs();
  }
  return dirty;
}

export function onEditorChange() {
  const doc = syncActive();
  if (!doc) return;
  refreshDirty(doc);
  drafts.save({
    id: doc.id,
    name: doc.name,
    path: doc.path,
    content: doc.state.doc.toString(),
    dirty: doc.dirty
  }).catch(() => { /* el borrador es una ayuda, no un requisito */ });
  if (settings.autoSave && doc.path && doc.dirty) autoSaveNow();
  if (hooks.onChange) hooks.onChange(doc);
}

/* ---------------------------------------------------------- operaciones */

export function activate(id) {
  if (id === activeId) { editor.focus(); return; }
  syncActive();
  const doc = docs.find((d) => d.id === id);
  if (!doc) return;
  activeId = id;
  editor.setState(doc.state);
  renderTabs();
  editor.focus();
  if (hooks.onActivate) hooks.onActivate(doc);
}

export function newFile(name) {
  const base = name || nextUntitledName();
  const doc = makeDoc(base, null, '');
  docs.push(doc);
  activate(doc.id);
  persistSession();
  return doc;
}

function nextUntitledName() {
  let i = 1;
  while (docs.some((d) => d.name === 'sin_titulo_' + i + '.py')) i++;
  return 'sin_titulo_' + i + '.py';
}

export async function openPath(path, options = {}) {
  const existing = docs.find((d) => d.path && d.path === path);
  if (existing) {
    activate(existing.id);
    return existing;
  }
  try {
    const file = await window.pc.files.read(path);
    const doc = makeDoc(file.name, file.path, file.content);
    doc.mtime = file.mtime;
    docs.push(doc);
    activate(doc.id);
    persistSession();
    return doc;
  } catch (err) {
    if (!options.silent) toast(err.message, { title: 'No se pudo abrir', type: 'err' });
    return null;
  }
}

export async function openDialog() {
  const file = await window.pc.files.openFileDialog();
  if (!file) return null;
  const existing = docs.find((d) => d.path === file.path);
  if (existing) { activate(existing.id); return existing; }
  const doc = makeDoc(file.name, file.path, file.content);
  doc.mtime = file.mtime;
  docs.push(doc);
  activate(doc.id);
  persistSession();
  return doc;
}

async function persistActive(silent) {
  const doc = syncActive();
  if (!doc || !doc.path) return false;
  const text = doc.state.doc.toString();
  if (text === doc.savedText) return true;
  try {
    const res = await window.pc.files.write(doc.path, text);
    doc.savedText = text;
    doc.mtime = res.mtime;
    doc.dirty = false;
    renderTabs();
    if (hooks.onSaved) hooks.onSaved(doc, { silent: !!silent });
    return true;
  } catch (err) {
    toast(err.message, { title: 'Error al guardar', type: 'err' });
    return false;
  }
}

export async function save(id) {
  const doc = id ? docs.find((d) => d.id === id) : syncActive();
  if (!doc) return false;
  if (doc.id === activeId) syncActive();
  if (!doc.path) return saveAs(doc.id);
  return persistActive(false);
}

export async function saveAs(id) {
  const doc = id ? docs.find((d) => d.id === id) : syncActive();
  if (!doc) return false;
  if (doc.id === activeId) syncActive();
  const target = await window.pc.files.saveAsDialog(doc.name);
  if (!target) return false;
  try {
    const text = doc.state.doc.toString();
    const res = await window.pc.files.write(target.path, text);
    doc.path = target.path;
    doc.name = target.name;
    doc.untitled = false;
    doc.savedText = text;
    doc.mtime = res.mtime;
    doc.dirty = false;
    renderTabs();
    persistSession();
    if (hooks.onSaved) hooks.onSaved(doc, {});
    return true;
  } catch (err) {
    toast(err.message, { title: 'Error al guardar', type: 'err' });
    return false;
  }
}

export async function saveAll() {
  syncActive();
  let n = 0;
  for (const doc of docs.slice()) {
    if (!doc.dirty) continue;
    const okSave = doc.path ? await saveDoc(doc) : await saveAs(doc.id);
    if (okSave) n++;
  }
  return n;
}

async function saveDoc(doc) {
  const text = doc.state.doc.toString();
  try {
    const res = await window.pc.files.write(doc.path, text);
    doc.savedText = text;
    doc.mtime = res.mtime;
    doc.dirty = false;
    renderTabs();
    return true;
  } catch (err) {
    toast(err.message, { title: 'Error al guardar', type: 'err' });
    return false;
  }
}

export async function close(id) {
  const doc = docs.find((d) => d.id === (id || activeId));
  if (!doc) return;
  if (doc.id === activeId) syncActive();
  if (doc.dirty) {
    const keep = await confirmDialog(
      'El archivo "' + doc.name + '" tiene cambios sin guardar. ¿Quieres guardarlos antes de cerrar?',
      { title: 'Cambios sin guardar', okLabel: 'Guardar y cerrar', cancelLabel: 'Cerrar sin guardar' }
    );
    if (keep) {
      const okSave = doc.path ? await saveDoc(doc) : await saveAs(doc.id);
      if (!okSave) return;
    }
  }
  const index = docs.indexOf(doc);
  docs.splice(index, 1);
  drafts.remove(doc.id).catch(() => {});
  if (activeId === doc.id) {
    const next = docs[index] || docs[index - 1] || null;
    activeId = next ? next.id : null;
    if (next) editor.setState(next.state);
  }
  renderTabs();
  persistSession();
  if (hooks.onActivate) hooks.onActivate(current());
}

export async function closeAll() {
  for (const doc of docs.slice()) await close(doc.id);
}

export async function renamed(oldPath, newPath, newName) {
  const doc = docs.find((d) => d.path === oldPath);
  if (!doc) return;
  doc.path = newPath;
  doc.name = newName;
  renderTabs();
  persistSession();
}

/** Recarga desde disco un archivo que cambio fuera del editor. */
export async function reloadFromDisk(path) {
  const doc = docs.find((d) => d.path === path);
  if (!doc || doc.dirty) return;
  try {
    const file = await window.pc.files.read(path);
    if (file.content === doc.savedText) return;
    const isActive = doc.id === activeId;
    doc.state = editor.makeState(file.content, settings);
    doc.savedText = file.content;
    doc.mtime = file.mtime;
    doc.dirty = false;
    if (isActive) editor.setState(doc.state);
    renderTabs();
  } catch (err) { /* el archivo pudo borrarse */ }
}

/** Reconstruye todos los estados cuando cambian preferencias estructurales. */
export function rebuildStates(next) {
  syncActive();
  settings = next;
  for (const doc of docs) {
    const text = doc.state.doc.toString();
    doc.state = editor.makeState(text, settings);
  }
  const active = current();
  if (active) editor.setState(active.state);
}

/** Aplica preferencias ligeras sin perder el historial. */
export function applySettings(next) {
  syncActive();
  settings = next;
  const effects = editor.settingsEffects(next);
  for (const doc of docs) {
    if (doc.id === activeId) {
      const view = editor.getView();
      if (view) { view.dispatch({ effects }); doc.state = view.state; }
    } else {
      doc.state = doc.state.update({ effects }).state;
    }
  }
}

/* --------------------------------------------------------------- sesion */

export function persistSession() {
  const openFiles = docs.filter((d) => d.path).map((d) => d.path);
  const activeDoc = current();
  window.pc.config.setSession({
    openFiles,
    activeFile: activeDoc && activeDoc.path ? activeDoc.path : null
  }).catch(() => {});
}

export async function restoreSession(session) {
  if (!session || !Array.isArray(session.openFiles)) return 0;
  let opened = 0;
  for (const path of session.openFiles.slice(0, 12)) {
    const exists = await window.pc.files.exists(path);
    if (!exists) continue;
    const doc = await openPath(path, { silent: true });
    if (doc) opened++;
  }
  if (session.activeFile) {
    const doc = docs.find((d) => d.path === session.activeFile);
    if (doc) activate(doc.id);
  }
  renderTabs();
  return opened;
}

/**
 * Cierre de sesion: guarda lo que tenga ruta, olvida el resto y deja el editor
 * en blanco. No pregunta nada porque el usuario ya confirmo el cierre.
 */
export async function resetForUserChange() {
  syncActive();
  for (const doc of docs) {
    if (doc.dirty && doc.path) await saveDoc(doc);
  }
  docs.length = 0;
  activeId = null;
  drafts.clear().catch(() => {});
  editor.setState(editor.makeState('', settings));
  renderTabs();
}

export function hasUnsaved() { syncActive(); return docs.some((d) => d.dirty); }

export function nextTab(dir) {
  if (docs.length < 2) return;
  const i = docs.findIndex((d) => d.id === activeId);
  const next = docs[(i + dir + docs.length) % docs.length];
  activate(next.id);
}

export { syncActive };
