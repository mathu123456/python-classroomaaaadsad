/*
 * Bandeja de entregas y pantalla de revision del profesor (secciones 9, 10,
 * 11, 12, 23 y 24 del pliego).
 *
 * Tres paneles: informacion del estudiante, codigo con comentarios por linea,
 * y evaluacion. El codigo se muestra con el mismo CodeMirror del editor, en
 * solo lectura, con numeracion, resaltado y marcadores en el margen.
 */

import { $, el, icon, clear, toast, modal, confirmDialog, promptDialog, debounce } from './ui.js';
import {
  EditorState, EditorView, lineNumbers, highlightSpecialChars, drawSelection,
  highlightActiveLine, keymap, defaultKeymap, searchKeymap, search, openSearchPanel,
  Decoration, StateField, StateEffect, RangeSetBuilder, python
} from './vendor/cm6.js';
import { syntaxExtension, darkFlag } from './theme.js';
import { formatoFecha, formatoTiempo, chipEstado, textoEstado, textoNota, textoIntentos, ayuda, AYUDA }
  from './dashboard.js';
import { avatar } from './avatar.js';
import { ordenarArchivos, lineas } from './entrega-archivos.js';
import { PanelEjecucion } from './run-panel.js';

let hooks = {};
let filtroActual = 'pending';
let vista = null;            // entrega abierta { submission, view, lineaSeleccionada }

const TIPOS = [
  { id: 'error', etiqueta: 'Error', icono: 'alert', color: 'var(--error)' },
  { id: 'warning', etiqueta: 'Advertencia', icono: 'alert', color: 'var(--warn)' },
  { id: 'suggestion', etiqueta: 'Sugerencia', icono: 'info', color: 'var(--accent)' },
  { id: 'positive', etiqueta: 'Bien hecho', icono: 'check-circle', color: 'var(--ok)' },
  { id: 'question', etiqueta: 'Pregunta', icono: 'info', color: 'var(--syn-decorator)' }
];

const TIPO_POR_ID = TIPOS.reduce((a, t) => { a[t.id] = t; return a; }, {});

export function init(appHooks) { hooks = appHooks || {}; }

/*
 * Los archivos de una entrega.
 *
 * Desde 1.0.0 una entrega puede traer una carpeta entera (un `main.py` que
 * importa sus modulos, datos de ejemplo…). Las entregas de siempre, de un solo
 * archivo, se ven exactamente igual que antes: se presentan como un unico
 * `main.py` y no aparece ninguna pestana.
 */
function archivosDe(s) {
  const lista = (s && s.files) || [];
  if (lista.length) return ordenarArchivos(lista);
  return [{ name: 'main.py', content: (s && s.code) || '' }];
}

/**
 * Cual es el archivo que se ejecuta y que se abre primero al revisar: el que
 * dijo el estudiante al entregar y, si no dijo nada, el de siempre.
 */
function principalDe(archivos, s) {
  const buscar = (n) => archivos.find((f) => f.name === n);
  const dicho = s && s.entryFile ? buscar(s.entryFile) : null;
  return (dicho || buscar('main.py') || buscar('solucion.py') ||
    archivos.find((f) => /\.py$/i.test(f.name)) || archivos[0]).name;
}

function contenidoDe(s, nombre) {
  const f = archivosDe(s).find((x) => x.name === nombre);
  return f ? (f.content || '') : '';
}

/* ====================================================== bandeja (lista) */

/*
 * Cuantas entregas se piden de golpe. Con un curso entero puede haber cientos:
 * se traen por tandas para que la pantalla salga rapido, y quien quiera ver mas
 * pulsa el boton del final. Al cambiar de filtro se vuelve a la primera tanda.
 */
const TANDA = 60;
let limiteBandeja = TANDA;

