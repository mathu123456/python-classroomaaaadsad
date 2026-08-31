'use strict';
/*
 * Estadisticas, informes, formato propio .pclass y copias de seguridad
 * (fases 5 y 6).
 *
 * Todo lo que sale del programa se genera aqui, en el proceso principal, que es
 * el unico que puede escribir en el disco del usuario. Y todo lo que entra pasa
 * antes por una validacion que explica exactamente que falla, en vez de
 * importar a medias.
 *
 * Regla que no se rompe: importar NUNCA sobrescribe algo que ya existe sin
 * preguntar. La interfaz pide primero una vista previa (importPreview) y solo
 * despues, con la decision tomada, aplica el cambio (importApply).
 */

const fs = require('fs');
const path = require('path');
const { app, dialog, shell } = require('electron');

const db = require('../sqlite');
const users = require('../repos/users');
const academic = require('../repos/academic');
const work = require('../repos/work');
const stats = require('../repos/stats');
const courses = require('../repos/courses');

const FORMATO = 'pclass';
const VERSION_PCLASS = 1;

/* ------------------------------------------------------------- utiles */

function guard(fn) {
  return (event, ...args) => {
    try {
      return fn(...args);
    } catch (err) {
      throw new Error(err && err.message ? err.message : String(err));
    }
  };
}

function nombreArchivo(texto, extension) {
  const base = String(texto || 'python-classroom')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, '')
    .trim().replace(/\s+/g, '-')
    .slice(0, 60) || 'python-classroom';
  return base + (extension || '');
}

function escribir(ruta, contenido) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, contenido, 'utf8');
  return { ok: true, path: ruta, sizeBytes: fs.statSync(ruta).size };
}

