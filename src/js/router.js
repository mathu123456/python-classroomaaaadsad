/*
 * Enrutador de paginas.
 *
 * La aplicacion tiene dos modos de trabajo:
 *   - IDE      : barra lateral + editor + panel (lo de las fases 1 y 2)
 *   - Paginas  : Inicio, Ejercicios, Proyectos, Curso (fase 3), que ocupan
 *                todo el area de trabajo manteniendo la barra de actividad.
 *
 * Este modulo se encarga de alternar entre ambos y de volver a pintar la
 * pagina activa cuando cambian los datos.
 */

import { $, $$, clear } from './ui.js';

const paginas = new Map();
let host = null;
let actual = null;
let hooks = {};

export function init(appHooks) {
  hooks = appHooks || {};
  host = $('#page-host');
}

/** Registra una pagina: render(container) puede ser asincrono. */
export function register(nombre, render) {
  paginas.set(nombre, render);
}

export function current() { return actual; }
export function enPagina() { return actual !== null; }

function marcarBotones() {
  for (const btn of $$('.act-btn[data-page]')) {
    btn.classList.toggle('active', btn.dataset.page === actual);
  }
  if (actual) {
    for (const btn of $$('.act-btn[data-view]')) btn.classList.remove('active');
  }
}

/** Muestra una pagina a pantalla completa. */
export async function show(nombre) {
  const render = paginas.get(nombre);
  if (!render) return false;

  actual = nombre;
  $('#sidebar').style.display = 'none';
  $('#sidebar-resizer').style.display = 'none';
  document.querySelector('.main').style.display = 'none';
  host.hidden = false;
  marcarBotones();

  clear(host);
  host.scrollTop = 0;
  try {
    await render(host);
  } catch (err) {
    clear(host).append(Object.assign(document.createElement('div'), {
      className: 'page',
      textContent: 'No se pudo cargar la página: ' + (err && err.message ? err.message : err)
    }));
  }
  if (hooks.onShow) hooks.onShow(nombre);
  return true;
}

/** Vuelve al entorno de programacion. */
export function showIDE(vistaLateral) {
  actual = null;
  host.hidden = true;
  clear(host);
  $('#sidebar').style.display = '';
  $('#sidebar-resizer').style.display = '';
  document.querySelector('.main').style.display = '';
  marcarBotones();
  if (hooks.onIDE) hooks.onIDE(vistaLateral);
}

/** Vuelve a pintar la pagina activa (tras un cambio de datos). */
export async function refresh() {
  if (!actual) return;
  const nombre = actual;
  const render = paginas.get(nombre);
  if (!render) return;
  const scroll = host.scrollTop;
  clear(host);
  await render(host);
  host.scrollTop = scroll;
}