export async function renderEntregas(host) {
  const usuario = await window.pc.session.me();
  if (!usuario || usuario.rol !== 'profesor') {
    clear(host).append(el('div', { class: 'page' },
      el('div', { class: 'empty-page' }, el('b', null, 'Solo el profesor revisa entregas.'))));
    return;
  }

  const [contadores, lote] = await Promise.all([
    window.pc.submissions.counters(),
    window.pc.submissions.review({ status: filtroActual, limit: limiteBandeja })
  ]);

  const page = el('div', { class: 'page' });
  page.append(el('div', { class: 'page-head' },
    el('div', { class: 'ph-text' },
      el('h1', null, 'Entregas'),
      el('p', null, 'Revisa el código, deja comentarios por línea y califica.')),
    el('div', { class: 'ph-actions' },
      el('button', { class: 'btn outline', onclick: () => hooks.refrescar && hooks.refrescar() },
        icon('refresh', 14), 'Actualizar'))
  ));

  /* Los cinco estados del pliego, con el mismo nombre que ve el estudiante. */
  const filtros = [
    ['pending', 'Pendientes de revisión', contadores.pendientes, ''],
    ['reviewing', 'En revisión', contadores.enRevision, ''],
    ['graded', 'Calificadas', contadores.calificadas, ''],
    ['abandoned', 'Abandonadas', contadores.abandonadas, AYUDA.abandonado],
    ['late', 'Fuera de tiempo', contadores.tardias, AYUDA.fueraDeTiempo],
    ['all', 'Todas', null, '']
  ];
  const barra = el('div', { class: 'filtro-barra' });
  for (const [id, etiqueta, n, explicacion] of filtros) {
    barra.append(el('button', {
      class: 'btn sm ' + (filtroActual === id ? 'primary' : 'outline'),
      title: explicacion || undefined,
      onclick: () => {
        filtroActual = id;
        limiteBandeja = TANDA;
        if (hooks.refrescar) hooks.refrescar();
      }
    }, etiqueta, n != null ? el('span', { class: 'chip', style: { marginLeft: '6px' } }, String(n)) : null));
  }
  page.append(barra);

  if (!lote.items.length) {
    page.append(el('div', { class: 'empty-page' },
      icon('tasks', 34),
      el('b', null, 'No hay entregas en este filtro'),
      el('p', null, 'Cuando tus estudiantes entreguen, aparecerán aquí.')));
  } else {
    const card = el('div', { class: 'card' });
    for (const s of lote.items) card.append(filaEntrega(s));
    page.append(card);
    page.append(el('div', { class: 'lista-pie' },
      el('p', null, 'Mostrando ' + lote.items.length + ' de ' + lote.total + ' entregas.'),
      lote.items.length < lote.total
        ? el('button', {
          class: 'btn sm outline',
          onclick: () => { limiteBandeja += TANDA; if (hooks.refrescar) hooks.refrescar(); }
        }, 'Ver ' + Math.min(TANDA, lote.total - lote.items.length) + ' más')
        : null));
  }

  clear(host).append(page);
}

function filaEntrega(s) {
  const est = s.estudiante || { nombre: 'Estudiante', color: 'var(--accent)', iniciales: '?' };
  return el('div', { class: 'list-row entrega-row', onclick: () => abrirRevision(s.id) },
    avatar(est, 30, { clase: 'av' }),
    el('div', { class: 'lr-main' },
      el('b', null, est.nombre),
      el('span', null, (s.ejercicio ? s.ejercicio.title : 'Ejercicio') +
        '  ·  intento ' + s.attemptNumber +
        '  ·  ' + formatoFecha(s.submittedAt || s.updatedAt) +
        (s.timeSpentSec ? '  ·  ' + formatoTiempo(s.timeSpentSec) : ''))),
    s.isLate ? el('span', { class: 'chip warn' }, 'tarde') : null,
    chipEstado(s.status),
    s.grade != null ? el('div', { class: 'lr-num' }, s.grade + ' / ' + s.maxScore) : null,
    el('button', { class: 'btn sm primary' }, s.status === 'graded' ? 'Ver' : 'Revisar')
  );
}

/* ==================================================== pantalla de revision */

export async function abrirRevision(submissionId) {
  const s = await window.pc.submissions.get(submissionId);
  if (!s) { toast('La entrega ya no existe.', { type: 'err' }); return; }

  if (s.status === 'submitted' || s.status === 'late') {
    await window.pc.submissions.setStatus(submissionId, 'under_review');
    s.status = 'under_review';
  }

  vista = {
    submission: s,
    lineaSeleccionada: null,
    view: null,
    archivo: principalDe(archivosDe(s), s),
    panelEjecucion: null
  };
  if (hooks.mostrarPagina) hooks.mostrarPagina('revision');
}

