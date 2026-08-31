'use strict';
/*
 * Entregas, retroalimentacion, calificacion, eventos de sesion y progreso.
 *
 * Reglas importantes:
 *  - Cada intento se conserva: nunca se sobrescribe el codigo de un intento
 *    anterior (seccion 17 del pliego).
 *  - La nota y el XP los escribe SOLO el profesor. El estudiante nunca los toca.
 *  - Toda modificacion de nota deja rastro en grade_history (seccion 12).
 *  - El autoguardado del borrador NO va a la cola de sincronizacion: solo se
 *    sincroniza cuando ocurre algo importante (entrega, calificacion...).
 */

const db = require('../sqlite');
const users = require('./users');
const academic = require('./academic');
const game = require('./gamification');
const courses = require('./courses');

const ESTADOS = ['draft', 'in_progress', 'submitted', 'under_review', 'graded', 'returned', 'abandoned', 'late'];
const TIPOS_FEEDBACK = ['error', 'warning', 'suggestion', 'positive', 'question'];
const ABIERTOS = ['draft', 'in_progress'];
const ENTREGADOS = ['submitted', 'under_review', 'late'];
const CERRADOS = ['graded', 'returned'];

/* ------------------------------------------------------------- vistas */

function submissionView(row, opciones) {
  if (!row) return null;
  const ej = db.get('SELECT title, topicId, xp, maxScore, timeLimit, maxAttempts FROM exercises WHERE id = ?',
    [row.exerciseId]);
  const alumno = db.get('SELECT uid, firstName, lastName, email, grade, groupName, color, photoURL' +
    ' FROM users WHERE uid = ?', [row.studentId]);

  const out = {
    id: row.id,
    submissionId: row.id,
    studentId: row.studentId,
    exerciseId: row.exerciseId,
    attemptNumber: row.attemptNumber,
    code: row.code,
    files: db.parseJson(row.files, []),
    entryFile: row.entryFile || null,
    status: row.status,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    grade: row.grade,
    maxScore: row.maxScore != null ? row.maxScore : (ej ? ej.maxScore : null),
    xpEarned: row.xpEarned,
    teacherComment: row.teacherComment,
    gradedAt: row.gradedAt,
    gradedBy: row.gradedBy,
    timeSpentSec: row.timeSpentSec,
    isLate: !!row.isLate,
    classId: row.classId,
    updatedAt: row.updatedAt,
    ejercicio: ej ? {
      id: row.exerciseId,
      title: ej.title,
      tema: academic.topicName(ej.topicId),
      xp: ej.xp,
      maxScore: ej.maxScore,
      timeLimit: ej.timeLimit,
      maxAttempts: ej.maxAttempts
    } : null,
    estudiante: alumno ? {
      uid: alumno.uid,
      nombre: (alumno.firstName + ' ' + alumno.lastName).trim() || alumno.email,
      email: alumno.email,
      grado: alumno.grade,
      grupo: alumno.groupName,
      color: alumno.color,
      foto: alumno.photoURL || null,
      iniciales: ((alumno.firstName || '').charAt(0) + (alumno.lastName || '').charAt(0)).toUpperCase()
    } : null
  };

  if (opciones && opciones.withDetail) {
    out.feedback = listFeedback(row.id);
    out.gradeHistory = listGradeHistory(row.id);
    out.eventos = db.all(
      'SELECT type, timestamp FROM session_events WHERE submissionId = ? ORDER BY timestamp DESC LIMIT 50',
      [row.id]);
  }
  return out;
}

/* ========================================================== entregas */

