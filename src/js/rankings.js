/*
 * Pagina de Rankings (fase 4).
 *
 * El ranking no se calcula aqui: lo calcula el cliente del profesor
 * (work.buildRankings) y lo publica en el nodo rankings/ de Firebase. Cada
 * estudiante lee esa copia, que queda guardada en SQLite para poder verla sin
 * conexion con la fecha de la ultima descarga.
 *
 * No hay ninguna escucha permanente sobre rankings/: se lee al entrar en la
 * pagina y cuando cambia la senal ligera config/lastChange (lo hace sync.js).
 */

import { el, icon, clear, toast, modal } from './ui.js';
import { formatoFecha } from './dashboard.js';
import { avatar } from './avatar.js';

let hooks = {};
let pestana = 'general';
let temaActivo = '';
let gradoActivo = '';

export function init(appHooks) { hooks = appHooks || {}; }

const MEDALLAS = ['🥇', '🥈', '🥉'];

/** "Actualizado hace 2 horas" a partir de una fecha ISO. */
export function haceCuanto(iso) {
  if (!iso) return 'sin fecha';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 'sin fecha';
  const seg = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seg < 90) return 'hace ' + seg + ' segundos';
  const min = Math.round(seg / 60);
  if (min < 90) return 'hace ' + min + ' minuto(s)';
  const h = Math.round(min / 60);
  if (h < 36) return 'hace ' + h + ' hora(s)';
  return 'hace ' + Math.round(h / 24) + ' día(s)';
}

function posicion(n) {
  return n >= 1 && n <= 3 ? MEDALLAS[n - 1] : String(n);
}

/** Una fila del ranking. `mia` la resalta. */
function fila(entrada, opciones) {
  const o = opciones || {};
  return el('div', { class: 'rk-row' + (o.mia ? ' mia' : '') },
    el('div', { class: 'rk-pos' }, posicion(entrada.position)),
    avatar({ nombreCompleto: entrada.name, color: entrada.color, foto: entrada.foto }, 30, { clase: 'av' }),
    el('div', { class: 'rk-main' },
      el('b', null, entrada.name || 'Sin nombre'),
      el('span', null,
        [entrada.grade ? 'grado ' + entrada.grade : null,
          entrada.completed != null ? entrada.completed + ' ejercicio(s)' : null,
          entrada.badges ? entrada.badges + ' insignia(s)' : null].filter(Boolean).join('  ·  ') || '—')),
    entrada.average != null ? el('span', { class: 'chip' }, 'prom. ' + entrada.average) : null,
    el('div', { class: 'rk-xp' }, (entrada.xp || 0) + ' XP'));
}

function listaVacia(texto) {
  return el('div', { class: 'empty-page' }, icon('chart', 30), el('b', null, texto));
}

/* -------------------------------------------------------------- general */

function pintarGeneral(host, datos, usuario) {
  clear(host);
  if (!datos.global.length) {
    host.append(listaVacia('Todavía no hay nadie con XP en el ranking'));
    return;
  }

  const card = el('div', { class: 'card rk-lista' });
  for (const e of datos.global) card.append(fila(e, { mia: e.uid === usuario.uid }));
  host.append(card);

  // El estudiante ve siempre su posicion, aunque el profesor limite la lista.
  if (datos.yo && datos.yoFueraDeLista) {
    host.append(el('div', { class: 'rk-sep' }, 'TU POSICIÓN'));
    host.append(el('div', { class: 'card rk-lista' }, fila(datos.yo, { mia: true })));
    if (datos.yoSinClasificar) {
      host.append(el('div', { class: 'form-note' },
        'Tu posición es provisional: se calcula con los datos de este equipo y quedará fija ' +
        'cuando tu profesor vuelva a publicar el ranking.'));
    }
  }
}

/* -------------------------------------------------------------- por tema */

function pintarPorTema(host, datos, usuario) {
  clear(host);
  const temas = Object.entries(datos.topics || {});
  if (!temas.length) {
    host.append(listaVacia('Ningún tema tiene todavía XP repartido'));
    return;
  }
  if (!temaActivo || !datos.topics[temaActivo]) temaActivo = temas[0][0];

  const barra = el('div', { class: 'filtro-barra' });
  for (const [id, t] of temas) {
    barra.append(el('button', {
      class: 'btn sm ' + (temaActivo === id ? 'primary' : 'outline'),
      onclick: () => { temaActivo = id; pintarPorTema(host, datos, usuario); }
    }, t.name));
  }
  host.append(barra);

  const t = datos.topics[temaActivo];
  const limite = usuario.rol === 'profesor' ? 0 : datos.limitePuestos;
  const entradas = limite > 0 ? t.entries.slice(0, limite) : t.entries;
  const card = el('div', { class: 'card rk-lista' });
  for (const e of entradas) card.append(fila(e, { mia: e.uid === usuario.uid }));
  host.append(card);

  const mia = t.entries.find((e) => e.uid === usuario.uid);
  if (mia && entradas.indexOf(mia) === -1) {
    host.append(el('div', { class: 'rk-sep' }, 'TU POSICIÓN'));
    host.append(el('div', { class: 'card rk-lista' }, fila(mia, { mia: true })));
  }
}

/* ------------------------------------------------------------- por grado */