/** Pinta la pantalla completa de revision en el contenedor de paginas. */
export async function renderRevision(host) {
  if (!vista) {
    clear(host).append(el('div', { class: 'page' },
      el('div', { class: 'empty-page' },
        el('b', null, 'No hay ninguna entrega abierta'),
        el('button', { class: 'btn primary', onclick: () => hooks.irEntregas && hooks.irEntregas() }, 'Ver entregas'))));
    return;
  }

  // Se relee siempre: puede haber llegado retroalimentacion nueva o una
  // sincronizacion desde otro equipo.
  const fresca = await window.pc.submissions.get(vista.submission.id);
  if (fresca) vista.submission = fresca;

  const s = vista.submission;
  const est = s.estudiante || {};
  const ej = s.ejercicio || {};

  const layout = el('div', { class: 'revision' });

  /* ---------------- panel izquierdo: informacion ---------------- */
  const izq = el('aside', { class: 'rev-info' },
    el('button', { class: 'btn sm outline', onclick: () => { cerrarRevision(); if (hooks.irEntregas) hooks.irEntregas(); } },
      icon('arrow-left', 13), 'Volver a entregas'),
    el('div', { class: 'rev-student' },
      avatar(est, 44),
      el('div', null,
        el('b', null, est.nombre || 'Estudiante'),
        el('span', null, est.email || ''),
        est.grado || est.grupo ? el('span', null, 'Grado ' + (est.grado || '—') + ' · Grupo ' + (est.grupo || '—')) : null)),
    el('dl', { class: 'info-grid', style: { padding: '10px 0' } },
      el('dt', null, 'Ejercicio'), el('dd', null, ej.title || '—'),
      el('dt', null, 'Tema'), el('dd', null, ej.tema || '—'),
      el('dt', null, 'Intento'), el('dd', null, String(s.attemptNumber) + (ej.maxAttempts ? ' de ' + ej.maxAttempts : '')),
      el('dt', null, 'Estado'), el('dd', null, textoEstado(s.status)),
      el('dt', null, 'Iniciado'), el('dd', null, formatoFecha(s.startedAt)),
      el('dt', null, 'Entregado'), el('dd', null, formatoFecha(s.submittedAt)),
      el('dt', null, 'Tiempo'), el('dd', null, formatoTiempo(s.timeSpentSec)),
      el('dt', null, 'A tiempo'), el('dd', null, s.isLate ? 'No (tarde)' : 'Sí')),
    seccionEventos(s),
    seccionHistorial(s),
    seccionIntentos(s)
  );

  /* ---------------- panel central: archivos, codigo y ejecucion ---------------- */
  const archivos = archivosDe(s);
  if (!archivos.find((f) => f.name === vista.archivo)) vista.archivo = principalDe(archivos, s);
  const actual = vista.archivo;
  const principal = principalDe(archivos, s);

  const pestanas = el('div', { class: 'rev-files' });
  for (const f of archivos) {
    const conComentarios = (s.feedback || []).filter((c) => (c.file || principal) === f.name).length;
    pestanas.append(el('button', {
      class: 'rev-file' + (f.name === actual ? ' on' : ''),
      title: f.name + (f.name === principal ? ' · es el archivo que se ejecuta' : ''),
      onclick: () => { vista.archivo = f.name; if (hooks.refrescar) hooks.refrescar(); }
    },
      icon(/\.py$/i.test(f.name) ? 'py' : 'file', 13),
      f.name,
      f.name === principal ? el('span', { class: 'chip' }, 'principal') : null,
      conComentarios ? el('span', { class: 'chip warn' }, String(conComentarios)) : null));
  }

  const centro = el('section', { class: 'rev-code' },
    archivos.length > 1 ? pestanas : null,
    el('div', { class: 'rev-code-head' },
      icon(/\.py$/i.test(actual) ? 'py' : 'file', 15),
      el('b', null, actual),
      el('span', { class: 'chip' }, lineas(contenidoDe(s, actual)) + ' líneas'),
      archivos.length > 1
        ? el('span', { class: 'chip', title: 'Se entregó la carpeta completa.' },
          archivos.length + ' archivos')
        : null,
      el('span', { style: { flex: '1' } }),
      el('button', { class: 'btn sm outline', onclick: () => { if (vista.view) { openSearchPanel(vista.view); vista.view.focus(); } } },
        icon('search', 13), 'Buscar'),
      el('button', { class: 'btn sm primary', id: 'rev-run-btn', onclick: () => ejecutarEntrega(s) },
        icon('play', 12), 'Ejecutar la entrega'),
      el('button', {
        class: 'btn sm outline',
        title: 'Abre una copia de la entrega en el editor, para trastear sin tocar nada del estudiante.',
        onclick: () => abrirEnElEditor(s)
      }, 'Abrir en el editor')),
    el('div', { class: 'rev-code-body', id: 'rev-code-host' }),
    el('div', { class: 'rev-run', id: 'rev-run', hidden: true }),
    el('div', { class: 'rev-hint' },
      icon('info', 12),
      ' Haz clic en el número de una línea para comentarla. Los comentarios se marcan en el margen.' +
      (archivos.length > 1 ? ' Cada archivo lleva sus propios comentarios.' : ''))
  );

  /* ---------------- panel derecho: evaluacion ---------------- */
  const der = el('aside', { class: 'rev-grade', id: 'rev-grade' });

  layout.append(izq, centro, der);
  clear(host).append(layout);

  /*
   * La consola de la ejecucion sobrevive al repintado: si el profesor esta
   * mirando la salida y entra una entrega nueva, no se le borra lo que ve.
   */
  if (vista.panelEjecucion) {
    const zona = $('#rev-run');
    vista.panelEjecucion.montarEn(zona);
    zona.hidden = false;
    if (vista.panelEjecucion.estaEjecutando()) {
      const btn = $('#rev-run-btn');
      if (btn) clear(btn).append(icon('stop', 12), 'Detener');
    }
  }

  montarCodigo(s);
  pintarEvaluacion(der, s);
}

