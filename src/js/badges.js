/*
 * Insignias y premios (fase 4).
 *
 *   Estudiante -> su vitrina: lo que tiene, con fecha y motivo, y lo que le
 *                 falta, con la condicion exacta que queda pendiente.
 *   Profesor   -> panel de premios: catalogo, concesion manual, premios por
 *                 posicion de ranking y quien tiene cada insignia.
 *
 * El cliente del estudiante CALCULA su vitrina en local (con lo que hay en
 * SQLite) pero nunca escribe una concesion: eso solo lo hace el profesor, al
 * calificar o a mano, y las Security Rules lo imponen.
 */

import { el, icon, clear, toast, modal, confirmDialog } from './ui.js';
import { formatoFecha } from './dashboard.js';
import { avatar } from './avatar.js';
import * as sync from './sync.js';

let hooks = {};
let pestanaPremios = 'insignias';
let ultimaBajadaInsignias = 0;

export function init(appHooks) { hooks = appHooks || {}; }

const ICONOS = ['star', 'py', 'check-circle', 'target', 'clock', 'book', 'users',
  'graduation', 'chart', 'key', 'package', 'terminal', 'search', 'check'];

const COLORES = ['#ffd43b', '#4b8bf5', '#4bcf87', '#c58cf5', '#ff7ab2', '#57c7d4', '#f0b23a'];

const TIPOS_REGLA = [
  ['first_submission', 'Su primera entrega'],
  ['exercises_completed', 'Ejercicios completados (N)'],
  ['topic_exercises', 'Ejercicios de un tema concreto (N)'],
  ['perfect_scores', 'Notas perfectas (N)'],
  ['challenges_completed', 'Retos completados (N)'],
  ['no_late', 'Entregas seguidas a tiempo (N)'],
  ['streak_days', 'Días distintos con actividad (N)'],
  ['fast_finish', 'Terminar en menos del X % del tiempo'],
  ['topic_completed', 'Completar un tema al 100 %']
];

/* --------------------------------------------------------------- piezas */

/** Ficha visual de una insignia, en color si la tiene y en gris si no. */
function ficha(b, onClick) {
  return el('button', {
    class: 'badge-tile' + (b.conseguida ? '' : ' bloqueada'),
    title: b.conseguida ? 'Conseguida ' + formatoFecha(b.grantedAt) : b.comoSeConsigue,
    onclick: () => onClick(b)
  },
    el('span', {
      class: 'bt-icon',
      style: b.conseguida ? { background: b.color, color: '#10131a' } : null
    }, icon(b.conseguida ? b.icon : 'lock', 17)),
    el('span', { class: 'bt-name' }, b.name),
    el('span', { class: 'bt-note' }, b.conseguida ? formatoFecha(b.grantedAt) : b.comoSeConsigue));
}

async function detalleInsignia(b) {
  await modal({
    title: b.name,
    body: el('div', null,
      el('div', { class: 'badge-detail' },
        el('span', {
          class: 'bt-icon grande',
          style: b.conseguida ? { background: b.color, color: '#10131a' } : null
        }, icon(b.conseguida ? b.icon : 'lock', 26)),
        el('div', null,
          el('b', null, b.conseguida ? 'Conseguida' : 'Todavía no la tienes'),
          el('span', null, b.description || 'Sin descripción.'))),
      b.conseguida
        ? el('div', { class: 'card', style: { marginTop: '10px' } },
          el('div', { class: 'list-row' },
            el('div', { class: 'lr-main' },
              el('b', null, 'Otorgada'),
              el('span', null, formatoFecha(b.grantedAt)))),
          b.reason
            ? el('div', { class: 'list-row' },
              el('div', { class: 'lr-main' }, el('b', null, 'Motivo'), el('span', null, b.reason)))
            : null,
          b.xpBonus
            ? el('div', { class: 'list-row' },
              el('div', { class: 'lr-main' }, el('b', null, 'XP extra'), el('span', null, '+' + b.xpBonus + ' XP')))
            : null)
        : el('div', { class: 'form-note' }, 'Cómo se consigue: ' + b.comoSeConsigue),
      b.avance && b.avance.objetivo > 1 && !b.conseguida
        ? el('div', { class: 'bar', style: { marginTop: '10px' } },
          el('i', {
            style: {
              width: Math.min(100, Math.round(((b.avance.actual || 0) / b.avance.objetivo) * 100)) + '%'
            }
          }))
        : null),
    buttons: [{ label: 'Cerrar', value: null, primary: true }]
  });
}