/** Devuelve el intento abierto o crea uno nuevo respetando maxAttempts. */
function startAttempt(studentUid, exerciseId) {
  const ejRow = db.get('SELECT * FROM exercises WHERE id = ?', [exerciseId]);
  if (!ejRow) return { ok: false, error: 'El ejercicio no existe.' };

  const disp = academic.availability(ejRow, studentUid);
  if (!disp.puede) return { ok: false, error: disp.motivo };

  const abierto = db.get(
    'SELECT * FROM submissions WHERE studentId = ? AND exerciseId = ? AND status IN (?, ?)' +
    ' ORDER BY attemptNumber DESC LIMIT 1',
    [studentUid, exerciseId, 'draft', 'in_progress']);

  if (abierto) {
    db.run("UPDATE submissions SET status = 'in_progress', updatedAt = ? WHERE id = ?",
      [db.nowIso(), abierto.id]);
    return {
      ok: true,
      reanudado: true,
      submission: submissionView(db.get('SELECT * FROM submissions WHERE id = ?', [abierto.id])),
      ejercicio: academic.exerciseView(ejRow, studentUid)
    };
  }

  const previos = db.get('SELECT COALESCE(MAX(attemptNumber), 0) AS n FROM submissions' +
    ' WHERE studentId = ? AND exerciseId = ?', [studentUid, exerciseId]).n;

  const row = {
    id: db.newId('sub'),
    studentId: studentUid,
    exerciseId: exerciseId,
    attemptNumber: previos + 1,
    code: ejRow.starterCode || '',
    files: db.toJson(db.parseJson(ejRow.files, [])),
    status: 'in_progress',
    startedAt: db.nowIso(),
    submittedAt: null,
    grade: null,
    maxScore: ejRow.maxScore,
    xpEarned: 0,
    teacherComment: '',
    gradedAt: null,
    gradedBy: null,
    timeSpentSec: 0,
    isLate: disp.tarde ? 1 : 0,
    classId: disp.claseId || null,
    // Copia del curso del ejercicio: asi la entrega queda aislada aunque el
    // ejercicio se borre despues, y Firebase puede filtrar por ella sin unir
    // tablas (RTDB no hace joins).
    courseId: ejRow.courseId || null,
    updatedAt: db.nowIso(),
    syncedAt: null
  };
  db.upsert('submissions', 'id', row);
  logEvent(studentUid, exerciseId, row.id, 'ATTEMPT_STARTED', { attempt: row.attemptNumber });

  return {
    ok: true,
    reanudado: false,
    submission: submissionView(row),
    ejercicio: academic.exerciseView(ejRow, studentUid)
  };
}

/** Autoguardado. Solo toca SQLite: no sube nada a Firebase. */
function saveDraft(submissionId, datos) {
  const row = db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
  if (!row) return { ok: false, error: 'La entrega no existe.' };
  if (ABIERTOS.indexOf(row.status) === -1) {
    return { ok: false, error: 'Este intento ya no admite cambios (' + row.status + ').' };
  }
  const suma = Math.max(0, Math.min(3600, Number(datos.addSeconds) || 0));
  db.run(
    'UPDATE submissions SET code = ?, files = ?, entryFile = ?,' +
    ' timeSpentSec = timeSpentSec + ?, updatedAt = ? WHERE id = ?',
    [
      String(datos.code == null ? row.code : datos.code),
      datos.files ? db.toJson(datos.files) : row.files,
      datos.entrada ? String(datos.entrada).slice(0, 200) : row.entryFile,
      suma,
      db.nowIso(),
      submissionId
    ]);
  return { ok: true, guardadoEn: db.nowIso() };
}

/** Entrega definitiva del intento. A partir de aqui el estudiante no edita. */
function submitWork(submissionId, datos) {
  const row = db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
  if (!row) return { ok: false, error: 'La entrega no existe.' };
  if (ABIERTOS.indexOf(row.status) === -1) {
    return { ok: false, error: 'Este intento ya fue entregado.' };
  }
  const ejRow = db.get('SELECT * FROM exercises WHERE id = ?', [row.exerciseId]);
  const tarde = row.isLate || (ejRow && ejRow.dueDate && new Date(ejRow.dueDate).getTime() < Date.now());
  if (tarde && ejRow && !ejRow.allowLateSubmission) {
    return { ok: false, error: 'La fecha límite pasó y este ejercicio no admite entregas tardías.' };
  }

  const estado = tarde ? 'late' : 'submitted';
  db.run(
    'UPDATE submissions SET code = ?, files = ?, entryFile = ?, status = ?, submittedAt = ?, isLate = ?,' +
    ' timeSpentSec = timeSpentSec + ?, updatedAt = ? WHERE id = ?',
    [
      datos && datos.code != null ? String(datos.code) : row.code,
      datos && datos.files ? db.toJson(datos.files) : row.files,
      datos && datos.entrada ? String(datos.entrada).slice(0, 200) : row.entryFile,
      estado,
      db.nowIso(),
      tarde ? 1 : 0,
      Math.max(0, Math.min(3600, Number(datos && datos.addSeconds) || 0)),
      db.nowIso(),
      submissionId
    ]);

  const actualizado = db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
  db.enqueue('submissions', submissionId, 'upsert', remoteSubmission(actualizado));
  logEvent(row.studentId, row.exerciseId, submissionId, 'SUBMITTED', { late: !!tarde });
  recomputeProgress(row.studentId);

  return { ok: true, submission: submissionView(actualizado), tarde: !!tarde };
}