function seccionEventos(s) {
  const eventos = s.eventos || [];
  const salidas = eventos.filter((e) => ['FOCUS_LOST', 'WINDOW_MINIMIZED', 'EXERCISE_EXIT'].indexOf(e.type) !== -1);
  return el('div', null,
    el('div', { class: 'side-section-title', style: { padding: '10px 0 4px' } }, 'Actividad'),
    salidas.length
      ? el('div', { class: 'form-note warn' },
        salidas.length + ' salida(s) del ejercicio registradas. Es un dato de control académico, ' +
        'no una prueba de copia.')
      : el('div', { style: { fontSize: '11.5px', color: 'var(--text-muted)' } },
        'Sin salidas del ejercicio registradas.'),
    eventos.length
      ? el('div', { class: 'rev-eventos' },
        eventos.slice(0, 8).map((e) => el('div', null,
          el('span', null, e.type.toLowerCase().replace(/_/g, ' ')),
          el('small', null, formatoFecha(e.timestamp)))))
      : null
  );
}

function seccionHistorial(s) {
  const h = s.gradeHistory || [];
  if (!h.length) return null;
  return el('div', null,
    el('div', { class: 'side-section-title', style: { padding: '10px 0 4px' } }, 'Historial de notas'),
    el('div', { class: 'rev-eventos' },
      h.map((g) => el('div', null,
        el('span', null, (g.oldGrade == null ? '—' : g.oldGrade) + ' → ' + g.newGrade + '  ' + (g.reason || '')),
        el('small', null, formatoFecha(g.changedAt)))))
  );
}

function seccionIntentos(s) {
  return el('div', null,
    el('div', { class: 'side-section-title', style: { padding: '10px 0 4px' } }, 'Otros intentos'),
    el('div', { id: 'rev-intentos', style: { fontSize: '11.5px', color: 'var(--text-muted)' } }, 'Cargando…'));
}

/* ------------------------------------------------------- visor de codigo */

const marcarLineas = StateEffect.define();

function campoDecoraciones(lineasPorTipo) {
  return StateField.define({
    create(state) { return construirDecoraciones(state, lineasPorTipo); },
    update(valor, tr) {
      for (const e of tr.effects) {
        if (e.is(marcarLineas)) return construirDecoraciones(tr.state, e.value);
      }
      return tr.docChanged ? construirDecoraciones(tr.state, lineasPorTipo) : valor;
    },
    provide: (f) => EditorView.decorations.from(f)
  });
}

function construirDecoraciones(state, mapa) {
  const builder = new RangeSetBuilder();
  const numeros = Object.keys(mapa).map(Number).sort((a, b) => a - b);
  for (const n of numeros) {
    if (n < 1 || n > state.doc.lines) continue;
    const line = state.doc.line(n);
    builder.add(line.from, line.from, Decoration.line({ class: 'cm-fb-line cm-fb-' + mapa[n] }));
  }
  return builder.finish();
}

function montarCodigo(s) {
  const host = $('#rev-code-host');
  if (!host) return;
  clear(host);

  // Solo los comentarios del archivo que se esta viendo.
  const principal = principalDe(archivosDe(s), s);
  const feedback = (s.feedback || []).filter((f) => (f.file || principal) === vista.archivo);
  const mapa = {};
  for (const f of feedback) {
    const prioridad = { error: 4, warning: 3, question: 2, suggestion: 1, positive: 0 };
    if (!mapa[f.line] || prioridad[f.type] > prioridad[mapa[f.line]]) mapa[f.line] = f.type;
  }

  const oscuro = document.documentElement.dataset.theme !== 'light';

  const state = EditorState.create({
    doc: contenidoDe(s, vista.archivo),
    extensions: [
      lineNumbers({
        domEventHandlers: {
          click: (view, bloque) => {
            const linea = view.state.doc.lineAt(bloque.from).number;
            abrirComentario(linea);
            return true;
          }
        }
      }),
      highlightSpecialChars(),
      drawSelection(),
      highlightActiveLine(),
      search({ top: true }),
      keymap.of([...defaultKeymap, ...searchKeymap]),
      python(),
      syntaxExtension(),
      darkFlag(oscuro),
      campoDecoraciones(mapa),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping
    ]
  });

  vista.view = new EditorView({ state, parent: host });
  cargarIntentos(s);
}

