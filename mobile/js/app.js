/*
 * Python Classroom móvil — arranque y navegación.
 *
 * Es la misma aplicación, no otra: mismos estilos, misma base de datos y las
 * mismas reglas de seguridad. Lo que cambia es de dónde salen los datos (aquí
 * Firebase directo, sin SQLite) y cómo se ejecuta Python (Pyodide en el propio
 * navegador, ver js/python.js).
 *
 * Alcance de esta versión: la parte del ESTUDIANTE. Un profesor puede entrar y
 * ver lo suyo, pero calificar sigue siendo cosa de la aplicación de escritorio;
 * la pantalla se lo dice en vez de fingir que puede.
 */

import { el, clear, toast, modal, confirmDialog } from '../../src/js/ui.js';
import * as fb from './fb.js';
import * as data from './data.js';
import * as pantallas from './pantallas.js';
import { pantallaAcceso } from './acceso.js';

const estado = {
  usuario: null,        // { uid, nombre, correo, rol, ... }
  pestana: 'ejercicios',
  detalle: null         // { titulo, volverA } cuando se abre un ejercicio
};

/* ------------------------------------------------------------- utilidades */

const $ = (sel) => document.querySelector(sel);

function splash(texto) {
  const s = $('#m-splash');
  if (!s) return;
  s.hidden = false;
  const t = $('#m-splash-texto');
  if (t && texto) t.textContent = texto;
}

function quitarSplash() {
  const s = $('#m-splash');
  if (s) s.hidden = true;
}

function cabecera(titulo, sub, conVolver) {
  $('#m-title').textContent = titulo;
  $('#m-sub').textContent = sub || '';
  $('#m-back').hidden = !conVolver;
}

/* ---------------------------------------------------------------- render */

const VISTAS = {
  ejercicios: { titulo: 'Ejercicios', render: pantallas.ejercicios },
  entregas: { titulo: 'Mis entregas', render: pantallas.entregas },
  ranking: { titulo: 'Ranking', render: pantallas.ranking },
  insignias: { titulo: 'Insignias', render: pantallas.insignias },
  yo: { titulo: 'Mi cuenta', render: pantallas.yo }
};

/** Pinta la pestaña activa. Cada pantalla recibe el contexto y los hooks. */
export async function pintar() {
  /*
   * Sin sesion no hay nada que pintar: cualquier pantalla necesita el uid. Si se
   * llega aqui -por un aviso de conexion, por el boton de recargar o porque la
   * sesion caduco- se vuelve al acceso en vez de reventar.
   */
  if (!estado.usuario) { mostrarAcceso(null); return; }

  const vista = VISTAS[estado.pestana] || VISTAS.ejercicios;
  const host = $('#m-body');
  cabecera(vista.titulo, estado.usuario ? estado.usuario.correo : '', false);
  for (const b of document.querySelectorAll('.m-tabs button')) {
    b.classList.toggle('active', b.dataset.tab === estado.pestana);
  }

  const contenedor = el('div', { class: 'm-seccion' });
  contenedor.append(el('div', { class: 'm-vacio' }, 'Cargando…'));
  clear(host).append(contenedor);
  host.scrollTop = 0;

  try {
    const nodo = await vista.render(ctx());
    clear(host).append(nodo);
  } catch (err) {
    clear(host).append(el('div', { class: 'm-aviso' },
      el('div', null, 'No se pudo cargar: ' + (err && err.message ? err.message : err))));
  }
}

/** Abre un ejercicio a pantalla completa (sale de las pestañas). */
export async function abrirEjercicio(ejercicio) {
  const host = $('#m-body');
  cabecera(ejercicio.title || 'Ejercicio', 'Resolver y entregar', true);
  clear(host).append(el('div', { class: 'm-vacio' }, 'Abriendo…'));
  estado.detalle = { tipo: 'ejercicio', id: ejercicio.id };
  try {
    const nodo = await pantallas.resolver(ctx(), ejercicio);
    clear(host).append(nodo);
    host.scrollTop = 0;
  } catch (err) {
    clear(host).append(el('div', { class: 'm-aviso' },
      el('div', null, 'No se pudo abrir: ' + (err && err.message ? err.message : err))));
  }
}

/** Ficha de una entrega ya calificada. */
export async function abrirEntrega(entrega) {
  const host = $('#m-body');
  cabecera('Resultado', entrega.exerciseTitle || '', true);
  estado.detalle = { tipo: 'entrega', id: entrega.id };
  const nodo = await pantallas.resultado(ctx(), entrega);
  clear(host).append(nodo);
  host.scrollTop = 0;
}

