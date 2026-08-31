/*
 * Tableros de inicio y administracion de cuentas.
 *
 *   Estudiante -> su avance real: ejercicios, XP, notas, tiempo y actividad.
 *   Profesor   -> estado del curso, revision pendiente y avance por estudiante.
 *
 * Todos los numeros salen de SQLite (que a su vez se alimenta de Firebase).
 * Donde todavia no hay dato -por ejemplo una nota sin calificar- se muestra un
 * guion, nunca un valor inventado.
 */

import { $, el, icon, clear, toast, modal, confirmDialog, promptDialog } from './ui.js';
import * as badges from './badges.js';
import { avatar as avatarFoto } from './avatar.js';
import { cambiarFoto } from './photo.js';

let hooks = {};

export function init(appHooks) { hooks = appHooks || {}; }

/* ------------------------------------------------------------- formatos */

export function formatoTiempo(segundos) {
  const s = Math.max(0, Math.round(segundos || 0));
  if (s < 60) return s + ' s';
  const min = Math.floor(s / 60);
  if (min < 60) return min + ' min';
  return Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
}

export function formatoFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const hora = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return 'hoy ' + hora;
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short' }) + ' ' + hora;
}

/*
 * Estados de una entrega, con los nombres que ve la persona.
 *
 * Son los cinco del pliego -pendiente de revisión, en revisión, calificado,
 * abandonado y fuera de tiempo- más los dos que existen antes de entregar
 * (borrador y en progreso), que el estudiante también necesita distinguir.
 *
 * Cada uno lleva su explicación: se usa en la ayuda contextual, para que nadie
 * tenga que adivinar qué significa «abandonado».
 */
export const ESTADOS_ENTREGA = {
  draft: {
    texto: 'Borrador',
    tono: '',
    ayuda: 'Lo empezaste pero todavía no lo has entregado.'
  },
  in_progress: {
    texto: 'En progreso',
    tono: 'warn',
    ayuda: 'Lo estás resolviendo. Se guarda solo mientras trabajas.'
  },
  submitted: {
    texto: 'Pendiente de revisión',
    tono: 'accent',
    ayuda: 'Ya lo entregaste. Tu profesor todavía no lo ha revisado.'
  },
  under_review: {
    texto: 'En revisión',
    tono: 'accent',
    ayuda: 'Tu profesor lo está revisando ahora mismo.'
  },
  graded: {
    texto: 'Calificado',
    tono: 'ok',
    ayuda: 'Ya tiene nota y comentarios.'
  },
  returned: {
    texto: 'Calificado',
    tono: 'ok',
    ayuda: 'Tiene nota y tu profesor te lo devolvió para que lo corrijas.'
  },
  abandoned: {
    texto: 'Abandonado',
    tono: 'err',
    ayuda: 'El estudiante dejó de realizar la actividad según las condiciones ' +
      'establecidas para el ejercicio. Un error de Python no marca nada como abandonado.'
  },
  late: {
    texto: 'Fuera de tiempo',
    tono: 'warn',
    ayuda: 'La entrega ocurrió después del límite establecido.'
  },
  pendiente: {
    texto: 'Sin empezar',
    tono: '',
    ayuda: 'Todavía no lo has abierto.'
  }
};

export function textoEstado(estado) {
  const e = ESTADOS_ENTREGA[estado];
  return e ? e.texto : 'Sin información';
}

export function ayudaEstado(estado) {
  const e = ESTADOS_ENTREGA[estado];
  return e ? e.ayuda : '';
}

export function chipEstado(estado) {
  const e = ESTADOS_ENTREGA[estado] || { texto: 'Sin información', tono: '', ayuda: '' };
  return el('span', { class: 'chip ' + e.tono, title: e.ayuda }, e.texto);
}

/**
 * Texto seguro: nunca deja escapar un null, un undefined ni un NaN a la
 * pantalla. Donde no hay dato, se dice que no hay dato.
 */
export function texto(valor, siFalta) {
  if (valor == null) return siFalta || 'Sin información';
  if (typeof valor === 'number' && !isFinite(valor)) return siFalta || 'Sin información';
  const s = String(valor).trim();
  if (!s || s === 'null' || s === 'undefined' || s === 'NaN' || s === '[object Object]') {
    return siFalta || 'Sin información';
  }
  return s;
}

/** Nota lista para mostrar: «4.7 / 5.0» o «Pendiente». */
export function textoNota(nota, maxScore) {
  if (nota == null || !isFinite(Number(nota))) return 'Pendiente';
  const max = isFinite(Number(maxScore)) && Number(maxScore) > 0 ? Number(maxScore) : 5;
  return Number(nota).toFixed(1) + ' / ' + max.toFixed(1);
}

/** Intentos: «1 de 3» o «1» cuando son ilimitados. */
export function textoIntentos(usados, maximo) {
  const u = Math.max(0, Math.round(Number(usados) || 0));
  const m = Math.round(Number(maximo) || 0);
  return m > 0 ? u + ' de ' + m : String(u);
}

export const AYUDA = {
  intentos: 'Un intento corresponde a una entrega. Ejecutar el código, guardar o ' +
    'equivocarse no consume intentos.',
  abandonado: ESTADOS_ENTREGA.abandoned.ayuda,
  fueraDeTiempo: ESTADOS_ENTREGA.late.ayuda,
  xp: 'La experiencia se gana cuando tu profesor califica una entrega.',
  ranking: 'El puesto se calcula con la experiencia que llevas ganada.'
};

/** Icono de ayuda con su explicación al pasar el cursor. */
export function ayuda(texto_) {
  return el('span', { class: 'ayuda-info', title: texto_, tabindex: '0' }, 'ⓘ');
}

/* El avatar (foto o iniciales) lo resuelve un solo modulo: src/js/avatar.js */
function avatar(u, size) {
  return avatarFoto(u, size || 52);
}

function kpi(o) {
  return el('div', { class: 'kpi ' + (o.tono || '') },
    el('div', { class: 'k-top' }, icon(o.icono, 13), o.titulo),
    el('div', { class: 'k-value' }, String(o.valor), o.sufijo ? el('small', null, ' ' + o.sufijo) : null),
    o.nota ? el('div', { class: 'k-note' }, o.nota) : null,
    o.porcentaje != null
      ? el('div', { class: 'bar ' + (o.barra || '') },
        el('i', { style: { width: Math.max(0, Math.min(100, o.porcentaje)) + '%' } }))
      : null);
}

/**
 * Ejercicios que el estudiante tiene por hacer: los que no ha entregado y los
 * que dejo a medias. Ordenados por urgencia real (lo que cierra antes primero).
 */
