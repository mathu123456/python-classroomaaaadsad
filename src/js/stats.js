/*
 * Pagina de Estadisticas (fase 5).
 *
 * Solo la ve el profesor. Todos los numeros salen de consultas agregadas de
 * SQLite (electron/repos/stats.js); aqui no se recalcula nada sobre listas
 * completas: se pinta.
 *
 * El criterio con el que el sistema avisa de un tema con dificultades se
 * muestra en la propia pantalla y se puede cambiar: el profesor tiene que saber
 * por que le esta avisando.
 */

import { el, icon, clear, toast, modal, confirmDialog } from './ui.js';
import { formatoTiempo, formatoFecha } from './dashboard.js';
import { barras, barrasHorizontales, lineas, tarjetaGrafica, sinDatos } from './charts.js';

let hooks = {};

export function init(appHooks) { hooks = appHooks || {}; }

function kpi(o) {
  return el('div', { class: 'kpi ' + (o.tono || '') },
    el('div', { class: 'k-top' }, icon(o.icono, 13), o.titulo),
    el('div', { class: 'k-value' }, String(o.valor), o.sufijo ? el('small', null, ' ' + o.sufijo) : null),
    o.nota ? el('div', { class: 'k-note' }, o.nota) : null);
}

/* ------------------------------------------------------------- avisos */

function avisoTema(t, textoCriterio) {
  return el('div', { class: 'aviso-tema' },
    el('div', { class: 'at-head' }, icon('alert', 15), el('b', null, 'Tema con dificultades'),
      el('span', { class: 'chip warn' }, t.tema)),
    el('div', { class: 'at-datos' },
      el('div', null, el('span', null, 'Promedio'),
        el('b', null, (t.promedio == null ? '—' : t.promedio) + ' / ' + t.maxScore)),
      el('div', null, el('span', null, 'Entregas reprobadas'),
        el('b', null, t.reprobadas + ' / ' + t.conNota)),
      el('div', null, el('span', null, 'Intentos promedio'),
        el('b', null, t.intentosMedios == null ? '—' : String(t.intentosMedios))),
      el('div', null, el('span', null, 'Estudiantes'), el('b', null, String(t.estudiantes)))),
    el('ul', { class: 'at-motivos' }, t.motivos.map((m) => el('li', null, m))),
    el('p', { class: 'chart-note' }, textoCriterio));
}

/* ----------------------------------------------------------- criterio */

