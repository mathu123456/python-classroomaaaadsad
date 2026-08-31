'use strict';
/*
 * Estadisticas del curso (fase 5).
 *
 * Todo se calcula con consultas agregadas de SQLite -que usan los indices que
 * ya existen (idx_sub_student, idx_sub_exercise, idx_exercises_topic)- y no
 * trayendo listas completas a JavaScript.
 *
 * Criterio de "tema con dificultades": esta escrito una sola vez, aqui, y se
 * devuelve junto con los datos para poder explicarselo al profesor en la propia
 * pantalla. Es configurable desde la interfaz.
 */

const db = require('../sqlite');
const academic = require('./academic');
const courses = require('./courses');

/* ------------------------------------------------------------- criterio */

const CRITERIO_DEFECTO = {
  promedioMinimoPct: 60,     // por debajo de este % de la nota maxima, aviso
  reprobadosMinimoPct: 33,   // o mas de este % de estudiantes reprobados
  intentosAviso: 2.5         // o mas intentos de media por estudiante
};

function criterio() {
  const guardado = db.parseJson(db.getMeta('statsCriterio'), null);
  return Object.assign({}, CRITERIO_DEFECTO, guardado || {});
}

function setCriterio(patch) {
  const actual = criterio();
  const nuevo = {
    promedioMinimoPct: Math.max(0, Math.min(100, Number(patch.promedioMinimoPct) || actual.promedioMinimoPct)),
    reprobadosMinimoPct: Math.max(0, Math.min(100, Number(patch.reprobadosMinimoPct) || actual.reprobadosMinimoPct)),
    intentosAviso: Math.max(1, Math.min(20, Number(patch.intentosAviso) || actual.intentosAviso))
  };
  db.setMeta('statsCriterio', db.toJson(nuevo));
  return nuevo;
}

/** Texto que explica en pantalla por que el sistema avisa. */
function textoCriterio(c) {
  const k = c || criterio();
  return 'Se avisa de un tema cuando su promedio queda por debajo del ' + k.promedioMinimoPct +
    ' % de la nota máxima, cuando más del ' + k.reprobadosMinimoPct +
    ' % de los estudiantes con nota lo reprueban, o cuando hace falta una media de ' +
    k.intentosAviso + ' intentos o más.';
}

/* ------------------------------------------------------------- resumen */

function redondear(n, decimales) {
  if (n == null || !isFinite(n)) return null;
  const f = Math.pow(10, decimales == null ? 2 : decimales);
  return Math.round(n * f) / f;
}

/** Cifras generales DEL CURSO -nunca del colegio entero. */
function resumen(courseId) {
  const cid = courseId || courses.requireActiveCourse().id;
  const g = db.get(
    "SELECT COUNT(*) AS entregas," +
    " SUM(CASE WHEN status IN ('graded','returned') THEN 1 ELSE 0 END) AS calificadas," +
    " SUM(CASE WHEN status IN ('submitted','under_review','late') THEN 1 ELSE 0 END) AS pendientes," +
    " SUM(CASE WHEN status IN ('draft','in_progress') THEN 1 ELSE 0 END) AS enCurso," +
    " SUM(CASE WHEN isLate = 1 THEN 1 ELSE 0 END) AS tardias," +
    " AVG(CASE WHEN grade IS NOT NULL THEN grade END) AS promedio," +
    " AVG(CASE WHEN grade IS NOT NULL THEN timeSpentSec END) AS tiempoMedio," +
    " COALESCE(SUM(xpEarned), 0) AS xp" +
    ' FROM submissions WHERE courseId = ?', [cid]);

  const aprobados = db.get(
    'SELECT' +
    ' SUM(CASE WHEN s.grade >= COALESCE(s.maxScore, e.maxScore, 5) * 0.6 THEN 1 ELSE 0 END) AS aprobadas,' +
    ' SUM(CASE WHEN s.grade <  COALESCE(s.maxScore, e.maxScore, 5) * 0.6 THEN 1 ELSE 0 END) AS reprobadas' +
    ' FROM submissions s LEFT JOIN exercises e ON e.id = s.exerciseId' +
    ' WHERE s.courseId = ? AND s.grade IS NOT NULL', [cid]);

  const intentos = db.get(
    'SELECT AVG(n) AS media FROM (SELECT COUNT(*) AS n FROM submissions' +
    ' WHERE courseId = ? GROUP BY studentId, exerciseId)', [cid]);

  const retos = db.get(
    "SELECT COUNT(DISTINCT s.studentId || '|' || c.id) AS n FROM challenges c" +
    ' JOIN submissions s ON s.exerciseId = c.exerciseId' +
    " WHERE c.courseId = ? AND s.courseId = ? AND s.status IN ('graded','returned')", [cid, cid]);

  const estudiantes = db.get(
    "SELECT COUNT(*) AS n FROM course_members WHERE courseId = ? AND role = 'student' AND active = 1",
    [cid]).n;
  const ejercicios = db.get(
    "SELECT COUNT(*) AS total," +
    " SUM(CASE WHEN status IN ('published','active') THEN 1 ELSE 0 END) AS publicados" +
    ' FROM exercises WHERE courseId = ?', [cid]);

  const calificadas = g.calificadas || 0;
  const aprobadas = aprobados.aprobadas || 0;
  const reprobadas = aprobados.reprobadas || 0;

  return {
    estudiantes: estudiantes,
    ejercicios: ejercicios.total || 0,
    ejerciciosPublicados: ejercicios.publicados || 0,
    entregas: g.entregas || 0,
    calificadas: calificadas,
    pendientes: g.pendientes || 0,
    enCurso: g.enCurso || 0,
    tardias: g.tardias || 0,
    aprobadas: aprobadas,
    reprobadas: reprobadas,
    tasaAprobacion: (aprobadas + reprobadas) ? redondear((aprobadas / (aprobadas + reprobadas)) * 100, 1) : null,
    promedioGeneral: redondear(g.promedio, 2),
    tiempoMedioSegundos: g.tiempoMedio == null ? null : Math.round(g.tiempoMedio),
    intentosMedios: redondear(intentos && intentos.media, 2),
    retosCompletados: retos ? retos.n : 0,
    xpRepartido: g.xp || 0
  };
}

