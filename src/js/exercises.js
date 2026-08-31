/*
 * Pagina de Ejercicios.
 *
 *   Profesor   -> pestanas de Temario, Ejercicios, Clases y Retos.
 *   Estudiante -> lo que puede resolver, con su estado y sus intentos.
 *
 * El modelo completo del pliego (tipo, dificultad, XP, nota maxima, tiempo,
 * intentos, fechas, solo-en-clase, entrega tardia y criterios) se configura
 * aqui y se guarda en SQLite; la sincronizacion lo sube a Firebase.
 */

import { $, el, icon, clear, toast, modal, confirmDialog } from './ui.js';
import { chipEstado, formatoFecha, formatoTiempo, textoNota, textoIntentos, ayuda, AYUDA } from './dashboard.js';
import * as badges from './badges.js';

let hooks = {};
let pestana = 'ejercicios';
let filtroTema = '';
let filtroEstado = '';

export function init(appHooks) { hooks = appHooks || {}; }

const DIFICULTAD = { easy: 'Fácil', medium: 'Media', hard: 'Difícil' };
const ESTRELLAS = { easy: 1, medium: 2, hard: 3 };
const TIPO_ETIQUETA = {
  normal: 'Normal', timed: 'Cronometrado', class: 'Solo en clase',
  challenge: 'Reto', project: 'Proyecto'
};
const ESTADO_EJ = {
  draft: ['Borrador', ''], published: ['Publicado', 'ok'], active: ['Activo', 'ok'],
  closed: ['Cerrado', 'warn'], archived: ['Archivado', 'err']
};

function estrellas(dif) {
  const n = ESTRELLAS[dif] || 1;
  return el('span', { class: 'stars', title: DIFICULTAD[dif] }, '★'.repeat(n) + '☆'.repeat(3 - n));
}

function fechaInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
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

function campoBox(nombre, etiqueta, control, ayuda) {
  return el('div', { class: 'form-field', dataset: { field: nombre } },
    el('label', null, etiqueta), control,
    ayuda ? el('small', { style: { fontSize: '10.5px', color: 'var(--text-faint)' } }, ayuda) : null,
    el('div', { class: 'err' }));
}

/* ============================================================ profesor */

async function vistaProfesor(host) {
  const page = el('div', { class: 'page' });

  page.append(el('div', { class: 'page-head' },
    el('div', { class: 'ph-text' },
      el('h1', null, 'Curso'),
      el('p', null, 'Temario, ejercicios, clases y retos.'))));

  const tabs = el('div', { class: 'filtro-barra' });
  for (const [id, texto] of [['temario', 'Temario'], ['ejercicios', 'Ejercicios'], ['clases', 'Clases'],
    ['retos', 'Retos'], ['premios', 'Premios']]) {
    tabs.append(el('button', {
      class: 'btn sm ' + (pestana === id ? 'primary' : 'outline'),
      onclick: () => { pestana = id; if (hooks.refrescar) hooks.refrescar(); }
    }, texto));
  }
  page.append(tabs);

  const cuerpo = el('div');
  page.append(cuerpo);

  // Se rellena el cuerpo con la pagina aun desconectada y se cuelga al final,
  // para no mostrar nunca media pantalla mientras se leen los datos.
  if (pestana === 'temario') await pintarTemario(cuerpo);
  else if (pestana === 'clases') await pintarClases(cuerpo);
  else if (pestana === 'retos') await pintarRetos(cuerpo);
  else if (pestana === 'premios') await badges.renderPanelPremios(cuerpo);
  else await pintarEjercicios(cuerpo);

  clear(host).append(page);
}

/* ------------------------------------------------------------ temario */

async function pintarTemario(host) {
  const temas = await window.pc.topics.list();
  clear(host);

  host.append(el('div', { class: 'section-head' },
    el('h2', null, 'Temario'), el('span', { class: 'count' }, temas.length),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn sm outline', onclick: cargarSugerido }, 'Cargar temario sugerido'),
    el('button', { class: 'btn sm primary', onclick: () => temaModal(null) }, icon('plus', 12), 'Nuevo tema')));

  if (!temas.length) {
    host.append(el('div', { class: 'empty-page' },
      icon('book', 34),
      el('b', null, 'Todavía no hay temas'),
      el('p', null, 'Los ejercicios se organizan por tema. Carga el temario sugerido de Python o crea los tuyos.'),
      el('button', { class: 'btn primary', onclick: cargarSugerido }, 'Cargar temario sugerido (17 temas)')));
    return;
  }

  const card = el('div', { class: 'card' });
  for (const t of temas) {
    card.append(el('div', { class: 'list-row' },
      el('span', { style: { width: '10px', height: '10px', borderRadius: '3px', background: t.color, flex: '0 0 auto' } }),
      el('div', { class: 'lr-main' },
        el('b', null, t.nombre),
        el('span', null, (t.descripcion || 'Sin descripción') + '  ·  ' + t.xpDisponible + ' XP disponibles')),
      el('span', { class: 'chip' }, t.ejercicios + ' ej.'),
      el('div', { class: 'lr-actions' },
        el('button', { class: 'icon-btn', title: 'Editar', onclick: () => temaModal(t) }, icon('edit', 15)),
        el('button', { class: 'icon-btn', title: 'Eliminar', onclick: () => borrarTema(t) }, icon('trash', 15)))));
  }
  host.append(card);
}

async function cargarSugerido() {
  const res = await window.pc.topics.seed();
  toast(res.creados ? res.creados + ' tema(s) añadidos' : 'El temario sugerido ya estaba cargado',
    { type: res.creados ? 'ok' : 'info' });
  if (hooks.refrescar) await hooks.refrescar();
}