/**
 * Lo que viaja a Firebase de una entrega (el codigo va como texto).
 *
 * Los campos que son competencia del profesor -nota, XP, comentario y marcas de
 * calificacion- SOLO se incluyen cuando existen de verdad. Si el cliente de un
 * estudiante los mandase vacios, las Security Rules rechazarian la escritura
 * entera: para ellas escribir "" donde antes no habia nada tambien es tocar el
 * campo.
 */
function remoteSubmission(row) {
  const out = {
    studentId: row.studentId,
    exerciseId: row.exerciseId,
    attemptNumber: row.attemptNumber,
    code: row.code,
    files: db.parseJson(row.files, []),
    entryFile: row.entryFile || null,
    status: row.status,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    maxScore: row.maxScore,
    timeSpentSec: row.timeSpentSec,
    isLate: !!row.isLate,
    classId: row.classId,
    courseId: row.courseId || null,
    updatedAt: row.updatedAt
  };
  if (row.grade != null) out.grade = row.grade;
  if (row.xpEarned) out.xpEarned = row.xpEarned;
  if (row.teacherComment) out.teacherComment = row.teacherComment;
  if (row.gradedAt) out.gradedAt = row.gradedAt;
  if (row.gradedBy) out.gradedBy = row.gradedBy;
  return out;
}

function getSubmission(id, opciones) {
  return submissionView(db.get('SELECT * FROM submissions WHERE id = ?', [id]), opciones);
}

function listForStudent(studentUid, exerciseId) {
  const sql = exerciseId
    ? 'SELECT * FROM submissions WHERE studentId = ? AND exerciseId = ? ORDER BY attemptNumber DESC'
    : 'SELECT * FROM submissions WHERE studentId = ? ORDER BY updatedAt DESC';
  const params = exerciseId ? [studentUid, exerciseId] : [studentUid];
  return db.all(sql, params).map((r) => submissionView(r));
}

/**
 * Bandeja del profesor. Carga solo lo necesario y admite paginacion, para no
 * traerse todas las entregas de golpe (seccion 30).
 */
function listForReview(filtro) {
  const f = filtro || {};
  const where = ['courseId = ?'];
  const params = [courses.requireActiveCourse().id];

  if (f.status && f.status !== 'all') {
    if (f.status === 'pending') where.push("status IN ('submitted','late')");
    else if (f.status === 'reviewing') where.push("status = 'under_review'");
    else if (f.status === 'graded') where.push("status IN ('graded','returned')");
    else if (f.status === 'abandoned') where.push("status = 'abandoned'");
    else if (f.status === 'late') where.push("status = 'late' OR isLate = 1");
    else { where.push('status = ?'); params.push(f.status); }
  } else {
    where.push("status NOT IN ('draft')");
  }
  if (f.exerciseId) { where.push('exerciseId = ?'); params.push(f.exerciseId); }
  if (f.studentId) { where.push('studentId = ?'); params.push(f.studentId); }

  const limit = Math.min(200, Math.max(1, Number(f.limit) || 50));
  const offset = Math.max(0, Number(f.offset) || 0);

  const total = db.get('SELECT COUNT(*) AS n FROM submissions WHERE ' + where.join(' AND '), params).n;
  const rows = db.all(
    'SELECT * FROM submissions WHERE ' + where.join(' AND ') +
    ' ORDER BY (status IN (\'submitted\',\'late\')) DESC, COALESCE(submittedAt, updatedAt) DESC' +
    ' LIMIT ? OFFSET ?', params.concat([limit, offset]));

  return { total, limit, offset, items: rows.map((r) => submissionView(r)) };
}

function reviewCounters() {
  const row = db.get(
    "SELECT" +
    " SUM(CASE WHEN status IN ('submitted','late') THEN 1 ELSE 0 END) AS pendientes," +
    " SUM(CASE WHEN status = 'under_review' THEN 1 ELSE 0 END) AS enRevision," +
    " SUM(CASE WHEN status IN ('graded','returned') THEN 1 ELSE 0 END) AS calificadas," +
    " SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END) AS abandonadas," +
    " SUM(CASE WHEN isLate = 1 THEN 1 ELSE 0 END) AS tardias" +
    ' FROM submissions WHERE courseId = ?', [courses.requireActiveCourse().id]);
  return {
    pendientes: row.pendientes || 0,
    enRevision: row.enRevision || 0,
    calificadas: row.calificadas || 0,
    abandonadas: row.abandonadas || 0,
    tardias: row.tardias || 0
  };
}

