/*
 * Gestor de librerias (inspirado en el gestor del Arduino IDE).
 *
 * Buscar -> ver informacion -> instalar / actualizar / desinstalar, con el
 * registro de pip en vivo. Todo se hace con el pip del runtime interno.
 */

import { $, $$, el, icon, clear, toast, debounce, confirmDialog } from './ui.js';

let listEl = null;
let detailEl = null;
let searchEl = null;
let filter = 'all';
let installed = new Map();
let outdated = new Map();
let items = [];
let selectedName = null;
let busyOp = null;
let logBuffer = '';
let hooks = {};

export function init(appHooks) {
  hooks = appHooks || {};
  listEl = $('#pkg-list');
  detailEl = $('#pkg-detail');
  searchEl = $('#pkg-search');

  searchEl.addEventListener('input', debounce(() => search(searchEl.value), 320));
  searchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(searchEl.value); });

  $('#pkg-refresh').addEventListener('click', () => refresh(true));

  for (const btn of $$('[data-pkgfilter]')) {
    btn.addEventListener('click', () => {
      filter = btn.dataset.pkgfilter;
      for (const b of $$('[data-pkgfilter]')) {
        b.classList.toggle('primary', b === btn);
        b.classList.toggle('outline', b !== btn);
      }
      render();
    });
  }
  const first = $$('[data-pkgfilter]')[0];
  first.classList.add('primary');
  first.classList.remove('outline');

  window.pc.packages.onEvent(onPipEvent);
}

let loadedOnce = false;

export async function activate() {
  if (!loadedOnce) { loadedOnce = true; await refresh(); }
}

/* ------------------------------------------------------------ datos */

export async function refresh(force) {
  listEl.innerHTML = '<div class="empty-note"><span class="spinner" style="display:inline-block;vertical-align:-2px"></span> Consultando pip…</div>';
  const res = await window.pc.packages.list();
  installed = new Map();
  if (res.ok) {
    for (const p of res.items) installed.set(norm(p.name), p);
  } else {
    listEl.innerHTML = '<div class="empty-note">' + (res.error || 'No se pudo consultar pip.') + '</div>';
    return;
  }
  if (force || !outdated.size) refreshOutdated();
  if (searchEl.value.trim()) await search(searchEl.value);
  else await search('');
  if (hooks.onInstalledChange) hooks.onInstalledChange(installed);
}

async function refreshOutdated() {
  try {
    const res = await window.pc.packages.outdated();
    outdated = new Map();
    if (res.ok) for (const p of res.items) outdated.set(norm(p.name), p);
    markUpdatesBadge();
    render();
  } catch (err) { /* sin conexion: no pasa nada */ }
}

function markUpdatesBadge() {
  const btn = document.querySelector('.act-btn[data-view="packages"]');
  if (btn) btn.classList.toggle('has-alert', outdated.size > 0);
}

function norm(n) { return String(n || '').toLowerCase().replace(/_/g, '-'); }

export async function search(query) {
  const res = await window.pc.packages.search(query || '');
  items = res.ok ? res.items : [];
  render();
}

/* ---------------------------------------------------------- pintado */

function render() {
  clear(listEl);

  let rows = [];
  if (filter === 'installed') {
    rows = Array.from(installed.values()).map((p) => ({
      name: p.name,
      summary: p.summary || '',
      installedVersion: p.version,
      source: 'instalado'
    }));
    const q = norm(searchEl.value.trim());
    if (q) rows = rows.filter((r) => norm(r.name).includes(q));
  } else if (filter === 'updates') {
    rows = Array.from(outdated.values()).map((p) => ({
      name: p.name,
      summary: 'Actualización disponible: ' + p.version + ' → ' + p.latest,
      installedVersion: p.version,
      latest: p.latest,
      source: 'actualizable'
    }));
  } else {
    rows = items.map((it) => Object.assign({}, it, {
      installedVersion: it.installedVersion || (installed.get(norm(it.name)) || {}).version || null
    }));
  }

  if (!rows.length) {
    listEl.append(el('div', { class: 'empty-note' },
      filter === 'updates' ? 'Todo está actualizado.' :
        (searchEl.value.trim() ? 'No se encontró "' + searchEl.value.trim() + '". Comprueba el nombre o tu conexión.'
          : 'No hay paquetes para mostrar.')
    ));
    return;
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, 'es'));

  for (const row of rows) {
    const key = norm(row.name);
    const inst = row.installedVersion || (installed.get(key) || {}).version || null;
    const upd = outdated.get(key);

    const card = el('div', {
      class: 'pkg-card' + (selectedName === row.name ? ' selected' : ''),
      onclick: () => showDetail(row.name)
    },
      el('div', { class: 'pk-top' },
        el('span', { class: 'pk-name' }, row.name),
        inst ? el('span', { class: 'chip ok' }, 'v' + inst) : null,
        upd ? el('span', { class: 'chip warn' }, '→ ' + upd.latest) : null,
        !inst && row.source === 'pypi' ? el('span', { class: 'chip accent' }, 'PyPI') : null
      ),
      row.summary ? el('div', { class: 'pk-sum' }, row.summary) : null,
      el('div', { class: 'pk-actions' },
        !inst ? el('button', {
          class: 'btn sm primary',
          disabled: !!busyOp,
          onclick: (e) => { e.stopPropagation(); install(row.name); }
        }, 'Instalar') : null,
        upd ? el('button', {
          class: 'btn sm outline',
          disabled: !!busyOp,
          onclick: (e) => { e.stopPropagation(); upgrade(row.name); }
        }, 'Actualizar') : null,
        inst ? el('button', {
          class: 'btn sm outline',
          disabled: !!busyOp,
          onclick: (e) => { e.stopPropagation(); uninstall(row.name); }
        }, 'Desinstalar') : null
      )
    );
    listEl.append(card);
  }
}