async function temaModal(tema) {
  const form = el('form', { class: 'form-grid', novalidate: true });
  form.append(
    campoBox('nombre', 'Nombre del tema',
      el('input', { class: 'input', name: 'nombre', value: tema ? tema.nombre : '', placeholder: 'Funciones' })),
    campoBox('descripcion', 'Descripción (opcional)',
      el('input', { class: 'input', name: 'descripcion', value: tema ? tema.descripcion : '' })),
    campoBox('orden', 'Orden',
      el('input', { class: 'input', name: 'orden', type: 'number', min: '0', value: tema ? tema.orden : '' })));

  const res = await modal({
    title: tema ? 'Editar tema' : 'Nuevo tema', body: form,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;
  const datos = leerForm(form);
  if (tema) datos.id = tema.id;
  const out = await window.pc.topics.save(datos);
  if (!out.ok) { marcar(form, out.errores); toast(out.error || 'Revisa los datos', { type: 'err' }); return; }
  toast(tema ? 'Tema actualizado' : 'Tema creado', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

async function borrarTema(t) {
  const ok = await confirmDialog('¿Eliminar el tema "' + t.nombre + '"?',
    { title: 'Eliminar tema', okLabel: 'Eliminar', danger: true });
  if (!ok) return;
  const out = await window.pc.topics.remove(t.id);
  if (!out.ok) { toast(out.error, { type: 'err', timeout: 6000 }); return; }
  toast('Tema eliminado', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

/* --------------------------------------------------------- ejercicios */

async function pintarEjercicios(host) {
  const [temas, ejercicios] = await Promise.all([window.pc.topics.list(), window.pc.exercises.list()]);
  clear(host);

  host.append(el('div', { class: 'section-head' },
    el('h2', null, 'Ejercicios'), el('span', { class: 'count' }, ejercicios.length),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn sm outline', disabled: !temas.length, onclick: () => subirEjercicio(temas) },
      icon('download', 12), 'Subir archivos'),
    el('button', {
      class: 'btn sm primary', disabled: !temas.length,
      title: temas.length ? '' : 'Primero crea al menos un tema',
      onclick: () => ejercicioModal(null, temas)
    }, icon('plus', 12), 'Nuevo ejercicio')));

  if (!ejercicios.length) {
    host.append(el('div', { class: 'empty-page' },
      icon('tasks', 34),
      el('b', null, 'Aún no has creado ejercicios'),
      el('p', null, 'Un ejercicio tiene enunciado, tema, dificultad, XP y nota máxima. Se publica cuando tú quieras.'),
      el('button', { class: 'btn primary', disabled: !temas.length, onclick: () => ejercicioModal(null, temas) },
        'Crear el primer ejercicio')));
    return;
  }

  const grid = el('div', { class: 'ex-grid' });
  for (const ej of ejercicios) grid.append(tarjetaProfesor(ej, temas));
  host.append(grid);
}

function tarjetaProfesor(ej, temas) {
  const [etiqueta, tono] = ESTADO_EJ[ej.status] || ['', ''];
  return el('div', { class: 'ex-card' + (ej.status === 'draft' ? ' inactivo' : '') },
    el('div', { class: 'ex-top' },
      el('div', { class: 'ex-title' }, ej.title),
      estrellas(ej.difficulty)),
    el('div', { class: 'ex-meta' },
      el('span', { class: 'chip accent' }, ej.tema),
      el('span', { class: 'chip ' + tono }, etiqueta),
      el('span', { class: 'chip' }, TIPO_ETIQUETA[ej.type] || ej.type),
      el('span', { class: 'chip' }, ej.xp + ' XP'),
      el('span', { class: 'chip' }, 'Nota ' + ej.maxScore),
      ej.timeLimit ? el('span', { class: 'chip warn' }, ej.timeLimit + ' min') : null,
      ej.maxAttempts ? el('span', { class: 'chip' }, ej.maxAttempts + ' intento(s)') : null,
      ej.isClassOnly ? el('span', { class: 'chip warn' }, 'solo en clase') : null),
    el('div', { class: 'ex-desc' }, ej.description || 'Sin descripción.'),
    ej.dueDate ? el('div', { style: { fontSize: '11px', color: 'var(--text-faint)' } },
      'Cierra el ' + formatoFecha(ej.dueDate) + (ej.allowLateSubmission ? ' (admite entregas tardías)' : '')) : null,
    el('div', { class: 'ex-actions' },
      el('button', { class: 'btn sm outline', onclick: () => ejercicioModal(ej, temas) }, 'Editar'),
      ej.status === 'draft'
        ? el('button', { class: 'btn sm success', onclick: () => cambiarEstado(ej, 'published') }, 'Publicar')
        : ej.status === 'closed'
          ? el('button', { class: 'btn sm outline', onclick: () => cambiarEstado(ej, 'published') }, 'Reabrir')
          : el('button', { class: 'btn sm outline', onclick: () => cambiarEstado(ej, 'closed') }, 'Cerrar'),
      el('button', { class: 'icon-btn', title: 'Eliminar', onclick: () => borrarEjercicio(ej) }, icon('trash', 15))));
}

async function cambiarEstado(ej, estado) {
  const out = await window.pc.exercises.setStatus(ej.id, estado);
  if (!out.ok) { toast(out.error, { type: 'err' }); return; }
  toast(estado === 'published' ? 'Ejercicio publicado: ya lo ven tus estudiantes' : 'Ejercicio cerrado',
    { type: 'ok' });
  if (hooks.onPublicado) hooks.onPublicado();
  if (hooks.refrescar) await hooks.refrescar();
}

async function borrarEjercicio(ej) {
  const ok = await confirmDialog(
    'Se eliminará "' + ej.title + '" y todas las entregas asociadas. ¿Continuar?',
    { title: 'Eliminar ejercicio', okLabel: 'Eliminar', danger: true });
  if (!ok) return;
  const out = await window.pc.exercises.remove(ej.id);
  if (!out.ok) { toast(out.error, { type: 'err' }); return; }
  toast('Ejercicio eliminado' + (out.entregasBorradas ? ' (' + out.entregasBorradas + ' entrega(s))' : ''), { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

async function ejercicioModal(ej, temas, archivosIniciales) {
  const form = el('form', { class: 'form-grid', novalidate: true });
  const archivos = Array.isArray(archivosIniciales)
    ? archivosIniciales.slice()
    : (ej && Array.isArray(ej.files) ? ej.files.slice() : []);

  /*
   * ¿Para quién es? Sin destinatarios (el caso de siempre) es para todo el
   * curso; el profesor puede acotarlo a estudiantes y/o grupos concretos.
   * Se pide el roster y los grupos aquí mismo -es lo único que este modal
   * necesita de más- para no tener que cambiar la firma en cada llamador.
   */
  const destinoPrevio = ej && ej.destinatarios ? ej.destinatarios : { estudiantes: [], grupos: [] };
  const [estudiantesCurso, gruposCurso] = await Promise.all([
    window.pc.users.students(), window.pc.groups.list()
  ]);
  const acotado = !!(destinoPrevio.estudiantes.length || destinoPrevio.grupos.length);
  const estSel = new Set(destinoPrevio.estudiantes);
  const grpSel = new Set(destinoPrevio.grupos);

  const selTema = el('select', { class: 'select', name: 'topicId' },
    temas.map((t) => el('option', { value: t.id, selected: ej && ej.topicId === t.id }, t.nombre)));
  const selTipo = el('select', { class: 'select', name: 'type' },
    Object.entries(TIPO_ETIQUETA).map(([v, t]) => el('option', { value: v, selected: ej ? ej.type === v : v === 'normal' }, t)));
  const selDif = el('select', { class: 'select', name: 'difficulty' },
    Object.entries(DIFICULTAD).map(([v, t]) =>
      el('option', { value: v, selected: ej ? ej.difficulty === v : v === 'easy' }, '★'.repeat(ESTRELLAS[v]) + ' ' + t)));
  const selEstado = el('select', { class: 'select', name: 'status' },
    Object.entries(ESTADO_EJ).map(([v, [t]]) => el('option', { value: v, selected: ej ? ej.status === v : v === 'draft' }, t)));

  const critHost = el('div');
  const suma = el('small', { style: { fontSize: '11px', color: 'var(--text-faint)' } });
  const addCriterio = (c) => {
    const fila = el('div', { class: 'crit-row' },
      el('input', { class: 'input crit-nombre', value: c ? c.name : '', placeholder: 'Lógica' }),
      el('input', { class: 'input crit-puntos', type: 'number', step: '0.1', min: '0', value: c ? c.points : '' }),
      el('button', { class: 'icon-btn', type: 'button', onclick: () => { fila.remove(); actualizarSuma(); } }, icon('close', 13)));
    fila.querySelector('.crit-puntos').addEventListener('input', actualizarSuma);
    critHost.append(fila);
    actualizarSuma();
  };
  function actualizarSuma() {
    let total = 0;
    for (const i of critHost.querySelectorAll('.crit-puntos')) total += Number(i.value) || 0;
    const nota = Number(form.querySelector('input[name="maxScore"]').value) || 0;
    const n = critHost.querySelectorAll('.crit-row').length;
    suma.textContent = n
      ? 'Suman ' + Math.round(total * 100) / 100 + ' de ' + nota + (Math.abs(total - nota) < 0.001 ? '  ✓' : '  (deben coincidir)')
      : 'Sin criterios: la nota se pone directa.';
    suma.style.color = !n || Math.abs(total - nota) < 0.001 ? 'var(--text-faint)' : 'var(--warn)';
  }

  form.append(
    campoBox('title', 'Título',
      el('input', { class: 'input', name: 'title', value: ej ? ej.title : '', placeholder: 'Crear una calculadora' })),
    campoBox('description', 'Descripción corta',
      el('input', { class: 'input', name: 'description', value: ej ? ej.description : '' })),
    campoBox('instructions', 'Instrucciones para el estudiante',
      el('textarea', { class: 'textarea', name: 'instructions', rows: '5' }, ej ? ej.instructions : '')),
    el('div', { class: 'ex-form-grid' },
      campoBox('topicId', 'Tema', selTema),
      campoBox('type', 'Tipo', selTipo),
      campoBox('difficulty', 'Dificultad', selDif),
      campoBox('status', 'Estado', selEstado)),
    el('div', { class: 'ex-form-grid' },
      campoBox('xp', 'XP', el('input', { class: 'input', name: 'xp', type: 'number', min: '0', value: ej ? ej.xp : '10' })),
      campoBox('maxScore', 'Nota máxima',
        el('input', { class: 'input', name: 'maxScore', type: 'number', step: '0.1', min: '0.1', value: ej ? ej.maxScore : '5' })),
      campoBox('timeLimit', 'Tiempo (min)',
        el('input', { class: 'input', name: 'timeLimit', type: 'number', min: '0', max: '600', value: ej ? ej.timeLimit : '0' }), '0 = sin límite'),
      campoBox('maxAttempts', 'Intentos',
        el('input', { class: 'input', name: 'maxAttempts', type: 'number', min: '0', max: '99', value: ej ? ej.maxAttempts : '0' }), '0 = ilimitados')),
    el('div', { class: 'ex-form-grid' },
      campoBox('publishedAt', 'Disponible desde',
        el('input', { class: 'input', name: 'publishedAt', type: 'datetime-local', value: ej ? fechaInput(ej.publishedAt) : '' })),
      campoBox('dueDate', 'Fecha de entrega',
        el('input', { class: 'input', name: 'dueDate', type: 'datetime-local', value: ej ? fechaInput(ej.dueDate) : '' }))),
    campoBox('starterCode', 'Código inicial (opcional)',
      el('textarea', {
        class: 'textarea', name: 'starterCode', rows: '4', spellcheck: 'false',
        style: { fontFamily: 'var(--font-code)' }
      }, ej ? ej.starterCode : '')),
    el('div', { class: 'form-field' },
      el('label', null, 'Archivos del ejercicio'),
      el('div', { class: 'form-note' }, archivos.length
        ? archivos.map((file) => file.name).join(', ')
        : 'Sin archivos adicionales. Puedes crearlo desde cero o subirlos desde tu equipo.'),
      archivos.length ? el('small', null, 'Se entregarán como archivos iniciales al estudiante.') : null),
    el('div', { class: 'form-field' },
      el('label', null, 'Criterios de evaluación'), critHost,
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
        el('button', { class: 'btn sm outline', type: 'button', onclick: () => addCriterio(null) }, icon('plus', 12), 'Añadir criterio'),
        suma)),
    el('div', { class: 'form-grid', style: { gap: '7px' } },
      el('label', { class: 'checkline' },
        el('input', { type: 'checkbox', name: 'isClassOnly', checked: ej ? ej.isClassOnly : false }),
        'Solo se puede resolver durante una clase activa'),
      el('label', { class: 'checkline' },
        el('input', { type: 'checkbox', name: 'allowLateSubmission', checked: ej ? ej.allowLateSubmission : true }),
        'Permitir entregas después de la fecha límite')));

  const audienceHost = el('div', { class: 'check-lista', style: { display: acotado ? '' : 'none' } });
  function pintarAudiencia() {
    clear(audienceHost);
    if (estudiantesCurso.length) {
      audienceHost.append(el('small', null, 'Estudiantes'));
      for (const est of estudiantesCurso) {
        audienceHost.append(el('label', { class: 'checkline' },
          el('input', {
            type: 'checkbox', checked: estSel.has(est.uid),
            onchange: (e) => { if (e.target.checked) estSel.add(est.uid); else estSel.delete(est.uid); }
          }),
          est.nombreCompleto || est.nombre));
      }
    }
    if (gruposCurso.length) {
      audienceHost.append(el('small', null, 'Grupos'));
      for (const g of gruposCurso) {
        audienceHost.append(el('label', { class: 'checkline' },
          el('input', {
            type: 'checkbox', checked: grpSel.has(g.id),
            onchange: (e) => { if (e.target.checked) grpSel.add(g.id); else grpSel.delete(g.id); }
          }),
          g.nombre + ' (' + g.miembros.length + ')'));
      }
    }
    if (!estudiantesCurso.length && !gruposCurso.length) {
      audienceHost.append(el('div', { class: 'empty-note' }, 'Todavía no hay estudiantes ni grupos en este curso.'));
    }
  }
  pintarAudiencia();

  const radioTodos = el('input', { type: 'radio', name: '_audienciaModo', value: 'todos', checked: !acotado });
  const radioAlgunos = el('input', { type: 'radio', name: '_audienciaModo', value: 'algunos', checked: acotado });
  radioTodos.addEventListener('change', () => { audienceHost.style.display = 'none'; });
  radioAlgunos.addEventListener('change', () => { audienceHost.style.display = ''; });

  form.append(el('div', { class: 'form-field' },
    el('label', null, '¿Para quién es?'),
    el('div', { style: { display: 'flex', gap: '16px', marginBottom: '6px' } },
      el('label', { class: 'checkline' }, radioTodos, 'Todo el curso'),
      el('label', { class: 'checkline' }, radioAlgunos, 'Estudiantes o grupos concretos')),
    audienceHost));

  if (ej && ej.rubric && ej.rubric.length) ej.rubric.forEach(addCriterio);
  form.querySelector('input[name="maxScore"]').addEventListener('input', actualizarSuma);
  actualizarSuma();

  const res = await modal({
    title: ej ? 'Editar ejercicio' : 'Nuevo ejercicio', body: form, wide: true,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;

  const datos = leerForm(form);
  datos.rubric = Array.from(critHost.querySelectorAll('.crit-row')).map((f) => ({
    name: f.querySelector('.crit-nombre').value,
    points: Number(f.querySelector('.crit-puntos').value) || 0
  })).filter((c) => c.name.trim());
  datos.files = archivos;
  if (!ej && archivos.length && !datos.starterCode.trim()) {
    const principal = archivos.find((file) => /\.pyw?$/i.test(file.name));
    if (principal) datos.starterCode = principal.content;
  }
  datos.publishedAt = datos.publishedAt ? new Date(datos.publishedAt).toISOString() : null;
  datos.dueDate = datos.dueDate ? new Date(datos.dueDate).toISOString() : null;
  if (ej) datos.id = ej.id;

  const out = await window.pc.exercises.save(datos);
  if (!out.ok) { marcar(form, out.errores); toast(out.error || 'Revisa los datos', { type: 'err' }); return; }

  // "Todo el curso" limpia cualquier destinatario previo; "concretos" los guarda.
  const destinatarios = radioAlgunos.checked
    ? { estudiantes: Array.from(estSel), grupos: Array.from(grpSel) }
    : { estudiantes: [], grupos: [] };
  await window.pc.exercises.setTargets(out.ejercicio.id, destinatarios);

  toast(ej ? 'Ejercicio actualizado' : 'Ejercicio creado', { type: 'ok' });
  if (hooks.onPublicado) hooks.onPublicado();
  if (hooks.refrescar) await hooks.refrescar();
}

async function subirEjercicio(temas) {
  const archivos = await window.pc.files.openFilesDialog();
  if (!archivos || !archivos.length) return;
  await ejercicioModal(null, temas, archivos);
}

/* -------------------------------------------------------------- clases */

async function pintarClases(host) {
  const [clases, ejercicios, temas] = await Promise.all([
    window.pc.classes.list(), window.pc.exercises.list(), window.pc.topics.list()
  ]);
  clear(host);

  host.append(el('div', { class: 'section-head' },
    el('h2', null, 'Clases'), el('span', { class: 'count' }, clases.length),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn sm primary', onclick: () => claseModal(null, ejercicios, temas) },
      icon('plus', 12), 'Nueva clase')));

  host.append(el('div', { class: 'form-note' },
    'Los ejercicios marcados como «solo en clase» únicamente se pueden abrir mientras ' +
    'la clase que los contiene está activa.'));

  if (!clases.length) {
    host.append(el('div', { class: 'empty-page' },
      icon('users', 34),
      el('b', null, 'Todavía no hay clases'),
      el('p', null, 'Una clase agrupa ejercicios y se abre y cierra cuando tú quieres.')));
    return;
  }

  const card = el('div', { class: 'card' });
  for (const c of clases) {
    card.append(el('div', { class: 'list-row' },
      el('span', { class: 'sb-dot', style: { background: c.activa ? 'var(--ok)' : 'var(--text-faint)' } }),
      el('div', { class: 'lr-main' },
        el('b', null, c.title),
        el('span', null, c.tema + '  ·  ' + c.ejercicios.length + ' ejercicio(s)' +
          (c.startTime ? '  ·  abierta ' + formatoFecha(c.startTime) : '') +
          (c.endTime ? '  ·  cerrada ' + formatoFecha(c.endTime) : ''))),
      el('span', { class: 'chip ' + (c.activa ? 'ok' : c.status === 'closed' ? 'err' : '') },
        c.activa ? 'ACTIVA' : c.status === 'closed' ? 'Finalizada' : 'Programada'),
      el('div', { class: 'lr-actions' },
        c.activa
          ? el('button', { class: 'btn sm danger', onclick: () => cambiarClase(c, 'closed') }, 'Cerrar clase')
          : el('button', { class: 'btn sm success', onclick: () => cambiarClase(c, 'active') }, 'Abrir clase'),
        el('button', { class: 'icon-btn', title: 'Editar', onclick: () => claseModal(c, ejercicios, temas) }, icon('edit', 15)),
        el('button', { class: 'icon-btn', title: 'Eliminar', onclick: () => borrarClase(c) }, icon('trash', 15)))));
  }
  host.append(card);
}

async function cambiarClase(c, estado) {
  if (estado === 'closed') {
    const ok = await confirmDialog(
      'Al cerrar la clase, sus ejercicios «solo en clase» dejarán de poder abrirse.' +
      (c.onClosePolicy === 'block' ? ' Los intentos abiertos se marcarán como abandonados.' : ' Quien ya estaba trabajando podrá terminar.'),
      { title: 'Cerrar clase', okLabel: 'Cerrar clase' });
    if (!ok) return;
  }
  const out = await window.pc.classes.setStatus(c.id, estado);
  if (!out.ok) { toast(out.error, { type: 'err' }); return; }
  toast(estado === 'active' ? 'Clase abierta' : 'Clase finalizada' +
    (out.bloqueados ? ' · ' + out.bloqueados + ' intento(s) marcados como abandonados' : ''), { type: 'ok' });
  if (hooks.onPublicado) hooks.onPublicado();
  if (hooks.refrescar) await hooks.refrescar();
}

async function borrarClase(c) {
  const ok = await confirmDialog('¿Eliminar la clase "' + c.title + '"?',
    { title: 'Eliminar clase', okLabel: 'Eliminar', danger: true });
  if (!ok) return;
  await window.pc.classes.remove(c.id);
  if (hooks.refrescar) await hooks.refrescar();
}

async function claseModal(c, ejercicios, temas) {
  const form = el('form', { class: 'form-grid', novalidate: true });
  const selTema = el('select', { class: 'select', name: 'topicId' },
    el('option', { value: '' }, 'Sin tema'),
    temas.map((t) => el('option', { value: t.id, selected: c && c.topicId === t.id }, t.nombre)));
  const selPolitica = el('select', { class: 'select', name: 'onClosePolicy' },
    el('option', { value: 'allow_finish', selected: !c || c.onClosePolicy === 'allow_finish' }, 'Permitir terminar lo empezado'),
    el('option', { value: 'block', selected: c && c.onClosePolicy === 'block' }, 'Bloquear inmediatamente'));

  const seleccion = new Set(c ? c.ejercicios.map((e) => e.id) : []);
  const lista = el('div', { class: 'check-lista' });
  for (const ej of ejercicios) {
    lista.append(el('label', { class: 'checkline' },
      el('input', {
        type: 'checkbox', checked: seleccion.has(ej.id), dataset: { ex: ej.id },
        onchange: (e) => { if (e.target.checked) seleccion.add(ej.id); else seleccion.delete(ej.id); }
      }),
      ej.title + (ej.isClassOnly ? '  (solo en clase)' : '')));
  }

  form.append(
    campoBox('title', 'Nombre de la clase',
      el('input', { class: 'input', name: 'title', value: c ? c.title : '', placeholder: 'Clase 15 — Funciones' })),
    el('div', { class: 'ex-form-grid' },
      campoBox('topicId', 'Tema', selTema),
      campoBox('onClosePolicy', 'Al cerrar la clase', selPolitica)),
    el('div', { class: 'form-field' },
      el('label', null, 'Ejercicios de esta clase'),
      ejercicios.length ? lista : el('div', { class: 'empty-note' }, 'Crea ejercicios primero.')));

  const res = await modal({
    title: c ? 'Editar clase' : 'Nueva clase', body: form,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;
  const datos = leerForm(form);
  datos.exerciseIds = Array.from(seleccion);
  if (c) datos.id = c.id;
  const out = await window.pc.classes.save(datos);
  if (!out.ok) { marcar(form, out.errores); toast(out.error || 'Revisa los datos', { type: 'err' }); return; }
  toast(c ? 'Clase actualizada' : 'Clase creada', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

/* --------------------------------------------------------------- retos */

async function pintarRetos(host) {
  const [retos, temas, ejercicios] = await Promise.all([
    window.pc.challenges.list(), window.pc.topics.list(), window.pc.exercises.list()
  ]);
  clear(host);

  host.append(el('div', { class: 'section-head' },
    el('h2', null, 'Retos especiales'), el('span', { class: 'count' }, retos.length),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn sm primary', onclick: () => retoModal(null, temas, ejercicios) },
      icon('plus', 12), 'Nuevo reto')));

  if (!retos.length) {
    host.append(el('div', { class: 'empty-page' },
      icon('star', 34),
      el('b', null, 'Todavía no hay retos'),
      el('p', null, 'Un reto es un ejercicio con más dificultad, más XP y un premio asociado.')));
    return;
  }

  const grid = el('div', { class: 'ex-grid' });
  for (const r of retos) {
    grid.append(el('div', { class: 'ex-card' + (r.status === 'draft' ? ' inactivo' : '') },
      el('div', { class: 'ex-top' },
        el('div', { class: 'ex-title' }, '🔥 ' + r.title),
        estrellas(r.difficulty)),
      el('div', { class: 'ex-meta' },
        el('span', { class: 'chip accent' }, r.tema),
        el('span', { class: 'chip ' + (r.disponible ? 'ok' : '') }, r.disponible ? 'Disponible' : r.status),
        el('span', { class: 'chip' }, '+' + r.xp + ' XP'),
        r.reward ? el('span', { class: 'chip warn' }, r.reward) : null),
      el('div', { class: 'ex-desc' }, r.description || 'Sin descripción.'),
      el('div', { class: 'ex-actions' },
        el('button', { class: 'btn sm outline', onclick: () => retoModal(r, temas, ejercicios) }, 'Editar'),
        el('button', {
          class: 'btn sm ' + (r.status === 'published' ? 'outline' : 'success'),
          onclick: async () => {
            await window.pc.challenges.save(Object.assign({}, r, {
              status: r.status === 'published' ? 'draft' : 'published'
            }));
            if (hooks.refrescar) await hooks.refrescar();
          }
        }, r.status === 'published' ? 'Ocultar' : 'Publicar'),
        el('button', {
          class: 'icon-btn', title: 'Eliminar',
          onclick: async () => {
            const ok = await confirmDialog('¿Eliminar el reto "' + r.title + '"?',
              { title: 'Eliminar reto', okLabel: 'Eliminar', danger: true });
            if (!ok) return;
            await window.pc.challenges.remove(r.id);
            if (hooks.refrescar) await hooks.refrescar();
          }
        }, icon('trash', 15)))));
  }
  host.append(grid);
}

async function retoModal(r, temas, ejercicios) {
  const form = el('form', { class: 'form-grid', novalidate: true });
  const selTema = el('select', { class: 'select', name: 'topicId' },
    el('option', { value: '' }, 'Sin tema'),
    temas.map((t) => el('option', { value: t.id, selected: r && r.topicId === t.id }, t.nombre)));
  const selEj = el('select', { class: 'select', name: 'exerciseId' },
    el('option', { value: '' }, 'Sin ejercicio asociado'),
    ejercicios.map((e) => el('option', { value: e.id, selected: r && r.exerciseId === e.id }, e.title)));
  const selDif = el('select', { class: 'select', name: 'difficulty' },
    Object.entries(DIFICULTAD).map(([v, t]) =>
      el('option', { value: v, selected: r ? r.difficulty === v : v === 'hard' }, t)));

  form.append(
    campoBox('title', 'Título del reto',
      el('input', { class: 'input', name: 'title', value: r ? r.title : '', placeholder: 'El número secreto' })),
    campoBox('description', 'Descripción',
      el('textarea', { class: 'textarea', name: 'description', rows: '3' }, r ? r.description : '')),
    el('div', { class: 'ex-form-grid' },
      campoBox('topicId', 'Tema', selTema),
      campoBox('difficulty', 'Dificultad', selDif),
      campoBox('xp', 'XP', el('input', { class: 'input', name: 'xp', type: 'number', min: '0', value: r ? r.xp : '100' })),
      campoBox('maxAttempts', 'Intentos',
        el('input', { class: 'input', name: 'maxAttempts', type: 'number', min: '0', value: r ? r.maxAttempts : '1' }))),
    campoBox('reward', 'Premio',
      el('input', { class: 'input', name: 'reward', value: r ? r.reward : '', placeholder: 'Insignia 🏆 Maestro de funciones' })),
    campoBox('requirements', 'Requisitos',
      el('textarea', { class: 'textarea', name: 'requirements', rows: '2' }, r ? r.requirements : '')),
    el('div', { class: 'ex-form-grid' },
      campoBox('startDate', 'Desde',
        el('input', { class: 'input', name: 'startDate', type: 'datetime-local', value: r ? fechaInput(r.startDate) : '' })),
      campoBox('endDate', 'Hasta',
        el('input', { class: 'input', name: 'endDate', type: 'datetime-local', value: r ? fechaInput(r.endDate) : '' }))),
    campoBox('ejercicio', 'Ejercicio que hay que resolver', selEj),
    el('div', { class: 'form-note' },
      'Si el reto tiene un ejercicio asociado, el estudiante lo resuelve con el mismo flujo que ' +
      'cualquier otro ejercicio. El premio se configura en la pestaña Premios y se concede al calificar.'));

  const res = await modal({
    title: r ? 'Editar reto' : 'Nuevo reto', body: form, wide: true,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;
  const datos = leerForm(form);
  datos.startDate = datos.startDate ? new Date(datos.startDate).toISOString() : null;
  datos.endDate = datos.endDate ? new Date(datos.endDate).toISOString() : null;
  if (r) { datos.id = r.id; datos.status = r.status; }
  const out = await window.pc.challenges.save(datos);
  if (!out.ok) { marcar(form, out.errores); toast(out.error || 'Revisa los datos', { type: 'err' }); return; }
  toast(r ? 'Reto actualizado' : 'Reto creado', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
}

/* =========================================================== estudiante */

async function vistaEstudiante(host) {
  const [temas, ejercicios, mias] = await Promise.all([
    window.pc.topics.list(), window.pc.exercises.list(), window.pc.submissions.mine()
  ]);

  const porEjercicio = new Map();
  for (const s of mias) {
    const previo = porEjercicio.get(s.exerciseId);
    if (!previo || s.attemptNumber > previo.attemptNumber) porEjercicio.set(s.exerciseId, s);
  }

  const page = el('div', { class: 'page' });

  const selTema = el('select', { class: 'select', style: { width: 'auto', minWidth: '150px' } },
    el('option', { value: '' }, 'Todos los temas'),
    temas.filter((t) => ejercicios.some((e) => e.topicId === t.id))
      .map((t) => el('option', { value: t.id, selected: filtroTema === t.id }, t.nombre)));
  selTema.addEventListener('change', () => { filtroTema = selTema.value; if (hooks.refrescar) hooks.refrescar(); });

  const selEstado = el('select', { class: 'select', style: { width: 'auto', minWidth: '150px' } },
    [['', 'Todos'], ['pendiente', 'Pendientes'], ['en_curso', 'En curso'],
      ['entregado', 'Entregados'], ['calificado', 'Calificados']]
      .map(([v, t]) => el('option', { value: v, selected: filtroEstado === v }, t)));
  selEstado.addEventListener('change', () => { filtroEstado = selEstado.value; if (hooks.refrescar) hooks.refrescar(); });

  page.append(el('div', { class: 'page-head' },
    el('div', { class: 'ph-text' },
      el('h1', null, 'Ejercicios'),
      el('p', null, 'Lo que ha publicado tu profesor. Al empezar uno se crea tu carpeta de trabajo.')),
    el('div', { class: 'ph-actions' }, selTema, selEstado)));

  const clasificar = (ej) => {
    const s = porEjercicio.get(ej.id);
    if (!s) return 'pendiente';
    if (s.status === 'graded' || s.status === 'returned') return 'calificado';
    if (s.status === 'submitted' || s.status === 'under_review' || s.status === 'late') return 'entregado';
    if (s.status === 'in_progress' || s.status === 'draft') return 'en_curso';
    return 'pendiente';
  };

  const visibles = ejercicios.filter((ej) => {
    if (filtroTema && ej.topicId !== filtroTema) return false;
    if (filtroEstado && clasificar(ej) !== filtroEstado) return false;
    return true;
  });

  if (!ejercicios.length) {
    page.append(el('div', { class: 'empty-page' },
      icon('tasks', 34),
      el('b', null, 'Todavía no hay ejercicios disponibles'),
      el('p', null, 'Cuando tu profesor publique uno aparecerá aquí. Mientras tanto puedes practicar en el editor.'),
      el('button', { class: 'btn primary', onclick: () => hooks.irEditor && hooks.irEditor() }, 'Abrir el editor')));
  } else if (!visibles.length) {
    page.append(el('div', { class: 'empty-page' },
      icon('search', 30),
      el('b', null, 'Ningún ejercicio con esos filtros'),
      el('p', null, 'Tienes ' + ejercicios.length + ' ejercicio(s), pero los filtros los están ocultando.'),
      el('button', {
        class: 'btn primary',
        onclick: () => { limpiarFiltros(); if (hooks.refrescar) hooks.refrescar(); }
      }, 'Quitar los filtros')));
  } else {
    const grid = el('div', { class: 'ex-grid' });
    for (const ej of visibles) grid.append(tarjetaEstudiante(ej, porEjercicio.get(ej.id), clasificar(ej)));
    page.append(grid);
  }

  await pintarRetosEstudiante(page, ejercicios, porEjercicio);

  clear(host).append(page);
}

/**
 * Seccion de retos del estudiante (fase 4).
 *
 * Un reto se resuelve con el MISMO flujo que cualquier ejercicio: se abre el
 * ejercicio asociado con hooks.abrirEjercicio, que entra en
 * exercise-session.js. No hay ningun sistema paralelo.
 */
async function pintarRetosEstudiante(page, ejercicios, porEjercicio) {
  const [retos, premios] = await Promise.all([
    window.pc.challenges.list(), window.pc.rewards.list()
  ]);
  const disponibles = retos.filter((r) => r.disponible);
  if (!disponibles.length) return;

  page.append(el('div', { class: 'section-head' },
    el('h2', null, '🔥 Retos'), el('span', { class: 'count' }, disponibles.length)));

  const grid = el('div', { class: 'ex-grid' });
  for (const r of disponibles) {
    const ej = r.exerciseId ? ejercicios.find((e) => e.id === r.exerciseId) : null;
    if (r.exerciseId && !ej) continue;
    const s = ej ? porEjercicio.get(ej.id) : null;
    const calificado = s && (s.status === 'graded' || s.status === 'returned');
    const entregado = s && ['submitted', 'under_review', 'late'].indexOf(s.status) !== -1;
    const premio = premios.find((p) => p.scope === 'challenge' && p.challengeId === r.id && p.active);

    grid.append(el('div', { class: 'ex-card reto' + (calificado ? ' calificado' : entregado ? ' entregado' : '') },
      el('div', { class: 'ex-top' },
        el('div', { class: 'ex-title' }, '🔥 ' + r.title),
        estrellas(r.difficulty)),
      el('div', { class: 'ex-meta' },
        el('span', { class: 'chip accent' }, r.tema),
        el('span', { class: 'chip' }, '+' + r.xp + ' XP'),
        s ? chipEstado(s.status) : null,
        premio && premio.insignia
          ? el('span', { class: 'chip warn' }, 'premio: ' + premio.insignia.name)
          : (r.reward ? el('span', { class: 'chip warn' }, r.reward) : null),
        r.endDate ? el('span', { class: 'chip' }, 'hasta ' + formatoFecha(r.endDate)) : null),
      el('div', { class: 'ex-desc' }, r.description || 'Sin descripción.'),
      r.requirements ? el('div', { class: 'form-note' }, 'Requisitos: ' + r.requirements) : null,
      !ej ? el('div', { class: 'form-note warn' }, 'Este reto todavía no tiene ejercicio asociado.') : null,
      el('div', { class: 'ex-actions' },
        ej && (calificado || entregado)
          ? el('button', {
            class: 'btn sm primary',
            onclick: () => hooks.verResultado && hooks.verResultado(s.id)
          }, 'Ver resultado')
          : el('button', {
            class: 'btn sm primary',
            disabled: !ej || !ej.disponible,
            title: ej ? (ej.disponible ? '' : ej.motivoNoDisponible) : 'Sin ejercicio asociado',
            onclick: () => ej && hooks.abrirEjercicio && hooks.abrirEjercicio(ej.id)
          }, s && (s.status === 'in_progress' || s.status === 'draft') ? 'Continuar el reto' : 'Aceptar el reto'))));
  }
  page.append(grid);
}

function tarjetaEstudiante(ej, s, clase) {
  const calificado = clase === 'calificado';
  const entregado = clase === 'entregado';
  const enCurso = clase === 'en_curso';

  return el('div', { class: 'ex-card ' + clase },
    el('div', { class: 'ex-top' },
      el('div', { class: 'ex-title' }, ej.title),
      estrellas(ej.difficulty)),
    el('div', { class: 'ex-meta' },
      el('span', { class: 'chip accent' }, ej.tema),
      s ? chipEstado(s.status) : el('span', { class: 'chip' }, 'Pendiente'),
      el('span', { class: 'chip' }, ej.xp + ' XP'),
      ej.timeLimit ? el('span', { class: 'chip warn' }, ej.timeLimit + ' min') : null,
      el('span', { class: 'chip', title: AYUDA.intentos },
        'Intentos ' + textoIntentos(ej.attempts, ej.maxAttempts)),
      ej.isClassOnly ? el('span', { class: 'chip warn' }, 'solo en clase') : null),
    el('div', { class: 'ex-desc' }, ej.description || 'Sin descripción.'),

    calificado && s
      ? el('div', { class: 'nota-caja' },
        el('div', { class: 'nota-valor' }, textoNota(s.grade, s.maxScore)),
        el('div', null,
          el('b', null, '+' + (s.xpEarned || 0) + ' XP'),
          s.teacherComment ? el('span', null, s.teacherComment.slice(0, 90) + (s.teacherComment.length > 90 ? '…' : '')) : null))
      : null,

    entregado ? el('div', { class: 'form-note' }, 'Entregado. Tu profesor lo está revisando.') : null,
    !ej.disponible && !s ? el('div', { class: 'form-note warn' }, ej.motivoNoDisponible) : null,
    ej.dueDate ? el('div', { style: { fontSize: '11px', color: 'var(--warn)' } }, 'Cierra el ' + formatoFecha(ej.dueDate)) : null,

    el('div', { class: 'ex-actions' },
      el('button', { class: 'btn sm outline', onclick: () => enunciadoModal(ej) }, 'Enunciado'),
      calificado || entregado
        ? el('button', { class: 'btn sm primary', onclick: () => hooks.verResultado && hooks.verResultado(s.id) }, 'Ver resultado')
        : el('button', {
          class: 'btn sm primary', disabled: !ej.disponible,
          title: ej.disponible ? '' : ej.motivoNoDisponible,
          onclick: () => hooks.abrirEjercicio && hooks.abrirEjercicio(ej.id)
        }, enCurso ? 'Continuar' : 'Comenzar')));
}

async function enunciadoModal(ej) {
  const res = await modal({
    title: ej.title, wide: true,
    body: el('div', null,
      el('div', { class: 'ex-meta', style: { marginBottom: '10px' } },
        el('span', { class: 'chip accent' }, ej.tema),
        estrellas(ej.difficulty),
        el('span', { class: 'chip' }, ej.xp + ' XP'),
        el('span', { class: 'chip' }, 'Nota máxima ' + ej.maxScore),
        ej.maxAttempts
          ? el('span', { class: 'chip', title: AYUDA.intentos }, ej.maxAttempts + ' intento(s)')
          : null,
        ej.timeLimit ? el('span', { class: 'chip warn' }, ej.timeLimit + ' min') : null),
      ej.description ? el('p', null, ej.description) : null,
      el('h4', { style: { fontSize: '12.5px', color: 'var(--text-strong)', margin: '12px 0 6px' } }, 'Instrucciones'),
      el('div', { class: 'enunciado' }, ej.instructions || '(sin instrucciones adicionales)'),
      ej.rubric && ej.rubric.length
        ? el('div', null,
          el('h4', { style: { fontSize: '12.5px', color: 'var(--text-strong)', margin: '12px 0 6px' } }, 'Cómo se evalúa'),
          el('div', { class: 'card' }, ej.rubric.map((c) => el('div', { class: 'list-row' },
            el('div', { class: 'lr-main' }, el('b', null, c.name)),
            el('div', { class: 'lr-num' }, c.points)))))
        : null),
    buttons: [
      { label: 'Cerrar', value: null },
      ej.disponible ? { label: 'Comenzar ejercicio', value: 'go', primary: true } : null
    ].filter(Boolean)
  });
  if (res === 'go' && hooks.abrirEjercicio) hooks.abrirEjercicio(ej.id);
}

/* ------------------------------------------------------------- entrada */

export async function renderEjercicios(host) {
  const usuario = await window.pc.session.me();
  if (!usuario) { clear(host); return; }
  if (usuario.rol === 'profesor') await vistaProfesor(host);
  else await vistaEstudiante(host);
}

export async function nuevoEjercicio() {
  const temas = await window.pc.topics.list();
  if (!temas.length) { toast('Primero crea al menos un tema.', { type: 'warn' }); await temaModal(null); return; }
  pestana = 'ejercicios';
  await ejercicioModal(null, temas);
}

export function irPestana(p) { pestana = p; }

/** Filtros de la vista del estudiante (los usa también el aviso de ocultos). */
export function filtrosActuales() { return { tema: filtroTema, estado: filtroEstado }; }

export function limpiarFiltros() { filtroTema = ''; filtroEstado = ''; }