function setStatus(submissionId, status) {
  if (ESTADOS.indexOf(status) === -1) return { ok: false, error: 'Estado no válido.' };
  const row = db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
  if (!row) return { ok: false, error: 'La entrega no existe.' };
  db.run('UPDATE submissions SET status = ?, updatedAt = ? WHERE id = ?', [status, db.nowIso(), submissionId]);
  const actualizado = db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
  db.enqueue('submissions', submissionId, 'upsert', remoteSubmission(actualizado));
  return { ok: true, submission: submissionView(actualizado) };
}

/* ======================================================== calificacion */

/**
 * Califica una entrega. Guarda historial si ya tenia nota y devuelve el
 * resultado listo para mostrar al estudiante.
 */
function gradeSubmission(submissionId, datos, teacherUid) {
  const row = db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
  if (!row) return { ok: false, error: 'La entrega no existe.' };
  const ejRow = db.get('SELECT * FROM exercises WHERE id = ?', [row.exerciseId]);
  const maxScore = row.maxScore != null ? row.maxScore : (ejRow ? ejRow.maxScore : 5);

  const nota = Number(datos.grade);
  if (!isFinite(nota) || nota < 0 || nota > maxScore) {
    return { ok: false, errores: { grade: 'La nota debe estar entre 0 y ' + maxScore + '.' } };
  }

  const xpMaximo = ejRow ? ejRow.xp : 0;
  const xp = datos.xpEarned == null
    ? Math.round((nota / maxScore) * xpMaximo)
    : Math.max(0, Math.min(xpMaximo, Math.round(Number(datos.xpEarned) || 0)));

  const teniaNota = row.grade != null;
  const ahora = db.nowIso();

  db.transaction(() => {
    if (teniaNota && (row.grade !== nota || row.xpEarned !== xp)) {
      const h = {
        id: db.newId('gh'),
        submissionId: submissionId,
        courseId: row.courseId || null,
        oldGrade: row.grade,
        newGrade: nota,
        oldXp: row.xpEarned,
        newXp: xp,
        reason: users.clean(datos.reason, 300) || 'Corrección posterior',
        changedBy: teacherUid,
        changedAt: ahora,
        syncedAt: null
      };
      db.upsert('grade_history', 'id', h);
      db.enqueue('gradeHistory', h.id, 'upsert', h);
    }
    db.run(
      'UPDATE submissions SET grade = ?, xpEarned = ?, teacherComment = ?, status = ?,' +
      ' gradedAt = ?, gradedBy = ?, maxScore = ?, updatedAt = ? WHERE id = ?',
      [nota, xp, String(datos.teacherComment || '').slice(0, 4000),
        datos.returnToStudent ? 'returned' : 'graded',
        ahora, teacherUid, maxScore, ahora, submissionId]);
  });

  const actualizado = db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
  db.enqueue('submissions', submissionId, 'upsert', remoteSubmission(actualizado));
  recomputeProgress(row.studentId);
  db.enqueue('studentProgress', row.studentId, 'upsert', progressFor(row.studentId));

  /*
   * Cadena de la fase 4: calificar -> recalcular progreso -> evaluar insignias
   * automaticas -> conceder las nuevas -> premio del reto si lo tiene. Los
   * rankings se recalculan y publican despues, ya en el cliente (sync.js), que
   * es quien habla con Firebase.
   */
  const insignias = game.evaluate(row.studentId, teacherUid);
  const premioReto = game.grantChallengeReward(row.studentId, row.exerciseId, teacherUid);
  const nuevasInsignias = insignias.nuevas.concat(premioReto.concedidas);

  return {
    ok: true,
    submission: submissionView(actualizado, { withDetail: true }),
    huboHistorial: teniaNota,
    insigniasNuevas: nuevasInsignias
  };
}

function listGradeHistory(submissionId) {
  return db.all('SELECT * FROM grade_history WHERE submissionId = ? ORDER BY changedAt DESC',
    [submissionId]);
}

/** Reabre una entrega para que el estudiante pueda corregirla. */
function reopenSubmission(submissionId, motivo, teacherUid) {
  const row = db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
  if (!row) return { ok: false, error: 'La entrega no existe.' };
  db.run("UPDATE submissions SET status = 'in_progress', submittedAt = NULL, updatedAt = ? WHERE id = ?",
    [db.nowIso(), submissionId]);
  logEvent(row.studentId, row.exerciseId, submissionId, 'REOPENED_BY_TEACHER',
    { motivo: String(motivo || ''), teacherUid });
  const actualizado = db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
  db.enqueue('submissions', submissionId, 'upsert', remoteSubmission(actualizado));
  return { ok: true, submission: submissionView(actualizado) };
}

