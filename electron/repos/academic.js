'use strict';
/*
 * Temarios, ejercicios, clases y retos sobre SQLite.
 *
 * Aqui vive el modelo academico y sus reglas de negocio (estados, fechas,
 * disponibilidad). No sabe nada de la interfaz ni de Firebase: los cambios se
 * dejan en la cola de sincronizacion y otro modulo los sube cuando puede.
 */

const db = require('../sqlite');
const users = require('./users');
const courses = require('./courses');
const groups = require('./groups');

const TIPOS = ['normal', 'timed', 'class', 'challenge', 'project'];
const DIFICULTADES = ['easy', 'medium', 'hard'];
const ESTADOS_EJERCICIO = ['draft', 'published', 'active', 'closed', 'archived'];
const ESTADOS_CLASE = ['scheduled', 'active', 'closed'];

const TEMARIO_SUGERIDO = [
  'Variables', 'Tipos de datos', 'Operadores', 'Condicionales', 'Ciclos',
  'Funciones', 'Listas', 'Tuplas', 'Diccionarios', 'Conjuntos', 'Strings',
  'Manejo de archivos', 'Excepciones', 'POO', 'Módulos', 'Librerías',
  'Programación avanzada'
];

const COLORES = ['#4b8bf5', '#7ee1c9', '#ffd43b', '#ff7ab2', '#c58cf5', '#f0b23a', '#57c7d4', '#4bcf87'];

/* ------------------------------------------------------------- utiles */