async function cargarIntentos(s) {
  const nodo = $('#rev-intentos');
  if (!nodo) return;
  try {
    const lote = await window.pc.submissions.review({ studentId: s.studentId, exerciseId: s.exerciseId, limit: 10 });
    clear(nodo);
    if (lote.items.length <= 1) { nodo.textContent = 'Este es el único intento.'; return; }
    for (const otro of lote.items) {
      nodo.append(el('button', {
        class: 'btn sm ' + (otro.id === s.id ? 'primary' : 'outline'),
        style: { marginRight: '4px', marginBottom: '4px' },
        onclick: () => { if (otro.id !== s.id) abrirRevision(otro.id).then(() => hooks.refrescar && hooks.refrescar()); }
      }, 'Intento ' + otro.attemptNumber + (otro.grade != null ? ' · ' + otro.grade : '')));
    }
  } catch (err) {
    nodo.textContent = 'No se pudieron cargar los intentos.';
  }
}

function irALinea(n) {
  if (!vista || !vista.view) return;
  const doc = vista.view.state.doc;
  const linea = doc.line(Math.min(Math.max(1, n), doc.lines));
  vista.view.dispatch({ selection: { anchor: linea.from }, scrollIntoView: true });
}

/* ---------------------------------------------------- comentarios linea */

async function abrirComentario(linea, existente) {
  const s = vista.submission;
  const archivo = vista.archivo;
  const codigoLinea = contenidoDe(s, archivo).split('\n')[linea - 1] || '';

  const selTipo = el('div', { class: 'tipo-selector' });
  let tipoElegido = existente ? existente.type : 'suggestion';
  const botones = TIPOS.map((t) => {
    const b = el('button', {
      class: 'tipo-btn' + (tipoElegido === t.id ? ' on' : ''),
      type: 'button',
      style: { borderColor: tipoElegido === t.id ? t.color : '' },
      onclick: () => {
        tipoElegido = t.id;
        for (const otro of botones) otro.classList.remove('on');
        b.classList.add('on');
      }
    }, icon(t.icono, 13), t.etiqueta);
    selTipo.append(b);
    return b;
  });

  const texto = el('textarea', {
    class: 'textarea', rows: '4',
    placeholder: 'Debes comprobar que la lista no esté vacía.'
  }, existente ? existente.message : '');

  const body = el('div', { class: 'form-grid' },
    el('div', { class: 'linea-preview' },
      el('span', { class: 'ln' }, String(linea)),
      el('code', null, codigoLinea.length > 120 ? codigoLinea.slice(0, 120) + '…' : (codigoLinea || '(línea vacía)'))),
    el('div', { class: 'form-field' }, el('label', null, 'Tipo de comentario'), selTipo),
    el('div', { class: 'form-field' }, el('label', null, 'Comentario'), texto)
  );

  const botonesModal = [{ label: 'Cancelar', value: null }];
  if (existente) botonesModal.push({ label: 'Eliminar', value: 'del', variant: 'danger' });
  botonesModal.push({ label: existente ? 'Guardar' : 'Añadir', value: 'ok', primary: true });

  const res = await modal({
    title: 'Comentario en ' + archivo + ', línea ' + linea,
    body,
    buttons: botonesModal
  });

  if (res === 'del' && existente) {
    await window.pc.feedback.remove(existente.id);
    await recargarEntrega();
    return;
  }
  if (res !== 'ok') return;

  const out = await window.pc.feedback.save({
    id: existente ? existente.id : undefined,
    submissionId: s.id,
    file: archivo,
    line: linea,
    type: tipoElegido,
    message: texto.value
  });
  if (!out.ok) {
    toast(out.error || Object.values(out.errores || {})[0] || 'No se pudo guardar', { type: 'err' });
    return;
  }
  await recargarEntrega();
}

async function recargarEntrega() {
  if (!vista) return;
  const s = await window.pc.submissions.get(vista.submission.id);
  vista.submission = s;
  montarCodigo(s);
  pintarEvaluacion($('#rev-grade'), s);
}