async function pendientesDelEstudiante() {
  const [ejercicios, mias] = await Promise.all([
    window.pc.exercises.list(),
    window.pc.submissions.mine()
  ]);

  const ultima = new Map();
  for (const s of mias) {
    const previo = ultima.get(s.exerciseId);
    if (!previo || Number(s.attemptNumber) > Number(previo.attemptNumber)) ultima.set(s.exerciseId, s);
  }

  const ahora = Date.now();
  const lista = [];
  for (const ej of ejercicios) {
    const s = ultima.get(ej.id);
    const entregado = s && ['submitted', 'under_review', 'late', 'graded', 'returned'].indexOf(s.status) !== -1;
    if (entregado) continue;
    if (!ej.disponible && !s) continue;          // cerrado o fuera de clase: no es una tarea suya ahora

    const cierra = ej.dueDate ? new Date(ej.dueDate).getTime() : null;
    lista.push({
      id: ej.id,
      titulo: ej.title || 'Ejercicio',
      tema: ej.tema || 'Sin tema',
      xp: ej.xp || 0,
      empezado: !!s,
      cierra: ej.dueDate || null,
      urgente: cierra != null && cierra - ahora < 48 * 3600 * 1000
    });
  }

  return lista.sort((a, b) => {
    const ca = a.cierra ? new Date(a.cierra).getTime() : Infinity;
    const cb = b.cierra ? new Date(b.cierra).getTime() : Infinity;
    if (ca !== cb) return ca - cb;
    if (a.empezado !== b.empezado) return a.empezado ? -1 : 1;   // lo empezado, antes
    return a.titulo.localeCompare(b.titulo, 'es');
  });
}

/* =========================================================== estudiante */

async function inicioEstudiante(host, usuario) {
  const { progreso: p, recientes } = await window.pc.progress.mine();
  const page = el('div', { class: 'page' });

  const miAvatar = el('button', {
    class: 'avatar-boton',
    title: 'Cambiar mi foto',
    onclick: () => cambiarFoto(usuario, () => hooks.refrescar && hooks.refrescar())
  }, avatar(usuario, 52), el('span', { class: 'avatar-lapiz' }, '✎'));

  page.append(el('div', { class: 'hero' },
    miAvatar,
    el('div', { class: 'h-text' },
      el('h1', null, 'Hola, ' + usuario.nombre),
      el('div', { class: 'h-meta' },
        usuario.grado ? el('span', { class: 'chip' }, 'Grado ' + usuario.grado) : null,
        usuario.grupo ? el('span', { class: 'chip' }, 'Grupo ' + usuario.grupo) : null,
        el('span', null, usuario.correo))),
    el('div', { class: 'h-actions' },
      el('button', { class: 'btn primary', onclick: () => hooks.irEjercicios && hooks.irEjercicios() }, 'Ver ejercicios'),
      el('button', { class: 'btn outline', onclick: () => hooks.irRankings && hooks.irRankings() }, '🏆 Rankings'),
      el('button', { class: 'btn outline', onclick: () => hooks.irEditor && hooks.irEditor() }, 'Abrir el editor'))));

  page.append(el('div', { class: 'kpi-grid' },
    kpi({
      icono: 'check-circle', titulo: 'Ejercicios', tono: 'ok',
      valor: p.completados, sufijo: '/ ' + p.totalEjercicios,
      nota: p.porcentaje + '% del curso', porcentaje: p.porcentaje, barra: 'ok'
    }),
    kpi({
      icono: 'star', titulo: 'Experiencia', tono: 'accent',
      valor: p.xpTotal, sufijo: 'de ' + p.xpDisponible + ' XP',
      nota: p.enRevision ? p.enRevision + ' entrega(s) en revisión' : 'El XP llega al calificar'
    }),
    kpi({
      icono: 'target', titulo: 'Promedio',
      valor: p.promedio == null ? '—' : p.promedio.toFixed(1),
      nota: p.aprobados + ' aprobado(s) · ' + p.reprobados + ' por mejorar'
    }),
    kpi({
      icono: 'clock', titulo: 'Tiempo dedicado',
      valor: formatoTiempo(p.tiempoTotalSegundos),
      nota: p.enProgreso ? p.enProgreso + ' en progreso' : p.pendientes + ' por empezar'
    })));

  /*
   * Lo primero que tiene que responder el tablero es «que tengo que hacer».
   * Antes habia que ir a Ejercicios para saberlo; ahora esta aqui, con la fecha
   * de cierre cuando la hay y el estado de lo que ya empezaste.
   */
  const pendientes = await pendientesDelEstudiante();
  page.append(el('div', { class: 'section-head' },
    el('h2', null, 'Lo que tienes que hacer'),
    el('span', { class: 'count' }, String(pendientes.length))));

  if (!pendientes.length) {
    page.append(el('div', { class: 'card' },
      el('div', { class: 'list-row' },
        icon('check-circle', 16),
        el('div', { class: 'lr-main' },
          el('b', null, 'Estás al día'),
          el('span', null, 'No tienes ejercicios pendientes. Cuando tu profesor publique uno, aparecerá aquí.')))));
  } else {
    const card = el('div', { class: 'card' });
    for (const t of pendientes.slice(0, 6)) {
      card.append(el('div', {
        class: 'list-row', style: { cursor: 'pointer' },
        onclick: () => hooks.abrirEjercicio && hooks.abrirEjercicio(t.id)
      },
        icon(t.empezado ? 'clock' : 'tasks', 16),
        el('div', { class: 'lr-main' },
          el('b', null, t.titulo),
          el('span', null, [
            t.tema,
            t.empezado ? 'lo dejaste a medias' : 'sin empezar',
            t.xp + ' XP',
            t.cierra ? 'cierra ' + formatoFecha(t.cierra) : null
          ].filter(Boolean).join('  ·  '))),
        t.urgente ? el('span', { class: 'chip warn' }, 'cierra pronto') : null,
        el('button', { class: 'btn sm primary' }, t.empezado ? 'Continuar' : 'Empezar')));
    }
    if (pendientes.length > 6) {
      card.append(el('div', { class: 'list-row' },
        el('div', { class: 'lr-main' },
          el('span', null, 'y ' + (pendientes.length - 6) + ' más en la sección Ejercicios.'))));
    }
    page.append(card);
  }

  if (p.porTema.length) {
    page.append(el('div', { class: 'section-head' },
      el('h2', null, 'Progreso por tema'), el('span', { class: 'count' }, p.porTema.length)));
    const card = el('div', { class: 'card' });
    for (const t of p.porTema) {
      card.append(el('div', { class: 'list-row' },
        el('div', { class: 'lr-main' },
          el('b', null, t.tema),
          el('span', null, t.completados + ' de ' + t.total + '  ·  ' + t.xp + ' / ' + t.xpDisponible + ' XP' +
            (t.promedio != null ? '  ·  promedio ' + t.promedio : '')),
          el('div', { class: 'bar ' + (t.porcentaje === 100 ? 'ok' : '') },
            el('i', { style: { width: t.porcentaje + '%' } }))),
        el('div', { class: 'lr-num' }, t.porcentaje + '%')));
    }
    page.append(card);
  }

  // Vitrina de insignias (fase 4). Si el profesor no ha creado ninguna, no se
  // pinta la seccion en vez de mostrar una caja vacia.
  const vitrina = await badges.seccionVitrina(null);
  if (vitrina) page.append(vitrina);

  page.append(el('div', { class: 'section-head' }, el('h2', null, 'Mis últimas entregas')));
  if (!recientes.length) {
    page.append(el('div', { class: 'empty-page' },
      icon('tasks', 34),
      el('b', null, 'Todavía no has empezado ningún ejercicio'),
      el('p', null, 'Cuando tu profesor publique ejercicios los verás en la sección Ejercicios.'),
      el('button', { class: 'btn primary', onclick: () => hooks.irEjercicios && hooks.irEjercicios() }, 'Ir a ejercicios')));
  } else {
    const card = el('div', { class: 'card' });
    for (const a of recientes) {
      const calificado = a.estado === 'graded' || a.estado === 'returned';
      card.append(el('div', {
        class: 'list-row', style: { cursor: 'pointer' },
        onclick: () => hooks.verResultado && hooks.verResultado(a.submissionId)
      },
        icon(calificado ? 'check-circle' : 'clock', 16),
        el('div', { class: 'lr-main' },
          el('b', null, a.titulo),
          el('span', null, a.tema + '  ·  ' + formatoFecha(a.cuando))),
        chipEstado(a.estado),
        calificado
          ? el('div', { class: 'lr-num' }, (a.nota == null ? '—' : a.nota) + (a.xpGanado ? '  +' + a.xpGanado + ' XP' : ''))
          : null));
    }
    page.append(card);
  }

  clear(host).append(page);
}

