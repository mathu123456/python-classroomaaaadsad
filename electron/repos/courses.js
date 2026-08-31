'use strict';
/*
 * Cursos: el ecosistema aislado de un profesor.
 *
 * Un curso agrupa a un profesor con sus estudiantes, sus ejercicios y su
 * propio ritmo. Un profesor puede tener varios; un estudiante pertenece a
 * uno. Aqui solo vive la parte local (SQLite) — el aislamiento de verdad en
 * Firebase (Security Rules) llega en una fase posterior; por ahora esto sirve
 * para que el resto del codigo ya pueda preguntar "en que curso estoy" sin
 * cambiar de comportamiento todavia.
 *
 * El curso ACTIVO es estado de la sesion de este proceso, igual que
 * `activeUid` en users.js: no viaja como parametro en cada llamada de la
 * interfaz, así que las pantallas no necesitan aprender de esto todavía.
 */

const db = require('../sqlite');

/*
 * Alfabeto sin caracteres que se confunden al dictarlos en clase (0/O, 1/I/L).
 * Es el mismo alfabeto que usa la migración silenciosa en sqlite.js; se repite
 * aquí a propósito -son diez líneas- para que este módulo no dependa de un
 * detalle interno de la migración.
 */
const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || 80);
}

function generarCodigo() {
  for (let intento = 0; intento < 20; intento++) {
    let codigo = '';
    for (let i = 0; i < 6; i++) codigo += ALFABETO_CODIGO[Math.floor(Math.random() * ALFABETO_CODIGO.length)];
    if (!db.get('SELECT 1 FROM courses WHERE accessCode = ?', [codigo])) return codigo;
  }
  return 'C' + Date.now().toString(36).toUpperCase();
}

let activeCourseId = null;