async function showDetail(name) {
  selectedName = name;
  render();
  detailEl.hidden = false;
  clear(detailEl);
  detailEl.append(el('div', null, el('span', { class: 'spinner', style: { display: 'inline-block', verticalAlign: '-2px' } }), ' Cargando información…'));

  const info = await window.pc.packages.info(name);
  clear(detailEl);
  if (!info.ok) {
    detailEl.append(el('div', { class: 'empty-note' }, info.error));
    return;
  }

  const dl = el('dl', { class: 'kv' });
  const add = (k, v) => { if (v) { dl.append(el('dt', null, k)); dl.append(el('dd', null, v)); } };
  add('Instalada', info.installedVersion || 'no instalada');
  add('Última', info.latestVersion || (info.offline ? 'sin conexión' : '—'));
  add('Autor', info.author);
  add('Licencia', info.license);
  add('Requiere', info.requiresPython);
  if (info.requires && info.requires.length) add('Depende de', info.requires.join(', '));
  add('Ubicación', info.location);

  detailEl.append(
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } },
      el('h4', { style: { flex: '1' } }, info.name),
      el('button', { class: 'icon-btn', title: 'Cerrar', onclick: () => { detailEl.hidden = true; selectedName = null; render(); } }, icon('close', 13))
    ),
    info.summary ? el('p', { style: { color: 'var(--text-muted)', marginBottom: '8px' } }, info.summary) : null,
    dl,
    info.homepage ? el('p', { style: { marginTop: '8px' } },
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); window.pc.app.openExternal(info.homepage); } }, info.homepage)
    ) : null,
    el('div', { style: { display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' } },
      !info.installedVersion ? el('button', { class: 'btn sm primary', disabled: !!busyOp, onclick: () => install(info.name) }, 'Instalar') : null,
      info.installedVersion && info.latestVersion && info.installedVersion !== info.latestVersion
        ? el('button', { class: 'btn sm primary', disabled: !!busyOp, onclick: () => upgrade(info.name) }, 'Actualizar a ' + info.latestVersion) : null,
      info.installedVersion ? el('button', { class: 'btn sm outline', disabled: !!busyOp, onclick: () => uninstall(info.name) }, 'Desinstalar') : null,
      el('button', { class: 'btn sm outline', onclick: () => insertImport(info.name) }, 'Insertar import')
    ),
    info.offline ? el('p', { style: { marginTop: '8px', color: 'var(--warn)' } },
      'Sin conexión: solo se muestra la información local. Instalar una librería nueva requiere Internet.') : null,
    el('div', { class: 'pip-log', id: 'pip-log', hidden: !logBuffer }, logBuffer)
  );
}

function insertImport(name) {
  const mod = String(name).replace(/-/g, '_').toLowerCase();
  if (hooks.insertText) hooks.insertText('import ' + mod + '\n');
}

/* --------------------------------------------------------- operaciones */

async function install(name) {
  logBuffer = '';
  const res = await window.pc.packages.install(name);
  handleStart(res, 'Instalando ' + name);
}

async function upgrade(name) {
  logBuffer = '';
  const res = await window.pc.packages.upgrade(name);
  handleStart(res, 'Actualizando ' + name);
}

async function uninstall(name) {
  const ok = await confirmDialog('¿Desinstalar "' + name + '" del runtime de Python Classroom?', {
    title: 'Desinstalar librería', okLabel: 'Desinstalar', danger: true
  });
  if (!ok) return;
  logBuffer = '';
  const res = await window.pc.packages.uninstall(name);
  handleStart(res, 'Desinstalando ' + name);
}

function handleStart(res, label) {
  if (!res || !res.ok) {
    toast((res && res.error) || 'No se pudo iniciar la operación', { title: 'pip', type: 'err' });
    return;
  }
  busyOp = label;
  render();
  showProgress(label);
}

let progressToast = null;

function showProgress(label) {
  if (progressToast) progressToast();
  progressToast = toast(label + '…  (puede tardar según tu conexión)', { title: 'pip', type: 'info', timeout: 0 });
}

function onPipEvent(ev) {
  if (!ev) return;
  if (ev.type === 'start') {
    logBuffer = '$ ' + ev.command + '\n';
    paintLog();
    return;
  }
  if (ev.type === 'log') {
    logBuffer += ev.data;
    if (logBuffer.length > 40000) logBuffer = logBuffer.slice(-30000);
    paintLog();
    return;
  }
  if (ev.type === 'done') {
    busyOp = null;
    if (progressToast) { progressToast(); progressToast = null; }
    if (ev.ok) {
      toast('Operación completada (' + ev.op + ' ' + ev.name + ')', { title: 'pip', type: 'ok' });
    } else {
      toast('pip terminó con código ' + ev.code + '. Revisa el registro.', { title: 'pip', type: 'err', timeout: 8000 });
    }
    refresh(true).then(() => { if (selectedName) showDetail(selectedName); });
    if (hooks.onInstalledChange) hooks.onInstalledChange(installed);
  }
}

function paintLog() {
  const node = $('#pip-log');
  if (!node) return;
  node.hidden = false;
  node.textContent = logBuffer;
  node.scrollTop = node.scrollHeight;
}

/** Vacia el estado al cambiar de usuario (la lista se recarga al entrar). */
export function reset() {
  loadedOnce = false;
  installed = new Map();
  outdated = new Map();
  items = [];
  selectedName = null;
  logBuffer = '';
  if (listEl) listEl.innerHTML = '';
  if (detailEl) detailEl.hidden = true;
  if (searchEl) searchEl.value = '';
}

export function installedList() { return installed; }