function pintarPorGrado(host, datos, usuario) {
  clear(host);
  const grados = Object.entries(datos.grades || {}).filter(([, lista]) => lista && lista.length);
  if (!grados.length) {
    host.append(listaVacia('Todavía no hay grados con estudiantes'));
    return;
  }
  if (!gradoActivo || !datos.grades[gradoActivo]) gradoActivo = grados[0][0];

  const barra = el('div', { class: 'filtro-barra' });
  for (const [g] of grados) {
    barra.append(el('button', {
      class: 'btn sm ' + (gradoActivo === g ? 'primary' : 'outline'),
      onclick: () => { gradoActivo = g; pintarPorGrado(host, datos, usuario); }
    }, g === 'sin-grado' ? 'Sin grado' : 'Grado ' + g));
  }
  host.append(barra);

  const lista = datos.grades[gradoActivo];
  const limite = usuario.rol === 'profesor' ? 0 : datos.limitePuestos;
  const entradas = limite > 0 ? lista.slice(0, limite) : lista;
  const card = el('div', { class: 'card rk-lista' });
  for (const e of entradas) card.append(fila(e, { mia: e.uid === usuario.uid }));
  host.append(card);

  const mia = lista.find((e) => e.uid === usuario.uid);
  if (mia && entradas.indexOf(mia) === -1) {
    host.append(el('div', { class: 'rk-sep' }, 'TU POSICIÓN'));
    host.append(el('div', { class: 'card rk-lista' }, fila(mia, { mia: true })));
  }
}

/* --------------------------------------------------------- configuracion */

async function configurarLimite(actual) {
  const input = el('input', {
    class: 'input', type: 'number', min: '0', max: '500', value: String(actual)
  });
  const res = await modal({
    title: 'Puestos visibles para los estudiantes',
    body: el('div', null,
      el('p', null, 'Cuántos puestos del ranking ve un estudiante. Su propia posición se muestra siempre, ' +
        'aunque quede fuera de la lista.'),
      input,
      el('div', { class: 'form-note' }, 'Escribe 0 para mostrar el ranking completo.')),
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;
  const n = Math.max(0, Math.min(500, Math.round(Number(input.value) || 0)));
  await window.pc.rankings.setConfig({ limitePuestos: n });
  toast(n === 0 ? 'Los estudiantes verán el ranking completo' : 'Los estudiantes verán ' + n + ' puestos',
    { type: 'ok' });
  if (hooks.onPublicado) hooks.onPublicado();
  if (hooks.refrescar) await hooks.refrescar();
}

/* -------------------------------------------------------------- entrada */

export async function renderRankings(host) {
  const usuario = await window.pc.session.me();
  if (!usuario) { clear(host); return; }

  const datos = await window.pc.rankings.get();
  const page = el('div', { class: 'page' });

  page.append(el('div', { class: 'page-head' },
    el('div', { class: 'ph-text' },
      el('h1', null, '🏆 Rankings'),
      el('p', null, usuario.rol === 'profesor'
        ? 'Se recalcula al calificar y se publica para toda la clase. No hay temporizadores.'
        : 'La clasificación de la clase por experiencia conseguida.')),
    el('div', { class: 'ph-actions' },
      usuario.rol === 'profesor'
        ? el('button', {
          class: 'btn sm outline',
          onclick: () => configurarLimite(datos.limitePuestos)
        }, icon('settings', 12), 'Puestos visibles: ' + (datos.limitePuestos || 'todos'))
        : null)));

  if (!datos.disponible) {
    page.append(el('div', { class: 'empty-page' },
      icon('chart', 34),
      el('b', null, 'Ranking no disponible todavía'),
      el('p', null, datos.motivo)));
    clear(host).append(page);
    return;
  }

  page.append(el('div', { class: 'rk-estado' },
    icon(datos.fuente === 'local' ? 'check' : 'clock', 12),
    ' ' + (datos.fuente === 'local'
      ? 'Calculado ahora con los datos de este equipo'
      : 'Actualizado ' + haceCuanto(datos.descargadoEn) +
        (navigator.onLine ? '' : ' · sin conexión, se muestra la última copia descargada')),
    datos.total ? el('span', { class: 'chip' }, datos.total + ' estudiante(s)') : null));

  const tabs = el('div', { class: 'filtro-barra' });
  for (const [id, texto] of [['general', 'General'], ['tema', 'Por tema'], ['grado', 'Por grado']]) {
    tabs.append(el('button', {
      class: 'btn sm ' + (pestana === id ? 'primary' : 'outline'),
      onclick: () => { pestana = id; pintar(); }
    }, texto));
  }
  page.append(tabs);

  const cuerpo = el('div');
  page.append(cuerpo);

  function pintar() {
    for (const b of tabs.children) {
      const activo = b.textContent === ({ general: 'General', tema: 'Por tema', grado: 'Por grado' })[pestana];
      b.className = 'btn sm ' + (activo ? 'primary' : 'outline');
    }
    if (pestana === 'tema') pintarPorTema(cuerpo, datos, usuario);
    else if (pestana === 'grado') pintarPorGrado(cuerpo, datos, usuario);
    else pintarGeneral(cuerpo, datos, usuario);
  }

  /*
   * Se pinta con la pagina todavia fuera del documento y se cuelga entera de
   * una vez: asi nadie -ni un estudiante, ni las pruebas- ve una pagina a medio
   * pintar cuando una sincronizacion dispara un repintado.
   */
  pintar();
  clear(host).append(page);
}