/** Escape para HTML: los informes se abren en el navegador. */
function esc(texto) {
  return String(texto == null ? '' : texto).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Celda de CSV: comillas dobles y separador seguro para hojas de calculo. */
function csvCelda(valor) {
  if (valor == null) return '';
  const s = String(valor);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csv(filas) {
  return filas.map((f) => f.map(csvCelda).join(';')).join('\r\n') + '\r\n';
}

function segundosATexto(s) {
  const n = Math.max(0, Math.round(s || 0));
  if (n < 60) return n + ' s';
  const min = Math.floor(n / 60);
  return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
}

/* ============================================== construir un .pclass */

function sobreEntrega(submissionId) {
  const s = db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
  if (!s) return null;
  const ej = db.get('SELECT * FROM exercises WHERE id = ?', [s.exerciseId]);
  const alumno = users.byUid(s.studentId);

  return {
    formato: FORMATO,
    version: VERSION_PCLASS,
    tipo: 'entrega',
    exportadoEn: db.nowIso(),
    app: { nombre: app.getName(), version: app.getVersion() },
    studentId: s.studentId,
    studentName: alumno ? (alumno.firstName + ' ' + alumno.lastName).trim() || alumno.email : s.studentId,
    exerciseId: s.exerciseId,
    exerciseTitle: ej ? ej.title : 'Ejercicio eliminado',
    submissionId: s.id,
    attemptNumber: s.attemptNumber,
    code: s.code || '',
    files: academic.normalizarLista(db.parseJson(s.files, [])),
    status: s.status,
    startedAt: s.startedAt,
    submittedAt: s.submittedAt,
    timeSpentSec: s.timeSpentSec,
    grade: s.grade,
    maxScore: s.maxScore != null ? s.maxScore : (ej ? ej.maxScore : null),
    xpEarned: s.xpEarned,
    teacherComment: s.teacherComment,
    feedback: work.listFeedback(s.id).map((f) => ({
      line: f.line, type: f.type, message: f.message, resolved: f.resolved, createdAt: f.createdAt
    }))
  };
}

function sobreEjercicio(exerciseId) {
  const e = db.get('SELECT * FROM exercises WHERE id = ?', [exerciseId]);
  if (!e) return null;
  return {
    formato: FORMATO,
    version: VERSION_PCLASS,
    tipo: 'ejercicio',
    exportadoEn: db.nowIso(),
    app: { nombre: app.getName(), version: app.getVersion() },
    exerciseId: e.id,
    exercise: {
      title: e.title,
      description: e.description,
      instructions: e.instructions,
      temaNombre: academic.topicName(e.topicId),
      type: e.type,
      difficulty: e.difficulty,
      xp: e.xp,
      maxScore: e.maxScore,
      timeLimit: e.timeLimit,
      allowLateSubmission: !!e.allowLateSubmission,
      maxAttempts: e.maxAttempts,
      isClassOnly: !!e.isClassOnly,
      starterCode: e.starterCode,
      rubric: academic.normalizarLista(db.parseJson(e.rubric, [])),
      files: academic.normalizarLista(db.parseJson(e.files, []))
    }
  };
}

function sobreEntregasDeEjercicio(exerciseId) {
  const e = db.get('SELECT * FROM exercises WHERE id = ?', [exerciseId]);
  if (!e) return null;
  const ids = db.all('SELECT id FROM submissions WHERE exerciseId = ? ORDER BY studentId, attemptNumber',
    [exerciseId]).map((r) => r.id);
  return {
    formato: FORMATO,
    version: VERSION_PCLASS,
    tipo: 'entregas',
    exportadoEn: db.nowIso(),
    app: { nombre: app.getName(), version: app.getVersion() },
    exerciseId: exerciseId,
    exerciseTitle: e.title,
    total: ids.length,
    entregas: ids.map(sobreEntrega).filter(Boolean)
  };
}

/* --------------------------------------------------------- validacion */

const CAMPOS_MINIMOS = {
  entrega: ['studentId', 'exerciseId', 'submissionId', 'attemptNumber', 'code', 'status'],
  ejercicio: ['exercise'],
  entregas: ['entregas']
};

/**
 * Valida un .pclass ya interpretado. Devuelve { ok, errores[], tipo }.
 * Los mensajes son los que se le muestran al profesor tal cual.
 */
function validarPclass(datos) {
  const errores = [];
  if (!datos || typeof datos !== 'object') {
    return { ok: false, errores: ['El archivo no contiene un objeto JSON válido.'] };
  }
  if (datos.formato !== FORMATO) {
    errores.push('No es un archivo de Python Classroom: falta «formato: "pclass"».');
  }
  const version = Number(datos.version);
  if (!isFinite(version) || version < 1) errores.push('Falta el número de versión del formato.');
  else if (version > VERSION_PCLASS) {
    errores.push('El archivo es de una versión más nueva (' + version + ') que esta aplicación (' +
      VERSION_PCLASS + '). Actualiza Python Classroom.');
  }

  const tipo = datos.tipo;
  if (!CAMPOS_MINIMOS[tipo]) {
    errores.push('Tipo de contenido desconocido: ' + JSON.stringify(tipo) +
      '. Se admiten: entrega, entregas y ejercicio.');
  } else {
    for (const campo of CAMPOS_MINIMOS[tipo]) {
      if (datos[campo] === undefined || datos[campo] === null) errores.push('Falta el campo «' + campo + '».');
    }
  }

  if (tipo === 'ejercicio' && datos.exercise) {
    const ex = datos.exercise;
    if (!ex.title || String(ex.title).trim().length < 3) errores.push('El ejercicio no tiene título.');
    if (ex.maxScore != null && !(Number(ex.maxScore) > 0)) errores.push('La nota máxima del ejercicio no es válida.');
    if (ex.rubric && !Array.isArray(ex.rubric)) errores.push('Los criterios de evaluación no son una lista.');
  }
  if (tipo === 'entregas' && datos.entregas && !Array.isArray(datos.entregas)) {
    errores.push('El campo «entregas» debería ser una lista.');
  }

  return { ok: errores.length === 0, errores: errores, tipo: tipo };
}

function leerPclass(ruta) {
  const texto = fs.readFileSync(ruta, 'utf8');
  let datos = null;
  try {
    datos = JSON.parse(texto);
  } catch (err) {
    return { ok: false, errores: ['El archivo no es JSON válido: ' + err.message] };
  }
  const v = validarPclass(datos);
  return v.ok ? { ok: true, datos: datos, tipo: v.tipo } : { ok: false, errores: v.errores };
}

/* ================================================= informe imprimible */

function informeHtml(datos) {
  const e = datos.estudiante;
  const t = datos.totales || {};
  const fila = (celdas) => '<tr>' + celdas.map((c) => '<td>' + c + '</td>').join('') + '</tr>';

  const entregas = datos.entregas.map((s) => fila([
    esc(s.ejercicio), esc(s.tema), s.intento, esc(s.estado),
    s.nota == null ? '—' : esc(s.nota + ' / ' + (s.maxScore == null ? '?' : s.maxScore)),
    s.xp || 0, segundosATexto(s.tiempoSegundos),
    esc(s.comentario || '')
  ])).join('\n');

  const temas = datos.porTema.map((p) => fila([
    esc(p.tema), p.completados + ' / ' + p.total,
    p.promedio == null ? '—' : esc(p.promedio), p.xp
  ])).join('\n');

  const insignias = datos.insignias.length
    ? '<ul class="insignias">' + datos.insignias.map((b) =>
      '<li><b>' + esc(b.name) + '</b> — ' + esc(b.description || '') +
      ' <small>(' + esc(String(b.grantedAt).slice(0, 10)) +
      (b.reason ? ' · ' + esc(b.reason) : '') + ')</small></li>').join('') + '</ul>'
    : '<p class="vacio">Todavía no tiene insignias.</p>';

  const comentarios = datos.comentarios.length
    ? '<ul class="comentarios">' + datos.comentarios.slice(0, 60).map((c) =>
      '<li><b>línea ' + c.linea + '</b> (' + esc(c.tipo) + '): ' + esc(c.mensaje) + '</li>').join('') + '</ul>'
    : '<p class="vacio">Sin comentarios por línea.</p>';

  return '<!doctype html>\n<html lang="es"><head><meta charset="utf-8">' +
    '<title>Informe de ' + esc(e.nombre) + '</title><style>' +
    'body{font-family:Segoe UI,system-ui,sans-serif;color:#16191f;margin:32px;line-height:1.45}' +
    'h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}' +
    '.meta{color:#555;font-size:12.5px;margin-bottom:14px}' +
    'table{border-collapse:collapse;width:100%;font-size:12px}' +
    'th,td{border:1px solid #ddd;padding:5px 7px;text-align:left;vertical-align:top}' +
    'th{background:#f3f5f8}' +
    '.kpis{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0 4px}' +
    '.kpi{border:1px solid #ddd;border-radius:6px;padding:8px 12px;min-width:120px}' +
    '.kpi b{display:block;font-size:18px}.kpi span{font-size:11px;color:#555}' +
    '.vacio{color:#777;font-size:12.5px}.insignias li,.comentarios li{font-size:12.5px}' +
    'footer{margin-top:26px;color:#777;font-size:11px}' +
    '@media print{body{margin:12mm}h2{page-break-after:avoid}}' +
    '</style></head><body>' +
    '<h1>Informe de ' + esc(e.nombre) + '</h1>' +
    '<div class="meta">' + esc(e.correo) +
    (e.grado ? ' · grado ' + esc(e.grado) : '') + (e.grupo ? ' · grupo ' + esc(e.grupo) : '') +
    ' · generado el ' + esc(String(datos.generadoEn).slice(0, 19).replace('T', ' ')) + '</div>' +
    '<div class="kpis">' +
    '<div class="kpi"><b>' + (t.completados || 0) + ' / ' + (t.total || 0) + '</b><span>ejercicios completados</span></div>' +
    '<div class="kpi"><b>' + (t.promedio == null ? '—' : t.promedio) + '</b><span>promedio</span></div>' +
    '<div class="kpi"><b>' + (t.xp || 0) + '</b><span>XP</span></div>' +
    '<div class="kpi"><b>' + (t.aprobados || 0) + ' / ' + (t.reprobados || 0) + '</b><span>aprobados / por mejorar</span></div>' +
    '<div class="kpi"><b>' + segundosATexto(t.tiempoSegundos) + '</b><span>tiempo dedicado</span></div>' +
    '</div>' +
    '<h2>Progreso por tema</h2>' +
    (temas ? '<table><thead><tr><th>Tema</th><th>Completados</th><th>Promedio</th><th>XP</th></tr></thead><tbody>' +
      temas + '</tbody></table>' : '<p class="vacio">Sin progreso por tema todavía.</p>') +
    '<h2>Entregas</h2>' +
    (entregas ? '<table><thead><tr><th>Ejercicio</th><th>Tema</th><th>Intento</th><th>Estado</th>' +
      '<th>Nota</th><th>XP</th><th>Tiempo</th><th>Comentario del profesor</th></tr></thead><tbody>' +
      entregas + '</tbody></table>' : '<p class="vacio">Sin entregas.</p>') +
    '<h2>Insignias</h2>' + insignias +
    '<h2>Comentarios por línea</h2>' + comentarios +
    '<footer>Python Classroom ' + esc(app.getVersion()) +
    ' · informe generado desde los datos de este equipo.</footer>' +
    '</body></html>\n';
}

/* ============================================== importar una copia */

/** Cuenta que traeria una copia de seguridad (app:exportData) y que chocaria. */
function previewBackup(datos) {
  const academico = (datos && datos.academico) || {};
  const bloques = [
    ['temarios', 'topics', 'Temas'],
    ['ejercicios', 'exercises', 'Ejercicios'],
    ['clases', 'classes', 'Clases'],
    ['retos', 'challenges', 'Retos'],
    ['entregas', 'submissions', 'Entregas'],
    ['feedback', 'feedback', 'Comentarios'],
    ['usuarios', 'users', 'Cuentas']
  ];

  const resumen = [];
  for (const [clave, tabla, etiqueta] of bloques) {
    const lista = Array.isArray(academico[clave]) ? academico[clave] : [];
    if (!lista.length) continue;
    let conflictos = 0;
    for (const fila of lista) {
      const id = fila && (fila.id || fila.uid);
      if (!id) continue;
      const columna = tabla === 'users' ? 'uid' : 'id';
      if (db.get('SELECT ' + columna + ' FROM ' + tabla + ' WHERE ' + columna + ' = ?', [id])) conflictos++;
    }
    resumen.push({ clave, tabla, etiqueta, total: lista.length, conflictos: conflictos });
  }

  return {
    ok: resumen.length > 0,
    exportadoEn: datos.exportadoEn || null,
    esquema: datos.esquema || null,
    app: datos.app || null,
    perfil: datos.perfil ? { nombre: datos.perfil.nombreCompleto, correo: datos.perfil.correo } : null,
    bloques: resumen,
    totalFilas: resumen.reduce((a, b) => a + b.total, 0),
    totalConflictos: resumen.reduce((a, b) => a + b.conflictos, 0)
  };
}

/**
 * Aplica una copia. `modo`:
 *   'omitir'      -> conserva lo que ya existe (opcion por defecto)
 *   'sobrescribir'-> reemplaza las filas con el mismo identificador
 * Nunca borra nada que no venga en el archivo.
 */
function aplicarBackup(datos, modo) {
  const academico = (datos && datos.academico) || {};
  const sobrescribir = modo === 'sobrescribir';
  const cuenta = { insertados: 0, sobrescritos: 0, omitidos: 0 };

  const bloques = [
    ['temarios', 'topics', 'id'],
    ['ejercicios', 'exercises', 'id'],
    ['clases', 'classes', 'id'],
    ['retos', 'challenges', 'id'],
    ['entregas', 'submissions', 'id'],
    ['feedback', 'feedback', 'id']
  ];

  db.transaction(() => {
    for (const [clave, tabla, columna] of bloques) {
      const lista = Array.isArray(academico[clave]) ? academico[clave] : [];
      for (const fila of lista) {
        const id = fila && fila[columna];
        if (!id) continue;
        const existe = db.get('SELECT ' + columna + ' FROM ' + tabla + ' WHERE ' + columna + ' = ?', [id]);
        if (existe && !sobrescribir) { cuenta.omitidos++; continue; }

        // Solo se copian las columnas que la tabla tiene de verdad: asi un
        // archivo de otra version no rompe la importacion.
        const columnas = db.all('PRAGMA table_info(' + tabla + ')').map((c) => c.name);
        const payload = {};
        for (const c of columnas) {
          if (fila[c] === undefined) continue;
          payload[c] = typeof fila[c] === 'object' && fila[c] !== null ? db.toJson(fila[c]) : fila[c];
        }
        if (payload[columna] == null) payload[columna] = id;
        if (columnas.indexOf('syncedAt') !== -1) payload.syncedAt = null;
        db.upsert(tabla, columna, payload);
        if (existe) cuenta.sobrescritos++; else cuenta.insertados++;
      }
    }
  });

  // El progreso se recalcula: nunca se importa un total ya calculado.
  for (const u of db.all("SELECT uid FROM users WHERE role = 'student'")) {
    work.recomputeProgress(u.uid);
  }
  return Object.assign({ ok: true, modo: sobrescribir ? 'sobrescribir' : 'omitir' }, cuenta);
}

/*
 * Un profesor solo puede pedir el informe de UN ESTUDIANTE DE SU CURSO -nunca
 * de uno ajeno, aunque conozca o adivine su uid-. Sin curso activo, o si el
 * estudiante no es miembro de ese curso, no hay a quién mostrar.
 */
function estudianteDeMiCurso(yo, studentId) {
  if (yo.role !== 'teacher') return yo.uid;
  if (!studentId) return yo.uid;
  const curso = courses.activeCourse();
  if (!curso || courses.membershipRole(curso.id, studentId) !== 'student') {
    throw new Error('Ese estudiante no pertenece a tu curso.');
  }
  return studentId;
}

/* ============================================================ registro */

function register(ipcMain, ctx) {
  const ventana = () => (ctx && ctx.getWindow ? ctx.getWindow() : null);
  const notify = (motivo) => { if (ctx && ctx.send) ctx.send('data:changed', { motivo: motivo, at: Date.now() }); };

  /* ---------------------------------------------------- estadisticas */

  ipcMain.handle('stats:course', guard(() => {
    users.requireTeacher();
    return stats.courseStats();
  }));

  ipcMain.handle('stats:student', guard((studentId) => {
    const yo = users.requireUser();
    const objetivo = estudianteDeMiCurso(yo, studentId);
    const datos = stats.studentReport(objetivo);
    if (!datos) throw new Error('Ese estudiante no existe en este equipo.');
    return datos;
  }));

  ipcMain.handle('stats:criterio', guard(() => {
    users.requireUser();
    return { criterio: stats.criterio(), texto: stats.textoCriterio() };
  }));

  ipcMain.handle('stats:setCriterio', guard((patch) => {
    users.requireTeacher();
    const nuevo = stats.setCriterio(patch || {});
    notify('criterio de estadísticas');
    return { ok: true, criterio: nuevo, texto: stats.textoCriterio(nuevo) };
  }));

  /* -------------------------------------------------- exportar .pclass */

  /**
   * Exporta a .pclass. `que` puede ser 'entrega', 'entregas' o 'ejercicio'.
   * Devuelve { ok, path } o { ok:false, canceled:true }.
   */
  ipcMain.handle('pclass:export', guard(async (que, id) => {
    const yo = users.requireUser();

    let sobre = null;
    let sugerido = 'export';
    if (que === 'entrega') {
      sobre = sobreEntrega(id);
      if (!sobre) throw new Error('La entrega no existe.');
      if (yo.role !== 'teacher' && sobre.studentId !== yo.uid) {
        throw new Error('Solo puedes exportar tus propias entregas.');
      }
      sugerido = nombreArchivo(sobre.exerciseTitle + '-' + sobre.studentName + '-intento' + sobre.attemptNumber, '.pclass');
    } else if (que === 'entregas') {
      users.requireTeacher();
      sobre = sobreEntregasDeEjercicio(id);
      if (!sobre) throw new Error('El ejercicio no existe.');
      sugerido = nombreArchivo(sobre.exerciseTitle + '-entregas', '.pclass');
    } else if (que === 'ejercicio') {
      users.requireTeacher();
      sobre = sobreEjercicio(id);
      if (!sobre) throw new Error('El ejercicio no existe.');
      sugerido = nombreArchivo(sobre.exercise.title, '.pclass');
    } else {
      throw new Error('No sé exportar «' + que + '».');
    }

    const res = await dialog.showSaveDialog(ventana(), {
      title: 'Exportar a .pclass',
      defaultPath: sugerido,
      filters: [{ name: 'Python Classroom', extensions: ['pclass'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    const salida = escribir(res.filePath, JSON.stringify(sobre, null, 2));
    return Object.assign({ tipo: sobre.tipo }, salida);
  }));

  /** Version sin dialogo, para las pruebas automatizadas y los guiones. */
  ipcMain.handle('pclass:exportTo', guard((que, id, destino) => {
    users.requireUser();
    const sobre = que === 'entrega' ? sobreEntrega(id)
      : que === 'entregas' ? sobreEntregasDeEjercicio(id)
        : que === 'ejercicio' ? sobreEjercicio(id) : null;
    if (!sobre) throw new Error('No hay nada que exportar.');
    return Object.assign({ tipo: sobre.tipo }, escribir(String(destino), JSON.stringify(sobre, null, 2)));
  }));

  /* --------------------------------------------------- abrir e importar */

  /** Abre un .pclass en modo lectura: valida y devuelve su contenido. */
  ipcMain.handle('pclass:open', guard(async (ruta) => {
    users.requireUser();
    let archivo = ruta;
    if (!archivo) {
      const res = await dialog.showOpenDialog(ventana(), {
        title: 'Abrir un archivo .pclass',
        properties: ['openFile'],
        filters: [{ name: 'Python Classroom', extensions: ['pclass'] }]
      });
      if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
      archivo = res.filePaths[0];
    }
    if (!fs.existsSync(archivo)) return { ok: false, errores: ['El archivo no existe: ' + archivo] };
    const leido = leerPclass(archivo);
    if (!leido.ok) return { ok: false, errores: leido.errores, path: archivo };
    return { ok: true, path: archivo, tipo: leido.tipo, datos: leido.datos };
  }));

  /**
   * Vista previa de la importacion de un ejercicio: dice si ya existe algo con
   * el mismo identificador o el mismo titulo, para poder preguntar antes.
   */
  ipcMain.handle('pclass:importPreview', guard((ruta) => {
    users.requireTeacher();
    const leido = leerPclass(String(ruta));
    if (!leido.ok) return { ok: false, errores: leido.errores };
    if (leido.tipo !== 'ejercicio') {
      return {
        ok: false,
        errores: ['Este archivo es de tipo «' + leido.tipo + '». Solo se pueden importar ejercicios.']
      };
    }
    const d = leido.datos;
    const porId = d.exerciseId ? db.get('SELECT id, title FROM exercises WHERE id = ?', [d.exerciseId]) : null;
    const porTitulo = db.get('SELECT id, title FROM exercises WHERE lower(title) = lower(?)',
      [String(d.exercise.title || '')]);
    return {
      ok: true,
      tipo: leido.tipo,
      exportadoEn: d.exportadoEn || null,
      ejercicio: d.exercise,
      temaNombre: d.exercise.temaNombre || null,
      conflicto: porId || porTitulo
        ? {
          id: (porId || porTitulo).id,
          title: (porId || porTitulo).title,
          motivo: porId ? 'Ya existe un ejercicio con el mismo identificador.'
            : 'Ya existe un ejercicio con el mismo título.'
        }
        : null
    };
  }));

  /**
   * Importa el ejercicio. `modo`:
   *   'nuevo'        -> crea una copia con identificador nuevo (por defecto)
   *   'sobrescribir' -> reemplaza el ejercicio en conflicto
   */
  ipcMain.handle('pclass:import', guard((ruta, modo) => {
    const yo = users.requireTeacher();
    const leido = leerPclass(String(ruta));
    if (!leido.ok) return { ok: false, errores: leido.errores };
    if (leido.tipo !== 'ejercicio') {
      return { ok: false, errores: ['Solo se pueden importar ejercicios.'] };
    }
    const d = leido.datos;
    const ex = d.exercise;

    // El tema se busca por nombre; si no existe se crea, para que el ejercicio
    // no quede colgando sin tema.
    let topicId = null;
    if (ex.temaNombre) {
      const tema = db.get('SELECT id FROM topics WHERE lower(name) = lower(?)', [ex.temaNombre]);
      if (tema) topicId = tema.id;
      else {
        const creado = academic.saveTopic({ name: ex.temaNombre }, yo.uid);
        if (creado.ok) topicId = creado.tema.id;
      }
    }

    const sobrescribir = modo === 'sobrescribir';
    const conflicto = d.exerciseId ? db.get('SELECT id FROM exercises WHERE id = ?', [d.exerciseId]) : null;
    const porTitulo = db.get('SELECT id FROM exercises WHERE lower(title) = lower(?)', [String(ex.title || '')]);
    const destino = sobrescribir ? (conflicto || porTitulo) : null;

    const datos = {
      id: destino ? destino.id : undefined,
      title: sobrescribir || !porTitulo ? ex.title : ex.title + ' (importado)',
      description: ex.description,
      instructions: ex.instructions,
      topicId: topicId,
      type: ex.type,
      difficulty: ex.difficulty,
      xp: ex.xp,
      maxScore: ex.maxScore,
      timeLimit: ex.timeLimit,
      maxAttempts: ex.maxAttempts,
      isClassOnly: ex.isClassOnly,
      allowLateSubmission: ex.allowLateSubmission,
      starterCode: ex.starterCode,
      rubric: ex.rubric,
      files: ex.files,
      status: 'draft'
    };

    const out = academic.saveExercise(datos, yo.uid);
    if (!out.ok) return { ok: false, errores: Object.values(out.errores || { error: out.error }) };
    notify('importación');
    return {
      ok: true,
      modo: sobrescribir ? 'sobrescribir' : 'nuevo',
      ejercicio: out.ejercicio,
      avisoTema: topicId ? null : 'El ejercicio quedó sin tema porque el archivo no traía ninguno.'
    };
  }));

  /* ------------------------------------------------- informes y CSV */

  /** CSV de notas: una fila por entrega calificada. */
  ipcMain.handle('report:csv', guard(async (destino) => {
    users.requireTeacher();
    const cid = courses.requireActiveCourse().id;
    const filas = db.all(
      'SELECT u.firstName, u.lastName, u.email, u.grade, u.groupName,' +
      ' e.title AS ejercicio, t.name AS tema, s.attemptNumber, s.status, s.grade AS nota,' +
      ' COALESCE(s.maxScore, e.maxScore) AS maxScore, s.xpEarned, s.timeSpentSec, s.isLate,' +
      ' s.submittedAt, s.gradedAt, s.teacherComment' +
      ' FROM submissions s' +
      ' LEFT JOIN users u ON u.uid = s.studentId' +
      ' LEFT JOIN exercises e ON e.id = s.exerciseId' +
      ' LEFT JOIN topics t ON t.id = e.topicId' +
      ' WHERE s.grade IS NOT NULL AND s.courseId = ?' +
      ' ORDER BY u.lastName, u.firstName, e.title, s.attemptNumber', [cid]);

    const cabecera = ['Apellido', 'Nombre', 'Correo', 'Grado', 'Grupo', 'Tema', 'Ejercicio',
      'Intento', 'Estado', 'Nota', 'Nota máxima', 'XP', 'Tiempo (min)', 'Tardía',
      'Entregada', 'Calificada', 'Comentario'];
    const cuerpo = filas.map((r) => [
      r.lastName, r.firstName, r.email, r.grade, r.groupName, r.tema, r.ejercicio,
      r.attemptNumber, r.status, r.nota, r.maxScore, r.xpEarned,
      Math.round((r.timeSpentSec || 0) / 60), r.isLate ? 'sí' : 'no',
      r.submittedAt, r.gradedAt, r.teacherComment
    ]);

    let ruta = destino;
    if (!ruta) {
      const res = await dialog.showSaveDialog(ventana(), {
        title: 'Exportar notas a CSV',
        defaultPath: nombreArchivo('notas-python-classroom', '.csv'),
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      ruta = res.filePath;
    }
    // BOM para que Excel reconozca UTF-8 y no rompa los acentos.
    const salida = escribir(ruta, '﻿' + csv([cabecera].concat(cuerpo)));
    return Object.assign({ filas: cuerpo.length }, salida);
  }));

  /** JSON con todo el curso -del curso activo, nunca del colegio entero-. */
  ipcMain.handle('report:json', guard(async (destino) => {
    users.requireTeacher();
    const cid = courses.requireActiveCourse().id;
    const payload = {
      formato: 'pclass-curso',
      version: VERSION_PCLASS,
      exportadoEn: db.nowIso(),
      app: { nombre: app.getName(), version: app.getVersion() },
      esquema: db.SCHEMA_VERSION,
      estadisticas: stats.courseStats(),
      usuarios: users.list(),
      temas: db.all('SELECT * FROM topics'),
      ejercicios: db.all('SELECT * FROM exercises WHERE courseId = ?', [cid]),
      clases: db.all('SELECT * FROM classes WHERE courseId = ?', [cid]),
      retos: db.all('SELECT * FROM challenges WHERE courseId = ?', [cid]),
      entregas: db.all('SELECT * FROM submissions WHERE courseId = ?', [cid]),
      feedback: db.all('SELECT * FROM feedback WHERE courseId = ?', [cid]),
      historialNotas: db.all('SELECT * FROM grade_history WHERE courseId = ?', [cid]),
      insignias: db.all('SELECT * FROM badges'),
      insigniasConcedidas: db.all('SELECT * FROM user_badges WHERE courseId = ?', [cid]),
      premios: db.all('SELECT * FROM rewards')
    };
    let ruta = destino;
    if (!ruta) {
      const res = await dialog.showSaveDialog(ventana(), {
        title: 'Exportar el curso a JSON',
        defaultPath: nombreArchivo('curso-python-classroom', '.json'),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      ruta = res.filePath;
    }
    return escribir(ruta, JSON.stringify(payload, null, 2));
  }));

  /** Informe imprimible de un estudiante en HTML. */
  ipcMain.handle('report:student', guard(async (studentId, destino) => {
    const yo = users.requireUser();
    const objetivo = estudianteDeMiCurso(yo, studentId);
    const datos = stats.studentReport(objetivo);
    if (!datos) throw new Error('Ese estudiante no existe en este equipo.');

    let ruta = destino;
    if (!ruta) {
      const res = await dialog.showSaveDialog(ventana(), {
        title: 'Informe imprimible',
        defaultPath: nombreArchivo('informe-' + datos.estudiante.nombre, '.html'),
        filters: [{ name: 'HTML', extensions: ['html'] }]
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      ruta = res.filePath;
    }
    const salida = escribir(ruta, informeHtml(datos));
    return Object.assign({ estudiante: datos.estudiante.nombre }, salida);
  }));

  ipcMain.handle('report:openFile', guard(async (ruta) => {
    users.requireUser();
    const archivo = path.resolve(String(ruta || ''));
    if (!fs.existsSync(archivo)) return { ok: false, error: 'El archivo no existe.' };
    await shell.openPath(archivo);
    return { ok: true };
  }));

  /* ------------------------------------------------- importar una copia */

  ipcMain.handle('backup:importPreview', guard(async (ruta) => {
    users.requireTeacher();
    let archivo = ruta;
    if (!archivo) {
      const res = await dialog.showOpenDialog(ventana(), {
        title: 'Importar una copia de seguridad',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
      archivo = res.filePaths[0];
    }
    if (!fs.existsSync(archivo)) return { ok: false, error: 'El archivo no existe.' };
    let datos = null;
    try {
      datos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    } catch (err) {
      return { ok: false, error: 'El archivo no es JSON válido: ' + err.message };
    }
    const previa = previewBackup(datos);
    if (!previa.ok) return { ok: false, error: 'La copia no contiene datos académicos que importar.' };
    return Object.assign({ path: archivo }, previa);
  }));

  ipcMain.handle('backup:import', guard((ruta, modo) => {
    users.requireTeacher();
    const archivo = path.resolve(String(ruta || ''));
    if (!fs.existsSync(archivo)) return { ok: false, error: 'El archivo no existe.' };
    const datos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    // Antes de tocar nada se guarda una copia de la base actual.
    const copia = db.backupNow('previa-importacion');
    const res = aplicarBackup(datos, modo);
    notify('importación de copia');
    return Object.assign(res, { copiaPrevia: copia.ok ? copia.name : null });
  }));

  /* ------------------------------------- copias de seguridad (fase 6) */

  ipcMain.handle('backup:list', guard(() => {
    users.requireUser();
    return { carpeta: db.backupsDir(), copias: db.listBackups() };
  }));

  ipcMain.handle('backup:create', guard(() => {
    users.requireUser();
    return db.backupNow('manual');
  }));

  ipcMain.handle('backup:restore', guard((archivo) => {
    users.requireTeacher();
    const res = db.restoreBackup(archivo);
    if (res.ok) notify('restauración');
    return res;
  }));

  ipcMain.handle('backup:reveal', guard(() => {
    users.requireUser();
    shell.openPath(db.backupsDir());
    return { ok: true };
  }));

  return {
    informeHtml,
    validarPclass,
    previewBackup
  };
}

module.exports = { register, validarPclass, informeHtml, previewBackup, VERSION_PCLASS, FORMATO };