function volver() {
  estado.detalle = null;
  pintar();
}

/** Contexto que reciben las pantallas: datos, usuario y navegación. */
function ctx() {
  return {
    usuario: estado.usuario,
    data: data,
    fb: fb,
    abrirEjercicio: abrirEjercicio,
    abrirEntrega: abrirEntrega,
    volver: volver,
    refrescar: pintar,
    irA: (pestana) => { estado.pestana = pestana; estado.detalle = null; pintar(); },
    toast: toast,
    modal: modal,
    confirmar: confirmDialog
  };
}

/* ------------------------------------------------------------- sesión */

async function entrarEnLaApp(user) {
  splash('Cargando tu curso…');
  try {
    estado.usuario = await data.miPerfil(user.uid);
  } catch (err) {
    // Sin conexión y sin copia: se entra con lo mínimo, y se dice.
    estado.usuario = { uid: user.uid, correo: user.email || '', nombre: user.email || '', rol: 'estudiante' };
    toast('Sin conexión: se muestra lo último que quedó guardado.', { type: 'warn', timeout: 6000 });
  }
  $('#m-auth').hidden = true;
  $('#m-app').hidden = false;
  quitarSplash();
  await pintar();
}

function mostrarAcceso(mensaje) {
  $('#m-app').hidden = true;
  quitarSplash();
  const cont = $('#m-auth');
  cont.hidden = false;
  pantallaAcceso($('#m-auth-card'), {
    fb: fb,
    data: data,
    mensaje: mensaje,
    onEntrar: (user) => entrarEnLaApp(user)
  });
}

export async function salir() {
  const ok = await confirmDialog('¿Cerrar la sesión en este teléfono?',
    { title: 'Salir', okLabel: 'Salir' });
  if (!ok) return;
  try { await fb.salir(); } catch (err) { /* igual se sale */ }
  estado.usuario = null;
  mostrarAcceso(null);
}

/* -------------------------------------------------------------- arranque */

async function arrancar() {
  splash('Conectando con Firebase…');

  const iniciado = fb.init();
  if (!iniciado.ok) {
    quitarSplash();
    $('#m-auth').hidden = false;
    clear($('#m-auth-card')).append(
      el('h2', null, 'No se pudo iniciar'),
      el('p', { class: 'sub' }, iniciado.error),
      el('div', { class: 'm-aviso' },
        el('div', null, 'Revisa la conexión y vuelve a abrir la aplicación.')));
    return;
  }

  /* --- interfaz --- */
  for (const b of document.querySelectorAll('.m-tabs button')) {
    b.addEventListener('click', () => {
      estado.pestana = b.dataset.tab;
      estado.detalle = null;
      pintar();
    });
  }
  $('#m-back').addEventListener('click', volver);
  $('#m-refresh').addEventListener('click', () => { if (estado.usuario) pintar(); });

  window.addEventListener('online', () => {
    toast('Conexión recuperada', { type: 'ok' });
    if (estado.usuario) pintar();
  });
  window.addEventListener('offline', () => {
    toast('Sin conexión: se muestra lo guardado en el teléfono.', { type: 'warn', timeout: 5000 });
  });

  /* --- ¿hay sesión guardada? --- */
  splash('Comprobando tu sesión…');
  const user = await fb.primerEstado(9000);
  if (user) await entrarEnLaApp(user);
  else mostrarAcceso(null);

  // La sesión puede caducar o cerrarse desde otro sitio.
  fb.onAuth((u) => {
    if (!u && estado.usuario) {
      estado.usuario = null;
      mostrarAcceso('Tu sesión se cerró. Vuelve a entrar.');
    }
  });

  /* --- instalable: el servicio en segundo plano guarda la app --- */
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (err) {
      console.warn('[movil] no se pudo registrar el service worker:', err);
    }
  }
}

arrancar().catch((err) => {
  quitarSplash();
  document.body.innerHTML = '<div style="padding:24px;font-family:system-ui;color:#ff6b6b">' +
    '<h2>Python Classroom no pudo iniciar</h2><pre style="white-space:pre-wrap">' +
    String((err && err.stack) || err) + '</pre></div>';
});

// Para depurar desde el teléfono con el inspector conectado.
window.__pcMovil = { estado, pintar, ctx, salir };