/* ====================================================== vitrina alumno */

/**
 * Seccion de insignias del tablero del estudiante. Devuelve un nodo listo para
 * anadir, o null si el profesor todavia no ha creado ninguna insignia.
 */
export async function seccionVitrina(studentUid) {
  const datos = studentUid
    ? await window.pc.badges.of(studentUid)
    : await window.pc.badges.mine();
  if (!datos.insignias.length) return null;

  const grid = el('div', { class: 'badge-grid' });
  for (const b of datos.insignias) grid.append(ficha(b, detalleInsignia));

  return el('div', null,
    el('div', { class: 'section-head' },
      el('h2', null, 'Mis insignias'),
      el('span', { class: 'count' }, datos.conseguidas + ' / ' + datos.total),
      datos.xpExtra ? el('span', { class: 'chip accent' }, '+' + datos.xpExtra + ' XP extra') : null),
    el('div', { class: 'card' }, grid));
}

/* ==================================================== panel del profesor */

async function pintarCatalogo(host) {
  const insignias = await window.pc.badges.list();
  clear(host);

  host.append(el('div', { class: 'section-head' },
    el('h2', null, 'Catálogo de insignias'),
    el('span', { class: 'count' }, insignias.length),
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'btn sm outline',
      onclick: async () => {
        const out = await window.pc.badges.seed();
        toast(out.creadas ? out.creadas + ' insignia(s) añadidas' : 'El catálogo ya estaba cargado',
          { type: out.creadas ? 'ok' : 'info' });
        if (hooks.onPublicado) hooks.onPublicado();
        if (hooks.refrescar) await hooks.refrescar();
      }
    }, 'Cargar catálogo sugerido'),
    el('button', { class: 'btn sm primary', onclick: () => insigniaModal(null) },
      icon('plus', 12), 'Nueva insignia')));

  if (!insignias.length) {
    host.append(el('div', { class: 'empty-page' },
      icon('star', 34),
      el('b', null, 'Todavía no hay insignias'),
      el('p', null, 'Carga el catálogo sugerido o crea la primera insignia a mano.')));
    return;
  }

  const card = el('div', { class: 'card' });
  for (const b of insignias) {
    card.append(el('div', { class: 'list-row' + (b.active ? '' : ' apagada') },
      el('span', { class: 'bt-icon pequeno', style: { background: b.color, color: '#10131a' } }, icon(b.icon, 14)),
      el('div', { class: 'lr-main' },
        el('b', null, b.name),
        el('span', null, (b.description || 'Sin descripción.') +
          (b.xpBonus ? '  ·  +' + b.xpBonus + ' XP' : ''))),
      el('span', { class: 'chip ' + (b.type === 'auto' ? 'accent' : '') },
        b.type === 'auto' ? 'automática' : 'manual'),
      b.active ? null : el('span', { class: 'chip err' }, 'desactivada'),
      el('div', { class: 'lr-actions' },
        el('button', {
          class: 'icon-btn', title: 'Quién la tiene (' + b.otorgadas + ')',
          onclick: () => verQuienLaTiene(b)
        }, icon('users', 15)),
        el('button', { class: 'icon-btn', title: 'Conceder a un estudiante', onclick: () => concederModal(b) },
          icon('plus', 15)),
        el('button', { class: 'icon-btn', title: 'Editar', onclick: () => insigniaModal(b) }, icon('edit', 15)),
        el('button', {
          class: 'icon-btn', title: b.active ? 'Desactivar' : 'Activar',
          onclick: async () => {
            await window.pc.badges.setActive(b.id, !b.active);
            if (hooks.onPublicado) hooks.onPublicado();
            if (hooks.refrescar) await hooks.refrescar();
          }
        }, icon(b.active ? 'eye-off' : 'eye', 15)))));
  }
  host.append(card);
  host.append(el('div', { class: 'form-note' },
    'Las insignias automáticas se evalúan al calificar. Una insignia nunca se concede dos veces.'));
}

