'use strict';
/*
 * Espejo local de los perfiles.
 *
 * La identidad la gobierna Firebase Authentication: aqui NO hay contrasenas.
 * Esta tabla existe para que la aplicacion sepa quien es cada quien sin
 * conexion (nombre, rol, grado, grupo) y para poder calcular progreso local.
 *
 * El rol es dato sensible: la ultima palabra la tienen las Security Rules de
 * Firebase. Lo que hay aqui es una copia y una comprobacion adicional local.
 */

const db = require('../sqlite');
const courses = require('./courses');

const ROLES = ['teacher', 'student'];
const PALETA = ['#4b8bf5', '#7ee1c9', '#ffd43b', '#ff7ab2', '#c58cf5', '#f0b23a', '#57c7d4', '#4bcf87'];

let activeUid = null;

function colorFor(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETA[h % PALETA.length];
}

function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || 80);
}

function initials(row) {
  const a = (row.firstName || '').trim().charAt(0);
  const b = (row.lastName || '').trim().charAt(0);
  return (a + b).toUpperCase() || (row.email || '?').charAt(0).toUpperCase();
}

/** Forma con la que la interfaz ve a un usuario. */
function view(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    id: row.uid,
    email: row.email,
    correo: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    nombre: row.firstName,
    apellido: row.lastName,
    nombreCompleto: (row.firstName + ' ' + row.lastName).trim() || row.email,
    iniciales: initials(row),
    role: row.role,
    rol: row.role === 'teacher' ? 'profesor' : 'estudiante',
    rolVerificadoEn: row.roleVerifiedAt || null,
    grade: row.grade,
    grado: row.grade,
    groupName: row.groupName,
    grupo: row.groupName,
    color: row.color,
    foto: row.photoURL || null,
    fotoActualizadaEn: row.photoUpdatedAt || null,
    tutorialCompletado: !!row.tutorialDone,
    activo: !!row.active,
    creadoEn: row.createdAt,
    ultimoAccesoEn: row.lastLoginAt,
    quiereSerProfesor: !!row.teacherRequestedAt,
    cursoSolicitado: row.teacherRequestedCourseId || null
  };
}

function byUid(uid) {
  return db.get('SELECT * FROM users WHERE uid = ?', [uid]);
}

function count() {
  const r = db.get('SELECT COUNT(*) AS n FROM users');
  return r ? r.n : 0;
}

function countTeachers() {
  const r = db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'teacher'");
  return r ? r.n : 0;
}

/**
 * Crea o actualiza el perfil tras iniciar sesion en Firebase.
 * El rol solo se acepta al crear (o si lo cambia un profesor via setRole).
 */
/*
 * Espeja en local la cuenta que acaba de iniciar sesion.
 *
 * REGLA DE ORO: el rol de profesor solo entra aqui si el proceso principal lo
 * verifico contra Firebase (data.verifiedRole + data.roleVerifiedAt). Sin esa
 * comprobacion se queda como estudiante, aunque la interfaz pida otra cosa y
 * aunque la base local este recien creada.
 */
function upsertFromAuth(data) {
  const uid = String(data.uid || '').trim();
  if (!uid) throw new Error('Falta el identificador de usuario.');
  const previo = byUid(uid);
  const ahora = db.nowIso();

  const verificado = ROLES.indexOf(data.verifiedRole) !== -1 ? data.verifiedRole : null;
  /*
   * Sin verificacion nueva se conserva lo que YA se habia verificado en este
   * equipo. Si no hay nada verificado -por ejemplo porque se borro la base-,
   * la sesion entra como estudiante.
   */
  const rolPrevioValido = previo && previo.roleVerifiedAt ? previo.role : 'student';
  const rol = verificado || rolPrevioValido;
  const verificadoEn = verificado
    ? (data.roleVerifiedAt || ahora)
    : (previo ? previo.roleVerifiedAt : null);

  const row = {
    uid: uid,
    email: clean(data.email, 190).toLowerCase(),
    firstName: clean(data.firstName != null ? data.firstName : (previo && previo.firstName), 60),
    lastName: clean(data.lastName != null ? data.lastName : (previo && previo.lastName), 60),
    role: rol,
    roleVerifiedAt: verificadoEn,
    grade: clean(data.grade != null ? data.grade : (previo && previo.grade), 20),
    groupName: clean(data.groupName != null ? data.groupName : (previo && previo.groupName), 20),
    color: (previo && previo.color) || colorFor(uid),
    photoURL: data.photoURL !== undefined ? (data.photoURL || null) : (previo ? previo.photoURL : null),
    photoUpdatedAt: data.photoURL !== undefined ? ahora : (previo ? previo.photoUpdatedAt : null),
    tutorialDone: previo ? previo.tutorialDone : 0,
    active: previo ? previo.active : 1,
    createdAt: previo ? previo.createdAt : ahora,
    updatedAt: ahora,
    lastLoginAt: data.touchLogin === false ? (previo && previo.lastLoginAt) : ahora,
    syncedAt: previo ? previo.syncedAt : null
  };

  db.upsert('users', 'uid', row);
  if (data.enqueue !== false) db.enqueue('users', uid, 'upsert', remotePayload(row));
  return view(byUid(uid));
}