async function editarCriterio(criterio) {
  const campo = (nombre, etiqueta, valor, extra) => el('div', { class: 'form-field' },
    el('label', null, etiqueta),
    el('input', Object.assign({ class: 'input', name: nombre, type: 'number', value: String(valor) }, extra || {})));

  const form = el('form', { class: 'form-grid', novalidate: true },
    campo('promedioMinimoPct', 'Avisar si el promedio baja del … % de la nota máxima',
      criterio.promedioMinimoPct, { min: '0', max: '100' }),
    campo('reprobadosMinimoPct', 'Avisar si reprueban más del … % de las entregas con nota',
      criterio.reprobadosMinimoPct, { min: '0', max: '100' }),
    campo('intentosAviso', 'Avisar si hacen falta … intentos de media o más',
      criterio.intentosAviso, { min: '1', max: '20', step: '0.5' }),
    el('div', { class: 'form-note' },
      'Basta con que se cumpla una de las tres condiciones para que el tema aparezca marcado.'));

  const res = await modal({
    title: 'Cuándo avisar de un tema con dificultades',
    body: form,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;
  const datos = {};
  for (const i of form.querySelectorAll('input')) datos[i.name] = Number(i.value);
  const out = await window.pc.stats.setCriterio(datos);
  toast('Criterio actualizado', { type: 'ok' });
  if (hooks.refrescar) await hooks.refrescar();
  return out;
}

/* ---------------------------------------------------------- informes */

async function exportarCsv() {
  const res = await window.pc.reports.csv();
  if (res.canceled) return;
  if (!res.ok) { toast(res.error || 'No se pudo exportar', { type: 'err' }); return; }
  toast(res.filas + ' fila(s) exportadas a CSV', { type: 'ok' });
}

async function exportarJson() {
  const res = await window.pc.reports.json();
  if (res.canceled) return;
  if (!res.ok) { toast(res.error || 'No se pudo exportar', { type: 'err' }); return; }
  toast('Curso exportado a JSON', { type: 'ok' });
}

async function informeEstudiante(lista) {
  const sel = el('select', { class: 'select' },
    lista.map((e) => el('option', { value: e.uid }, e.nombre)));
  const res = await modal({
    title: 'Informe imprimible de un estudiante',
    body: el('div', null,
      el('p', null, 'Se genera un archivo HTML con sus notas, su progreso, sus comentarios y sus insignias. ' +
        'Se abre en el navegador y desde ahí se puede imprimir o guardar como PDF.'),
      sel),
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Generar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;
  const out = await window.pc.reports.student(sel.value);
  if (out.canceled) return;
  if (!out.ok) { toast(out.error || 'No se pudo generar', { type: 'err' }); return; }
  toast('Informe de ' + out.estudiante + ' generado', { type: 'ok' });
  const abrir = await confirmDialog('¿Abrir el informe ahora?', { title: 'Informe generado', okLabel: 'Abrir' });
  if (abrir) await window.pc.reports.open(out.path);
}

/* -------------------------------------------------------- intercambio */

async function importarEjercicio() {
  const abierto = await window.pc.pclass.abrir();
  if (abierto.canceled) return;
  if (!abierto.ok) {
    await modal({
      title: 'El archivo no se puede importar',
      body: el('div', null,
        el('p', null, 'Python Classroom revisó el archivo y encontró esto:'),
        el('ul', { class: 'at-motivos' }, (abierto.errores || []).map((e) => el('li', null, e)))),
      buttons: [{ label: 'Cerrar', value: null, primary: true }]
    });
    return;
  }

  const previa = await window.pc.pclass.previa(abierto.path);
  if (!previa.ok) {
    toast((previa.errores || ['No se puede importar'])[0], { type: 'err', timeout: 7000 });
    return;
  }

  const ex = previa.ejercicio;
  const cuerpo = el('div', null,
    el('div', { class: 'card' },
      el('div', { class: 'list-row' },
        el('div', { class: 'lr-main' }, el('b', null, ex.title),
          el('span', null, (previa.temaNombre || 'Sin tema') + '  ·  ' + ex.xp + ' XP  ·  nota máxima ' +
            ex.maxScore + '  ·  ' + ((ex.rubric || []).length) + ' criterio(s)'))),
      el('div', { class: 'list-row' },
        el('div', { class: 'lr-main' }, el('b', null, 'Exportado'),
          el('span', null, formatoFecha(previa.exportadoEn))))),
    previa.conflicto
      ? el('div', { class: 'form-note warn' },
        previa.conflicto.motivo + ' («' + previa.conflicto.title + '»). ' +
        'Puedes crear una copia nueva o reemplazar el que ya tienes.')
      : el('div', { class: 'form-note' }, 'No hay ningún ejercicio que choque con este.'),
    el('div', { class: 'form-note' }, 'El ejercicio se importa como borrador: nadie lo verá hasta que lo publiques.'));

  const botones = [{ label: 'Cancelar', value: null }];
  if (previa.conflicto) botones.push({ label: 'Reemplazar el existente', value: 'sobrescribir', variant: 'danger' });
  botones.push({ label: previa.conflicto ? 'Importar como copia' : 'Importar', value: 'nuevo', primary: true });

  const decision = await modal({ title: 'Importar ejercicio', body: cuerpo, buttons: botones, wide: true });
  if (!decision) return;

  const out = await window.pc.pclass.importar(abierto.path, decision);
  if (!out.ok) { toast((out.errores || ['No se pudo importar'])[0], { type: 'err' }); return; }
  toast('Ejercicio importado: ' + out.ejercicio.title, { type: 'ok' });
  if (out.avisoTema) toast(out.avisoTema, { type: 'warn' });
  if (hooks.onPublicado) hooks.onPublicado();
  if (hooks.refrescar) await hooks.refrescar();
}

async function exportarEjercicio(ejercicios) {
  if (!ejercicios.length) { toast('Todavía no hay ejercicios que exportar.', { type: 'warn' }); return; }
  const sel = el('select', { class: 'select' },
    ejercicios.map((e) => el('option', { value: e.id }, e.title)));
  const conEntregas = el('input', { type: 'checkbox' });
  const res = await modal({
    title: 'Exportar a .pclass',
    body: el('div', null,
      el('p', null, 'El archivo .pclass es el formato propio de Python Classroom: JSON con todo el ejercicio, ' +
        'listo para compartirlo con otro profesor.'),
      sel,
      el('label', { class: 'checkline' }, conEntregas, 'Exportar las entregas en vez del ejercicio')),
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Exportar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;
  const out = await window.pc.pclass.exportar(conEntregas.checked ? 'entregas' : 'ejercicio', sel.value);
  if (out.canceled) return;
  if (!out.ok) { toast(out.error || 'No se pudo exportar', { type: 'err' }); return; }
  toast('Guardado en ' + out.path, { type: 'ok', timeout: 6000 });
}

async function importarCopia() {
  const previa = await window.pc.backups.importPreview();
  if (previa.canceled) return;
  if (!previa.ok) { toast(previa.error || 'No se pudo leer la copia', { type: 'err' }); return; }

  const tabla = el('table', { class: 'data' },
    el('thead', null, el('tr', null,
      el('th', null, 'Contenido'), el('th', null, 'Filas'), el('th', null, 'Ya existen'))),
    el('tbody', null, previa.bloques.map((b) => el('tr', null,
      el('td', null, b.etiqueta),
      el('td', { class: 'num' }, String(b.total)),
      el('td', { class: 'num' }, b.conflictos ? String(b.conflictos) : '—')))));

  const cuerpo = el('div', null,
    el('p', null, 'Esto es lo que trae la copia' +
      (previa.exportadoEn ? ' (exportada el ' + formatoFecha(previa.exportadoEn) + ')' : '') + ':'),
    el('div', { class: 'card table-wrap' }, tabla),
    previa.totalConflictos
      ? el('div', { class: 'form-note warn' },
        previa.totalConflictos + ' fila(s) ya existen en este equipo. Puedes conservarlas o reemplazarlas. ' +
        'Nada se borra: lo que no venga en la copia se queda como está.')
      : el('div', { class: 'form-note' }, 'Ninguna fila choca con lo que ya tienes.'),
    el('div', { class: 'form-note' }, 'Antes de importar se guarda una copia de seguridad de la base actual.'));

  const botones = [{ label: 'Cancelar', value: null }];
  if (previa.totalConflictos) botones.push({ label: 'Reemplazar lo repetido', value: 'sobrescribir', variant: 'danger' });
  botones.push({ label: 'Importar conservando lo mío', value: 'omitir', primary: true });

  const decision = await modal({ title: 'Importar una copia de seguridad', body: cuerpo, buttons: botones, wide: true });
  if (!decision) return;

  const out = await window.pc.backups.import(previa.path, decision);
  if (!out.ok) { toast(out.error || 'No se pudo importar', { type: 'err' }); return; }
  toast(out.insertados + ' nuevas · ' + out.sobrescritos + ' reemplazadas · ' + out.omitidos + ' conservadas',
    { title: 'Copia importada', type: 'ok', timeout: 7000 });
  if (hooks.refrescar) await hooks.refrescar();
}

/* ------------------------------------------------------------- pagina */

export async function renderEstadisticas(host) {
  const usuario = await window.pc.session.me();
  if (!usuario || usuario.rol !== 'profesor') {
    clear(host).append(el('div', { class: 'page' },
      el('div', { class: 'empty-page' }, el('b', null, 'Solo el profesor puede ver las estadísticas.'))));
    return;
  }

  const [datos, ejercicios] = await Promise.all([
    window.pc.stats.course(), window.pc.exercises.list()
  ]);
  const r = datos.resumen;
  const page = el('div', { class: 'page' });

  page.append(el('div', { class: 'page-head' },
    el('div', { class: 'ph-text' },
      el('h1', null, 'Estadísticas'),
      el('p', null, 'Calculadas con consultas sobre la base de datos de este equipo · ' +
        formatoFecha(datos.generadoEn))),
    el('div', { class: 'ph-actions' },
      el('button', { class: 'btn sm outline', onclick: () => exportarCsv() }, icon('table', 12), 'CSV de notas'),
      el('button', { class: 'btn sm outline', onclick: () => exportarJson() }, icon('json', 12), 'JSON del curso'),
      el('button', { class: 'btn sm outline', onclick: () => informeEstudiante(datos.porEstudiante) },
        icon('file', 12), 'Informe de estudiante'))));

  /* ---- cifras generales ---- */
  page.append(el('div', { class: 'kpi-grid' },
    kpi({
      icono: 'target', titulo: 'Promedio general', tono: 'accent',
      valor: r.promedioGeneral == null ? '—' : r.promedioGeneral,
      nota: r.calificadas + ' entrega(s) calificada(s)'
    }),
    kpi({
      icono: 'check-circle', titulo: 'Tasa de aprobación', tono: r.tasaAprobacion >= 60 ? 'ok' : 'warn',
      valor: r.tasaAprobacion == null ? '—' : r.tasaAprobacion + ' %',
      nota: r.aprobadas + ' aprobadas · ' + r.reprobadas + ' reprobadas'
    }),
    kpi({
      icono: 'clock', titulo: 'Tiempo por ejercicio',
      valor: r.tiempoMedioSegundos == null ? '—' : formatoTiempo(r.tiempoMedioSegundos),
      nota: 'media de ' + (r.intentosMedios == null ? '—' : r.intentosMedios) + ' intento(s)'
    }),
    kpi({
      icono: 'star', titulo: 'XP repartido', valor: r.xpRepartido,
      nota: r.retosCompletados + ' reto(s) completado(s)'
    }),
    kpi({
      icono: 'tasks', titulo: 'Entregas', valor: r.entregas,
      nota: r.pendientes + ' por revisar · ' + r.enCurso + ' en curso · ' + r.tardias + ' tardía(s)'
    }),
    kpi({
      icono: 'users', titulo: 'Estudiantes', valor: r.estudiantes,
      nota: r.ejerciciosPublicados + ' de ' + r.ejercicios + ' ejercicio(s) publicados'
    })));

  /* ---- avisos de temas con dificultades ---- */
  page.append(el('div', { class: 'section-head' },
    el('h2', null, 'Detección de problemas'),
    el('span', { class: 'count' }, datos.temasEnDificultad.length),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn sm outline', onclick: () => editarCriterio(datos.criterio) },
      icon('settings', 12), 'Cambiar el criterio')));

  /*
   * Lo que el profesor quiere saber de un vistazo: cual es el tema que peor va.
   * Se dice con nombre y numero, no solo con un aviso de color.
   */
  const conNotaTodos = datos.porTema.filter((t) => t.promedio != null && t.conNota > 0);
  if (conNotaTodos.length) {
    const peor = conNotaTodos.reduce((a, b) => (b.promedio < a.promedio ? b : a));
    page.append(el('div', { class: 'card' },
      el('div', { class: 'list-row' },
        icon(peor.enDificultad ? 'alert' : 'info', 16),
        el('div', { class: 'lr-main' },
          el('b', null, 'El tema con menor promedio es «' + peor.tema + '»'),
          el('span', null, 'Promedio ' + peor.promedio + ' / ' + peor.maxScore + '  ·  ' +
            peor.conNota + ' entrega(s) con nota  ·  ' + peor.estudiantes + ' estudiante(s)')),
        el('div', { class: 'lr-num' }, peor.promedio + ' / ' + peor.maxScore))));
  }

  if (!datos.temasEnDificultad.length) {
    page.append(el('div', { class: 'card' },
      el('div', { class: 'list-row' },
        icon('check-circle', 16),
        el('div', { class: 'lr-main' },
          el('b', null, 'Ningún tema está por debajo del criterio'),
          el('span', null, datos.textoCriterio)))));
  } else {
    for (const t of datos.temasEnDificultad) page.append(avisoTema(t, datos.textoCriterio));
  }

  /* ---- graficas ---- */
  page.append(el('div', { class: 'section-head' }, el('h2', null, 'Gráficas')));

  const conNota = datos.porTema.filter((t) => t.promedio != null);
  const maxNota = Math.max(5, ...conNota.map((t) => t.maxScore || 5));
  page.append(tarjetaGrafica('Promedio por tema',
    conNota.length
      ? barras(conNota.map((t) => ({
        etiqueta: t.tema,
        valor: t.promedio,
        valorTexto: String(t.promedio),
        color: t.enDificultad ? 'var(--warn)' : 'var(--accent)',
        detalle: t.tema + ': promedio ' + t.promedio + ' / ' + t.maxScore + ' · ' +
          t.conNota + ' entrega(s) con nota'
      })), { maximo: maxNota })
      : sinDatos('Todavía no hay ninguna entrega calificada.'),
    'Los temas marcados en ámbar cumplen el criterio de aviso.'));

  page.append(tarjetaGrafica('Evolución del promedio por semana',
    datos.evolucion.length >= 2
      ? lineas(datos.evolucion.map((e) => ({
        etiqueta: e.semana,
        valor: e.promedio || 0,
        detalle: 'Semana ' + e.semana + ': promedio ' + e.promedio + ' · ' + e.entregas + ' entrega(s)'
      })), { maximo: maxNota })
      : sinDatos('Hace falta al menos dos semanas con entregas calificadas.'),
    'Cada punto es el promedio de las entregas calificadas esa semana.'));

  page.append(tarjetaGrafica('Distribución de notas',
    datos.distribucion.total
      ? barras(datos.distribucion.tramos.map((t) => ({
        etiqueta: t.etiqueta,
        valor: t.n,
        detalle: t.n + ' entrega(s) entre ' + t.etiqueta.replace('-', ' y ') + ' (escala 0-5)'
      })), { formatoEje: (v) => String(Math.round(v)) })
      : sinDatos('Todavía no hay notas que repartir en tramos.'),
    'Las notas se llevan a la escala 0-5 aunque el ejercicio use otra nota máxima.'));

  const conProgreso = datos.porEstudiante.filter((e) => e.total > 0);
  page.append(tarjetaGrafica('Progreso por estudiante',
    conProgreso.length
      ? barrasHorizontales(conProgreso.map((e) => ({
        etiqueta: e.nombre,
        valor: e.porcentaje,
        valorTexto: e.porcentaje + ' %',
        color: e.porcentaje >= 70 ? 'var(--ok)' : e.porcentaje >= 35 ? 'var(--accent)' : 'var(--warn)',
        detalle: e.nombre + ': ' + e.completados + ' de ' + e.total + ' ejercicio(s) · ' + e.xp + ' XP'
      })), { maximo: 100 })
      : sinDatos('Todavía no hay estudiantes con ejercicios asignados.'),
    'Porcentaje de ejercicios publicados que ya ha entregado cada estudiante.'));

  page.append(tarjetaGrafica('Ejercicios completados por semana',
    datos.porSemana.length
      ? barras(datos.porSemana.map((s) => ({
        etiqueta: s.semana,
        valor: s.entregas,
        detalle: 'Semana ' + s.semana + ': ' + s.entregas + ' entrega(s)'
      })), { formatoEje: (v) => String(Math.round(v)) })
      : sinDatos('Todavía no hay entregas registradas.'),
    'Se cuenta por la fecha de entrega, no por la de calificación.'));

  /* ---- destacados ---- */
  page.append(el('div', { class: 'section-head' }, el('h2', null, 'Estudiantes')));
  const columnas = el('div', { class: 'dos-columnas' });

  const listaEstudiantes = (titulo, lista, vacio, tono) => {
    const card = el('div', { class: 'card' },
      el('div', { class: 'list-row' }, el('div', { class: 'lr-main' }, el('b', null, titulo))));
    if (!lista.length) card.append(el('div', { class: 'empty-note' }, vacio));
    for (const e of lista) {
      card.append(el('div', { class: 'list-row' },
        el('div', {
          class: 'av h-avatar',
          style: { width: '26px', height: '26px', fontSize: '10.5px', background: e.color || 'var(--accent)' }
        }, (e.nombre || '?').split(' ').map((s) => s.charAt(0)).slice(0, 2).join('').toUpperCase()),
        el('div', { class: 'lr-main' },
          el('b', null, e.nombre),
          el('span', null, e.completados + '/' + e.total + ' ejercicios · ' + e.xp + ' XP' +
            (e.insignias ? ' · ' + e.insignias + ' insignia(s)' : ''))),
        el('span', { class: 'chip ' + tono }, e.promedio == null ? 'sin nota' : 'prom. ' + e.promedio)));
    }
    return card;
  };

  columnas.append(listaEstudiantes('Destacados', datos.destacados.mejores,
    'Todavía no hay datos suficientes.', 'ok'));
  columnas.append(listaEstudiantes('Con dificultades', datos.destacados.conDificultades,
    'Ningún estudiante está por debajo del umbral.', 'warn'));
  page.append(columnas);

  /* ---- tabla por tema ---- */
  page.append(el('div', { class: 'section-head' }, el('h2', null, 'Detalle por tema')));
  const tbody = el('tbody');
  for (const t of datos.porTema) {
    tbody.append(el('tr', { class: t.enDificultad ? 'fila-aviso' : '' },
      el('td', null, t.tema),
      el('td', { class: 'num' }, String(t.ejercicios)),
      el('td', { class: 'num' }, String(t.entregas)),
      el('td', { class: 'num' }, t.promedio == null ? '—' : t.promedio + ' / ' + t.maxScore),
      el('td', { class: 'num' }, t.conNota ? t.reprobadas + ' / ' + t.conNota : '—'),
      el('td', { class: 'num' }, t.intentosMedios == null ? '—' : String(t.intentosMedios)),
      el('td', { class: 'num' }, t.tiempoMedioSegundos == null ? '—' : formatoTiempo(t.tiempoMedioSegundos)),
      el('td', null, t.enDificultad ? el('span', { class: 'chip warn' }, 'aviso') : '—')));
  }
  page.append(el('div', { class: 'card table-wrap' },
    el('table', { class: 'data' },
      el('thead', null, el('tr', null,
        el('th', null, 'Tema'), el('th', null, 'Ejercicios'), el('th', null, 'Entregas'),
        el('th', null, 'Promedio'), el('th', null, 'Reprobadas'), el('th', null, 'Intentos'),
        el('th', null, 'Tiempo medio'), el('th', null, 'Estado'))),
      tbody)));

  /* ---- intercambio ---- */
  page.append(el('div', { class: 'section-head' }, el('h2', null, 'Intercambio de datos')));
  page.append(el('div', { class: 'card' },
    el('div', { class: 'list-row' },
      icon('download', 16),
      el('div', { class: 'lr-main' },
        el('b', null, 'Exportar un ejercicio o sus entregas (.pclass)'),
        el('span', null, 'Formato propio en JSON para compartir con otro profesor.')),
      el('button', { class: 'btn sm outline', onclick: () => exportarEjercicio(ejercicios) }, 'Exportar')),
    el('div', { class: 'list-row' },
      icon('folder-open', 16),
      el('div', { class: 'lr-main' },
        el('b', null, 'Importar un ejercicio desde .pclass'),
        el('span', null, 'Se valida el archivo y se pregunta antes de reemplazar nada.')),
      el('button', { class: 'btn sm outline', onclick: () => importarEjercicio() }, 'Importar')),
    el('div', { class: 'list-row' },
      icon('refresh', 16),
      el('div', { class: 'lr-main' },
        el('b', null, 'Importar una copia de seguridad'),
        el('span', null, 'La contraparte de «Exportar mis datos». Muestra qué va a entrar antes de hacerlo.')),
      el('button', { class: 'btn sm outline', onclick: () => importarCopia() }, 'Importar copia'))));

  clear(host).append(page);
}

/**
 * Abre un .pclass en modo lectura. Sirve tanto para una entrega como para un
 * ejercicio o un lote de entregas: no importa nada, solo muestra el contenido.
 */
export async function verPclass(ruta) {
  const abierto = await window.pc.pclass.abrir(ruta);
  if (abierto.canceled) return;
  if (!abierto.ok) {
    await modal({
      title: 'Ese archivo no se puede abrir',
      body: el('div', null,
        el('p', null, 'Python Classroom revisó el archivo y encontró esto:'),
        el('ul', { class: 'at-motivos' }, (abierto.errores || []).map((e) => el('li', null, e)))),
      buttons: [{ label: 'Cerrar', value: null, primary: true }]
    });
    return;
  }

  const d = abierto.datos;
  const cabecera = (pares) => el('div', { class: 'card' },
    pares.filter(Boolean).map(([k, v]) => el('div', { class: 'list-row' },
      el('div', { class: 'lr-main' }, el('b', null, k), el('span', null, v == null ? '—' : String(v))))));
  const subtitulo = (texto) => el('h4',
    { style: { margin: '12px 0 6px', fontSize: '12.5px', color: 'var(--text-strong)' } }, texto);

  let cuerpo;
  if (abierto.tipo === 'entrega') {
    cuerpo = el('div', null,
      cabecera([
        ['Estudiante', d.studentName],
        ['Ejercicio', d.exerciseTitle],
        ['Intento', d.attemptNumber],
        ['Estado', d.status],
        ['Nota', d.grade == null ? 'sin calificar' : d.grade + ' / ' + d.maxScore],
        ['XP', d.xpEarned],
        ['Tiempo dedicado', formatoTiempo(d.timeSpentSec)],
        ['Entregado', formatoFecha(d.submittedAt)],
        d.teacherComment ? ['Comentario del profesor', d.teacherComment] : null
      ]),
      subtitulo('Código'),
      el('pre', { class: 'pclass-code' }, d.code || '(sin código)'),
      d.feedback && d.feedback.length
        ? el('div', null,
          subtitulo('Comentarios por línea'),
          el('div', { class: 'card' }, d.feedback.map((f) => el('div', { class: 'list-row' },
            el('div', { class: 'lr-main' }, el('b', null, 'Línea ' + f.line + ' · ' + f.type),
              el('span', null, f.message))))))
        : null);
  } else if (abierto.tipo === 'ejercicio') {
    const ex = d.exercise;
    cuerpo = el('div', null,
      cabecera([
        ['Título', ex.title],
        ['Tema', ex.temaNombre],
        ['Tipo · dificultad', ex.type + ' · ' + ex.difficulty],
        ['XP', ex.xp],
        ['Nota máxima', ex.maxScore],
        ['Tiempo límite', ex.timeLimit ? ex.timeLimit + ' min' : 'sin límite'],
        ['Criterios', (ex.rubric || []).map((c) => c.name + ' (' + c.points + ')').join(', ') || 'ninguno'],
        ['Exportado', formatoFecha(d.exportadoEn)]
      ]),
      ex.description ? el('p', null, ex.description) : null,
      el('div', { class: 'enunciado' }, ex.instructions || '(sin instrucciones)'),
      ex.starterCode ? el('div', null, subtitulo('Código inicial'),
        el('pre', { class: 'pclass-code' }, ex.starterCode)) : null);
  } else {
    cuerpo = el('div', null,
      cabecera([
        ['Ejercicio', d.exerciseTitle],
        ['Entregas incluidas', d.total],
        ['Exportado', formatoFecha(d.exportadoEn)]
      ]),
      el('div', { class: 'card table-wrap' },
        el('table', { class: 'data' },
          el('thead', null, el('tr', null,
            el('th', null, 'Estudiante'), el('th', null, 'Intento'),
            el('th', null, 'Estado'), el('th', null, 'Nota'), el('th', null, 'XP'))),
          el('tbody', null, (d.entregas || []).map((otra) => el('tr', null,
            el('td', null, otra.studentName),
            el('td', { class: 'num' }, String(otra.attemptNumber)),
            el('td', null, otra.status),
            el('td', { class: 'num' }, otra.grade == null ? '—' : otra.grade + ' / ' + otra.maxScore),
            el('td', { class: 'num' }, String(otra.xpEarned || 0))))))));
  }

  await modal({
    title: 'Archivo .pclass (solo lectura)',
    wide: true,
    body: el('div', null, el('div', { class: 'form-note' }, abierto.path), cuerpo),
    buttons: [{ label: 'Cerrar', value: null, primary: true }]
  });
}

export { importarEjercicio, importarCopia };
