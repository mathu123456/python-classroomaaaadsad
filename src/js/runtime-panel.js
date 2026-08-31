/*
 * Panel del runtime de Python: que interprete se esta usando, donde vive y
 * como reinstalarlo o repararlo sin salir de la aplicacion.
 */

import { $, el, icon, clear, toast, confirmDialog } from './ui.js';

let bodyEl = null;
let info = null;
let installing = false;
let logText = '';
let hooks = {};

export function init(appHooks) {
  hooks = appHooks || {};
  bodyEl = $('#runtime-body');
  $('#rt-refresh').addEventListener('click', () => load(true));

  $('#runtime-banner-fix').addEventListener('click', () => {
    document.querySelector('.act-btn[data-view="python"]').click();
    setup({ force: false });
  });
  $('#runtime-banner-hide').addEventListener('click', () => {
    $('#runtime-banner').classList.remove('show');
  });

  window.pc.runtime.onEvent(onEvent);
}

export function current() { return info; }

export async function load(force) {
  info = await window.pc.python.runtime(!!force);
  render();
  updateStatusBar();
  updateBanner();
  if (hooks.onRuntime) hooks.onRuntime(info);
  return info;
}

function updateStatusBar() {
  const btn = $('#sb-python');
  if (!btn) return;
  clear(btn);
  const dot = el('span', { class: 'sb-dot' });
  btn.append(dot);
  if (info && info.ok) {
    btn.append(document.createTextNode(' Python ' + info.version + (info.embedded ? '' : ' (sistema)')));
    btn.className = 'sb-item ' + (info.embedded ? 'ok' : 'warn');
    btn.title = info.executable;
  } else {
    btn.append(document.createTextNode(' Python no disponible'));
    btn.className = 'sb-item error';
    btn.title = (info && info.error) || '';
  }
}

function updateBanner() {
  const banner = $('#runtime-banner');
  const text = $('#runtime-banner-text');
  if (!banner) return;
  if (!info || !info.ok) {
    text.textContent = (info && info.error) || 'No se encontró ningún intérprete de Python.';
    banner.classList.add('show');
  } else if (!info.embedded) {
    text.textContent = 'Se está usando el Python del sistema (' + info.version + '). ' +
      'Instala el runtime interno para que la app funcione igual en cualquier equipo.';
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }
  const act = document.querySelector('.act-btn[data-view="python"]');
  if (act) act.classList.toggle('has-alert', !info || !info.ok || !info.embedded);
}

/* -------------------------------------------------------------- pintado */

function render() {
  if (!bodyEl) return;
  clear(bodyEl);

  if (!info) {
    bodyEl.append(el('div', { class: 'empty-note' }, 'Detectando intérprete…'));
    return;
  }

  const state = info.ok
    ? (info.embedded
      ? el('span', { class: 'chip ok' }, 'Runtime interno')
      : el('span', { class: 'chip warn' }, 'Python del sistema'))
    : el('span', { class: 'chip err' }, 'No disponible');

  const dl = el('dl', { class: 'info-grid' });
  const add = (k, v) => { if (v) { dl.append(el('dt', null, k)); dl.append(el('dd', null, String(v))); } };
  add('Versión', info.version || '—');
  add('Ejecutable', info.executable || '—');
  add('Carpeta', info.home || '—');
  add('Plataforma', info.platform || '');

  bodyEl.append(
    el('div', { style: { padding: '12px 12px 6px', display: 'flex', alignItems: 'center', gap: '8px' } },
      icon('py', 20), el('b', { style: { fontSize: '13px' } }, 'Intérprete activo'),
      el('span', { style: { flex: '1' } }), state
    ),
    dl
  );

  if (!info.ok || !info.embedded) {
    bodyEl.append(el('div', { class: 'explorer-empty' },
      el('p', null, info.ok
        ? 'Python Classroom puede instalar su propio Python para no depender del que tenga cada computador.'
        : 'Necesitas instalar el runtime de Python para poder ejecutar código.'),
      el('p', { style: { color: 'var(--warn)' } }, 'La instalación descarga unos 12 MB y requiere Internet una sola vez.')
    ));
  }

  bodyEl.append(
    el('div', { class: 'side-section-title' }, 'Mantenimiento'),
    el('div', { style: { padding: '0 12px', display: 'grid', gap: '6px' } },
      el('button', {
        class: 'btn ' + (info.ok && info.embedded ? 'outline' : 'primary') + ' block',
        disabled: installing,
        onclick: () => setup({ force: false })
      }, info.ok && info.embedded ? 'Verificar / reparar runtime' : 'Instalar runtime de Python'),
      el('button', {
        class: 'btn outline block',
        disabled: installing,
        onclick: () => setup({ full: true })
      }, 'Instalar paquetes educativos (numpy, pandas, matplotlib)'),
      el('button', {
        class: 'btn outline block',
        disabled: installing,
        onclick: async () => {
          const ok = await confirmDialog(
            'Se borrará la carpeta del runtime y se descargará de nuevo. Los paquetes instalados se perderán. ¿Continuar?',
            { title: 'Reinstalar desde cero', okLabel: 'Reinstalar', danger: true });
          if (ok) setup({ force: true });
        }
      }, 'Reinstalar desde cero'),
      installing ? el('button', { class: 'btn danger block', onclick: () => window.pc.runtime.cancelSetup() }, 'Cancelar') : null
    ),
    installing ? el('div', { class: 'progressbar', style: { margin: '10px 12px 0' } }) : null,
    el('div', { style: { padding: '10px 12px' } },
      el('div', { class: 'pip-log', id: 'runtime-log', hidden: !logText }, logText)
    )
  );

  const logNode = $('#runtime-log');
  if (logNode) logNode.scrollTop = logNode.scrollHeight;
}

/* ------------------------------------------------------------ instalar */

async function setup(options) {
  if (installing) return;
  logText = '';
  const res = await window.pc.runtime.setup(options);
  if (!res || !res.ok) {
    toast((res && res.error) || 'No se pudo iniciar la instalación', { title: 'Runtime', type: 'err' });
    return;
  }
  installing = true;
  render();
  toast('Preparando el runtime de Python…', { title: 'Runtime', type: 'info', timeout: 5000 });
}

function onEvent(ev) {
  if (!ev) return;
  if (ev.type === 'start') { logText = ''; installing = true; render(); return; }
  if (ev.type === 'log') {
    logText += ev.data;
    if (logText.length > 60000) logText = logText.slice(-40000);
    const node = $('#runtime-log');
    if (node) { node.hidden = false; node.textContent = logText; node.scrollTop = node.scrollHeight; }
    return;
  }
  if (ev.type === 'done') {
    installing = false;
    load(true);
    if (ev.ok) toast('Runtime de Python listo', { title: 'Runtime', type: 'ok' });
    else toast('La instalación terminó con código ' + ev.code + '. Revisa el registro.', { title: 'Runtime', type: 'err', timeout: 9000 });
  }
}