/** Lo que se sube a Firebase de un perfil (sin datos locales). */
function remotePayload(row) {
  return {
    email: row.email,
    photoURL: row.photoURL || null,
    firstName: row.firstName,
    lastName: row.lastName,
    grade: row.grade,
    groupName: row.groupName,
    color: row.color,
    active: row.active ? true : false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
    // Solicitud de ser profesor: viaja tambien aqui para que enqueueRosterFanout
    // (que arma el payload de courseRoster a partir de este mismo objeto) se la
    // lleve gratis -es la unica forma en que EL PROFESOR DE ESE CURSO puede
    // enterarse, porque leer users/ ajeno ya esta cerrado.
    teacherRequestedAt: row.teacherRequestedAt || null,
    teacherRequestedCourseId: row.teacherRequestedCourseId || null
  };
}

/*
 * Copia el perfil de un uid al roster de CADA curso del que es miembro (en la
 * práctica, uno). Es lo que le permite al profesor ver a sus estudiantes sin
 * leer `users/` ajeno -que las reglas ya no dejan-: se llama al entrar y al
 * unirse a un curso, así que el roster se mantiene solo, sin que nadie tenga
 * que acordarse de llamarlo en cada sitio que toca el perfil.
 */
function enqueueRosterFanout(uid) {
  const row = byUid(uid);
  if (!row) return;
  const payload = remotePayload(row);
  for (const curso of courses.forUser(uid)) {
    db.enqueue('courseRoster', curso.id + ':' + uid, 'upsert',
      Object.assign({ courseId: curso.id, uid: uid }, payload));
  }
}

function update(uid, patch) {
  const previo = byUid(uid);
  if (!previo) return null;
  const row = Object.assign({}, previo, {
    firstName: patch.firstName != null ? clean(patch.firstName, 60) : previo.firstName,
    lastName: patch.lastName != null ? clean(patch.lastName, 60) : previo.lastName,
    grade: patch.grade != null ? clean(patch.grade, 20) : previo.grade,
    groupName: patch.groupName != null ? clean(patch.groupName, 20) : previo.groupName,
    active: patch.active === undefined ? previo.active : (patch.active ? 1 : 0),
    tutorialDone: patch.tutorialDone === undefined ? previo.tutorialDone : (patch.tutorialDone ? 1 : 0),
    updatedAt: db.nowIso()
  });
  db.upsert('users', 'uid', row);
  db.enqueue('users', uid, 'upsert', remotePayload(row));
  enqueueRosterFanout(uid);
  return view(byUid(uid));
}

/**
 * Guarda la URL de la foto de perfil. `null` la quita y vuelve a las iniciales.
 * Nunca se guarda la imagen: solo la direccion donde vive.
 */