/* ------------------------------------------------------ panel evaluacion */

function pintarEvaluacion(host, s) {
  if (!host) return;
  clear(host);
  const ej = s.ejercicio || {};
  const maxScore = s.maxScore || ej.maxScore || 5;
  const rubrica = (ej.rubric && ej.rubric.length ? ej.rubric : null);

  const inputNota = el('input', {
    class: 'input', type: 'number', step: '0.1', min: '0', max: String(maxScore),
    value: s.grade == null ? '' : String(s.grade), id: 'rev-nota'
  });
  const inputXp = el('input', {
    class: 'input', type: 'number', min: '0', max: String(ej.xp || 0),
    value: String(s.xpEarned || 0), id: 'rev-xp'
  });
  const comentario = el('textarea', {
    class: 'textarea', rows: '5', id: 'rev-comentario',
    placeholder: 'Excelente trabajo. La lógica está correcta. Debes mejorar la validación de entrada.'
  }, s.teacherComment || '');

  /* --- rubrica: al puntuar criterios se calcula la nota sola --- */
  let criterios = null;
  if (rubrica) {
    criterios = el('div', { class: 'rubrica' });
    for (const c of rubrica) {
      const inp = el('input', {
        class: 'input crit-p', type: 'number', step: '0.1', min: '0', max: String(c.points),
        placeholder: '0', dataset: { max: String(c.points) }
      });
      inp.addEventListener('input', () => {
        let total = 0;
        for (const i of criterios.querySelectorAll('.crit-p')) total += Number(i.value) || 0;
        inputNota.value = String(Math.round(total * 100) / 100);
        recalcularXp();
      });
      criterios.append(el('div', { class: 'crit-row' },
        el('span', null, c.name), inp, el('small', null, '/ ' + c.points)));
    }
  }

  function recalcularXp() {
    const nota = Number(inputNota.value);
    if (!isFinite(nota) || !ej.xp) return;
    inputXp.value = String(Math.round((nota / maxScore) * ej.xp));
  }
  inputNota.addEventListener('input', recalcularXp);

  const feedback = s.feedback || [];

  host.append(
    el('div', { class: 'rev-grade-head' },
      el('b', null, 'Evaluación'),
      s.grade != null ? el('span', { class: 'chip ok' }, 'Calificada') : el('span', { class: 'chip warn' }, 'Sin calificar')),

    el('div', { class: 'side-section-title' }, 'Comentarios en el código (' + feedback.length + ')'),
    feedback.length
      ? el('div', { class: 'fb-lista' }, feedback.map((f) => {
        const t = TIPO_POR_ID[f.type] || TIPO_POR_ID.suggestion;
        return el('div', { class: 'fb-item fb-' + f.type, onclick: () => irALinea(f.line) },
          el('div', { class: 'fb-top' },
            el('span', { class: 'fb-line' }, 'L' + f.line),
            el('span', { class: 'fb-tipo', style: { color: t.color } }, t.etiqueta),
            el('span', { style: { flex: '1' } }),
            el('button', {
              class: 'icon-btn', title: 'Editar',
              onclick: (e) => { e.stopPropagation(); abrirComentario(f.line, f); }
            }, icon('edit', 12))),
          el('p', null, f.message));
      }))
      : el('div', { class: 'empty-note' }, 'Haz clic en un número de línea para comentar.'),

    rubrica ? el('div', { class: 'side-section-title' }, 'Criterios') : null,
    criterios,

    el('div', { class: 'form-field' },
      el('label', null, 'Nota (sobre ' + maxScore + ')'), inputNota, el('div', { class: 'err' })),
    el('div', { class: 'form-field' },
      el('label', null, 'XP otorgado (máx. ' + (ej.xp || 0) + ')'), inputXp),
    el('div', { class: 'form-field' },
      el('label', null, 'Comentario general'), comentario),

    el('div', { class: 'rev-acciones' },
      el('button', { class: 'btn primary block', onclick: () => guardarNota(s, false) }, 'Guardar calificación'),
      el('button', { class: 'btn outline block', onclick: () => guardarNota(s, true) }, 'Calificar y devolver'),
      el('button', { class: 'btn outline block', onclick: () => reabrir(s) }, 'Reabrir para el estudiante'),
      el('button', { class: 'btn outline block', onclick: () => exportarEntrega(s) }, 'Exportar a .pclass'))
  );
}