/* ============================================================= profesor */

async function inicioProfesor(host, usuario) {
  const c = await window.pc.progress.course();
  const page = el('div', { class: 'page' });

  page.append(el('div', { class: 'hero' },
    el('button', {
      class: 'avatar-boton',
      title: 'Cambiar mi foto',
      onclick: () => cambiarFoto(usuario, () => hooks.refrescar && hooks.refrescar())
    }, avatar(usuario, 52), el('span', { class: 'avatar-lapiz' }, '✎')),
    el('div', { class: 'h-text' },
      el('h1', null, 'Hola, ' + usuario.nombre),
      el('div', { class: 'h-meta' },
        el('span', { class: 'badge-rol profesor' }, 'Profesor'),
        el('span', null, usuario.correo))),
    el('div', { class: 'h-actions' },
      el('button', { class: 'btn primary', onclick: () => hooks.irEntregas && hooks.irEntregas() },
        'Revisar entregas' + (c.revision.pendientes ? ' (' + c.revision.pendientes + ')' : '')),
      el('button', { class: 'btn outline', onclick: () => hooks.irEjercicios && hooks.irEjercicios() }, 'Temario y ejercicios'))));

  page.append(el('div', { class: 'kpi-grid' },
    kpi({
      icono: 'tasks', titulo: 'Por revisar', tono: c.revision.pendientes ? 'warn' : 'ok',
      valor: c.revision.pendientes,
      nota: c.revision.enRevision + ' en revisión · ' + c.revision.calificadas + ' calificadas'
    }),
    kpi({ icono: 'users', titulo: 'Estudiantes', valor: c.estudiantes, nota: c.profesores + ' profesor(es)' }),
    kpi({
      icono: 'book', titulo: 'Ejercicios', tono: 'accent',
      valor: c.ejerciciosActivos, sufijo: '/ ' + c.ejercicios,
      nota: c.temas + ' tema(s) · ' + c.borradores + ' borrador(es)'
    }),
    kpi({
      icono: 'star', titulo: 'XP repartido', valor: c.xpRepartido,
      nota: c.clasesActivas ? c.clasesActivas + ' clase(s) activa(s)' : 'Sin clases activas'
    })));

  if (!c.temas || !c.ejercicios) {
    page.append(el('div', { class: 'section-head' }, el('h2', null, 'Primeros pasos')));
    const card = el('div', { class: 'card' });
    const paso = (n, titulo, texto, etiqueta, accion, hecho) => card.append(
      el('div', { class: 'list-row' },
        el('div', {
          class: 'h-avatar',
          style: {
            width: '26px', height: '26px', fontSize: '11px',
            background: hecho ? 'var(--ok)' : 'var(--surface-3)',
            color: hecho ? '#0d1117' : 'var(--text-muted)'
          }
        }, hecho ? '✓' : String(n)),
        el('div', { class: 'lr-main' }, el('b', null, titulo), el('span', null, texto)),
        el('button', { class: 'btn sm ' + (hecho ? 'outline' : 'primary'), onclick: accion }, etiqueta)));
    paso(1, 'Crea el temario', 'Los ejercicios se organizan por tema.', 'Ir al temario',
      () => hooks.irEjercicios && hooks.irEjercicios(), c.temas > 0);
    paso(2, 'Crea y publica un ejercicio', 'Hasta que no lo publiques, tus estudiantes no lo ven.', 'Crear ejercicio',
      () => hooks.crearEjercicio && hooks.crearEjercicio(), c.ejercicios > 0);
    paso(3, 'Comparte el acceso', 'Tus estudiantes se registran con su correo desde la pantalla de acceso.', 'Ver cuentas',
      () => hooks.irCurso && hooks.irCurso(), c.estudiantes > 0);
    page.append(card);
  }

  /*
   * «¿Quien necesita atencion?» tiene que verse sin abrir estadisticas: aqui
   * salen los que van justos de nota o llevan reprobados, con el mismo criterio
   * que usa la pagina de Estadisticas.
   */
  const enRiesgo = c.porEstudiante
    .filter((e) => (e.promedio != null && e.promedio < 3) || (e.reprobados || 0) > 0 ||
      (e.total > 0 && e.completados === 0))
    .slice(0, 5);

  if (enRiesgo.length) {
    page.append(el('div', { class: 'section-head' },
      el('h2', null, 'Necesitan atención'),
      el('span', { class: 'count' }, String(enRiesgo.length)),
      ayuda('Aparecen quienes tienen promedio por debajo de 3, alguna entrega reprobada ' +
        'o no han entregado nada todavía.')));
    const card = el('div', { class: 'card' });
    for (const e of enRiesgo) {
      card.append(el('div', {
        class: 'list-row', style: { cursor: 'pointer' },
        onclick: () => progresoModal(e)
      },
        avatarFoto({ nombreCompleto: e.nombre, color: e.color, foto: e.foto }, 28, { clase: 'av' }),
        el('div', { class: 'lr-main' },
          el('b', null, e.nombre),
          el('span', null, [
            e.completados + ' de ' + e.total + ' ejercicios',
            e.promedio == null ? 'sin nota todavía' : 'promedio ' + e.promedio,
            e.enRevision ? e.enRevision + ' por revisar' : null
          ].filter(Boolean).join('  ·  '))),
        el('span', { class: 'chip warn' }, e.promedio == null ? 'sin entregas' : 'seguimiento')));
    }
    page.append(card);
  }

  page.append(el('div', { class: 'section-head' },
    el('h2', null, 'Avance de los estudiantes'),
    el('span', { class: 'count' }, c.porEstudiante.length),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn sm outline', onclick: () => hooks.irCurso && hooks.irCurso() }, 'Administrar')));

  if (!c.porEstudiante.length) {
    page.append(el('div', { class: 'empty-page' },
      icon('users', 34),
      el('b', null, 'Todavía no hay estudiantes'),
      el('p', null, 'Pídeles que abran Python Classroom y se registren con su correo.')));
  } else {
    page.append(el('div', { class: 'card table-wrap' }, tablaEstudiantes(c.porEstudiante)));
  }

  clear(host).append(page);
}

function tablaEstudiantes(filas) {
  const tbody = el('tbody');
  for (const e of filas) {
    const pct = e.total ? Math.round((e.completados / e.total) * 100) : 0;
    tbody.append(el('tr', { style: { cursor: 'pointer' }, onclick: () => progresoModal(e) },
      el('td', null, el('div', { class: 'who' },
        avatarFoto({ nombreCompleto: e.nombre, color: e.color, foto: e.foto }, 24, { clase: 'av' }),
        el('div', null,
          el('div', { style: { fontWeight: '600' } }, e.nombre),
          el('div', { style: { fontSize: '11px', color: 'var(--text-faint)' } }, e.correo)))),
      el('td', null, [e.grado, e.grupo].filter(Boolean).join(' · ') || '—'),
      el('td', null, el('div', { style: { minWidth: '110px' } },
        el('div', { style: { fontSize: '11.5px', color: 'var(--text-muted)' } }, e.completados + ' / ' + e.total),
        el('div', { class: 'bar' }, el('i', { style: { width: pct + '%' } })))),
      el('td', { class: 'num' }, String(e.xp)),
      el('td', { class: 'num' }, e.promedio == null ? '—' : e.promedio.toFixed(1)),
      el('td', { class: 'num' }, e.enRevision ? String(e.enRevision) : '—'),
      el('td', null, formatoFecha(e.ultimaActividad))));
  }
  return el('table', { class: 'data' },
    el('thead', null, el('tr', null,
      el('th', null, 'Estudiante'), el('th', null, 'Grado/Grupo'), el('th', null, 'Progreso'),
      el('th', null, 'XP'), el('th', null, 'Promedio'), el('th', null, 'Por revisar'),
      el('th', null, 'Última actividad'))),
    tbody);
}

/* ============================================== pagina Inicio (entrada) */

export async function renderInicio(host) {
  const usuario = await window.pc.session.me();
  if (!usuario) { clear(host); return; }
  if (usuario.rol === 'profesor') await inicioProfesor(host, usuario);
  else await inicioEstudiante(host, usuario);
}

/* ============================================ pagina Curso (profesor) */

export async function renderCurso(host) {
  const usuario = await window.pc.session.me();
  if (!usuario || usuario.rol !== 'profesor') {
    clear(host).append(el('div', { class: 'page' },
      el('div', { class: 'empty-page' }, el('b', null, 'Solo el profesor puede ver esta sección.'))));
    return;
  }

  const usuarios = await window.pc.users.list();
  const page = el('div', { class: 'page' });

  page.append(el('div', { class: 'page-head' },
    el('div', { class: 'ph-text' },
      el('h1', null, 'Estudiantes y cuentas'),
      el('p', null, 'Cada persona se registra con su correo desde la pantalla de acceso. ' +
        'Aquí administras roles y estado.'))));

  await seccionCursos(page);
  await seccionGrupos(page);
  await seccionCoprofesores(page);
  await seccionSolicitudesProfesor(page);

  const profesores = usuarios.filter((u) => u.rol === 'profesor');
  const estudiantes = usuarios.filter((u) => u.rol === 'estudiante');

  /*
   * «Mover a otro curso» solo tiene sentido cuando (a) el curso activo -del
   * que salen estos estudiantes- es un curso PROPIO (si aquí solo eres
   * coprofesor, moverEstudiante fallará en el backend: no eres dueño del
   * origen) y (b) hay al menos otro curso propio activo al que moverlos.
   * seccionCursos ya pidió "mis cursos" para pintar "Mis cursos", pero esa
   * lista queda encerrada en su propia función -no la devuelve-, así que se
   * vuelve a pedir aquí: es una lectura local a SQLite, barata.
   */
  const misCursos = await window.pc.courses.mine();
  const cursoActivo = await window.pc.courses.active();
  const cursosPropiosActivos = misCursos.filter((c) => c.profesorId === usuario.uid && c.estado === 'active');
  const otrosCursosPropios = cursoActivo && cursoActivo.profesorId === usuario.uid && cursosPropiosActivos.length > 1
    ? cursosPropiosActivos.filter((c) => c.id !== cursoActivo.id)
    : [];

  page.append(el('div', { class: 'section-head' },
    el('h2', null, 'Profesores'), el('span', { class: 'count' }, profesores.length)));
  page.append(listaCuentas(profesores, usuario, otrosCursosPropios));

  page.append(el('div', { class: 'section-head' },
    el('h2', null, 'Estudiantes'), el('span', { class: 'count' }, estudiantes.length)));
  if (!estudiantes.length) {
    page.append(el('div', { class: 'empty-page' },
      icon('users', 34),
      el('b', null, 'Aún no hay estudiantes registrados'),
      el('p', null, 'Pídeles que abran la aplicación y usen «Crear una cuenta» con su correo del colegio.')));
  } else {
    page.append(listaCuentas(estudiantes, usuario, otrosCursosPropios));
  }

  clear(host).append(page);
}

/*
 * «Mis cursos»: un profesor puede tener varios (uno por grupo que da clase),
 * cada uno con su propio código para que los estudiantes se unan. Por ahora
 * esto es puramente local a este equipo -no viaja todavía a Firebase-, así
 * que un curso creado aquí solo se ve en este mismo computador.
 */
async function seccionCursos(page) {
  const [cursos, activo] = await Promise.all([
    window.pc.courses.mine(),
    window.pc.courses.active()
  ]);

  page.append(el('div', { class: 'section-head' },
    el('h2', null, 'Mis cursos'),
    el('span', { class: 'count' }, cursos.length),
    ayuda('Cada curso tiene su propio código: los estudiantes lo usan para unirse a ese grupo ' +
      'y no ven nada de los demás cursos.'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn sm primary', onclick: () => crearCurso() }, icon('plus', 13), 'Crear curso')));

  if (!cursos.length) {
    page.append(el('div', { class: 'empty-page' },
      icon('graduation', 30),
      el('b', null, 'Todavía no tienes ningún curso'),
      el('p', null, 'Crea uno para tener un grupo de estudiantes con su propio ritmo y su propio código.'),
      el('button', { class: 'btn primary', onclick: () => crearCurso() }, 'Crear mi primer curso')));
    return;
  }

  const card = el('div', { class: 'card' });
  for (const c of cursos) {
    const esActivo = activo && activo.id === c.id;
    card.append(el('div', { class: 'list-row' },
      icon('graduation', 17),
      el('div', { class: 'lr-main' },
        el('b', null, c.nombre),
        el('span', null, [
          'código ' + c.codigo,
          c.estudiantes + (c.estudiantes === 1 ? ' estudiante' : ' estudiantes'),
          c.estado === 'archived' ? 'archivado' : null
        ].filter(Boolean).join('  ·  '))),
      esActivo
        ? el('span', { class: 'chip ok' }, 'Curso activo')
        : el('button', { class: 'btn sm outline', onclick: () => usarCurso(c) }, 'Usar este curso'),
      el('div', { class: 'lr-actions' },
        el('button', {
          class: 'btn sm outline', title: 'Copiar el código',
          onclick: async () => { await window.pc.app.copy(c.codigo); toast('Código copiado', { type: 'ok', timeout: 1800 }); }
        }, 'Copiar código'),
        el('button', { class: 'icon-btn', title: 'Cambiar el nombre', onclick: () => renombrarCurso(c) },
          icon('edit', 14)),
        el('button', { class: 'icon-btn', title: 'Cambiar el código de acceso', onclick: () => regenerarCodigo(c) },
          icon('refresh', 14)),
        el('button', {
          class: 'icon-btn', title: c.estado === 'archived' ? 'Reactivar' : 'Archivar',
          onclick: () => archivarCurso(c)
        }, icon(c.estado === 'archived' ? 'check-circle' : 'trash', 14)),
        c.estado === 'archived'
          ? el('button', {
            class: 'icon-btn', title: 'Borrar definitivamente', onclick: () => borrarCursoDefinitivo(c)
          }, icon('trash', 14))
          : null)));
  }
  page.append(card);
}

/*
 * Borrado de verdad, no archivado -eso ya lo hace archivarCurso()-. Solo
 * aparece cuando el curso YA está archivado; el backend (courses.eliminar)
 * es quien de verdad decide si se puede borrar -rechaza si tiene entregas o
 * si es el único curso del profesor-, así que aquí no se duplica esa
 * comprobación: si rechaza, su mensaje se muestra tal cual.
 */
async function borrarCursoDefinitivo(curso) {
  const ok = await confirmDialog(
    'Se borra «' + curso.nombre + '» PARA SIEMPRE: su temario, ejercicios, clases y grupos desaparecen ' +
    'con él. Esto NO se puede deshacer.',
    { title: 'Borrar curso definitivamente', okLabel: 'Borrar para siempre', danger: true });
  if (!ok) return;
  const res = await window.pc.courses.remove(curso.id);
  if (!res.ok) { toast(res.error, { type: 'err' }); return; }
  toast('Curso borrado', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
  if (hooks.refrescarCurso) await hooks.refrescarCurso();
}

async function crearCurso() {
  const nombre = await promptDialog({
    title: 'Crear curso',
    label: 'El nombre lo ven tus estudiantes al unirse (por ejemplo «10A» o «Décimo B»).',
    value: '',
    okLabel: 'Crear'
  });
  if (!nombre) return;
  const res = await window.pc.courses.create(nombre);
  if (!res.ok) { toast(res.error, { type: 'err' }); return; }
  toast('Curso «' + res.curso.nombre + '» creado · código ' + res.curso.codigo, { type: 'ok', timeout: 6000 });
  if (hooks.refrescar) await hooks.refrescar();
  if (hooks.refrescarCurso) await hooks.refrescarCurso();
}

async function renombrarCurso(curso) {
  const nombre = await promptDialog({ title: 'Cambiar el nombre del curso', value: curso.nombre, okLabel: 'Guardar' });
  if (!nombre || nombre === curso.nombre) return;
  const res = await window.pc.courses.rename(curso.id, nombre);
  if (!res.ok) { toast(res.error, { type: 'err' }); return; }
  toast('Nombre actualizado', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

async function regenerarCodigo(curso) {
  const ok = await confirmDialog(
    'El código actual («' + curso.codigo + '») dejará de servir para unirse a «' + curso.nombre + '». ' +
    'Quien ya esté matriculado no se ve afectado.',
    { title: 'Cambiar el código de acceso', okLabel: 'Cambiar código' });
  if (!ok) return;
  const res = await window.pc.courses.regenerateCode(curso.id);
  if (!res.ok) { toast(res.error, { type: 'err' }); return; }
  toast('Nuevo código: ' + res.curso.codigo, { type: 'ok', timeout: 6000 });
  if (hooks.refrescar) await hooks.refrescar();
}

async function archivarCurso(curso) {
  const archivar = curso.estado !== 'archived';
  if (archivar) {
    const ok = await confirmDialog(
      'Con «' + curso.nombre + '» archivado, sus estudiantes no podrán entregar ni ver ejercicios nuevos. ' +
      'Puedes reactivarlo cuando quieras; no se pierde nada.',
      { title: 'Archivar curso', okLabel: 'Archivar' });
    if (!ok) return;
  }
  const res = await window.pc.courses.setStatus(curso.id, archivar ? 'archived' : 'active');
  if (!res.ok) { toast(res.error, { type: 'err' }); return; }
  toast(archivar ? 'Curso archivado' : 'Curso reactivado', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

async function usarCurso(curso) {
  await window.pc.courses.setActive(curso.id);
  toast('Ahora estás en «' + curso.nombre + '»', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
  if (hooks.refrescarCurso) await hooks.refrescarCurso();
}

/*
 * Grupos con nombre dentro del curso activo (fase 5): sirven para asignar un
 * ejercicio a un subgrupo en vez de a todo el curso, desde el propio editor
 * de ejercicios. Aquí solo se administra quién está en cada uno.
 */
async function seccionGrupos(page) {
  const [grupos, estudiantes] = await Promise.all([
    window.pc.groups.list(), window.pc.users.students()
  ]);

  page.append(el('div', { class: 'section-head' },
    el('h2', null, 'Grupos'),
    el('span', { class: 'count' }, grupos.length),
    ayuda('Un grupo con nombre (por ejemplo «Equipo A») te deja asignar un ejercicio solo a ' +
      'quienes estén en él, desde el editor del ejercicio.'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn sm primary', onclick: () => crearGrupo() }, icon('plus', 13), 'Crear grupo')));

  if (!grupos.length) {
    page.append(el('div', { class: 'empty-page' },
      icon('users', 30),
      el('b', null, 'Todavía no tienes ningún grupo'),
      el('p', null, 'Crea uno para poder asignarle ejercicios concretos más adelante.')));
    return;
  }

  const card = el('div', { class: 'card' });
  for (const g of grupos) {
    card.append(el('div', { class: 'list-row' },
      el('span', { class: 'chip-color', style: { background: g.color } }),
      el('div', { class: 'lr-main' },
        el('b', null, g.nombre),
        el('span', null, g.miembros.length + (g.miembros.length === 1 ? ' estudiante' : ' estudiantes'))),
      el('div', { class: 'lr-actions' },
        el('button', { class: 'btn sm outline', onclick: () => miembrosGrupo(g, estudiantes) }, 'Miembros'),
        el('button', { class: 'icon-btn', title: 'Cambiar el nombre', onclick: () => renombrarGrupo(g) },
          icon('edit', 14)),
        el('button', { class: 'icon-btn', title: 'Borrar grupo', onclick: () => borrarGrupo(g) },
          icon('trash', 14)))));
  }
  page.append(card);
}

async function crearGrupo() {
  const nombre = await promptDialog({
    title: 'Crear grupo', label: 'Por ejemplo «Equipo A» o «Refuerzo».', value: '', okLabel: 'Crear'
  });
  if (!nombre) return;
  const res = await window.pc.groups.create(nombre);
  if (!res.ok) { toast(res.error, { type: 'err' }); return; }
  toast('Grupo «' + res.grupo.nombre + '» creado', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

async function renombrarGrupo(grupo) {
  const nombre = await promptDialog({ title: 'Cambiar el nombre del grupo', value: grupo.nombre, okLabel: 'Guardar' });
  if (!nombre || nombre === grupo.nombre) return;
  const res = await window.pc.groups.rename(grupo.id, nombre);
  if (!res.ok) { toast(res.error, { type: 'err' }); return; }
  toast('Nombre actualizado', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

async function borrarGrupo(grupo) {
  const ok = await confirmDialog(
    'Se borra el grupo «' + grupo.nombre + '». Los ejercicios ya asignados a él dejan de estarle dirigidos ' +
    '-vuelven a verse por todo el curso, no desaparecen-.',
    { title: 'Borrar grupo', okLabel: 'Borrar' });
  if (!ok) return;
  const res = await window.pc.groups.remove(grupo.id);
  if (!res.ok) { toast(res.error, { type: 'err' }); return; }
  toast('Grupo borrado', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

async function miembrosGrupo(grupo, estudiantes) {
  const seleccion = new Set(grupo.miembros);
  const body = el('div', { class: 'form-grid' });
  if (!estudiantes.length) {
    body.append(el('div', { class: 'empty-note' }, 'Todavía no hay estudiantes en este curso.'));
  } else {
    const lista = el('div', { class: 'check-lista' });
    for (const est of estudiantes) {
      lista.append(el('label', { class: 'checkline' },
        el('input', {
          type: 'checkbox', checked: seleccion.has(est.uid),
          onchange: (e) => { if (e.target.checked) seleccion.add(est.uid); else seleccion.delete(est.uid); }
        }),
        est.nombreCompleto));
    }
    body.append(lista);
  }
  const res = await modal({
    title: 'Miembros de «' + grupo.nombre + '»', body: body,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;
  const out = await window.pc.groups.setMembers(grupo.id, Array.from(seleccion));
  if (!out.ok) { toast(out.error, { type: 'err' }); return; }
  toast('Miembros actualizados', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

/*
 * Coprofesores del curso activo: otros profesores que se unieron con el
 * código de acceso para ver todo el curso -estudiantes, ejercicios,
 * entregas- sin ser su dueño (no crean ejercicios ni califican). A
 * diferencia de "Mis cursos" y "Grupos" no se crean desde aquí: cada uno se
 * une él mismo, desde su propio menú de cuenta con «Ser coprofesor de otro
 * curso», así que esta sección no lleva botón de "crear".
 */
async function seccionCoprofesores(page) {
  const activo = await window.pc.courses.active();
  const coprofesores = activo ? await window.pc.courses.coTeachers(activo.id) : [];

  page.append(el('div', { class: 'section-head' },
    el('h2', null, 'Coprofesores'),
    el('span', { class: 'count' }, coprofesores.length),
    ayuda('Un coprofesor ve todo este curso -estudiantes, ejercicios y entregas- pero no puede ' +
      'crear ejercicios ni calificar. Se une él mismo con el código de acceso de este curso, desde ' +
      'su propio menú de cuenta.')));

  if (!coprofesores.length) {
    page.append(el('div', { class: 'empty-page' },
      icon('users', 30),
      el('b', null, 'Todavía no tienes ningún coprofesor'),
      el('p', null, 'Comparte el código de este curso con otro profesor para que pueda unirse.')));
    return;
  }

  const card = el('div', { class: 'card' });
  for (const cp of coprofesores) {
    card.append(el('div', { class: 'list-row' },
      icon('users', 16),
      el('div', { class: 'lr-main' },
        el('b', null, cp.nombre),
        el('span', null, cp.correo)),
      el('div', { class: 'lr-actions' },
        el('button', { class: 'icon-btn', title: 'Quitar coprofesor', onclick: () => quitarCoprofesor(activo.id, cp) },
          icon('trash', 14)))));
  }
  page.append(card);
}

async function quitarCoprofesor(courseId, cp) {
  const ok = await confirmDialog(
    'Se quitará a ' + cp.nombre + ' como coprofesor de este curso: deja de ver a sus estudiantes, ' +
    'ejercicios y entregas.',
    { title: 'Quitar coprofesor', okLabel: 'Quitar', danger: true });
  if (!ok) return;
  const res = await window.pc.courses.removeCoTeacher(courseId, cp.uid);
  if (!res.ok) { toast(res.error || 'No se pudo quitar', { type: 'err' }); return; }
  toast('Coprofesor quitado', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

/*
 * Solicitudes para ser profesor DE ESTE CURSO: alguien se registró eligiendo
 * "profesor" con el código de acceso de este curso, pero no fue el primero de
 * la instalación -así que su cuenta quedó de estudiante hasta que el dueño
 * del curso apruebe o rechace la solicitud (el backend ya filtra por el
 * curso activo). Sin ninguna pendiente no se pinta nada -a diferencia de
 * Grupos o Coprofesores, aquí un "empty-page" sería ruido constante en la
 * pantalla normal-.
 */
async function seccionSolicitudesProfesor(page) {
  const solicitudes = await window.pc.users.solicitudesProfesor();
  if (!solicitudes.length) return;

  page.append(el('div', { class: 'section-head' },
    el('h2', null, 'Solicitudes para ser profesor'),
    el('span', { class: 'count' }, solicitudes.length),
    ayuda('Alguien pidió ser profesor de tu curso con tu código. Apruébalo para que pueda crear ' +
      'ejercicios y calificar, o recházalo si no corresponde.')));

  const card = el('div', { class: 'card' });
  for (const s of solicitudes) {
    card.append(el('div', { class: 'list-row' },
      icon('users', 16),
      el('div', { class: 'lr-main' },
        el('b', null, s.nombreCompleto),
        el('span', null, s.correo)),
      el('div', { class: 'lr-actions' },
        el('button', { class: 'btn sm primary', onclick: () => aprobarSolicitudProfesor(s) }, 'Aprobar'),
        el('button', { class: 'btn sm outline', onclick: () => rechazarSolicitudProfesor(s) }, 'Rechazar'))));
  }
  page.append(card);
}

async function aprobarSolicitudProfesor(s) {
  const ok = await confirmDialog(
    'Se aprobará a ' + s.nombreCompleto + ' como profesor de este curso: podrá crear ejercicios y ' +
    'calificar entregas.',
    { title: 'Aprobar solicitud de profesor', okLabel: 'Aprobar' });
  if (!ok) return;
  const res = await window.pc.users.aprobarSolicitudProfesor(s.uid);
  if (!res.ok) { toast(res.error || 'No se pudo aprobar', { type: 'err' }); return; }
  toast(s.nombreCompleto + ' ya es profesor de este curso', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
  if (hooks.refrescarCurso) await hooks.refrescarCurso();
}

async function rechazarSolicitudProfesor(s) {
  const ok = await confirmDialog(
    'Se rechazará la solicitud de ' + s.nombreCompleto + ' para ser profesor de este curso.',
    { title: 'Rechazar solicitud de profesor', okLabel: 'Rechazar', danger: true });
  if (!ok) return;
  const res = await window.pc.users.rechazarSolicitudProfesor(s.uid);
  if (!res.ok) { toast(res.error || 'No se pudo rechazar', { type: 'err' }); return; }
  toast('Solicitud rechazada', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

function listaCuentas(lista, actual, otrosCursos) {
  const puedeMover = Array.isArray(otrosCursos) && otrosCursos.length > 0;
  const card = el('div', { class: 'card' });
  for (const u of lista) {
    card.append(el('div', { class: 'list-row' },
      avatarFoto(u, 30, { clase: 'av' }),
      el('div', { class: 'lr-main' },
        el('b', null, u.nombreCompleto + (u.uid === actual.uid ? '  (tú)' : '')),
        el('span', null, u.correo +
          (u.grado || u.grupo ? '  ·  ' + [u.grado, u.grupo].filter(Boolean).join(' ') : '') +
          '  ·  último acceso: ' + formatoFecha(u.ultimoAccesoEn))),
      el('span', { class: 'badge-rol ' + (u.rol === 'profesor' ? 'profesor' : 'estudiante') }, u.rol),
      u.activo ? null : el('span', { class: 'chip err' }, 'Desactivada'),
      el('div', { class: 'lr-actions' },
        u.rol === 'estudiante'
          ? el('button', { class: 'icon-btn', title: 'Ver progreso', onclick: () => progresoModal({ uid: u.uid, nombre: u.nombreCompleto }) }, icon('chart', 15))
          : null,
        u.rol === 'estudiante' && puedeMover
          ? el('button', { class: 'icon-btn', title: 'Mover a otro curso', onclick: () => moverEstudianteModal(u, otrosCursos) }, icon('arrow-right', 15))
          : null,
        el('button', { class: 'icon-btn', title: 'Editar datos', onclick: () => editarCuenta(u) }, icon('edit', 15)),
        el('button', {
          class: 'icon-btn', title: u.rol === 'profesor' ? 'Convertir en estudiante' : 'Convertir en profesor',
          onclick: () => cambiarRol(u)
        }, icon('key', 15)),
        u.uid === actual.uid
          ? null
          : el('button', {
            class: 'icon-btn', title: 'Quitar del curso', onclick: () => borrarCuenta(u)
          }, icon('trash', 15)))));
  }
  return card;
}

/*
 * Mover a un estudiante de curso: solo se llega aquí cuando renderCurso ya
 * comprobó que hay a dónde moverlo (otrosCursos no viene vacío) -listaCuentas
 * es síncrona y solo arma DOM, así que esa comprobación y la carga de "los
 * otros cursos" vive en renderCurso, no aquí-.
 */
async function moverEstudianteModal(estudiante, otrosCursos) {
  const select = el('select', { class: 'select', name: 'cursoDestino' },
    otrosCursos.map((c) => el('option', { value: c.id }, c.nombre)));
  const body = el('div', { class: 'form-grid' },
    el('p', null, 'Mueve a ' + estudiante.nombreCompleto + ' a otro de tus cursos. Deja este y ' +
      'empieza de nuevo -sin su progreso previo- en el curso de destino.'),
    el('div', { class: 'form-field' }, el('label', null, 'Curso de destino'), select));

  const res = await modal({
    title: 'Mover a otro curso', body,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Mover', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;

  const out = await window.pc.courses.moveStudent(estudiante.uid, select.value);
  if (!out.ok) { toast(out.error || 'No se pudo mover', { type: 'err' }); return; }
  toast(estudiante.nombreCompleto + ' se movió a «' + out.curso.nombre + '»', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

/* ------------------------------------------------------------- modales */

function campoSimple(nombre, etiqueta, valor, tipo) {
  return el('div', { class: 'form-field', dataset: { field: nombre } },
    el('label', null, etiqueta),
    el('input', { class: 'input', name: nombre, type: tipo || 'text', value: valor == null ? '' : valor, spellcheck: 'false' }),
    el('div', { class: 'err' }));
}

function leer(form) {
  const out = {};
  for (const i of form.querySelectorAll('input, select')) {
    out[i.name] = i.type === 'checkbox' ? i.checked : i.value;
  }
  return out;
}

async function editarCuenta(u) {
  const form = el('form', { class: 'form-grid', novalidate: true });
  form.append(
    el('div', { class: 'form-row' },
      campoSimple('firstName', 'Nombre', u.nombre),
      campoSimple('lastName', 'Apellido', u.apellido)),
    u.rol === 'estudiante'
      ? el('div', { class: 'form-row' },
        campoSimple('grade', 'Grado', u.grado),
        campoSimple('groupName', 'Grupo', u.grupo))
      : null,
    el('label', { class: 'checkline' },
      el('input', { type: 'checkbox', name: 'active', checked: u.activo }),
      'Cuenta activa'),
    el('div', { class: 'form-note' },
      'El correo y la contraseña no se cambian desde aquí: cada persona gestiona su acceso.'));

  const res = await modal({
    title: 'Editar cuenta', body: form,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;
  const out = await window.pc.users.update(u.uid, leer(form));
  if (!out.ok) { toast(out.error || 'No se pudo guardar', { type: 'err' }); return; }
  toast('Cuenta actualizada', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

async function cambiarRol(u) {
  const nuevo = u.rol === 'profesor' ? 'student' : 'teacher';
  const ok = await confirmDialog(
    nuevo === 'teacher'
      ? 'Convertir a ' + u.nombreCompleto + ' en profesor. Podrá crear ejercicios y calificar. ¿Continuar?'
      : 'Quitar el rol de profesor a ' + u.nombreCompleto + '. ¿Continuar?',
    { title: 'Cambiar rol', okLabel: 'Cambiar rol', danger: nuevo === 'student' });
  if (!ok) return;
  try {
    const out = await window.pc.users.setRole(u.uid, nuevo);
    if (!out.ok) { toast(out.error || 'No se pudo cambiar', { type: 'err' }); return; }
    /*
     * El nuevo rol queda local al instante, pero Firebase (la fuente de
     * verdad de verificarRol) solo se entera cuando la cola lo sube -normalmente
     * hasta 15 segundos después-. Si esa persona vuelve a entrar en este mismo
     * equipo antes de que eso pase, la comprobación contra Firebase todavía ve
     * el rol viejo y se lo pisa. Se empuja ahora mismo para no dejar esa
     * ventana abierta -barato si la cola ya estaba vacía-.
     */
    const { empujar } = await import('./sync.js');
    await empujar().catch(() => {});
    toast('Rol actualizado', { type: 'ok' });
    if (hooks.refrescar) await hooks.refrescar();
  } catch (err) {
    toast(err.message, { type: 'err' });
  }
}

async function borrarCuenta(u) {
  const ok = await confirmDialog(
    'Se quitará a ' + u.nombreCompleto + ' de este equipo junto con su progreso guardado aquí. ' +
    'Su cuenta de acceso no se elimina. ¿Continuar?',
    { title: 'Quitar del curso', okLabel: 'Quitar', danger: true });
  if (!ok) return;
  try {
    const out = await window.pc.users.remove(u.uid);
    if (!out.ok) { toast(out.error || 'No se pudo quitar', { type: 'err' }); return; }
    toast('Cuenta quitada de este equipo', { type: 'ok' });
    if (hooks.refrescar) await hooks.refrescar();
  } catch (err) {
    toast(err.message, { type: 'err' });
  }
}

async function progresoModal(e) {
  const datos = await window.pc.progress.of(e.uid);
  const p = datos.progreso;

  const tbody = el('tbody');
  for (const s of datos.entregas) {
    tbody.append(el('tr', null,
      el('td', null, s.ejercicio ? s.ejercicio.title : '—'),
      el('td', null, s.ejercicio ? s.ejercicio.tema : '—'),
      el('td', null, String(s.attemptNumber)),
      el('td', null, chipEstado(s.status)),
      el('td', { class: 'num' }, formatoTiempo(s.timeSpentSec)),
      el('td', { class: 'num' }, s.grade == null ? '—' : s.grade + ' / ' + s.maxScore),
      el('td', { class: 'num' }, String(s.xpEarned || 0))));
  }

  const vitrinaAlumno = await badges.seccionVitrina(e.uid);

  await modal({
    title: 'Progreso de ' + (e.nombre || ''),
    wide: true,
    body: el('div', null,
      el('div', { class: 'kpi-grid', style: { marginBottom: '14px' } },
        kpi({ icono: 'check-circle', titulo: 'Completados', valor: p.completados, sufijo: '/ ' + p.totalEjercicios, tono: 'ok' }),
        kpi({ icono: 'star', titulo: 'XP', valor: p.xpTotal, tono: 'accent' }),
        kpi({ icono: 'target', titulo: 'Promedio', valor: p.promedio == null ? '—' : p.promedio.toFixed(1) }),
        kpi({ icono: 'clock', titulo: 'Tiempo', valor: formatoTiempo(p.tiempoTotalSegundos) })),
      datos.entregas.length
        ? el('div', { class: 'card table-wrap' },
          el('table', { class: 'data' },
            el('thead', null, el('tr', null,
              el('th', null, 'Ejercicio'), el('th', null, 'Tema'), el('th', null, 'Intento'),
              el('th', null, 'Estado'), el('th', null, 'Tiempo'), el('th', null, 'Nota'), el('th', null, 'XP'))),
            tbody))
        : el('div', { class: 'empty-note' }, 'Este estudiante todavía no ha entregado nada.'),
      vitrinaAlumno),
    buttons: [{ label: 'Cerrar', value: null, primary: true }]
  });
}

export { progresoModal };