function num(value, def, min, max) {
  const n = Number(value);
  if (!isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function real(value, def, min, max) {
  const n = Number(value);
  if (!isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function isoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function bool(value, def) {
  if (value === undefined || value === null) return def ? 1 : 0;
  return value ? 1 : 0;
}

function enumOr(value, lista, def) {
  return lista.indexOf(value) !== -1 ? value : def;
}

/* ============================================================ temarios */

function topicView(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    nombre: row.name,
    description: row.description,
    descripcion: row.description,
    orderIndex: row.orderIndex,
    orden: row.orderIndex,
    status: row.status,
    color: row.color,
    createdAt: row.createdAt,
    ejercicios: row.exerciseCount || 0,
    xpDisponible: row.xpAvailable || 0
  };
}

function listTopics() {
  return db.all(
    'SELECT t.*, ' +
    " (SELECT COUNT(*) FROM exercises e WHERE e.topicId = t.id) AS exerciseCount," +
    " (SELECT COALESCE(SUM(e.xp),0) FROM exercises e WHERE e.topicId = t.id AND e.status IN ('published','active')) AS xpAvailable" +
    ' FROM topics t ORDER BY t.orderIndex, t.name'
  ).map(topicView);
}

function saveTopic(datos, actorUid) {
  const name = users.clean(datos.name || datos.nombre, 60);
  if (name.length < 2) return { ok: false, errores: { nombre: 'Escribe el nombre del tema.' } };

  const dup = db.get('SELECT id FROM topics WHERE lower(name) = lower(?) AND id <> ?',
    [name, datos.id || '']);
  if (dup) return { ok: false, errores: { nombre: 'Ya existe un tema con ese nombre.' } };

  const previo = datos.id ? db.get('SELECT * FROM topics WHERE id = ?', [datos.id]) : null;
  if (datos.id && !previo) return { ok: false, error: 'El tema no existe.' };

  const total = db.get('SELECT COUNT(*) AS n FROM topics').n;
  const row = {
    id: previo ? previo.id : db.newId('topic'),
    name: name,
    description: users.clean(datos.description || datos.descripcion, 300),
    orderIndex: num(datos.orderIndex != null ? datos.orderIndex : datos.orden, total + 1, 0, 999),
    status: enumOr(datos.status, ['active', 'hidden'], 'active'),
    color: datos.color || (previo && previo.color) || COLORES[total % COLORES.length],
    createdBy: previo ? previo.createdBy : actorUid,
    createdAt: previo ? previo.createdAt : db.nowIso(),
    updatedAt: db.nowIso(),
    syncedAt: null
  };
  db.upsert('topics', 'id', row);
  db.enqueue('topics', row.id, 'upsert', row);
  return { ok: true, tema: topicView(Object.assign({}, row, { exerciseCount: 0 })) };
}

function deleteTopic(id) {
  const usados = db.get('SELECT COUNT(*) AS n FROM exercises WHERE topicId = ?', [id]).n;
  if (usados > 0) {
    return { ok: false, error: 'No se puede borrar: hay ' + usados + ' ejercicio(s) en este tema.' };
  }
  db.run('DELETE FROM topics WHERE id = ?', [id]);
  db.enqueue('topics', id, 'delete', null);
  return { ok: true };
}

function seedSuggestedTopics(actorUid) {
  let creados = 0;
  db.transaction(() => {
    TEMARIO_SUGERIDO.forEach((name, i) => {
      const existe = db.get('SELECT id FROM topics WHERE lower(name) = lower(?)', [name]);
      if (existe) return;
      const row = {
        id: db.newId('topic'),
        name: name,
        description: '',
        orderIndex: i + 1,
        status: 'active',
        color: COLORES[i % COLORES.length],
        createdBy: actorUid,
        createdAt: db.nowIso(),
        updatedAt: db.nowIso(),
        syncedAt: null
      };
      db.upsert('topics', 'id', row);
      db.enqueue('topics', row.id, 'upsert', row);
      creados++;
    });
  });
  return { ok: true, creados };
}

/* ========================================================== ejercicios */

function topicName(topicId) {
  if (!topicId) return 'Sin tema';
  const t = db.get('SELECT name FROM topics WHERE id = ?', [topicId]);
  return t ? t.name : 'Sin tema';
}

/**
 * Clase de este ejercicio que esta abierta AHORA.
 *
 * «Abierta» es dos cosas a la vez: que el profesor la haya puesto en marcha y
 * que estemos dentro de su horario. Una clase programada de 10:00 a 11:00 no
 * abre el ejercicio a las 15:00 aunque nadie la haya cerrado a mano.
 */
function activeClassFor(exerciseId) {
  const ahora = Date.now();
  const clases = db.all(
    'SELECT c.* FROM classes c JOIN class_exercises ce ON ce.classId = c.id' +
    " WHERE ce.exerciseId = ? AND c.status IN ('active','scheduled')", [exerciseId]);

  for (const c of clases) {
    const inicio = c.startTime ? new Date(c.startTime).getTime() : null;
    const fin = c.endTime ? new Date(c.endTime).getTime() : null;
    const empezada = inicio == null || inicio <= ahora;
    const noTerminada = fin == null || fin >= ahora;

    // Sin horario, manda el interruptor del profesor.
    if (inicio == null && fin == null) {
      if (c.status === 'active') return c;
      continue;
    }
    // Con horario, tiene que estar dentro de la ventana y no cerrada a mano.
    if (empezada && noTerminada && c.status !== 'closed') return c;
  }
  return null;
}

/** Proxima clase programada de un ejercicio, para poder decir cuando abre. */
function nextClassFor(exerciseId) {
  const ahora = new Date().toISOString();
  return db.get(
    'SELECT c.* FROM classes c JOIN class_exercises ce ON ce.classId = c.id' +
    " WHERE ce.exerciseId = ? AND c.status <> 'closed' AND c.startTime IS NOT NULL" +
    ' AND c.startTime > ? ORDER BY c.startTime LIMIT 1', [exerciseId, ahora]);
}

/**
 * Decide si un estudiante puede abrir un ejercicio ahora.
 * Devuelve { puede, motivo, tarde, claseId }.
 */
function availability(row, studentUid) {
  if (!row) return { puede: false, motivo: 'El ejercicio no existe.' };
  if (row.status === 'draft') return { puede: false, motivo: 'Este ejercicio todavía no está publicado.' };
  if (row.status === 'archived') return { puede: false, motivo: 'Este ejercicio está archivado.' };
  if (row.status === 'closed') return { puede: false, motivo: 'Este ejercicio está cerrado: ya no admite entregas.' };

  /*
   * Asignación individual o por grupo (fase 5): sin destinatarios, el
   * ejercicio sigue siendo para todo el curso -cero cambios para lo que ya
   * existía-. Con destinatarios, quien no aparezca ni directo ni por su
   * grupo lo ve como si no existiera, igual que uno fuera de horario.
   */
  if (studentUid && !groups.visibleParaEstudiante(row.id, studentUid, row.courseId)) {
    return { puede: false, motivo: 'Este ejercicio no está asignado a ti.' };
  }

  if (row.isClassOnly) {
    const clase = activeClassFor(row.id);
    if (!clase) {
      const proxima = nextClassFor(row.id);
      const cuando = proxima && proxima.startTime
        ? ' Abre el ' + new Date(proxima.startTime).toLocaleString('es',
          { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + '.'
        : '';
      return {
        puede: false,
        motivo: 'Este ejercicio solamente está disponible durante la clase.' + cuando
      };
    }
    var claseId = clase.id;
  }

  let tarde = false;
  if (row.dueDate) {
    const vencido = new Date(row.dueDate).getTime() < Date.now();
    if (vencido) {
      if (!row.allowLateSubmission) {
        return { puede: false, motivo: 'La fecha de entrega ya pasó y no se admiten entregas tardías.' };
      }
      tarde = true;
    }
  }

  if (row.maxAttempts > 0 && studentUid) {
    const usados = db.get(
      'SELECT COUNT(*) AS n FROM submissions WHERE studentId = ? AND exerciseId = ?' +
      " AND status NOT IN ('draft')", [studentUid, row.id]).n;
    const abierto = db.get(
      'SELECT id FROM submissions WHERE studentId = ? AND exerciseId = ?' +
      " AND status IN ('draft','in_progress') LIMIT 1", [studentUid, row.id]);
    if (usados >= row.maxAttempts && !abierto) {
      return { puede: false, motivo: 'Has agotado los ' + row.maxAttempts + ' intentos.' };
    }
  }

  return { puede: true, tarde: tarde, claseId: typeof claseId !== 'undefined' ? claseId : null };
}

function exerciseView(row, studentUid) {
  if (!row) return null;
  const rubricList = normalizarLista(db.parseJson(row.rubric, []));
  const disp = availability(row, studentUid);
  const out = {
    id: row.id,
    title: row.title,
    titulo: row.title,
    description: row.description,
    descripcion: row.description,
    instructions: row.instructions,
    instrucciones: row.instructions,
    topicId: row.topicId,
    temaId: row.topicId,
    tema: topicName(row.topicId),
    type: row.type,
    difficulty: row.difficulty,
    dificultad: { easy: 1, medium: 2, hard: 3 }[row.difficulty] || 1,
    xp: row.xp,
    maxScore: row.maxScore,
    notaMaxima: row.maxScore,
    timeLimit: row.timeLimit,
    tiempoLimiteMin: row.timeLimit,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
    dueDate: row.dueDate,
    isClassOnly: !!row.isClassOnly,
    allowLateSubmission: !!row.allowLateSubmission,
    maxAttempts: row.maxAttempts,
    intentosMax: row.maxAttempts,
    starterCode: row.starterCode,
    plantilla: row.starterCode,
    rubric: rubricList,
    criterios: rubricList,
    files: db.parseJson(row.files, []),
    disponible: disp.puede,
    motivoNoDisponible: disp.puede ? null : disp.motivo,
    entregaTardia: !!disp.tarde,
    claseActivaId: disp.claseId || null,
    destinatarios: groups.targetsFor(row.id)
  };
  if (studentUid) {
    out.attempts = db.get(
      'SELECT COUNT(*) AS n FROM submissions WHERE studentId = ? AND exerciseId = ?',
      [studentUid, row.id]).n;
  }
  return out;
}

function getExercise(id, studentUid) {
  return exerciseView(db.get('SELECT * FROM exercises WHERE id = ?', [id]), studentUid);
}

function listExercises(actor) {
  if (actor.role === 'teacher') {
    const cursoId = courses.requireActiveCourse().id;
    return db.all('SELECT * FROM exercises WHERE courseId = ? ORDER BY updatedAt DESC', [cursoId])
      .map((r) => exerciseView(r, null));
  }
  const cursoId = courses.courseIdFor(actor.uid);
  if (!cursoId) return [];   // sin curso todavia: no hay nada que ver
  /*
   * Ojo: esto NO excluye type='challenge' -aunque esa etiqueta exista-,
   * porque pintarRetosEstudiante (src/js/exercises.js) necesita encontrar el
   * ejercicio ligado a un reto (challenges.exerciseId) dentro de esta misma
   * lista para poder abrirlo; la separacion visual de "no aparecer dos veces"
   * se resuelve en la interfaz (vistaEstudiante), no aqui.
   */
  return db.all(
    "SELECT * FROM exercises WHERE courseId = ? AND status IN ('published','active') ORDER BY title", [cursoId]
  ).map((r) => exerciseView(r, actor.uid)).filter((exercise) => exercise.disponible);
}

/*
 * Lo que viaja a Firebase de un ejercicio.
 *
 * `rubric` y `files` se guardan en SQLite como texto JSON, pero a Firebase tienen
 * que ir como lista de verdad: si se subiera el texto, al bajarlo se volveria a
 * codificar y los criterios se perderian por el camino.
 */
function remoteExercise(row) {
  return Object.assign({}, row, {
    rubric: normalizarLista(db.parseJson(row.rubric, [])),
    files: normalizarLista(db.parseJson(row.files, [])),
    /*
     * `exercises/$id/targets` no es una entidad aparte en Firebase -hereda la
     * regla de escritura del propio ejercicio, sin reglas nuevas (ver el plan
     * de la fase 5)-, así que viaja embebido aquí. El nodo se reescribe
     * ENTERO en cada guardado (RUTAS usa fb.escribir, no un parche), así que
     * hace falta incluirlo siempre o un guardado sin tocar destinatarios los
     * borraría sin querer.
     */
    targets: groups.targetsFor(row.id)
  });
}

/** Devuelve siempre una lista, tambien si Firebase lo entrego como objeto. */
function normalizarLista(valor) {
  if (Array.isArray(valor)) return valor;
  if (typeof valor === 'string') return normalizarLista(db.parseJson(valor, []));
  if (valor && typeof valor === 'object') return Object.values(valor);
  return [];
}

function saveExercise(datos, actorUid) {
  const errores = {};
  const title = users.clean(datos.title || datos.titulo, 120);
  if (title.length < 3) errores.titulo = 'El título debe tener al menos 3 caracteres.';

  const topicId = datos.topicId || datos.temaId || null;
  if (!topicId || !db.get('SELECT id FROM topics WHERE id = ?', [topicId])) {
    errores.temaId = 'Elige un tema.';
  }

  const publishedAt = isoOrNull(datos.publishedAt);
  const dueDate = isoOrNull(datos.dueDate);
  if (publishedAt && dueDate && new Date(dueDate) <= new Date(publishedAt)) {
    errores.dueDate = 'La fecha de cierre debe ser posterior a la de publicación.';
  }

  const maxScore = real(datos.maxScore != null ? datos.maxScore : datos.notaMaxima, 5, 0.1, 100);
  const rubric = Array.isArray(datos.rubric || datos.criterios)
    ? (datos.rubric || datos.criterios).map((c) => ({
      id: c.id || db.newId('crit'),
      name: users.clean(c.name || c.nombre, 60),
      points: real(c.points != null ? c.points : c.puntos, 0, 0, 100)
    })).filter((c) => c.name)
    : [];
  const suma = rubric.reduce((a, c) => a + c.points, 0);
  if (rubric.length && Math.abs(suma - maxScore) > 0.001) {
    errores.criterios = 'Los criterios suman ' + suma + ' y la nota máxima es ' + maxScore + '.';
  }

  if (Object.keys(errores).length) return { ok: false, errores };

  const previo = datos.id ? db.get('SELECT * FROM exercises WHERE id = ?', [datos.id]) : null;
  if (datos.id && !previo) return { ok: false, error: 'El ejercicio no existe.' };

  const tipo = enumOr(datos.type, TIPOS, datos.timeLimit || datos.tiempoLimiteMin ? 'timed' : 'normal');
  const status = enumOr(datos.status, ESTADOS_EJERCICIO, previo ? previo.status : 'draft');

  const row = {
    id: previo ? previo.id : db.newId('exercise'),
    title: title,
    description: String(datos.description || datos.descripcion || '').slice(0, 2000),
    instructions: String(datos.instructions || datos.instrucciones || '').slice(0, 8000),
    topicId: topicId,
    type: tipo,
    difficulty: enumOr(datos.difficulty, DIFICULTADES,
      { 1: 'easy', 2: 'medium', 3: 'hard' }[Number(datos.dificultad)] || 'easy'),
    xp: num(datos.xp, 10, 0, 10000),
    maxScore: maxScore,
    timeLimit: num(datos.timeLimit != null ? datos.timeLimit : datos.tiempoLimiteMin, 0, 0, 600),
    status: status,
    createdBy: previo ? previo.createdBy : actorUid,
    createdAt: previo ? previo.createdAt : db.nowIso(),
    updatedAt: db.nowIso(),
    publishedAt: status === 'draft' ? null : (publishedAt || (previo && previo.publishedAt) || db.nowIso()),
    dueDate: dueDate,
    isClassOnly: bool(datos.isClassOnly, false),
    allowLateSubmission: bool(datos.allowLateSubmission, true),
    maxAttempts: num(datos.maxAttempts != null ? datos.maxAttempts : datos.intentosMax, 0, 0, 99),
    starterCode: String(datos.starterCode || datos.plantilla || '').slice(0, 40000),
    rubric: db.toJson(rubric),
    files: db.toJson(Array.isArray(datos.files) ? datos.files.slice(0, 20) : []),
    courseId: previo ? previo.courseId : courses.requireActiveCourse().id,
    syncedAt: null
  };

  db.upsert('exercises', 'id', row);
  db.enqueue('exercises', row.id, 'upsert', remoteExercise(row));
  return { ok: true, ejercicio: exerciseView(row, null) };
}

function setExerciseStatus(id, status) {
  if (ESTADOS_EJERCICIO.indexOf(status) === -1) return { ok: false, error: 'Estado no válido.' };
  const previo = db.get('SELECT * FROM exercises WHERE id = ?', [id]);
  if (!previo) return { ok: false, error: 'El ejercicio no existe.' };
  const publishedAt = (status !== 'draft' && !previo.publishedAt) ? db.nowIso() : previo.publishedAt;
  db.run('UPDATE exercises SET status = ?, publishedAt = ?, updatedAt = ? WHERE id = ?',
    [status, publishedAt, db.nowIso(), id]);
  const row = db.get('SELECT * FROM exercises WHERE id = ?', [id]);
  db.enqueue('exercises', id, 'upsert', remoteExercise(row));
  return { ok: true, ejercicio: exerciseView(row, null) };
}

function deleteExercise(id) {
  const previo = db.get('SELECT * FROM exercises WHERE id = ?', [id]);
  if (!previo) return { ok: false, error: 'El ejercicio no existe.' };
  const entregas = db.get('SELECT COUNT(*) AS n FROM submissions WHERE exerciseId = ?', [id]).n;
  db.transaction(() => {
    db.run('DELETE FROM submissions WHERE exerciseId = ?', [id]);
    db.run('DELETE FROM exercise_targets WHERE exerciseId = ?', [id]);
    db.run('DELETE FROM exercises WHERE id = ?', [id]);
  });
  db.enqueue('exercises', id, 'delete', null);
  return { ok: true, entregasBorradas: entregas };
}

/* ============================================================== clases */

function classView(row) {
  if (!row) return null;
  const ejercicios = db.all(
    'SELECT e.id, e.title, e.status FROM class_exercises ce JOIN exercises e ON e.id = ce.exerciseId' +
    ' WHERE ce.classId = ?', [row.id]);
  return {
    id: row.id,
    title: row.title,
    titulo: row.title,
    topicId: row.topicId,
    tema: topicName(row.topicId),
    teacherId: row.teacherId,
    status: row.status,
    startTime: row.startTime,
    endTime: row.endTime,
    onClosePolicy: row.onClosePolicy,
    createdAt: row.createdAt,
    ejercicios: ejercicios,
    activa: row.status === 'active'
  };
}

function listClasses() {
  const cursoId = courses.requireActiveCourse().id;
  return db.all('SELECT * FROM classes WHERE courseId = ? ORDER BY COALESCE(startTime, createdAt) DESC',
    [cursoId]).map(classView);
}

function activeClasses(studentUid) {
  const cursoId = courses.courseIdFor(studentUid);
  if (!cursoId) return [];
  return db.all("SELECT * FROM classes WHERE courseId = ? AND status = 'active'", [cursoId]).map(classView);
}

/**
 * "Mis clases" del estudiante: la que esta abierta ahora mismo, las que su
 * profesor ya programo (con horario fijado o todavia sin el) y un puñado de
 * las que acaban de cerrar.
 *
 * activeClasses() de arriba solo sirve para el chequeo de disponibilidad de
 * un ejercicio "solo en clase" -responde "hay algo abierto AHORA"-. Esta es
 * para una pantalla que el estudiante puede consultar en cualquier momento,
 * asi que tambien necesita lo que viene despues y lo que acaba de terminar,
 * no solo el instante presente.
 */
function studentClasses(studentUid) {
  const cursoId = courses.courseIdFor(studentUid);
  if (!cursoId) return [];

  const activas = db.all(
    "SELECT * FROM classes WHERE courseId = ? AND status = 'active'" +
    ' ORDER BY COALESCE(startTime, createdAt)', [cursoId]).map(classView);
  const programadas = db.all(
    "SELECT * FROM classes WHERE courseId = ? AND status = 'scheduled'" +
    ' ORDER BY COALESCE(startTime, createdAt)', [cursoId]).map(classView);
  /*
   * Solo un puñado de las mas recientes: esto no pretende ser un historial
   * completo del curso -eso ya lo tiene el profesor en "Clases"-, solo que lo
   * que el estudiante acaba de ver cerrar no desaparezca de golpe de su
   * propia pantalla.
   */
  const cerradas = db.all(
    "SELECT * FROM classes WHERE courseId = ? AND status = 'closed'" +
    ' ORDER BY COALESCE(endTime, updatedAt) DESC LIMIT 5', [cursoId]).map(classView);

  return activas.concat(programadas, cerradas);
}

function saveClass(datos, actorUid) {
  const title = users.clean(datos.title || datos.titulo, 120);
  if (title.length < 3) return { ok: false, errores: { titulo: 'Escribe un nombre para la clase.' } };
  const previo = datos.id ? db.get('SELECT * FROM classes WHERE id = ?', [datos.id]) : null;
  if (datos.id && !previo) return { ok: false, error: 'La clase no existe.' };

  const row = {
    id: previo ? previo.id : db.newId('class'),
    title: title,
    topicId: datos.topicId || datos.temaId || null,
    teacherId: previo ? previo.teacherId : actorUid,
    status: enumOr(datos.status, ESTADOS_CLASE, previo ? previo.status : 'scheduled'),
    startTime: isoOrNull(datos.startTime) || (previo && previo.startTime) || null,
    endTime: isoOrNull(datos.endTime) || (previo && previo.endTime) || null,
    onClosePolicy: enumOr(datos.onClosePolicy, ['allow_finish', 'block'], 'allow_finish'),
    courseId: previo ? previo.courseId : courses.requireActiveCourse().id,
    createdAt: previo ? previo.createdAt : db.nowIso(),
    updatedAt: db.nowIso(),
    syncedAt: null
  };
  db.upsert('classes', 'id', row);

  if (Array.isArray(datos.exerciseIds)) {
    db.transaction(() => {
      db.run('DELETE FROM class_exercises WHERE classId = ?', [row.id]);
      for (const exId of datos.exerciseIds.slice(0, 50)) {
        // Solo ejercicios del mismo curso: una clase no puede colar contenido
        // de otro curso a través de la ventana de horario.
        if (db.get('SELECT id FROM exercises WHERE id = ? AND courseId = ?', [exId, row.courseId])) {
          db.run('INSERT OR IGNORE INTO class_exercises(classId, exerciseId) VALUES (?, ?)', [row.id, exId]);
        }
      }
    });
  }

  const vista = classView(db.get('SELECT * FROM classes WHERE id = ?', [row.id]));
  db.enqueue('classes', row.id, 'upsert', Object.assign({}, row, {
    exerciseIds: vista.ejercicios.map((e) => e.id)
  }));
  return { ok: true, clase: vista };
}

function setClassStatus(id, status) {
  if (ESTADOS_CLASE.indexOf(status) === -1) return { ok: false, error: 'Estado no válido.' };
  const previo = db.get('SELECT * FROM classes WHERE id = ?', [id]);
  if (!previo) return { ok: false, error: 'La clase no existe.' };

  const patch = { status: status, updatedAt: db.nowIso() };
  if (status === 'active' && !previo.startTime) patch.startTime = db.nowIso();
  if (status === 'closed' && !previo.endTime) patch.endTime = db.nowIso();

  db.run('UPDATE classes SET status = ?, startTime = ?, endTime = ?, updatedAt = ? WHERE id = ?',
    [patch.status, patch.startTime || previo.startTime, patch.endTime || previo.endTime, patch.updatedAt, id]);

  // Al cerrar una clase con politica de bloqueo, los intentos abiertos de sus
  // ejercicios se marcan como abandonados.
  let bloqueados = 0;
  if (status === 'closed' && previo.onClosePolicy === 'block') {
    const ejercicios = db.all('SELECT exerciseId FROM class_exercises WHERE classId = ?', [id]);
    for (const e of ejercicios) {
      const res = db.run(
        "UPDATE submissions SET status = 'abandoned', updatedAt = ?" +
        " WHERE exerciseId = ? AND status IN ('draft','in_progress')", [db.nowIso(), e.exerciseId]);
      bloqueados += res.changes || 0;
    }
  }

  const row = db.get('SELECT * FROM classes WHERE id = ?', [id]);
  db.enqueue('classes', id, 'upsert', row);
  return { ok: true, clase: classView(row), bloqueados };
}

function deleteClass(id) {
  db.run('DELETE FROM classes WHERE id = ?', [id]);
  db.enqueue('classes', id, 'delete', null);
  return { ok: true };
}

/* ============================================================== retos */

function challengeView(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    titulo: row.title,
    description: row.description,
    topicId: row.topicId,
    tema: topicName(row.topicId),
    difficulty: row.difficulty,
    xp: row.xp,
    reward: row.reward,
    requirements: row.requirements,
    startDate: row.startDate,
    endDate: row.endDate,
    maxAttempts: row.maxAttempts,
    status: row.status,
    exerciseId: row.exerciseId,
    createdAt: row.createdAt,
    disponible: row.status === 'published' &&
      (!row.startDate || new Date(row.startDate).getTime() <= Date.now()) &&
      (!row.endDate || new Date(row.endDate).getTime() >= Date.now())
  };
}

function listChallenges(actor) {
  if (actor.role === 'teacher') {
    const cursoId = courses.requireActiveCourse().id;
    return db.all('SELECT * FROM challenges WHERE courseId = ? ORDER BY updatedAt DESC', [cursoId])
      .map(challengeView);
  }
  const cursoId = courses.courseIdFor(actor.uid);
  if (!cursoId) return [];
  return db.all("SELECT * FROM challenges WHERE courseId = ? AND status = 'published' ORDER BY createdAt DESC",
    [cursoId]).map(challengeView);
}

function saveChallenge(datos, actorUid) {
  const title = users.clean(datos.title || datos.titulo, 120);
  if (title.length < 3) return { ok: false, errores: { titulo: 'Escribe un título para el reto.' } };
  const previo = datos.id ? db.get('SELECT * FROM challenges WHERE id = ?', [datos.id]) : null;
  if (datos.id && !previo) return { ok: false, error: 'El reto no existe.' };

  const row = {
    id: previo ? previo.id : db.newId('challenge'),
    title: title,
    description: String(datos.description || datos.descripcion || '').slice(0, 4000),
    topicId: datos.topicId || datos.temaId || null,
    difficulty: enumOr(datos.difficulty, DIFICULTADES, 'hard'),
    xp: num(datos.xp, 100, 0, 100000),
    reward: users.clean(datos.reward || datos.premio, 120),
    requirements: String(datos.requirements || datos.requisitos || '').slice(0, 2000),
    startDate: isoOrNull(datos.startDate),
    endDate: isoOrNull(datos.endDate),
    maxAttempts: num(datos.maxAttempts, 1, 0, 99),
    status: enumOr(datos.status, ['draft', 'published', 'closed'], previo ? previo.status : 'draft'),
    exerciseId: datos.exerciseId || null,
    createdBy: previo ? previo.createdBy : actorUid,
    courseId: previo ? previo.courseId : courses.requireActiveCourse().id,
    createdAt: previo ? previo.createdAt : db.nowIso(),
    updatedAt: db.nowIso(),
    syncedAt: null
  };
  db.upsert('challenges', 'id', row);
  db.enqueue('challenges', row.id, 'upsert', row);
  return { ok: true, reto: challengeView(row) };
}

function deleteChallenge(id) {
  db.run('DELETE FROM challenges WHERE id = ?', [id]);
  db.enqueue('challenges', id, 'delete', null);
  return { ok: true };
}

module.exports = {
  TIPOS,
  DIFICULTADES,
  ESTADOS_EJERCICIO,
  ESTADOS_CLASE,
  TEMARIO_SUGERIDO,
  topicView,
  listTopics,
  saveTopic,
  deleteTopic,
  seedSuggestedTopics,
  topicName,
  availability,
  activeClassFor,
  nextClassFor,
  exerciseView,
  remoteExercise,
  normalizarLista,
  getExercise,
  listExercises,
  saveExercise,
  setExerciseStatus,
  deleteExercise,
  classView,
  listClasses,
  activeClasses,
  studentClasses,
  saveClass,
  setClassStatus,
  deleteClass,
  challengeView,
  listChallenges,
  saveChallenge,
  deleteChallenge
};