/* ==================================================== retroalimentacion */

function feedbackView(row) {
  return {
    id: row.id,
    submissionId: row.submissionId,
    file: row.file || null,
    line: row.line,
    columnStart: row.columnStart,
    columnEnd: row.columnEnd,
    type: row.type,
    message: row.message,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    resolved: !!row.resolved
  };
}

function listFeedback(submissionId) {
  return db.all('SELECT * FROM feedback WHERE submissionId = ? ORDER BY line, createdAt', [submissionId])
    .map(feedbackView);
}

function saveFeedback(datos, teacherUid) {
  const sub = db.get('SELECT id, courseId FROM submissions WHERE id = ?', [datos.submissionId]);
  if (!sub) return { ok: false, error: 'La entrega no existe.' };
  const message = String(datos.message || '').trim().slice(0, 2000);
  if (!message) return { ok: false, errores: { message: 'Escribe el comentario.' } };

  const previo = datos.id ? db.get('SELECT * FROM feedback WHERE id = ?', [datos.id]) : null;
  const row = {
    id: previo ? previo.id : db.newId('fb'),
    submissionId: datos.submissionId,
    courseId: sub.courseId || null,
    /*
     * A que archivo se refiere. Una entrega puede traer varios modulos, y un
     * comentario en la linea 12 de utils.py no tiene nada que ver con la linea
     * 12 de main.py. Vacio = el archivo principal (entregas de un solo archivo,
     * que son las de antes y las de siempre).
     */
    file: datos.file ? String(datos.file).slice(0, 200) : (previo ? previo.file : null),
    line: Math.max(1, Math.round(Number(datos.line) || 1)),
    columnStart: datos.columnStart == null ? null : Math.max(1, Math.round(Number(datos.columnStart))),
    columnEnd: datos.columnEnd == null ? null : Math.max(1, Math.round(Number(datos.columnEnd))),
    type: TIPOS_FEEDBACK.indexOf(datos.type) !== -1 ? datos.type : 'suggestion',
    message: message,
    createdBy: previo ? previo.createdBy : teacherUid,
    createdAt: previo ? previo.createdAt : db.nowIso(),
    resolved: datos.resolved ? 1 : (previo ? previo.resolved : 0),
    syncedAt: null
  };
  db.upsert('feedback', 'id', row);
  db.enqueue('feedback', row.id, 'upsert', row);
  return { ok: true, feedback: feedbackView(row) };
}

function deleteFeedback(id) {
  db.run('DELETE FROM feedback WHERE id = ?', [id]);
  db.enqueue('feedback', id, 'delete', null);
  return { ok: true };
}

/* ==================================================== eventos de sesion */

function logEvent(studentUid, exerciseId, submissionId, type, meta) {
  const row = {
    id: db.newId('evt'),
    studentId: studentUid,
    exerciseId: exerciseId || null,
    submissionId: submissionId || null,
    courseId: courses.courseIdFor(studentUid),
    type: String(type || 'UNKNOWN').slice(0, 40),
    timestamp: db.nowIso(),
    meta: db.toJson(meta || null),
    syncedAt: null
  };
  db.upsert('session_events', 'id', row);
  // Los eventos van a Firebase agrupados: solo se encolan los relevantes.
  if (['SUBMITTED', 'ABANDONED', 'TIME_UP', 'REOPENED_BY_TEACHER'].indexOf(row.type) !== -1) {
    db.enqueue('sessionEvents', row.id, 'upsert', row);
  }
  return row;
}