function selectorIcono(valor) {
  const grid = el('div', { class: 'tipo-selector', dataset: { field: 'icon' } });
  const oculto = el('input', { type: 'hidden', name: 'icon', value: valor || 'star' });
  for (const nombre of ICONOS) {
    const btn = el('button', {
      type: 'button',
      class: 'tipo-btn' + (oculto.value === nombre ? ' on' : ''),
      onclick: () => {
        oculto.value = nombre;
        for (const b of grid.querySelectorAll('.tipo-btn')) b.classList.remove('on');
        btn.classList.add('on');
      }
    }, icon(nombre, 14));
    grid.append(btn);
  }
  grid.append(oculto);
  return grid;
}

function selectorColor(valor) {
  const cont = el('div', { class: 'tipo-selector' });
  const oculto = el('input', { type: 'hidden', name: 'color', value: valor || COLORES[0] });
  for (const c of COLORES) {
    const btn = el('button', {
      type: 'button',
      class: 'color-chip' + (oculto.value === c ? ' on' : ''),
      style: { background: c },
      onclick: () => {
        oculto.value = c;
        for (const b of cont.querySelectorAll('.color-chip')) b.classList.remove('on');
        btn.classList.add('on');
      }
    }, '');
    cont.append(btn);
  }
  cont.append(oculto);
  return cont;
}

function campo(nombre, etiqueta, control, ayuda) {
  return el('div', { class: 'form-field', dataset: { field: nombre } },
    el('label', null, etiqueta), control,
    ayuda ? el('small', { style: { fontSize: '10.5px', color: 'var(--text-faint)' } }, ayuda) : null,
    el('div', { class: 'err' }));
}

function leerForm(form) {
  const out = {};
  for (const i of form.querySelectorAll('input, select, textarea')) {
    if (!i.name) continue;
    out[i.name] = i.type === 'checkbox' ? i.checked : i.value;
  }
  return out;
}

function marcar(form, errores) {
  for (const f of form.querySelectorAll('.form-field')) {
    f.classList.remove('error');
    const e = f.querySelector('.err');
    if (e) e.textContent = '';
  }
  for (const [k, v] of Object.entries(errores || {})) {
    const f = form.querySelector('[data-field="' + k + '"]');
    if (f) { f.classList.add('error'); f.querySelector('.err').textContent = v; }
    else toast(v, { type: 'err' });
  }
}

