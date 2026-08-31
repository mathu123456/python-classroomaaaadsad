/*
 * Explorador de archivos del proyecto.
 * Carga las carpetas bajo demanda (una lectura por carpeta abierta).
 */

import { $, el, icon, clear, toast, confirmDialog, promptDialog, contextMenu, shortPath } from './ui.js';

let root = null;              // {path, name}
let expanded = new Set();
let selected = null;
let hooks = {};
let bodyEl = null;
let recent = [];

const ICONS = { folder: 'folder', python: 'py', json: 'json', text: 'text', table: 'table', pclass: 'package', file: 'file' };

export function init(appHooks) {
  hooks = appHooks || {};
  bodyEl = $('#explorer-body');

  $('#ex-refresh').addEventListener('click', () => refresh());
  $('#ex-new-file').addEventListener('click', () => createFile(targetDir()));
  $('#ex-new-dir').addEventListener('click', () => createDir(targetDir()));

  window.pc.files.onChanged(() => { refresh(); });
}

export function getRoot() { return root; }

export async function setRoot(folder, recentList) {
  root = folder || null;
  if (recentList) recent = recentList;
  expanded = new Set(root ? [root.path] : []);
  $('#ws-name').textContent = root ? root.name : 'Explorador';
  $('#sb-workspace').textContent = root ? shortPath(root.path, 34) : 'Sin carpeta abierta';
  $('#sb-workspace').title = root ? root.path : '';
  await render();
  if (hooks.onRootChange) hooks.onRootChange(root);
}

export function setRecent(list) { recent = list || []; }

function targetDir() {
  if (!root) return null;
  if (selected) {
    if (selected.type === 'dir') return selected.path;
    return selected.path.replace(/[\\/][^\\/]+$/, '');
  }
  return root.path;
}

/* ------------------------------------------------------------- pintado */

export async function refresh() {
  await render();
}

async function render() {
  if (!bodyEl) return;
  clear(bodyEl);

  if (!root) {
    bodyEl.append(renderNoRoot());
    return;
  }

  const tree = el('div', { class: 'tree' });
  bodyEl.append(tree);
  await renderDir(root.path, tree, 0);
}

function renderNoRoot() {
  const box = el('div', { class: 'explorer-empty' },
    el('p', null, 'Todavía no has abierto ninguna carpeta.'),
    el('button', { class: 'btn primary block', onclick: () => hooks.openFolder && hooks.openFolder() }, 'Abrir carpeta'),
    el('button', { class: 'btn outline block', onclick: () => hooks.newProject && hooks.newProject() }, 'Crear proyecto nuevo')
  );
  if (recent.length) {
    box.append(el('div', { class: 'side-section-title', style: { padding: '12px 0 4px' } }, 'Recientes'));
    for (const p of recent.slice(0, 6)) {
      box.append(el('button', {
        class: 'tree-row',
        style: { width: '100%' },
        title: p,
        onclick: () => hooks.openRecent && hooks.openRecent(p)
      },
        el('span', { class: 'twisty leaf' }),
        el('span', { class: 'fico' }, icon('folder', 14)),
        el('span', { class: 'label' }, p.split(/[\\/]/).pop())
      ));
    }
  }
  return box;
}

async function renderDir(dirPath, container, depth) {
  let entries = [];
  try {
    entries = await window.pc.files.list(dirPath);
  } catch (err) {
    container.append(el('div', { class: 'explorer-empty' }, err.message));
    return;
  }
  if (!entries.length && depth === 0) {
    container.append(el('div', { class: 'explorer-empty' },
      el('p', null, 'La carpeta está vacía.'),
      el('button', { class: 'btn outline block', onclick: () => createFile(dirPath) }, 'Crear main.py')
    ));
    return;
  }

  for (const entry of entries) {
    const isDir = entry.type === 'dir';
    const isOpen = expanded.has(entry.path);
    const row = el('div', {
      class: 'tree-row' + (selected && selected.path === entry.path ? ' selected' : ''),
      style: { paddingLeft: (6 + depth * 13) + 'px' },
      title: entry.path,
      dataset: { path: entry.path, type: entry.type },
      onclick: () => onRowClick(entry, container, depth),
      oncontextmenu: (e) => { e.preventDefault(); selected = entry; markSelection(); showMenu(e, entry); }
    },
      el('span', { class: 'twisty' + (isDir ? (isOpen ? ' open' : '') : ' leaf') }, icon('chevron-right', 11)),
      el('span', { class: 'fico' }, icon(isDir ? (isOpen ? 'folder-open' : 'folder') : ICONS[entry.icon] || 'file', 14)),
      el('span', { class: 'label' }, entry.name)
    );
    container.append(row);

    if (isDir && isOpen) {
      const child = el('div', { class: 'tree-children', dataset: { parent: entry.path } });
      container.append(child);
      await renderDir(entry.path, child, depth + 1);
    }
  }
}