/** Guarda esta entrega en el formato propio .pclass (fase 5). */
async function exportarEntrega(s) {
  const out = await window.pc.pclass.exportar('entrega', s.id);
  if (out.canceled) return;
  if (!out.ok) { toast(out.error || 'No se pudo exportar', { type: 'err' }); return; }
  toast('Entrega guardada en ' + out.path, { type: 'ok', timeout: 6000 });
}

async function guardarNota(s, devolver) {
  const nota = Number($('#rev-nota').value);
  const maxScore = s.maxScore || (s.ejercicio && s.ejercicio.maxScore) || 5;
  if (!isFinite(nota) || nota < 0 || nota > maxScore) {
    toast('La nota debe estar entre 0 y ' + maxScore + '.', { type: 'err' });
    return;
  }

  let motivo = null;
  if (s.grade != null && s.grade !== nota) {
    motivo = await promptDialog({
      title: 'Cambio de nota',
      label: 'Esta entrega ya tenía ' + s.grade + '. Explica brevemente el cambio (queda en el historial).',
      value: 'Corrección posterior',
      okLabel: 'Guardar cambio'
    });
    if (!motivo) return;
  }

  const res = await window.pc.submissions.grade(s.id, {
    grade: nota,
    xpEarned: Number($('#rev-xp').value) || 0,
    teacherComment: $('#rev-comentario').value,
    returnToStudent: !!devolver,
    reason: motivo || undefined
  });

  if (!res.ok) {
    toast(res.error || Object.values(res.errores || {})[0] || 'No se pudo guardar', { type: 'err' });
    return;
  }
  toast('Calificación guardada: ' + nota + ' / ' + maxScore, { title: 'Evaluación', type: 'ok' });
  vista.submission = res.submission;
  // Las insignias automaticas ya se evaluaron en el proceso principal; aqui solo
  // se pasan al hook para el aviso y para republicar el ranking.
  if (res.insigniasNuevas && res.insigniasNuevas.length) {
    res.submission.insigniasNuevas = res.insigniasNuevas;
  }
  pintarEvaluacion($('#rev-grade'), res.submission);
  if (hooks.onCalificado) hooks.onCalificado(res.submission);
}

async function reabrir(s) {
  const motivo = await promptDialog({
    title: 'Reabrir entrega',
    label: 'El estudiante podrá volver a editar este intento. Motivo:',
    value: 'Corrige lo señalado y vuelve a entregar',
    okLabel: 'Reabrir'
  });
  if (!motivo) return;
  const res = await window.pc.submissions.reopen(s.id, motivo);
  if (!res.ok) { toast(res.error || 'No se pudo reabrir', { type: 'err' }); return; }
  toast('Entrega reabierta para el estudiante', { type: 'ok' });
  await recargarEntrega();
}

/** Abre el código de la entrega en el editor para probarlo. */
/*
 * Ejecuta la entrega SIN salir de la revision y SIN copiar nada.
 *
 * Antes habia que llevarse el codigo al editor, y si el trabajo estaba repartido
 * en varios modulos no funcionaba: al ejecutar un archivo suelto, los `import`
 * del estudiante no encontraban nada.
 *
 * Ahora se escribe la entrega COMPLETA en una carpeta temporal y se ejecuta ahi
 * su archivo principal. Como Python busca los modulos junto al archivo que
 * ejecuta, los import del estudiante funcionan tal cual. La carpeta es de usar y
 * tirar: no toca ni la entrega ni los archivos del profesor.
 */
async function ejecutarEntrega(s) {
  const zona = $('#rev-run');
  if (!zona) return;

  if (vista.panelEjecucion && vista.panelEjecucion.estaEjecutando()) {
    await vista.panelEjecucion.detener();
    return;
  }

  zona.hidden = false;
  if (!vista.panelEjecucion) {
    vista.panelEjecucion = new PanelEjecucion(zona, {
      titulo: 'Entrega de ' + ((s.estudiante && s.estudiante.nombre) || 'estudiante'),
      onEstado: (estado) => {
        const btn = $('#rev-run-btn');
        if (!btn) return;
        clear(btn).append(
          icon(estado === 'ejecutando' ? 'stop' : 'play', 12),
          estado === 'ejecutando' ? 'Detener' : 'Ejecutar la entrega');
      }
    });
  }

  const listo = await window.pc.submissions.prepare(s.id, vista.archivo);
  if (!listo.ok) {
    toast(listo.error || 'No se pudo preparar la entrega.', { type: 'err' });
    return;
  }
  await vista.panelEjecucion.ejecutar(listo.entrada, listo.entradaNombre);
}