async function insigniaModal(b) {
  const temas = await window.pc.topics.list();
  const regla = (b && b.rule) || {};

  const selTipo = el('select', { class: 'select', name: 'type' },
    el('option', { value: 'auto', selected: !b || b.type === 'auto' }, 'Automática (la da el sistema al calificar)'),
    el('option', { value: 'manual', selected: b && b.type === 'manual' }, 'Manual (la concedes tú)'));

  const selRegla = el('select', { class: 'select', name: 'ruleTipo' },
    TIPOS_REGLA.map(([v, t]) => el('option', { value: v, selected: regla.tipo === v }, t)));

  const inputN = el('input', {
    class: 'input', name: 'ruleN', type: 'number', min: '1',
    value: regla.n != null ? String(regla.n) : '10'
  });
  const inputPct = el('input', {
    class: 'input', name: 'rulePorcentaje', type: 'number', min: '1', max: '99',
    value: regla.porcentaje != null ? String(regla.porcentaje) : '50'
  });
  const selTema = el('select', { class: 'select', name: 'ruleTopicId' },
    el('option', { value: '' }, 'Cualquier tema'),
    temas.map((t) => el('option', { value: t.id, selected: regla.topicId === t.id }, t.nombre)));

  const cajaN = campo('ruleN', 'Cantidad (N)', inputN);
  const cajaPct = campo('rulePorcentaje', 'Porcentaje del tiempo límite', inputPct,
    'Se consigue al entregar usando menos de este porcentaje.');
  const cajaTema = campo('ruleTopicId', 'Tema que hay que completar', selTema);
  const cajaRegla = el('div', null, campo('rule', 'Condición', selRegla), cajaN, cajaPct, cajaTema);

  const refrescarCampos = () => {
    const auto = selTipo.value === 'auto';
    cajaRegla.style.display = auto ? '' : 'none';
    const t = selRegla.value;
    cajaN.style.display = ['exercises_completed', 'perfect_scores', 'challenges_completed',
      'no_late', 'streak_days', 'topic_exercises'].indexOf(t) !== -1 ? '' : 'none';
    cajaPct.style.display = t === 'fast_finish' ? '' : 'none';
    cajaTema.style.display = ['topic_completed', 'topic_exercises'].indexOf(t) !== -1 ? '' : 'none';
  };
  selTipo.addEventListener('change', refrescarCampos);
  selRegla.addEventListener('change', refrescarCampos);

  const form = el('form', { class: 'form-grid', novalidate: true },
    campo('name', 'Nombre', el('input', { class: 'input', name: 'name', value: b ? b.name : '', placeholder: 'Maestro de funciones' })),
    campo('description', 'Descripción',
      el('textarea', { class: 'textarea', name: 'description', rows: '2' }, b ? b.description : '')),
    el('div', { class: 'ex-form-grid' },
      campo('icon', 'Símbolo', selectorIcono(b ? b.icon : 'star')),
      campo('color', 'Color', selectorColor(b ? b.color : COLORES[0]))),
    el('div', { class: 'ex-form-grid' },
      campo('type', 'Tipo', selTipo),
      campo('xpBonus', 'XP extra al conseguirla',
        el('input', { class: 'input', name: 'xpBonus', type: 'number', min: '0', value: b ? String(b.xpBonus) : '0' }))),
    cajaRegla,
    el('label', { class: 'checkline' },
      el('input', { type: 'checkbox', name: 'active', checked: !b || b.active }), 'Activa'));

  refrescarCampos();

  const res = await modal({
    title: b ? 'Editar insignia' : 'Nueva insignia', body: form, wide: true,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;

  const datos = leerForm(form);
  const payload = {
    id: b ? b.id : undefined,
    name: datos.name,
    description: datos.description,
    icon: datos.icon,
    color: datos.color,
    type: datos.type,
    xpBonus: datos.xpBonus,
    active: datos.active
  };
  if (datos.type === 'auto') {
    payload.rule = { tipo: datos.ruleTipo };
    if (cajaN.style.display !== 'none') payload.rule.n = Number(datos.ruleN);
    if (cajaPct.style.display !== 'none') payload.rule.porcentaje = Number(datos.rulePorcentaje);
    if (cajaTema.style.display !== 'none' && datos.ruleTopicId) payload.rule.topicId = datos.ruleTopicId;
  }

  const out = await window.pc.badges.save(payload);
  if (!out.ok) { marcar(form, out.errores); toast(out.error || 'Revisa los datos', { type: 'err' }); return; }
  toast(b ? 'Insignia actualizada' : 'Insignia creada', { type: 'ok' });
  if (hooks.onPublicado) hooks.onPublicado();
  if (hooks.refrescar) await hooks.refrescar();
}

/* ------------------------------------------------------ concesion manual */

async function concederModal(insigniaFija) {
  const [estudiantes, insignias] = await Promise.all([
    window.pc.users.students(), window.pc.badges.list()
  ]);
  if (!estudiantes.length) { toast('Todavía no hay estudiantes registrados.', { type: 'warn' }); return; }
  const activas = insignias.filter((b) => b.active);
  if (!activas.length) { toast('Crea primero una insignia.', { type: 'warn' }); return; }

  const selAlumno = el('select', { class: 'select', name: 'studentId' },
    estudiantes.map((u) => el('option', { value: u.uid }, u.nombreCompleto +
      (u.grado ? ' · grado ' + u.grado : ''))));
  const selInsignia = el('select', { class: 'select', name: 'badgeId' },
    activas.map((b) => el('option', { value: b.id, selected: insigniaFija && insigniaFija.id === b.id }, b.name)));
  const motivo = el('textarea', { class: 'textarea', name: 'reason', rows: '2', placeholder: 'Excelente trabajo durante el proyecto.' });

  const form = el('form', { class: 'form-grid', novalidate: true },
    campo('estudiante', 'Estudiante', selAlumno),
    campo('badgeId', 'Insignia', selInsignia),
    campo('reason', 'Motivo', motivo, 'El estudiante lo verá en su vitrina.'));

  const res = await modal({
    title: '🎖 Premio especial', body: form,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Otorgar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;

  const out = await window.pc.badges.grant(selAlumno.value, selInsignia.value, motivo.value);
  if (!out.ok) { toast(out.error || 'No se pudo otorgar', { type: 'err' }); return; }
  toast(out.repetida ? 'Ese estudiante ya tenía esa insignia' : 'Insignia otorgada',
    { type: out.repetida ? 'warn' : 'ok' });
  if (hooks.onPublicado) hooks.onPublicado();
  if (hooks.refrescar) await hooks.refrescar();
}

async function verQuienLaTiene(b) {
  const lista = await window.pc.badges.holders(b.id);
  await modal({
    title: 'Quién tiene «' + b.name + '»',
    wide: true,
    body: lista.length
      ? el('div', { class: 'card' }, lista.map((h) => el('div', { class: 'list-row' },
        avatar({ nombreCompleto: h.nombre, color: h.color, foto: h.foto }, 28, { clase: 'av' }),
        el('div', { class: 'lr-main' },
          el('b', null, h.nombre),
          el('span', null, formatoFecha(h.grantedAt) + (h.reason ? '  ·  ' + h.reason : ''))),
        el('button', {
          class: 'icon-btn', title: 'Quitar la insignia',
          onclick: async (ev) => {
            const ok = await confirmDialog('¿Quitar «' + b.name + '» a ' + h.nombre + '?',
              { title: 'Quitar insignia', okLabel: 'Quitar', danger: true });
            if (!ok) return;
            await window.pc.badges.revoke(h.studentId, b.id);
            ev.currentTarget.closest('.list-row').remove();
            if (hooks.onPublicado) hooks.onPublicado();
          }
        }, icon('trash', 14)))))
      : el('div', { class: 'empty-note' }, 'Todavía nadie tiene esta insignia.'),
    buttons: [{ label: 'Cerrar', value: null, primary: true }]
  });
}

/* -------------------------------------------------------------- premios */

async function pintarPremios(host) {
  const [premios, insignias, temas, retos] = await Promise.all([
    window.pc.rewards.list(), window.pc.badges.list(), window.pc.topics.list(), window.pc.challenges.list()
  ]);
  clear(host);

  host.append(el('div', { class: 'section-head' },
    el('h2', null, 'Premios por posición'),
    el('span', { class: 'count' }, premios.length),
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'btn sm primary',
      onclick: () => premioModal(null, insignias, temas, retos)
    }, icon('plus', 12), 'Nuevo premio')));

  if (!premios.length) {
    host.append(el('div', { class: 'empty-page' },
      icon('target', 34),
      el('b', null, 'Sin premios configurados'),
      el('p', null, 'Un premio asocia una insignia al 1.º, 2.º o 3.º puesto del ranking general, ' +
        'al de un tema, o a un reto concreto.')));
    return;
  }

  const card = el('div', { class: 'card' });
  for (const p of premios) {
    const donde = p.scope === 'global' ? 'Ranking general'
      : p.scope === 'topic' ? 'Tema: ' + (p.tema || '—')
        : 'Reto: ' + (p.reto || '—');
    card.append(el('div', { class: 'list-row' + (p.active ? '' : ' apagada') },
      el('div', { class: 'rk-pos' }, p.scope === 'challenge' ? '🔥' : ['🥇', '🥈', '🥉'][p.position - 1] || p.position),
      el('div', { class: 'lr-main' },
        el('b', null, p.title || donde),
        el('span', null, donde + (p.insignia ? '  ·  insignia ' + p.insignia.name : '  ·  sin insignia') +
          (p.description ? '  ·  ' + p.description : ''))),
      p.active ? null : el('span', { class: 'chip err' }, 'desactivado'),
      el('div', { class: 'lr-actions' },
        el('button', {
          class: 'icon-btn', title: 'Editar',
          onclick: () => premioModal(p, insignias, temas, retos)
        }, icon('edit', 15)),
        el('button', {
          class: 'icon-btn', title: 'Eliminar',
          onclick: async () => {
            const ok = await confirmDialog('¿Eliminar este premio?',
              { title: 'Eliminar premio', okLabel: 'Eliminar', danger: true });
            if (!ok) return;
            await window.pc.rewards.remove(p.id);
            if (hooks.onPublicado) hooks.onPublicado();
            if (hooks.refrescar) await hooks.refrescar();
          }
        }, icon('trash', 15)))));
  }
  host.append(card);
  host.append(el('div', { class: 'form-note' },
    'El premio de un reto se concede automáticamente al calificar la entrega de su ejercicio. ' +
    'Los premios de ranking se conceden a mano cuando cierras el periodo.'));
}

async function premioModal(p, insignias, temas, retos) {
  const selScope = el('select', { class: 'select', name: 'scope' },
    el('option', { value: 'global', selected: !p || p.scope === 'global' }, 'Ranking general'),
    el('option', { value: 'topic', selected: p && p.scope === 'topic' }, 'Ranking de un tema'),
    el('option', { value: 'challenge', selected: p && p.scope === 'challenge' }, 'Reto concreto'));
  const selPos = el('select', { class: 'select', name: 'position' },
    [1, 2, 3].map((n) => el('option', { value: String(n), selected: p && p.position === n },
      ['1.º puesto', '2.º puesto', '3.º puesto'][n - 1])));
  const selTema = el('select', { class: 'select', name: 'topicId' },
    el('option', { value: '' }, 'Elige un tema'),
    temas.map((t) => el('option', { value: t.id, selected: p && p.topicId === t.id }, t.nombre)));
  const selReto = el('select', { class: 'select', name: 'challengeId' },
    el('option', { value: '' }, 'Elige un reto'),
    retos.map((r) => el('option', { value: r.id, selected: p && p.challengeId === r.id }, r.title)));
  const selBadge = el('select', { class: 'select', name: 'badgeId' },
    el('option', { value: '' }, 'Sin insignia'),
    insignias.map((b) => el('option', { value: b.id, selected: p && p.badgeId === b.id }, b.name)));

  const cajaPos = campo('position', 'Puesto', selPos);
  const cajaTema = campo('topicId', 'Tema', selTema);
  const cajaReto = campo('challengeId', 'Reto', selReto);

  const refrescar = () => {
    cajaPos.style.display = selScope.value === 'challenge' ? 'none' : '';
    cajaTema.style.display = selScope.value === 'topic' ? '' : 'none';
    cajaReto.style.display = selScope.value === 'challenge' ? '' : 'none';
  };
  selScope.addEventListener('change', refrescar);

  const form = el('form', { class: 'form-grid', novalidate: true },
    campo('title', 'Título', el('input', { class: 'input', name: 'title', value: p ? p.title : '', placeholder: 'Campeón del trimestre' })),
    campo('scope', 'Dónde se aplica', selScope),
    cajaPos, cajaTema, cajaReto,
    campo('badgeId', 'Insignia que se concede', selBadge),
    campo('description', 'Descripción',
      el('textarea', { class: 'textarea', name: 'description', rows: '2' }, p ? p.description : '')),
    el('label', { class: 'checkline' },
      el('input', { type: 'checkbox', name: 'active', checked: !p || p.active }), 'Activo'));
  refrescar();

  const res = await modal({
    title: p ? 'Editar premio' : 'Nuevo premio', body: form,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;

  const datos = leerForm(form);
  if (p) datos.id = p.id;
  const out = await window.pc.rewards.save(datos);
  if (!out.ok) { marcar(form, out.errores); toast(out.error || 'Revisa los datos', { type: 'err' }); return; }
  toast(p ? 'Premio actualizado' : 'Premio creado', { type: 'ok' });
  if (hooks.onPublicado) hooks.onPublicado();
  if (hooks.refrescar) await hooks.refrescar();
}

/* ------------------------------------------------------ quien tiene que */

async function pintarConcedidas(host) {
  const lista = await window.pc.badges.holders(null);
  clear(host);
  host.append(el('div', { class: 'section-head' },
    el('h2', null, 'Insignias concedidas'),
    el('span', { class: 'count' }, lista.length),
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'btn sm outline',
      title: 'Traer las concesiones que se hicieron en otro equipo',
      onclick: async () => {
        const res = await sync.arrastrarInsignias();
        ultimaBajadaInsignias = Date.now();
        toast(res.ok
          ? 'Concesiones al día (' + (res.aplicados || 0) + ' revisadas)'
          : 'Sin conexión: se muestra lo que hay en este equipo',
        { type: res.ok ? 'ok' : 'warn' });
        if (hooks.refrescar) await hooks.refrescar();
      }
    }, icon('refresh', 12), 'Actualizar'),
    el('button', { class: 'btn sm primary', onclick: () => concederModal(null) },
      icon('plus', 12), 'Conceder a mano')));

  if (!lista.length) {
    host.append(el('div', { class: 'empty-page' },
      icon('users', 34),
      el('b', null, 'Todavía no se ha concedido ninguna insignia'),
      el('p', null, 'Las automáticas se conceden solas al calificar.')));
    return;
  }

  const insignias = new Map((await window.pc.badges.list()).map((b) => [b.id, b]));
  const card = el('div', { class: 'card table-wrap' });
  const tbody = el('tbody');
  for (const h of lista) {
    const b = insignias.get(h.badgeId);
    tbody.append(el('tr', null,
      el('td', null, h.nombre),
      el('td', null, b ? b.name : h.badgeId),
      el('td', null, formatoFecha(h.grantedAt)),
      el('td', null, h.reason || '—')));
  }
  card.append(el('table', { class: 'data' },
    el('thead', null, el('tr', null,
      el('th', null, 'Estudiante'), el('th', null, 'Insignia'),
      el('th', null, 'Cuándo'), el('th', null, 'Motivo'))),
    tbody));
  host.append(card);
}

/** Pestana "Premios" de la pagina de curso del profesor. */
export async function renderPanelPremios(host) {
  clear(host);
  /*
   * Las concesiones de todos los estudiantes se traen al abrir el panel, no en
   * cada sincronizacion (seccion 11 de la fase 4).
   *
   * Y como maximo una vez por minuto: aplicar lo descargado avisa de que hay
   * datos nuevos, ese aviso repinta la pagina activa, y el repintado volveria a
   * entrar aqui. Sin este freno, abrir el panel se convierte en un bucle.
   */
  if (Date.now() - ultimaBajadaInsignias > 60000) {
    ultimaBajadaInsignias = Date.now();
    sync.arrastrarInsignias().catch(() => {});
  }
  const tabs = el('div', { class: 'filtro-barra' });
  const cuerpo = el('div');

  const pintar = async () => {
    for (const b of tabs.querySelectorAll('button')) {
      b.className = 'btn sm ' + (b.dataset.tab === pestanaPremios ? 'primary' : 'outline');
    }
    if (pestanaPremios === 'premios') await pintarPremios(cuerpo);
    else if (pestanaPremios === 'concedidas') await pintarConcedidas(cuerpo);
    else await pintarCatalogo(cuerpo);
  };

  for (const [id, texto] of [['insignias', 'Insignias'], ['premios', 'Premios'], ['concedidas', 'Concedidas']]) {
    tabs.append(el('button', {
      class: 'btn sm outline', dataset: { tab: id },
      onclick: () => { pestanaPremios = id; pintar(); }
    }, texto));
  }

  host.append(tabs, cuerpo);
  await pintar();
}

export { detalleInsignia, concederModal };
