/* Python Classroom - utilidades de interfaz (DOM, avisos, dialogos, menus) */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Crea un elemento: el('div', {class:'x', onclick:fn}, 'texto', otroNodo) */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') node.innerHTML = v;
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** <svg><use href="#i-name"></svg> */
export function icon(name, size = 15) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* ------------------------------------------------------------- avisos */

let toastSeq = 0;

export function toast(message, options = {}) {
  const root = $('#toast-root');
  if (!root) return () => {};
  const { title = '', type = 'info', timeout = 4200 } = options;
  const id = ++toastSeq;
  const node = el('div', { class: 'toast ' + (type === 'info' ? '' : type), dataset: { id } },
    icon(type === 'ok' ? 'check' : type === 'err' ? 'alert' : type === 'warn' ? 'alert' : 'info', 15),
    el('div', { class: 't-body' },
      title ? el('b', null, title) : null,
      el('span', null, message)
    ),
    el('button', { class: 'icon-btn', style: { width: '20px', height: '20px' }, onclick: () => node.remove() }, icon('close', 12))
  );
  root.append(node);
  const close = () => node.remove();
  if (timeout > 0) setTimeout(close, timeout);
  return close;
}

/* ------------------------------------------------------------ dialogos */

function closeModal(backdrop, resolve, value) {
  backdrop.remove();
  document.removeEventListener('keydown', backdrop._onKey, true);
  resolve(value);
}

/**
 * modal({ title, body: Node|string, buttons:[{label, value, variant, primary}], width })
 * Devuelve una promesa con el valor del boton pulsado (null si se cancela).
 */
export function modal(options = {}) {
  return new Promise((resolve) => {
    const { title = '', body = '', buttons = [{ label: 'Cerrar', value: null }], wide = false } = options;
    const bodyNode = body instanceof Node ? body : el('div', { html: String(body) });

    const box = el('div', { class: 'modal' + (wide ? ' wide' : '') },
      el('div', { class: 'modal-head' },
        el('h3', null, title),
        el('button', { class: 'icon-btn', onclick: () => closeModal(backdrop, resolve, null) }, icon('close', 14))
      ),
      el('div', { class: 'modal-body' }, bodyNode),
      el('div', { class: 'modal-foot' },
        buttons.map((b) => el('button', {
          class: 'btn ' + (b.variant || (b.primary ? 'primary' : 'outline')),
          onclick: () => closeModal(backdrop, resolve, b.value)
        }, b.label))
      )
    );

    const backdrop = el('div', {
      class: 'modal-backdrop',
      onmousedown: (e) => { if (e.target === backdrop && options.dismissible !== false) closeModal(backdrop, resolve, null); }
    }, box);

    backdrop._onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeModal(backdrop, resolve, null); }
    };
    document.addEventListener('keydown', backdrop._onKey, true);
    $('#modal-root').append(backdrop);

    const focusable = box.querySelector('input, textarea, .btn.primary, button');
    if (focusable) setTimeout(() => focusable.focus(), 30);
  });
}

export function confirmDialog(message, options = {}) {
  return modal({
    title: options.title || 'Confirmar',
    body: el('p', null, message),
    buttons: [
      { label: options.cancelLabel || 'Cancelar', value: false },
      { label: options.okLabel || 'Aceptar', value: true, variant: options.danger ? 'danger' : 'primary' }
    ]
  }).then((v) => v === true);
}

/** Pide un texto. Devuelve la cadena o null. */
export function promptDialog(options = {}) {
  const input = el('input', {
    class: 'input',
    value: options.value || '',
    placeholder: options.placeholder || '',
    spellcheck: 'false'
  });
  const body = el('div', null,
    options.label ? el('p', null, options.label) : null,
    input
  );
  const p = modal({
    title: options.title || 'Introduce un valor',
    body,
    buttons: [
      { label: 'Cancelar', value: null },
      { label: options.okLabel || 'Aceptar', value: '__ok__', primary: true }
    ]
  }).then((v) => (v === '__ok__' ? input.value.trim() || null : null));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const btn = input.closest('.modal').querySelector('.modal-foot .btn.primary');
      if (btn) btn.click();
    }
  });
  setTimeout(() => { input.focus(); input.select(); }, 40);
  return p;
}

/* ------------------------------------------------------ menu contextual */

let openMenu = null;

export function closeContextMenu() {
  if (openMenu) { openMenu.remove(); openMenu = null; }
}

/** items: [{label, icon, key, disabled, action}] o 'divider' */
export function contextMenu(x, y, items) {
  closeContextMenu();
  const menu = el('div', { class: 'ctx-menu' });
  for (const item of items) {
    if (item === 'divider' || item === '-') { menu.append(el('div', { class: 'divider' })); continue; }
    menu.append(el('button', {
      disabled: !!item.disabled,
      onclick: () => { closeContextMenu(); if (item.action) item.action(); }
    },
      item.icon ? icon(item.icon, 14) : el('span', { style: { width: '14px' } }),
      el('span', null, item.label),
      item.key ? el('span', { class: 'k' }, item.key) : null
    ));
  }
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 8);
  const py = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = Math.max(4, px) + 'px';
  menu.style.top = Math.max(4, py) + 'px';
  openMenu = menu;

  const dismiss = (ev) => {
    if (openMenu && !openMenu.contains(ev.target)) {
      closeContextMenu();
      document.removeEventListener('mousedown', dismiss, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
  return menu;
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu(); });
window.addEventListener('blur', closeContextMenu);

/* ------------------------------------------------------------ formatos */

export function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

export function formatDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return ms + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(2) + ' s';
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return m + ' min ' + s + ' s';
}

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
  wrapped.cancel = () => { if (t) { clearTimeout(t); t = null; } };
  wrapped.flush = (...args) => { if (t) { clearTimeout(t); t = null; } fn(...args); };
  return wrapped;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Convierte una ruta larga en algo legible para la barra de estado. */
export function shortPath(p, max = 48) {
  if (!p) return '';
  const norm = String(p).replace(/\\/g, '/');
  if (norm.length <= max) return p;
  const parts = norm.split('/');
  return '…/' + parts.slice(-2).join('/');
}

/** Arrastre generico para los separadores redimensionables. */
export function makeResizer(handle, onMove, options = {}) {
  const axis = options.axis || 'x';
  let dragging = false;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add('dragging');
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    onMove(axis === 'x' ? e.clientX : e.clientY, e);
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (options.onEnd) options.onEnd();
  });
}