function markSelection() {
  for (const row of document.querySelectorAll('#explorer-body .tree-row')) {
    row.classList.toggle('selected', !!selected && row.dataset.path === selected.path);
  }
}

async function onRowClick(entry) {
  selected = entry;
  markSelection();
  if (entry.type === 'dir') {
    if (expanded.has(entry.path)) expanded.delete(entry.path);
    else expanded.add(entry.path);
    await render();
  } else if (hooks.openFile) {
    hooks.openFile(entry.path);
  }
}

export function markActiveFile(path) {
  for (const row of document.querySelectorAll('#explorer-body .tree-row')) {
    row.classList.toggle('active', row.dataset.path === path);
  }
}

/* ------------------------------------------------------------ acciones */

function showMenu(event, entry) {
  const isDir = entry.type === 'dir';
  const dir = isDir ? entry.path : entry.path.replace(/[\\/][^\\/]+$/, '');
  contextMenu(event.clientX, event.clientY, [
    !isDir && { label: 'Abrir', icon: 'file', action: () => hooks.openFile && hooks.openFile(entry.path) },
    !isDir && /\.pyw?$/i.test(entry.name) && { label: 'Ejecutar este archivo', icon: 'play', action: () => hooks.runFile && hooks.runFile(entry.path) },
    !isDir && 'divider',
    { label: 'Nuevo archivo', icon: 'new-file', action: () => createFile(dir) },
    { label: 'Nueva carpeta', icon: 'new-folder', action: () => createDir(dir) },
    'divider',
    { label: 'Renombrar', icon: 'edit', key: 'F2', action: () => rename(entry) },
    { label: 'Eliminar', icon: 'trash', action: () => remove(entry) },
    'divider',
    { label: 'Copiar ruta', action: () => { window.pc.app.copy(entry.path); toast('Ruta copiada', { type: 'ok', timeout: 1800 }); } },
    { label: 'Mostrar en el explorador', icon: 'external', action: () => window.pc.files.reveal(entry.path) }
  ].filter(Boolean));
}

export async function createFile(dir) {
  if (!dir) { toast('Abre una carpeta primero.', { type: 'warn' }); return; }
  const name = await promptDialog({
    title: 'Nuevo archivo',
    label: 'Nombre del archivo (se creará dentro de ' + dir.split(/[\\/]/).pop() + ')',
    value: 'nuevo.py',
    okLabel: 'Crear'
  });
  if (!name) return;
  try {
    const created = await window.pc.files.createFile(dir, name);
    expanded.add(dir);
    await render();
    if (hooks.openFile) hooks.openFile(created.path);
    toast('Archivo creado: ' + created.name, { type: 'ok', timeout: 2200 });
  } catch (err) {
    toast(err.message, { title: 'No se pudo crear', type: 'err' });
  }
}

export async function createDir(dir) {
  if (!dir) { toast('Abre una carpeta primero.', { type: 'warn' }); return; }
  const name = await promptDialog({ title: 'Nueva carpeta', value: 'nueva_carpeta', okLabel: 'Crear' });
  if (!name) return;
  try {
    const created = await window.pc.files.createDir(dir, name);
    expanded.add(dir);
    expanded.add(created.path);
    await render();
  } catch (err) {
    toast(err.message, { title: 'No se pudo crear', type: 'err' });
  }
}

async function rename(entry) {
  const name = await promptDialog({ title: 'Renombrar', value: entry.name, okLabel: 'Renombrar' });
  if (!name || name === entry.name) return;
  try {
    const res = await window.pc.files.rename(entry.path, name);
    if (hooks.onRenamed) hooks.onRenamed(entry.path, res.path, res.name);
    await render();
  } catch (err) {
    toast(err.message, { title: 'No se pudo renombrar', type: 'err' });
  }
}

async function remove(entry) {
  const ok = await confirmDialog(
    '¿Enviar "' + entry.name + '" a la papelera?',
    { title: 'Eliminar', okLabel: 'Eliminar', danger: true }
  );
  if (!ok) return;
  try {
    await window.pc.files.remove(entry.path);
    if (hooks.onRemoved) hooks.onRemoved(entry.path);
    selected = null;
    await render();
    toast('Elemento enviado a la papelera', { type: 'ok', timeout: 2200 });
  } catch (err) {
    toast(err.message, { title: 'No se pudo eliminar', type: 'err' });
  }
}

export function expandTo(path) {
  if (!root || !path) return;
  const rel = path.slice(root.path.length).split(/[\\/]/).filter(Boolean);
  let acc = root.path;
  for (let i = 0; i < rel.length - 1; i++) {
    acc = acc + '\\' + rel[i];
    expanded.add(acc);
  }
}