/* ---------------------------------------------------------- por tema */

function porTema(courseId) {
  const cid = courseId || courses.requireActiveCourse().id;
  /*
   * El temario es el catálogo COMPARTIDO (topics no lleva curso); lo que se
   * acota por curso son los ejercicios y entregas que cuelgan de cada tema
   * -si no, el promedio de un profesor mezclaría entregas de otros cursos
   * que comparten el mismo tema del catálogo.
   */
  const filas = db.all(
    'SELECT t.id, t.name,' +
    ' COUNT(DISTINCT e.id) AS ejercicios,' +
    ' COUNT(s.id) AS entregas,' +
    ' AVG(CASE WHEN s.grade IS NOT NULL THEN s.grade END) AS promedio,' +
    ' MAX(COALESCE(s.maxScore, e.maxScore, 5)) AS maxScore,' +
    ' SUM(CASE WHEN s.grade IS NOT NULL THEN 1 ELSE 0 END) AS conNota,' +
    ' SUM(CASE WHEN s.grade IS NOT NULL AND s.grade < COALESCE(s.maxScore, e.maxScore, 5) * 0.6' +
    '   THEN 1 ELSE 0 END) AS reprobadas,' +
    ' COUNT(DISTINCT s.studentId) AS estudiantes,' +
    ' AVG(CASE WHEN s.grade IS NOT NULL THEN s.timeSpentSec END) AS tiempoMedio' +
    ' FROM topics t' +
    ' LEFT JOIN exercises e ON e.topicId = t.id AND e.courseId = ?' +
    ' LEFT JOIN submissions s ON s.exerciseId = e.id AND s.courseId = ?' +
    ' GROUP BY t.id, t.name ORDER BY t.orderIndex, t.name', [cid, cid]);

  const intentosPorTema = new Map(db.all(
    'SELECT topicId, AVG(n) AS media FROM (' +
    '  SELECT e.topicId AS topicId, COUNT(*) AS n FROM submissions s' +
    '  JOIN exercises e ON e.id = s.exerciseId WHERE s.courseId = ? GROUP BY s.studentId, s.exerciseId, e.topicId' +
    ') GROUP BY topicId', [cid]).map((r) => [r.topicId, r.media]));

  const k = criterio();

  return filas.map((r) => {
    const maxScore = r.maxScore || 5;
    const promedio = redondear(r.promedio, 2);
    const conNota = r.conNota || 0;
    const reprobadas = r.reprobadas || 0;
    const intentos = redondear(intentosPorTema.get(r.id), 2);

    const motivos = [];
    if (promedio != null && promedio < maxScore * (k.promedioMinimoPct / 100)) {
      motivos.push('promedio ' + promedio + ' por debajo del ' + k.promedioMinimoPct + ' % de ' + maxScore);
    }
    if (conNota && (reprobadas / conNota) * 100 > k.reprobadosMinimoPct) {
      motivos.push(reprobadas + ' de ' + conNota + ' entregas reprobadas');
    }
    if (intentos != null && intentos >= k.intentosAviso) {
      motivos.push('media de ' + intentos + ' intentos');
    }

    return {
      topicId: r.id,
      tema: r.name,
      ejercicios: r.ejercicios || 0,
      entregas: r.entregas || 0,
      conNota: conNota,
      promedio: promedio,
      maxScore: maxScore,
      reprobadas: reprobadas,
      estudiantes: r.estudiantes || 0,
      tiempoMedioSegundos: r.tiempoMedio == null ? null : Math.round(r.tiempoMedio),
      intentosMedios: intentos,
      enDificultad: motivos.length > 0,
      motivos: motivos
    };
  });
}