function listEvents(filtro) {
  const f = filtro || {};
  const where = [];
  const params = [];
  if (f.studentId) { where.push('studentId = ?'); params.push(f.studentId); }
  if (f.submissionId) { where.push('submissionId = ?'); params.push(f.submissionId); }
  if (f.exerciseId) { where.push('exerciseId = ?'); params.push(f.exerciseId); }
  const sql = 'SELECT * FROM session_events' + (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY timestamp DESC LIMIT ' + Math.min(500, Math.max(1, Number(f.limit) || 100));
  return db.all(sql, params).map((r) => Object.assign({}, r, { meta: db.parseJson(r.meta, null) }));
}

/* ============================================================ progreso */

/**
 * Recalcula el progreso de un estudiante a partir de las entregas reales.
 * Se guarda en student_progress para no repetir el calculo en cada pantalla.
 */
function recomputeProgress(studentUid) {
  const courseId = courses.courseIdFor(studentUid);
  // Sin curso, no hay de qué calcular progreso (progressFor ya cubre ese caso
  // más abajo); con curso, solo cuentan LOS EJERCICIOS DE ESE CURSO -si no,
  // el porcentaje de un tema saldría mal con exercises de otros cursos que
  // comparten el mismo tema del catálogo compartido-.
  const ejercicios = courseId ? db.all(
    "SELECT id, topicId, xp, maxScore FROM exercises WHERE courseId = ? AND status IN ('published','active','closed')",
    [courseId]) : [];
  const entregas = db.all('SELECT * FROM submissions WHERE studentId = ?', [studentUid]);

  const mejorPorEjercicio = new Map();
  for (const s of entregas) {
    const previo = mejorPorEjercicio.get(s.exerciseId);
    const mejor = !previo ||
      (s.grade != null && (previo.grade == null || s.grade > previo.grade)) ||
      (s.grade == null && previo.grade == null && s.attemptNumber > previo.attemptNumber);
    if (mejor) mejorPorEjercicio.set(s.exerciseId, s);
  }

  const acumulado = new Map();   // topicId -> agregados
  const totalKey = '*';
  const bucket = (key) => {
    if (!acumulado.has(key)) {
      acumulado.set(key, {
        completed: 0, total: 0, passed: 0, failed: 0,
        xp: 0, xpAvailable: 0, notas: [], timeSpentSec: 0
      });
    }
    return acumulado.get(key);
  };

  for (const ej of ejercicios) {
    const tema = ej.topicId || 'sin-tema';
    const bTema = bucket(tema);
    const bTotal = bucket(totalKey);
    bTema.total++; bTotal.total++;
    bTema.xpAvailable += ej.xp; bTotal.xpAvailable += ej.xp;

    const s = mejorPorEjercicio.get(ej.id);
    if (!s) continue;
    bTema.timeSpentSec += s.timeSpentSec || 0;
    bTotal.timeSpentSec += s.timeSpentSec || 0;

    if (ENTREGADOS.indexOf(s.status) !== -1 || CERRADOS.indexOf(s.status) !== -1) {
      bTema.completed++; bTotal.completed++;
    }
    if (s.grade != null) {
      bTema.notas.push(s.grade); bTotal.notas.push(s.grade);
      const aprueba = s.grade >= (ej.maxScore || 5) * 0.6;
      if (aprueba) { bTema.passed++; bTotal.passed++; } else { bTema.failed++; bTotal.failed++; }
      bTema.xp += s.xpEarned || 0; bTotal.xp += s.xpEarned || 0;
    }
  }

  /*
   * El progreso es POR CURSO (cada uno a su ritmo). Sin curso no hay a qué
   * ritmo compararse todavía -pasa un instante entre crear la cuenta de un
   * estudiante y que se una con el código-, así que no se guarda nada:
   * guardarlo con un curso "vacío" dejaría una fila fantasma que, más tarde,
   * con el curso real ya puesto, competiría con la buena por el mismo
   * (studentId, topicId) y podía devolver el progreso equivocado.
   */
  if (!courseId) return progressFor(studentUid);

  db.transaction(() => {
    db.run('DELETE FROM student_progress WHERE studentId = ? AND courseId = ?', [studentUid, courseId]);
    for (const [topicId, b] of acumulado) {
      db.upsert('student_progress', ['studentId', 'courseId', 'topicId'], {
        studentId: studentUid,
        courseId: courseId,
        topicId: topicId,
        completed: b.completed,
        total: b.total,
        passed: b.passed,
        failed: b.failed,
        xp: b.xp,
        xpAvailable: b.xpAvailable,
        average: b.notas.length ? Number((b.notas.reduce((x, y) => x + y, 0) / b.notas.length).toFixed(2)) : null,
        timeSpentSec: b.timeSpentSec,
        updatedAt: db.nowIso()
      });
    }
  });

  return progressFor(studentUid);
}

function progressFor(studentUid) {
  /*
   * Se filtra también por curso: sin esto, un estudiante que se unió a un
   * curso después de su primer inicio de sesión podía arrastrar una fila
   * "sin curso" vacía junto a la de verdad para el mismo tema, y cuál de
   * las dos se lea primero no está garantizado.
   */
  const courseId = courses.courseIdFor(studentUid);
  const filas = courseId
    ? db.all('SELECT * FROM student_progress WHERE studentId = ? AND courseId = ?', [studentUid, courseId])
    : [];
  const total = filas.find((f) => f.topicId === '*') || {
    completed: 0, total: 0, passed: 0, failed: 0, xp: 0, xpAvailable: 0, average: null, timeSpentSec: 0
  };
  const porTema = filas.filter((f) => f.topicId !== '*').map((f) => ({
    topicId: f.topicId,
    tema: academic.topicName(f.topicId),
    completados: f.completed,
    total: f.total,
    aprobados: f.passed,
    reprobados: f.failed,
    xp: f.xp,
    xpDisponible: f.xpAvailable,
    promedio: f.average,
    porcentaje: f.total ? Math.round((f.completed / f.total) * 100) : 0,
    tiempoSegundos: f.timeSpentSec
  })).sort((a, b) => a.tema.localeCompare(b.tema, 'es'));

  const enProgreso = db.get(
    "SELECT COUNT(*) AS n FROM submissions WHERE studentId = ? AND status IN ('draft','in_progress')",
    [studentUid]).n;
  const enRevision = db.get(
    "SELECT COUNT(*) AS n FROM submissions WHERE studentId = ? AND status IN ('submitted','under_review','late')",
    [studentUid]).n;
  const retos = db.get(
    "SELECT COUNT(DISTINCT s.exerciseId) AS n FROM submissions s JOIN challenges c ON c.exerciseId = s.exerciseId" +
    " WHERE s.studentId = ? AND s.status IN ('graded','returned')", [studentUid]).n;

  return {
    studentId: studentUid,
    courseId: courseId || null,
    completados: total.completed,
    totalEjercicios: total.total,
    aprobados: total.passed,
    reprobados: total.failed,
    pendientes: Math.max(0, total.total - total.completed - enProgreso),
    enProgreso: enProgreso,
    enRevision: enRevision,
    xpTotal: total.xp,
    xpDisponible: total.xpAvailable,
    promedio: total.average,
    porcentaje: total.total ? Math.round((total.completed / total.total) * 100) : 0,
    tiempoTotalSegundos: total.timeSpentSec,
    retosCompletados: retos,
    porTema: porTema,
    actualizadoEn: db.nowIso()
  };
}

function recentActivity(studentUid, limite) {
  return db.all(
    'SELECT s.*, e.title AS exTitle, e.topicId AS exTopic FROM submissions s' +
    ' LEFT JOIN exercises e ON e.id = s.exerciseId' +
    ' WHERE s.studentId = ? ORDER BY s.updatedAt DESC LIMIT ?',
    [studentUid, Math.min(20, Math.max(1, limite || 6))]
  ).map((r) => ({
    submissionId: r.id,
    ejercicioId: r.exerciseId,
    titulo: r.exTitle || 'Ejercicio eliminado',
    tema: academic.topicName(r.exTopic),
    estado: r.status,
    nota: r.grade,
    xpGanado: r.xpEarned,
    cuando: r.updatedAt
  }));
}

/* ============================================================ curso */

function courseSummary() {
  const cursoId = courses.requireActiveCourse().id;
  const estudiantes = db.all('SELECT uid, firstName, lastName, email, grade, groupName, color, photoURL' +
    " FROM users WHERE role = 'student' AND uid IN" +
    " (SELECT uid FROM course_members WHERE courseId = ? AND role = 'student' AND active = 1)", [cursoId]);
  const porEstudiante = estudiantes.map((u) => {
    const p = progressFor(u.uid);
    return {
      id: u.uid,
      uid: u.uid,
      nombre: (u.firstName + ' ' + u.lastName).trim() || u.email,
      correo: u.email,
      grado: u.grade,
      grupo: u.groupName,
      color: u.color,
      foto: u.photoURL || null,
      completados: p.completados,
      total: p.totalEjercicios,
      xp: p.xpTotal,
      promedio: p.promedio,
      aprobados: p.aprobados,
      reprobados: p.reprobados,
      enRevision: p.enRevision,
      ultimaActividad: (recentActivity(u.uid, 1)[0] || {}).cuando || null
    };
  }).sort((a, b) => b.xp - a.xp || a.nombre.localeCompare(b.nombre, 'es'));

  const ex = db.get(
    "SELECT COUNT(*) AS total," +
    " SUM(CASE WHEN status IN ('published','active') THEN 1 ELSE 0 END) AS activos," +
    " SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS borradores FROM exercises WHERE courseId = ?",
    [cursoId]);

  return {
    estudiantes: estudiantes.length,
    // "profesores" es informativo (co-profesores del MISMO curso, no del colegio entero).
    profesores: db.get("SELECT COUNT(*) AS n FROM course_members WHERE courseId = ? AND role = 'co_teacher'" +
      ' AND active = 1', [cursoId]).n + 1,
    temas: db.get('SELECT COUNT(*) AS n FROM topics').n,   // catalogo compartido de todo el colegio
    ejercicios: ex.total || 0,
    ejerciciosActivos: ex.activos || 0,
    borradores: ex.borradores || 0,
    clasesActivas: db.get("SELECT COUNT(*) AS n FROM classes WHERE courseId = ? AND status = 'active'",
      [cursoId]).n,
    retos: db.get('SELECT COUNT(*) AS n FROM challenges WHERE courseId = ?', [cursoId]).n,
    revision: reviewCounters(),
    xpRepartido: db.get('SELECT COALESCE(SUM(xpEarned),0) AS n FROM submissions WHERE courseId = ?', [cursoId]).n,
    porEstudiante: porEstudiante
  };
}

/**
 * Estructuras de ranking listas para subir a Firebase (seccion 20).
 * Se calculan bajo demanda, no con escuchas permanentes.
 */
function buildRankings(courseId) {
  const cursoId = courseId || courses.requireActiveCourse().id;
  const global = db.all(
    'SELECT u.uid, u.firstName, u.lastName, u.grade, u.groupName, u.color, u.photoURL,' +
    ' COALESCE(p.xp,0) AS xp, p.average AS average, COALESCE(p.completed,0) AS completed' +
    " FROM users u LEFT JOIN student_progress p ON p.studentId = u.uid AND p.topicId = '*' AND p.courseId = ?" +
    " WHERE u.role = 'student' AND u.uid IN" +
    " (SELECT uid FROM course_members WHERE courseId = ? AND role = 'student' AND active = 1)" +
    ' ORDER BY xp DESC, completed DESC', [cursoId, cursoId]
  ).map((r, i) => ({
    position: i + 1,
    uid: r.uid,
    name: (r.firstName + ' ' + r.lastName).trim(),
    grade: r.grade,
    group: r.groupName,
    color: r.color,
    foto: r.photoURL || null,
    xp: r.xp,
    average: r.average,
    completed: r.completed,
    badges: db.get('SELECT COUNT(*) AS n FROM user_badges WHERE studentId = ? AND courseId = ?', [r.uid, cursoId]).n
  }));

  const topics = {};
  for (const t of db.all('SELECT id, name FROM topics')) {
    const filas = db.all(
      'SELECT p.studentId, p.xp, p.completed, u.firstName, u.lastName, u.photoURL, u.grade' +
      ' FROM student_progress p' +
      ' JOIN users u ON u.uid = p.studentId' +
      ' WHERE p.topicId = ? AND p.courseId = ? AND p.xp > 0 ORDER BY p.xp DESC LIMIT 50',
      [t.id, cursoId]);
    if (!filas.length) continue;
    topics[t.id] = {
      name: t.name,
      entries: filas.map((r, i) => ({
        position: i + 1,
        uid: r.studentId,
        name: (r.firstName + ' ' + r.lastName).trim(),
        grade: r.grade,
        foto: r.photoURL || null,
        xp: r.xp,
        completed: r.completed
      }))
    };
  }

  const grades = {};
  for (const fila of global) {
    const key = fila.grade || 'sin-grado';
    if (!grades[key]) grades[key] = [];
    grades[key].push({
      uid: fila.uid, name: fila.name, xp: fila.xp, grade: fila.grade,
      foto: fila.foto, completed: fila.completed
    });
  }
  for (const key of Object.keys(grades)) {
    grades[key] = grades[key].sort((a, b) => b.xp - a.xp)
      .map((e, i) => Object.assign({ position: i + 1 }, e));
  }

  return { global, topics, grades, updatedAt: db.nowIso() };
}

module.exports = {
  ESTADOS,
  TIPOS_FEEDBACK,
  submissionView,
  startAttempt,
  saveDraft,
  submitWork,
  remoteSubmission,
  getSubmission,
  listForStudent,
  listForReview,
  reviewCounters,
  setStatus,
  gradeSubmission,
  listGradeHistory,
  reopenSubmission,
  listFeedback,
  saveFeedback,
  deleteFeedback,
  logEvent,
  listEvents,
  recomputeProgress,
  progressFor,
  recentActivity,
  courseSummary,
  buildRankings
};