function setPhoto(uid, url) {
  const previo = byUid(uid);
  if (!previo) throw new Error('La cuenta no existe.');
  const limpia = url == null || url === '' ? null : String(url).trim().slice(0, 400);
  if (limpia && !/^https:\/\//i.test(limpia)) throw new Error('La dirección de la foto no es válida.');
  db.run('UPDATE users SET photoURL = ?, photoUpdatedAt = ?, updatedAt = ? WHERE uid = ?',
    [limpia, limpia ? db.nowIso() : null, db.nowIso(), uid]);
  const row = byUid(uid);
  db.enqueue('users', uid, 'upsert', remotePayload(row));
  enqueueRosterFanout(uid);
  return view(row);
}

/** Cambia el rol. Solo lo llama el IPC tras comprobar que quien pide es profesor. */
function setRole(uid, role) {
  if (ROLES.indexOf(role) === -1) throw new Error('Rol no valido.');
  const previo = byUid(uid);
  if (!previo) throw new Error('La cuenta no existe.');
  if (previo.role === 'teacher' && role !== 'teacher' && countTeachers() <= 1) {
    throw new Error('Debe quedar al menos un profesor.');
  }
  db.run('UPDATE users SET role = ?, roleVerifiedAt = ?, updatedAt = ? WHERE uid = ?',
    [role, db.nowIso(), db.nowIso(), uid]);
  db.enqueue('roles', uid, 'upsert', role);
  return view(byUid(uid));
}

/** Marca (o borra) la solicitud de ser profesor de un curso concreto. */
function setSolicitudProfesor(uid, courseId) {
  const previo = byUid(uid);
  const cursoDeLaSolicitud = previo ? previo.teacherRequestedCourseId : null;
  db.run('UPDATE users SET teacherRequestedAt = ?, teacherRequestedCourseId = ?, updatedAt = ? WHERE uid = ?',
    [courseId ? db.nowIso() : null, courseId || null, db.nowIso(), uid]);
  const row = byUid(uid);
  if (row) {
    db.enqueue('users', uid, 'upsert', remotePayload(row));
    enqueueRosterFanout(uid);
    /*
     * Borrar una solicitud (rechazo, o el "ya no está pendiente" de una
     * aprobación) hacia un curso del que uid TODAVÍA no es miembro -el caso
     * normal de un rechazo, que nunca lo matricula- no lo alcanza
     * enqueueRosterFanout: esa función solo recorre cursos de los que YA se
     * es miembro. Sin este envío aparte, la marca pendiente se queda para
     * siempre en el roster remoto de ESE curso y el próximo arrastre
     * periódico la resucitaría en local, "revirtiendo" el rechazo. Quien
     * llama a esta función (el dueño del curso, resolviendo la solicitud) sí
     * tiene permiso de sobra para escribir en el roster de su propio curso.
     */
    if (!courseId && cursoDeLaSolicitud) {
      db.enqueue('courseRoster', cursoDeLaSolicitud + ':' + uid, 'upsert',
        Object.assign({ courseId: cursoDeLaSolicitud, uid: uid }, remotePayload(row)));
    }
  }
  return view(row);
}

/** Solicitudes pendientes de un curso concreto (para que su profesor las revise). */
function solicitudesDeProfesor(courseId) {
  return db.all(
    "SELECT * FROM users WHERE teacherRequestedCourseId = ? AND role != 'teacher'",
    [courseId]
  ).map(view);
}

/*
 * Quien pertenece a ESTE curso -el dueño más quien esté en course_members-,
 * no todo el colegio: es la lista que alimenta "Estudiantes y cuentas", la
 * pantalla central del aislamiento por curso. Sin curso activo no hay a quién
 * mostrar (mismo criterio que `students()`).
 */
function list() {
  const curso = courses.activeCourse();
  if (!curso) return [];
  return db.all(
    `SELECT * FROM users WHERE uid = ?
     UNION
     SELECT u.* FROM users u
     JOIN course_members m ON m.uid = u.uid
     WHERE m.courseId = ? AND m.active = 1
     ORDER BY role DESC, lastName, firstName`,
    [curso.teacherId, curso.id]).map(view);
}

/*
 * Solo los estudiantes DE ESTE CURSO -no todo el colegio-: es exactamente el
 * aislamiento que pidió el profesor ("cada profesor ve solo lo suyo"). Sin
 * curso activo no hay a quién mostrar.
 */
function students() {
  const curso = courses.activeCourse();
  if (!curso) return [];
  return db.all(
    `SELECT u.* FROM users u
     JOIN course_members m ON m.uid = u.uid AND m.courseId = ? AND m.role = 'student' AND m.active = 1
     WHERE u.role = 'student'
     ORDER BY u.lastName, u.firstName`,
    [curso.id]).map(view);
}

function remove(uid) {
  const previo = byUid(uid);
  if (!previo) return false;
  if (previo.role === 'teacher' && countTeachers() <= 1) {
    throw new Error('Debe quedar al menos un profesor.');
  }
  db.transaction(() => {
    db.run('DELETE FROM submissions WHERE studentId = ?', [uid]);
    db.run('DELETE FROM session_events WHERE studentId = ?', [uid]);
    db.run('DELETE FROM student_progress WHERE studentId = ?', [uid]);
    db.run('DELETE FROM users WHERE uid = ?', [uid]);
  });
  db.enqueue('users', uid, 'delete', null);
  return true;
}

/* ------------------------------------------------------- sesion activa */

function setActive(uid) {
  activeUid = uid || null;
  return activeUid;
}

function getActiveUid() { return activeUid; }

function active() {
  return activeUid ? view(byUid(activeUid)) : null;
}

function activeRow() {
  return activeUid ? byUid(activeUid) : null;
}

function requireUser() {
  const row = activeRow();
  if (!row) throw new Error('Debes iniciar sesión.');
  return row;
}

function requireTeacher() {
  const row = requireUser();
  if (row.role !== 'teacher') throw new Error('Esta acción solo la puede hacer un profesor.');
  return row;
}

module.exports = {
  ROLES,
  view,
  byUid,
  count,
  countTeachers,
  upsertFromAuth,
  update,
  setRole,
  setPhoto,
  setSolicitudProfesor,
  solicitudesDeProfesor,
  list,
  students,
  remove,
  enqueueRosterFanout,
  setActive,
  getActiveUid,
  active,
  activeRow,
  requireUser,
  requireTeacher,
  clean,
  colorFor
};