/* ------------------------------------------------------ por estudiante */

function porEstudiante(courseId) {
  const cid = courseId || courses.requireActiveCourse().id;
  return db.all(
    'SELECT u.uid, u.firstName, u.lastName, u.email, u.grade, u.groupName, u.color, u.photoURL,' +
    ' COALESCE(p.completed, 0) AS completados, COALESCE(p.total, 0) AS total,' +
    ' COALESCE(p.xp, 0) AS xp, p.average AS promedio, COALESCE(p.passed,0) AS aprobados,' +
    ' COALESCE(p.failed,0) AS reprobados, COALESCE(p.timeSpentSec,0) AS tiempo,' +
    ' (SELECT COUNT(*) FROM user_badges ub WHERE ub.studentId = u.uid AND ub.courseId = ?) AS insignias,' +
    " (SELECT COUNT(*) FROM submissions s WHERE s.studentId = u.uid AND s.courseId = ?" +
    "   AND s.status IN ('submitted','under_review','late')) AS enRevision" +
    ' FROM course_members m' +
    ' JOIN users u ON u.uid = m.uid' +
    " LEFT JOIN student_progress p ON p.studentId = u.uid AND p.courseId = ? AND p.topicId = '*'" +
    " WHERE m.courseId = ? AND m.role = 'student' AND m.active = 1 ORDER BY p.xp DESC, u.lastName",
    [cid, cid, cid, cid]
  ).map((r) => ({
    uid: r.uid,
    nombre: (r.firstName + ' ' + r.lastName).trim() || r.email,
    correo: r.email,
    grado: r.grade,
    grupo: r.groupName,
    color: r.color,
    foto: r.photoURL || null,
    completados: r.completados,
    total: r.total,
    porcentaje: r.total ? Math.round((r.completados / r.total) * 100) : 0,
    xp: r.xp,
    promedio: r.promedio,
    aprobados: r.aprobados,
    reprobados: r.reprobados,
    tiempoSegundos: r.tiempo,
    insignias: r.insignias,
    enRevision: r.enRevision
  }));
}

/* ----------------------------------------------------------- graficas */

/** Distribucion de notas normalizada a la escala 0-5 en cinco tramos. */
function distribucionNotas(courseId) {
  const cid = courseId || courses.requireActiveCourse().id;
  const filas = db.all(
    'SELECT s.grade AS grade, COALESCE(s.maxScore, e.maxScore, 5) AS maxScore' +
    ' FROM submissions s LEFT JOIN exercises e ON e.id = s.exerciseId' +
    ' WHERE s.courseId = ? AND s.grade IS NOT NULL', [cid]);
  const tramos = [
    { etiqueta: '0-1', n: 0 }, { etiqueta: '1-2', n: 0 }, { etiqueta: '2-3', n: 0 },
    { etiqueta: '3-4', n: 0 }, { etiqueta: '4-5', n: 0 }
  ];
  for (const f of filas) {
    const escala = (f.grade / (f.maxScore || 5)) * 5;
    const i = Math.min(4, Math.max(0, Math.floor(escala === 5 ? 4 : escala)));
    tramos[i].n++;
  }
  return { total: filas.length, tramos: tramos };
}

/** Evolucion del promedio por semana (fecha de calificacion). */
function evolucion(semanas, courseId) {
  const cid = courseId || courses.requireActiveCourse().id;
  const limite = Math.max(4, Math.min(52, semanas || 12));
  const filas = db.all(
    "SELECT strftime('%Y-%W', gradedAt) AS semana, COUNT(*) AS n, AVG(grade) AS promedio," +
    ' COALESCE(SUM(xpEarned),0) AS xp' +
    ' FROM submissions WHERE courseId = ? AND gradedAt IS NOT NULL GROUP BY semana ORDER BY semana', [cid]);
  return filas.slice(-limite).map((r) => ({
    semana: r.semana,
    entregas: r.n,
    promedio: redondear(r.promedio, 2),
    xp: r.xp
  }));
}

/** Ejercicios completados por semana (fecha de entrega). */
function completadosPorSemana(semanas, courseId) {
  const cid = courseId || courses.requireActiveCourse().id;
  const limite = Math.max(4, Math.min(52, semanas || 12));
  const filas = db.all(
    "SELECT strftime('%Y-%W', submittedAt) AS semana, COUNT(*) AS n" +
    ' FROM submissions WHERE courseId = ? AND submittedAt IS NOT NULL GROUP BY semana ORDER BY semana', [cid]);
  return filas.slice(-limite).map((r) => ({ semana: r.semana, entregas: r.n }));
}