function view(row) {
  if (!row) return null;
  return {
    id: row.id,
    nombre: row.name,
    profesorId: row.teacherId,
    codigo: row.accessCode,
    estado: row.status,
    activo: row.status === 'active',
    limiteRanking: row.rankingLimit,
    estudiantes: countStudents(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

/** Lo que viaja a Firebase de un curso: sus metadatos, nada de sus miembros. */
function remoteCourse(row) {
  return {
    name: row.name,
    teacherId: row.teacherId,
    accessCode: row.accessCode,
    status: row.status,
    rankingLimit: row.rankingLimit,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function byId(id) {
  return id ? db.get('SELECT * FROM courses WHERE id = ?', [String(id)]) : null;
}

function byCode(code) {
  const limpio = String(code || '').trim().toUpperCase();
  return limpio ? db.get('SELECT * FROM courses WHERE accessCode = ?', [limpio]) : null;
}

/**
 * Los cursos de un uid: los que posee (profesor) mas los que integra
 * (matricula en course_members, sea como estudiante o co-profesor).
 */
function forUser(uid) {
  if (!uid) return [];
  return db.all(
    `SELECT DISTINCT c.* FROM courses c
     LEFT JOIN course_members m ON m.courseId = c.id AND m.uid = ? AND m.active = 1
     WHERE c.teacherId = ? OR m.uid IS NOT NULL
     ORDER BY c.createdAt ASC`,
    [uid, uid]);
}

/**
 * El curso de un uid, sin exigir sesión activa. Se usa cuando hay que saber
 * "de qué curso es este dato" para alguien que no es necesariamente quien
 * tiene la sesión abierta ahora mismo (p. ej. calcular el progreso de un
 * estudiante cuando quien actúa es su profesor). Por ahora cada uno pertenece
 * a un único curso, así que basta con el primero.
 */
function courseIdFor(uid) {
  const cursos = forUser(uid);
  return cursos.length ? cursos[0].id : null;
}

function membershipRole(courseId, uid) {
  const curso = byId(courseId);
  if (!curso) return null;
  if (curso.teacherId === uid) return 'teacher';
  const fila = db.get('SELECT role FROM course_members WHERE courseId = ? AND uid = ? AND active = 1',
    [courseId, uid]);
  return fila ? fila.role : null;
}

/** Cuántos estudiantes activos tiene un curso (para la lista del profesor). */
function countStudents(courseId) {
  const fila = db.get(
    "SELECT COUNT(*) AS n FROM course_members WHERE courseId = ? AND role = 'student' AND active = 1",
    [courseId]);
  return fila ? fila.n : 0;
}

/**
 * Crea un curso nuevo. Es puramente local por ahora (no viaja a Firebase
 * todavía: eso llega junto con el resto del aislamiento, en una fase
 * posterior) — así que, de momento, un curso creado en un equipo solo existe
 * en ese equipo hasta que se sincronice.
 */
function crear(teacherUid, nombre) {
  const limpio = clean(nombre, 60);
  if (!limpio) return { ok: false, error: 'Ponle un nombre al curso.' };

  const ahora = db.nowIso();
  const id = db.newId('course');
  const codigo = generarCodigo();
  db.run(
    'INSERT INTO courses(id, name, teacherId, accessCode, status, rankingLimit, createdAt, updatedAt)' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, limpio, teacherUid, codigo, 'active', 10, ahora, ahora]);

  const fila = byId(id);
  db.enqueue('courses', id, 'upsert', remoteCourse(fila));
  db.enqueue('courseCodes', codigo, 'upsert', id);

  return { ok: true, curso: view(fila) };
}

function renombrar(courseId, teacherUid, nombre) {
  const curso = byId(courseId);
  if (!curso) return { ok: false, error: 'Ese curso ya no existe.' };
  if (curso.teacherId !== teacherUid) return { ok: false, error: 'Solo el dueño del curso puede renombrarlo.' };
  const limpio = clean(nombre, 60);
  if (!limpio) return { ok: false, error: 'Ponle un nombre al curso.' };
  db.run('UPDATE courses SET name = ?, updatedAt = ? WHERE id = ?', [limpio, db.nowIso(), courseId]);
  const fila = byId(courseId);
  db.enqueue('courses', courseId, 'upsert', remoteCourse(fila));
  return { ok: true, curso: view(fila) };
}

/**
 * Cambia el código de acceso. El anterior deja de servir para unirse en el
 * momento: quien ya está matriculado no se ve afectado. El código viejo se
 * queda huérfano en Firebase -apuntando a un curso cuyo código real ya
 * cambió-, así que resolverlo ahí no sirve de nada sin más.
 */
function regenerarCodigo(courseId, teacherUid) {
  const curso = byId(courseId);
  if (!curso) return { ok: false, error: 'Ese curso ya no existe.' };
  if (curso.teacherId !== teacherUid) return { ok: false, error: 'Solo el dueño del curso puede cambiar su código.' };
  const codigo = generarCodigo();
  db.run('UPDATE courses SET accessCode = ?, updatedAt = ? WHERE id = ?', [codigo, db.nowIso(), courseId]);
  const fila = byId(courseId);
  db.enqueue('courses', courseId, 'upsert', remoteCourse(fila));
  db.enqueue('courseCodes', codigo, 'upsert', courseId);
  return { ok: true, curso: view(fila) };
}

function setEstado(courseId, teacherUid, estado) {
  const curso = byId(courseId);
  if (!curso) return { ok: false, error: 'Ese curso ya no existe.' };
  if (curso.teacherId !== teacherUid) return { ok: false, error: 'Solo el dueño del curso puede archivarlo.' };
  if (['active', 'archived'].indexOf(estado) === -1) return { ok: false, error: 'Estado no válido.' };
  db.run('UPDATE courses SET status = ?, updatedAt = ? WHERE id = ?', [estado, db.nowIso(), courseId]);
  const fila = byId(courseId);
  db.enqueue('courses', courseId, 'upsert', remoteCourse(fila));
  return { ok: true, curso: view(fila) };
}

/**
 * Cuántos puestos del ranking ve un estudiante (0 = todos). Vive en la fila
 * del curso -cada profesor decide el suyo-, así que cambiar el número es una
 * escritura de curso más: pasa por aquí (no por SQL suelto en gamification.js)
 * para que quede encolada hacia Firebase igual que el resto de sus campos.
 */
function setRankingLimit(courseId, limite) {
  db.run('UPDATE courses SET rankingLimit = ?, updatedAt = ? WHERE id = ?', [limite, db.nowIso(), courseId]);
  const fila = byId(courseId);
  db.enqueue('courses', courseId, 'upsert', remoteCourse(fila));
  return fila;
}

/**
 * Un estudiante se une a un curso con el código que le dio su profesor.
 *
 * Solo funciona si todavía no pertenece a ningún curso: cada estudiante va a
 * uno, para que su progreso y su ritmo no queden repartidos entre dos sitios.
 * Cambiarlo de curso más adelante es una herramienta aparte, pensada para el
 * profesor, no algo que se resuelva reintroduciendo un código.
 */
function unirsePorCodigo(uid, codigo) {
  if (forUser(uid).length) {
    return { ok: false, error: 'Ya perteneces a un curso. Pídele a tu profesor que te cambie de curso si hace falta.' };
  }
  const curso = byCode(codigo);
  if (!curso) return { ok: false, error: 'Ese código no corresponde a ningún curso.' };
  if (curso.status !== 'active') return { ok: false, error: 'Ese curso está archivado y no admite estudiantes nuevos.' };
  if (curso.teacherId === uid) return { ok: false, error: 'Ya eres el profesor de ese curso.' };

  db.run('INSERT OR IGNORE INTO course_members(courseId, uid, role, active, joinedAt) VALUES (?, ?, ?, 1, ?)',
    [curso.id, uid, 'student', db.nowIso()]);
  db.enqueue('courseMembers', uid, 'upsert', { courseId: curso.id, uid: uid, role: 'student' });
  setActiveCourse(curso.id);
  return { ok: true, curso: view(byId(curso.id)) };
}

/**
 * El profesor mueve a un estudiante de su curso a otro curso suyo.
 *
 * El origen se resuelve solo -no lo elige quien llama-: `courseIdFor` ya
 * filtra por `active = 1`, así que siempre da el curso en el que el
 * estudiante está de verdad ahora mismo.
 */
function moverEstudiante(estudianteUid, cursoDestinoId, teacherUid) {
  const origenId = courseIdFor(estudianteUid);
  if (!origenId) return { ok: false, error: 'Ese estudiante no tiene curso.' };
  if (origenId === cursoDestinoId) return { ok: false, error: 'Ya está en ese curso.' };
  const origen = byId(origenId);
  const destino = byId(cursoDestinoId);
  if (!origen || origen.teacherId !== teacherUid) return { ok: false, error: 'Ese estudiante no es de tu curso.' };
  if (!destino || destino.teacherId !== teacherUid) return { ok: false, error: 'Ese curso de destino no es tuyo.' };
  if (destino.status !== 'active') return { ok: false, error: 'Ese curso de destino está archivado.' };
  if (membershipRole(origenId, estudianteUid) !== 'student') return { ok: false, error: 'Esa persona no es estudiante de ese curso.' };

  const ahora = db.nowIso();
  db.transaction(() => {
    db.run('UPDATE course_members SET active = 0 WHERE courseId = ? AND uid = ?', [origenId, estudianteUid]);
    db.run(
      'INSERT INTO course_members(courseId, uid, role, active, joinedAt) VALUES (?, ?, ?, 1, ?)' +
      ' ON CONFLICT(courseId, uid) DO UPDATE SET active = 1, joinedAt = excluded.joinedAt',
      [cursoDestinoId, estudianteUid, 'student', ahora]);
  });
  // Se borra en Firebase la matrícula del curso VIEJO (members/$uid deja de existir ahí)...
  db.enqueue('courseMembers', estudianteUid, 'delete', { courseId: origenId, uid: estudianteUid });
  // ...y se crea en el NUEVO. Dos operaciones con el mismo entityId pero distinto 'op': el opId
  // por defecto ya las distingue (entity:entityId:op), no hace falta opId explícito aquí.
  db.enqueue('courseMembers', estudianteUid, 'upsert', { courseId: cursoDestinoId, uid: estudianteUid, role: 'student' });
  return { ok: true, curso: view(destino) };
}

// Un profesor se une a OTRO curso como coprofesor (no reemplaza el suyo propio: puede tener
// varios cursos propios Y ser coprofesor en otros a la vez). Reutiliza el MISMO código de acceso
// que usan los estudiantes -no hace falta un código aparte-, porque solo un profesor autenticado
// como tal puede llegar a llamar a esta función (se comprueba en el canal IPC con requireTeacher()).
function unirseComoCoprofesor(uid, codigo) {
  const curso = byCode(codigo);
  if (!curso) return { ok: false, error: 'Ese código no corresponde a ningún curso.' };
  if (curso.status !== 'active') return { ok: false, error: 'Ese curso está archivado.' };
  if (curso.teacherId === uid) return { ok: false, error: 'Ya eres el profesor de ese curso.' };
  if (membershipRole(curso.id, uid)) return { ok: false, error: 'Ya perteneces a ese curso.' };
  db.run('INSERT OR IGNORE INTO course_members(courseId, uid, role, active, joinedAt) VALUES (?, ?, ?, 1, ?)',
    [curso.id, uid, 'co_teacher', db.nowIso()]);
  db.enqueue('courseMembers', uid, 'upsert', { courseId: curso.id, uid: uid, role: 'co_teacher' });
  return { ok: true, curso: view(curso) };
}

// Coprofesores DE UN curso (para pintarlos en la pantalla del curso). Usa users.js -pero courses.js
// NO puede requerir users.js (ciclo: users.js ya requiere courses.js) así que hazlo con SQL directo,
// uniendo con la tabla 'users'.
function coProfesores(courseId) {
  return db.all(
    "SELECT u.uid, u.firstName, u.lastName, u.email FROM course_members m" +
    " JOIN users u ON u.uid = m.uid" +
    " WHERE m.courseId = ? AND m.role = 'co_teacher' AND m.active = 1" +
    " ORDER BY u.lastName, u.firstName", [courseId]
  ).map((r) => ({ uid: r.uid, nombre: (r.firstName + ' ' + r.lastName).trim() || r.email, correo: r.email }));
}

function quitarCoprofesor(courseId, teacherUid, targetUid) {
  const curso = byId(courseId);
  if (!curso) return { ok: false, error: 'Ese curso ya no existe.' };
  if (curso.teacherId !== teacherUid) return { ok: false, error: 'Solo el dueño del curso puede quitar coprofesores.' };
  if (membershipRole(courseId, targetUid) !== 'co_teacher') return { ok: false, error: 'Esa persona no es coprofesor de este curso.' };
  db.run('UPDATE course_members SET active = 0 WHERE courseId = ? AND uid = ?', [courseId, targetUid]);
  db.enqueue('courseMembers', targetUid, 'delete', { courseId: courseId, uid: targetUid });
  return { ok: true };
}

/*
 * Borrado de verdad (no archivado). Solo un curso ARCHIVADO, SIN ninguna entrega hecha nunca en
 * él, y nunca el último curso que le queda al profesor -si no, se quedaría sin ninguno-.
 */
function eliminar(courseId, teacherUid) {
  const curso = byId(courseId);
  if (!curso) return { ok: false, error: 'Ese curso ya no existe.' };
  if (curso.teacherId !== teacherUid) return { ok: false, error: 'Solo el dueño del curso puede borrarlo.' };
  if (curso.status !== 'archived') return { ok: false, error: 'Archívalo primero; solo se borra un curso ya archivado.' };
  const entregas = db.get('SELECT COUNT(*) AS n FROM submissions WHERE courseId = ?', [courseId]).n;
  if (entregas > 0) return { ok: false, error: 'Este curso tiene entregas: no se puede borrar, solo archivar.' };
  const propios = forUser(teacherUid).filter((c) => c.teacherId === teacherUid);
  if (propios.length <= 1) return { ok: false, error: 'No puedes borrar tu único curso.' };

  db.transaction(() => {
    db.run('DELETE FROM exercise_targets WHERE exerciseId IN (SELECT id FROM exercises WHERE courseId = ?)', [courseId]);
    db.run('DELETE FROM class_exercises WHERE classId IN (SELECT id FROM classes WHERE courseId = ?)', [courseId]);
    db.run('DELETE FROM course_group_members WHERE groupId IN (SELECT id FROM course_groups WHERE courseId = ?)', [courseId]);
    db.run('DELETE FROM course_groups WHERE courseId = ?', [courseId]);
    db.run('DELETE FROM classes WHERE courseId = ?', [courseId]);
    db.run('DELETE FROM challenges WHERE courseId = ?', [courseId]);
    db.run('DELETE FROM exercises WHERE courseId = ?', [courseId]);
    db.run('DELETE FROM course_members WHERE courseId = ?', [courseId]);
    db.run('DELETE FROM courses WHERE id = ?', [courseId]);
  });
  // Firebase: borrar el nodo courses/<id> ENTERO se lleva de un plumazo members/roster/exercises/...
  // -es justo lo que queremos, ya se comprobó arriba que no hay entregas-.
  db.enqueue('courses', courseId, 'delete', null);
  if (getActiveCourseId() === courseId) setActiveCourse(null);
  return { ok: true };
}

/**
 * Aprueba a alguien que pidió ser profesor de este curso: pasa a ser
 * coprofesor de este curso concreto (no dueño de ninguno propio -eso lo
 * consigue como cualquier profesor nuevo, creando el suyo-).
 */
function aprobarSolicitudDeProfesor(courseId, teacherUid, targetUid) {
  const curso = byId(courseId);
  if (!curso) return { ok: false, error: 'Ese curso ya no existe.' };
  if (curso.teacherId !== teacherUid) return { ok: false, error: 'Solo el dueño del curso puede aprobar.' };
  db.run("INSERT OR IGNORE INTO course_members(courseId, uid, role, active, joinedAt) VALUES (?, ?, 'co_teacher', 1, ?)",
    [courseId, targetUid, db.nowIso()]);
  db.enqueue('courseMembers', targetUid, 'upsert', { courseId: courseId, uid: targetUid, role: 'co_teacher' });
  return { ok: true };
}

/**
 * Un profesor nunca se queda sin curso. La migración silenciosa (sqlite.js)
 * cubre el caso de una instalación que ya tenía datos de antes de que
 * existieran los cursos; esto cubre el otro caso, el normal de aquí en
 * adelante: un profesor autorizado que entra por primera vez en un equipo
 * limpio -donde la migración no tuvo a nadie que migrar todavía- recibe su
 * primer curso en el momento, sin que nadie tenga que crearlo a mano.
 */
function asegurarCursoDeProfesor(uid) {
  if (forUser(uid).length) return;
  crear(uid, 'Curso general');
}

function setActiveCourse(courseId) {
  activeCourseId = courseId || null;
  return activeCourseId;
}

function getActiveCourseId() { return activeCourseId; }

function activeCourse() { return byId(activeCourseId); }

function requireActiveCourse() {
  const row = activeCourse();
  if (!row) throw new Error('No tienes ningún curso activo.');
  return row;
}

/*
 * Al entrar, se activa un curso automaticamente si el uid solo pertenece a
 * uno (el caso normal por ahora: todavia no hay pantalla para tener varios a
 * la vez). Con varios cursos, la fase de "gestion de cursos" decidira cual
 * recordar; de momento se queda con el primero para no dejar la sesion sin
 * curso activo.
 */
function resolveActiveForUser(uid) {
  const cursos = forUser(uid);
  setActiveCourse(cursos.length ? cursos[0].id : null);
  return activeCourse();
}

module.exports = {
  view,
  byId,
  byCode,
  forUser,
  courseIdFor,
  countStudents,
  crear,
  aprobarSolicitudDeProfesor,
  asegurarCursoDeProfesor,
  unirsePorCodigo,
  moverEstudiante,
  unirseComoCoprofesor,
  coProfesores,
  quitarCoprofesor,
  eliminar,
  renombrar,
  regenerarCodigo,
  setEstado,
  setRankingLimit,
  membershipRole,
  setActiveCourse,
  getActiveCourseId,
  activeCourse,
  requireActiveCourse,
  resolveActiveForUser
};
