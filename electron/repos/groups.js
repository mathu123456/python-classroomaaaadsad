'use strict';
/*
 * Grupos con nombre dentro de un curso, y a quién va dirigido cada ejercicio
 * (fase 5 del plan de cursos: asignación individual y por grupo).
 *
 * Sin ninguna fila en exercise_targets, un ejercicio es para TODO el curso
 * -el comportamiento de siempre, cero cambios para lo ya existente-; el día
 * que el profesor le pone destinatarios (estudiantes concretos y/o grupos),
 * academic.availability() lo esconde de quien no aparezca ni directo ni por
 * su grupo, con el mismo mecanismo que ya usa para ocultar uno fuera de
 * horario de clase.
 */

const db = require('../sqlite');
const courses = require('./courses');

const COLOR_DEFECTO = '#4b8bf5';

function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || 60);
}

function miembrosDe(groupId) {
  return db.all('SELECT uid FROM course_group_members WHERE groupId = ?', [groupId]).map((r) => r.uid);
}

function groupView(row) {
  if (!row) return null;
  return {
    id: row.id,
    courseId: row.courseId,
    nombre: row.name,
    color: row.color,
    miembros: miembrosDe(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

/** Lo que viaja a Firebase de un grupo: hereda la regla del propio curso. */
function remoteGroup(row) {
  return {
    name: row.name,
    color: row.color,
    courseId: row.courseId,
    members: miembrosDe(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function list(courseId) {
  const cid = courseId || courses.requireActiveCourse().id;
  return db.all('SELECT * FROM course_groups WHERE courseId = ? ORDER BY name', [cid]).map(groupView);
}

function byId(id) {
  return id ? db.get('SELECT * FROM course_groups WHERE id = ?', [String(id)]) : null;
}

function requireOwnGroup(id, teacherUid) {
  const fila = byId(id);
  if (!fila) throw new Error('Ese grupo ya no existe.');
  const curso = courses.byId(fila.courseId);
  if (!curso || curso.teacherId !== teacherUid) throw new Error('Ese grupo no es de tu curso.');
  return fila;
}

function create(teacherUid, nombre, color) {
  const curso = courses.requireActiveCourse();
  if (curso.teacherId !== teacherUid) return { ok: false, error: 'Solo el dueño del curso puede crear grupos.' };
  const limpio = clean(nombre, 60);
  if (!limpio) return { ok: false, error: 'Ponle un nombre al grupo.' };
  if (db.get('SELECT 1 FROM course_groups WHERE courseId = ? AND name = ?', [curso.id, limpio])) {
    return { ok: false, error: 'Ya existe un grupo con ese nombre.' };
  }
  const ahora = db.nowIso();
  const id = db.newId('group');
  db.run('INSERT INTO course_groups(id, courseId, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    [id, curso.id, limpio, clean(color, 20) || COLOR_DEFECTO, ahora, ahora]);
  db.enqueue('groups', id, 'upsert', remoteGroup(byId(id)));
  return { ok: true, grupo: groupView(byId(id)) };
}

function rename(id, teacherUid, nombre) {
  requireOwnGroup(id, teacherUid);
  const limpio = clean(nombre, 60);
  if (!limpio) return { ok: false, error: 'Ponle un nombre al grupo.' };
  db.run('UPDATE course_groups SET name = ?, updatedAt = ? WHERE id = ?', [limpio, db.nowIso(), id]);
  db.enqueue('groups', id, 'upsert', remoteGroup(byId(id)));
  return { ok: true, grupo: groupView(byId(id)) };
}

function remove(id, teacherUid) {
  requireOwnGroup(id, teacherUid);
  db.transaction(() => {
    db.run('DELETE FROM course_group_members WHERE groupId = ?', [id]);
    db.run("DELETE FROM exercise_targets WHERE targetType = 'group' AND targetId = ?", [id]);
    db.run('DELETE FROM course_groups WHERE id = ?', [id]);
  });
  db.enqueue('groups', id, 'delete', null);
  return { ok: true };
}

/** Reemplaza la lista completa de miembros del grupo (solo estudiantes DE ESTE curso). */
function setMembers(id, teacherUid, uids) {
  const fila = requireOwnGroup(id, teacherUid);
  const validos = new Set(db.all(
    "SELECT uid FROM course_members WHERE courseId = ? AND role = 'student' AND active = 1",
    [fila.courseId]).map((r) => r.uid));
  const limpios = Array.from(new Set((Array.isArray(uids) ? uids : []).filter((u) => validos.has(u))));
  db.transaction(() => {
    db.run('DELETE FROM course_group_members WHERE groupId = ?', [id]);
    for (const uid of limpios) {
      db.run('INSERT INTO course_group_members(groupId, uid) VALUES (?, ?)', [id, uid]);
    }
    db.run('UPDATE course_groups SET updatedAt = ? WHERE id = ?', [db.nowIso(), id]);
    db.enqueue('groups', id, 'upsert', remoteGroup(byId(id)));
  });
  return { ok: true, grupo: groupView(byId(id)) };
}

function groupIdsForStudent(uid, courseId) {
  return db.all(
    'SELECT gm.groupId FROM course_group_members gm JOIN course_groups g ON g.id = gm.groupId' +
    ' WHERE gm.uid = ? AND g.courseId = ?', [uid, courseId]).map((r) => r.groupId);
}

/* ------------------------------------------------------- exercise_targets */

function targetsFor(exerciseId) {
  const filas = db.all('SELECT targetType, targetId FROM exercise_targets WHERE exerciseId = ?', [exerciseId]);
  return {
    estudiantes: filas.filter((f) => f.targetType === 'student').map((f) => f.targetId),
    grupos: filas.filter((f) => f.targetType === 'group').map((f) => f.targetId)
  };
}

/**
 * Reemplaza a quién va dirigido un ejercicio. Ambas listas vacías = todo el
 * curso (el comportamiento de siempre: sin filas, nadie queda fuera).
 */
function setTargets(exerciseId, teacherUid, datos) {
  const ejercicio = db.get('SELECT * FROM exercises WHERE id = ?', [exerciseId]);
  if (!ejercicio) return { ok: false, error: 'El ejercicio no existe.' };
  const curso = courses.byId(ejercicio.courseId);
  if (!curso || curso.teacherId !== teacherUid) return { ok: false, error: 'Ese ejercicio no es de tu curso.' };

  const estudiantesValidos = new Set(db.all(
    "SELECT uid FROM course_members WHERE courseId = ? AND role = 'student' AND active = 1",
    [ejercicio.courseId]).map((r) => r.uid));
  const gruposValidos = new Set(db.all('SELECT id FROM course_groups WHERE courseId = ?', [ejercicio.courseId])
    .map((r) => r.id));

  const estudiantes = Array.from(new Set((datos.estudiantes || []).filter((u) => estudiantesValidos.has(u))));
  const grupos = Array.from(new Set((datos.grupos || []).filter((g) => gruposValidos.has(g))));

  const ahora = db.nowIso();
  db.transaction(() => {
    db.run('DELETE FROM exercise_targets WHERE exerciseId = ?', [exerciseId]);
    for (const uid of estudiantes) {
      db.run('INSERT INTO exercise_targets(exerciseId, targetType, targetId, createdAt) VALUES (?, ?, ?, ?)',
        [exerciseId, 'student', uid, ahora]);
    }
    for (const gid of grupos) {
      db.run('INSERT INTO exercise_targets(exerciseId, targetType, targetId, createdAt) VALUES (?, ?, ?, ?)',
        [exerciseId, 'group', gid, ahora]);
    }
    db.run('UPDATE exercises SET updatedAt = ? WHERE id = ?', [ahora, exerciseId]);
  });
  return { ok: true, destinatarios: targetsFor(exerciseId) };
}

/** ¿Puede este estudiante ver el ejercicio, según a quién va dirigido? */
function visibleParaEstudiante(exerciseId, studentUid, courseId) {
  const filas = db.all('SELECT targetType, targetId FROM exercise_targets WHERE exerciseId = ?', [exerciseId]);
  if (!filas.length) return true;   // sin destinatarios = todo el curso
  if (filas.some((f) => f.targetType === 'student' && f.targetId === studentUid)) return true;
  const misGrupos = groupIdsForStudent(studentUid, courseId);
  return filas.some((f) => f.targetType === 'group' && misGrupos.indexOf(f.targetId) !== -1);
}

module.exports = {
  list,
  byId,
  create,
  rename,
  remove,
  setMembers,
  groupIdsForStudent,
  targetsFor,
  setTargets,
  visibleParaEstudiante
};