/* --------------------------------------------------------- destacados */

function destacados(limite, courseId) {
  const n = Math.max(1, Math.min(20, limite || 5));
  const todos = porEstudiante(courseId).filter((e) => e.promedio != null || e.xp > 0);
  const conNota = todos.filter((e) => e.promedio != null);
  return {
    mejores: todos.slice(0, n),
    conDificultades: conNota
      .filter((e) => e.reprobados > 0 || (e.promedio != null && e.promedio < 3))
      .sort((a, b) => (a.promedio || 0) - (b.promedio || 0))
      .slice(0, n)
  };
}

/* ------------------------------------------------------- todo junto */

/** Paquete completo para la pagina de estadisticas, SIEMPRE del curso activo. */
function courseStats() {
  const cid = courses.requireActiveCourse().id;
  const temas = porTema(cid);
  return {
    generadoEn: db.nowIso(),
    criterio: criterio(),
    textoCriterio: textoCriterio(),
    resumen: resumen(cid),
    porTema: temas,
    temasEnDificultad: temas.filter((t) => t.enDificultad),
    porEstudiante: porEstudiante(cid),
    distribucion: distribucionNotas(cid),
    evolucion: evolucion(12, cid),
    porSemana: completadosPorSemana(12, cid),
    destacados: destacados(5, cid)
  };
}

/**
 * Informe de un estudiante para imprimir: sus notas, su progreso, los
 * comentarios que recibio y sus insignias.
 */
function studentReport(studentUid) {
  const u = db.get('SELECT * FROM users WHERE uid = ?', [studentUid]);
  if (!u) return null;

  const entregas = db.all(
    'SELECT s.*, e.title AS ejercicio, e.topicId AS topicId, e.maxScore AS exMaxScore' +
    ' FROM submissions s LEFT JOIN exercises e ON e.id = s.exerciseId' +
    ' WHERE s.studentId = ? ORDER BY COALESCE(s.submittedAt, s.updatedAt) DESC', [studentUid]);

  const comentarios = db.all(
    'SELECT f.*, s.exerciseId AS exerciseId FROM feedback f' +
    ' JOIN submissions s ON s.id = f.submissionId WHERE s.studentId = ? ORDER BY f.createdAt DESC',
    [studentUid]);

  const insignias = db.all(
    'SELECT ub.grantedAt, ub.reason, b.name, b.description, b.icon, b.color' +
    ' FROM user_badges ub JOIN badges b ON b.id = ub.badgeId' +
    ' WHERE ub.studentId = ? ORDER BY ub.grantedAt', [studentUid]);

  const progreso = db.all('SELECT * FROM student_progress WHERE studentId = ?', [studentUid]);
  const total = progreso.find((p) => p.topicId === '*') || null;

  return {
    generadoEn: db.nowIso(),
    estudiante: {
      uid: u.uid,
      nombre: (u.firstName + ' ' + u.lastName).trim() || u.email,
      correo: u.email,
      grado: u.grade,
      grupo: u.groupName
    },
    totales: total ? {
      completados: total.completed,
      total: total.total,
      aprobados: total.passed,
      reprobados: total.failed,
      xp: total.xp,
      promedio: total.average,
      tiempoSegundos: total.timeSpentSec
    } : null,
    porTema: progreso.filter((p) => p.topicId !== '*').map((p) => ({
      tema: academic.topicName(p.topicId),
      completados: p.completed,
      total: p.total,
      promedio: p.average,
      xp: p.xp
    })),
    entregas: entregas.map((s) => ({
      ejercicio: s.ejercicio || 'Ejercicio eliminado',
      tema: academic.topicName(s.topicId),
      intento: s.attemptNumber,
      estado: s.status,
      nota: s.grade,
      maxScore: s.maxScore != null ? s.maxScore : s.exMaxScore,
      xp: s.xpEarned,
      entregadoEn: s.submittedAt,
      tiempoSegundos: s.timeSpentSec,
      comentario: s.teacherComment
    })),
    comentarios: comentarios.map((f) => ({
      linea: f.line, tipo: f.type, mensaje: f.message, cuando: f.createdAt
    })),
    insignias: insignias
  };
}

module.exports = {
  CRITERIO_DEFECTO,
  criterio,
  setCriterio,
  textoCriterio,
  resumen,
  porTema,
  porEstudiante,
  distribucionNotas,
  evolucion,
  completadosPorSemana,
  destacados,
  courseStats,
  studentReport
};