/** Copia de la entrega en el editor, por si el profesor quiere trastear. */
async function abrirEnElEditor(s) {
  const listo = await window.pc.submissions.prepare(s.id, vista.archivo);
  if (!listo.ok) {
    toast(listo.error || 'No se pudo preparar la entrega.', { type: 'err' });
    return;
  }
  if (hooks.abrirCarpeta) await hooks.abrirCarpeta(listo.carpeta, listo.entrada);
  toast('Es una copia para probar: lo que cambies aquí no toca la entrega del estudiante.',
    { type: 'info', timeout: 7000 });
}

export function entregaAbierta() { return vista ? vista.submission : null; }

export function cerrarRevision() {
  if (vista && vista.panelEjecucion) vista.panelEjecucion.destruir();
  vista = null;
}

/* ================================================ resultado (estudiante) */

/**
 * Lo que ve el estudiante cuando abre una entrega suya: estado, nota, XP,
 * comentario general y los comentarios por linea sobre su propio codigo.
 */
export async function mostrarResultado(submissionId) {
  const s = await window.pc.submissions.get(submissionId);
  if (!s) { toast('No se encontró la entrega.', { type: 'err' }); return; }

  const calificado = s.status === 'graded' || s.status === 'returned';
  const feedback = s.feedback || [];
  const archivos = archivosDe(s);
  const principal = principalDe(archivos, s);
  /* Para ensenar la linea comentada hay que mirar en SU archivo. */
  const lineaDe = (f) => (contenidoDe(s, f.file || principal).split('\n')[f.line - 1] || '');

  const cabecera = calificado
    ? el('div', { class: 'resultado ok' },
      el('div', { class: 'res-nota' }, (s.grade == null ? '—' : s.grade) + ' / ' + s.maxScore),
      el('div', null,
        el('b', null, 'Ejercicio calificado'),
        el('span', null, '+' + (s.xpEarned || 0) + ' XP  ·  ' + formatoFecha(s.gradedAt))))
    : el('div', { class: 'resultado pendiente' },
      el('div', { class: 'res-nota' }, icon('clock', 26)),
      el('div', null,
        el('b', null, s.status === 'abandoned' ? 'Intento abandonado' : 'En revisión'),
        el('span', null, s.status === 'abandoned'
          ? 'Este intento se cerró sin entregar.'
          : 'Tu profesor revisará tu código. La nota y el XP quedan pendientes.')));

  const cuerpo = el('div', null,
    cabecera,
    s.teacherComment
      ? el('div', null,
        el('div', { class: 'side-section-title' }, 'Comentario de tu profesor'),
        el('div', { class: 'form-note' }, s.teacherComment))
      : null,
    el('div', { class: 'side-section-title' }, 'Comentarios en el código (' + feedback.length + ')'),
    feedback.length
      ? el('div', { class: 'fb-lista' }, feedback.map((f) => {
        const t = TIPO_POR_ID[f.type] || TIPO_POR_ID.suggestion;
        return el('div', { class: 'fb-item fb-' + f.type },
          el('div', { class: 'fb-top' },
            el('span', { class: 'fb-line' },
              (archivos.length > 1 ? (f.file || principal) + ' · ' : '') + 'L' + f.line),
            el('span', { class: 'fb-tipo', style: { color: t.color } }, t.etiqueta)),
          el('code', { class: 'fb-code' }, lineaDe(f).trim().slice(0, 90) || '(línea vacía)'),
          el('p', null, f.message));
      }))
      : el('div', { class: 'empty-note' }, 'Sin comentarios por línea.'),
    el('div', { class: 'side-section-title' }, 'Datos de la entrega'),
    el('dl', { class: 'info-grid', style: { padding: 0 } },
      archivos.length > 1 ? el('dt', null, 'Archivos entregados') : null,
      archivos.length > 1
        ? el('dd', null, archivos.map((f) => f.name).join(', ') + '  ·  se ejecuta ' + principal)
        : null,
      el('dt', null, 'Intento'), el('dd', null, String(s.attemptNumber)),
      el('dt', null, 'Entregado'), el('dd', null, formatoFecha(s.submittedAt)),
      el('dt', null, 'Tiempo dedicado'), el('dd', null, formatoTiempo(s.timeSpentSec)),
      el('dt', null, 'A tiempo'), el('dd', null, s.isLate ? 'No (entrega tardía)' : 'Sí'))
  );

  await modal({
    title: (s.ejercicio ? s.ejercicio.title : 'Entrega'),
    wide: true,
    body: cuerpo,
    buttons: [{ label: 'Cerrar', value: null, primary: true }]
  });
}
