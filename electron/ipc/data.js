'use strict';
/*
 * Unica puerta de entrada del renderer a los datos locales (SQLite).
 *
 * Cada canal comprueba el rol del usuario activo antes de tocar nada. Esta
 * comprobacion es una segunda barrera: la autoridad real sobre quien puede
 * hacer que son las Security Rules de Firebase, porque el cliente siempre es
 * manipulable. Aqui se evita que un fallo de la interfaz escriba donde no debe.
 */

const { app } = require('electron');

const fs = require('fs');
const path = require('path');

const db = require('../sqlite');
const store = require('../store');
const files = require('./files');
const users = require('../repos/users');
const courses = require('../repos/courses');
const academic = require('../repos/academic');
const groups = require('../repos/groups');
const work = require('../repos/work');
const game = require('../repos/gamification');
const roleVerify = require('../role-verify');

let ctxRef = null;

function notify(motivo) {
  if (ctxRef) ctxRef.send('data:changed', { motivo: motivo || 'cambio', at: Date.now() });
}

/** Envuelve un manejador para que los errores lleguen limpios a la interfaz. */
function guard(fn) {
  return (event, ...args) => {
    try {
      return fn(...args);
    } catch (err) {
      throw new Error(err && err.message ? err.message : String(err));
    }
  };
}

function register(ipcMain, ctx) {
  ctxRef = ctx;
  db.open();

  /* ====================================================== sesion local */

  /**
   * El renderer avisa de que alguien inicio sesion en Firebase y entrega su ID
   * token. Aqui NO se cree nada de lo que diga la interfaz sobre el rol: el
   * proceso principal comprueba el token contra Firebase (role-verify.js) y de
   * ahi salen el uid, el correo y el rol.
   *
   * Sin conexion se acepta la identidad solo para poder seguir trabajando en
   * local con lo que ya habia, y el rol se limita a lo que se verifico antes en
   * este equipo. Si la base local se borro, no hay nada verificado: entra como
   * estudiante y se avisa de que la comprobacion quedo pendiente.
   */
  ipcMain.handle('data:setSession', guard(async (perfil) => {
    const datos = perfil || {};
    if (!datos.idToken) throw new Error('Falta el token de sesión de Firebase.');

    const comprobado = await roleVerify.verificar({ idToken: datos.idToken, uid: datos.uid, email: datos.email });
    if (comprobado.rechazado) {
      throw new Error('La sesión no se pudo verificar con Firebase: ' + (comprobado.error || 'token no válido') + '.');
    }

    // La identidad sale del token cuando se pudo comprobar.
    const uid = comprobado.ok ? comprobado.uid : String(datos.uid || '').trim();
    if (!uid) throw new Error('Perfil incompleto.');
    if (comprobado.ok && datos.uid && datos.uid !== uid) {
      console.warn('[sesion] el renderer pidió', datos.uid, 'y el token es de', uid);
    }
    const email = (comprobado.ok && comprobado.email) || datos.email || '';

    /*
     * El dueño se fija ANTES de tocar la base: al entrar se guarda el perfil y
     * el rol, y esas operaciones tienen que quedar a nombre de quien entra. Si
     * quedaran sin dueño, la siguiente persona que usara este computador
     * intentaria subirlas y las reglas se lo negarian, con razon.
     */
    db.setOwner(uid);

    const previo = users.byUid(uid);
    let vista = users.upsertFromAuth({
      uid: uid,
      email: email,
      firstName: datos.firstName,
      lastName: datos.lastName,
      grade: datos.grade,
      groupName: datos.groupName,
      verifiedRole: comprobado.ok ? comprobado.role : null,
      roleVerifiedAt: comprobado.ok ? comprobado.verifiedAt : null
    });

    users.setActive(uid);
    store.setActiveUser(uid);
    // Un profesor nunca se queda sin curso, ni siquiera la primera vez que
    // entra en un equipo limpio (la migración silenciosa solo cubre datos que
    // ya existían de antes).
    if (vista.role === 'teacher') courses.asegurarCursoDeProfesor(uid);
    courses.resolveActiveForUser(uid);
    // El profesor de ese curso necesita verte en su lista sin leer `users/`
    // ajeno: se refresca la copia del roster en cada entrada, por si acaso.
    users.enqueueRosterFanout(uid);
    // Si eligió "profesor" en el alta pero no hubo bootstrap (ya había uno en
    // esta instalación), su cuenta entró como estudiante: se deja marcada la
    // solicitud para que el profesor de ESE curso la revise.
    if (datos.teacherRequestedCourseId && vista.role !== 'teacher') {
      vista = users.setSolicitudProfesor(uid, datos.teacherRequestedCourseId);
    }
    if (ctx.onUserChange) ctx.onUserChange(vista);

    work.recomputeProgress(uid);
    return {
      ok: true,
      usuario: vista,
      verificado: !!comprobado.ok,
      verificacionPendiente: !comprobado.ok,
      motivo: comprobado.ok ? null : (comprobado.error || 'sin conexión'),
      cuentaNueva: !previo
    };
  }));

  /*
   * Canal EXCLUSIVO de las pruebas automatizadas (npm run test:e2e). Sustituye
   * la comprobacion contra Firebase por una tabla que siembra la propia prueba,
   * igual que si una persona autorizara el rol en la consola. No se registra
   * cuando la aplicacion esta empaquetada, asi que en una instalacion real este
   * canal no existe.
   */
  if (!app.isPackaged && process.env.PC_E2E) {
    /*
     * Borra la nota SOLO de la copia local, para poder comprobar el aviso de
     * «nueva calificación» como si llegara de otro equipo.
     */
    ipcMain.handle('test:olvidarNota', guard((submissionId) => {
      db.run('UPDATE submissions SET grade = NULL, xpEarned = 0, gradedAt = NULL,' +
        " teacherComment = '' WHERE id = ?", [submissionId]);
      return { ok: true };
    }));

    /* Pone una foto de perfil sin pasar por la subida real. */
    ipcMain.handle('test:setPhoto', guard((url) => {
      const yo = users.requireUser();
      const vista = users.setPhoto(yo.uid, url || null);
      notify('foto de perfil');
      return { ok: true, usuario: vista };
    }));

    ipcMain.handle('test:seedIdentity', guard((entradas) => {
      const tabla = new Map();
      /*
       * Por correo, además de por uid: quien se autoriza como profesor
       * DENTRO de una prueba (bootstrap, o una solicitud recién aprobada) usa
       * un uid que el propio SDK falso genera en el momento -la prueba no lo
       * conoce de antemano, así que no puede sembrarlo por uid antes de que
       * exista-. El correo sí se conoce antes de registrarse.
       */
      const porCorreo = new Map();
      let offline = false;
      for (const e of (Array.isArray(entradas) ? entradas : [])) {
        if (e && e.offline) { offline = true; continue; }
        const fila = { role: e && e.role === 'teacher' ? 'teacher' : 'student', email: (e && e.email) || (e && e.correo) || '' };
        if (e && e.uid) tabla.set(String(e.uid), fila);
        if (e && e.correo) porCorreo.set(String(e.correo).trim().toLowerCase(), fila);
      }
      roleVerify.setStub((datos) => {
        if (offline) return { ok: false, offline: true, error: 'sin conexión (prueba)' };
        const uid = String(datos.idToken || '').replace(/^fake:/, '');
        if (!uid) return { ok: false, rechazado: true, error: 'token vacío' };
        const correo = datos.email ? String(datos.email).trim().toLowerCase() : '';
        const fila = tabla.get(uid) || (correo ? porCorreo.get(correo) : null);
        return {
          ok: true,
          uid: uid,
          email: (fila && fila.email) || datos.email || '',
          role: fila ? fila.role : 'student',
          verifiedAt: new Date().toISOString()
        };
      });
      return { ok: true, cuentas: tabla.size, offline: offline };
    }));

    /*
     * Borra por completo, en SQLite local, a alguien creado dentro de una
     * prueba que necesita quedar aislada de las demás -el caso de quien se
     * registra como el primer profesor de la instalación (bootstrap): si su
     * cuenta se queda, es LA MÁS ANTIGUA con el rol verificado para siempre,
     * y "el profesor más antiguo es el dueño" (migrarACursos) elegiría a esa
     * cuenta de prueba en vez de a la que cada prueba posterior espera.
     * Sin pasar por users.remove(): esa función a propósito no deja borrar
     * al único profesor que queda, justo lo que aquí hace falta poder hacer.
     */
    ipcMain.handle('test:olvidarCuentaDePrueba', guard((uid) => {
      db.run('DELETE FROM course_members WHERE uid = ?', [uid]);
      db.run('DELETE FROM courses WHERE teacherId = ?', [uid]);
      db.run('DELETE FROM sync_queue WHERE ownerUid = ?', [uid]);
      db.run('DELETE FROM users WHERE uid = ?', [uid]);
      return { ok: true };
    }));

    /*
     * Deshace lo ya migrado y vuelve a dejar la base como si esta fuera la
     * PRIMERA vez que se abre con datos de antes de que existieran los
     * cursos, y entonces corre la migracion de verdad. Sirve para probar
     * `migrarACursos()` sin tener que fabricar un archivo .db aparte.
     */
    ipcMain.handle('test:probarMigracionCursos', guard(() => {
      db.run('DELETE FROM course_members');
      db.run('DELETE FROM courses');
      for (const tabla of ['topics', 'exercises', 'classes', 'challenges', 'submissions', 'session_events', 'user_badges']) {
        db.run('UPDATE ' + tabla + ' SET courseId = NULL');
      }
      db.run("DELETE FROM meta WHERE key IN ('cursosMigradosV1', 'cursoGeneralId')");

      db.migrarACursos();

      const cursoId = db.getMeta('cursoGeneralId');
      return {
        cursoId: cursoId,
        curso: db.get('SELECT * FROM courses WHERE id = ?', [cursoId]),
        miembros: db.all('SELECT uid, role FROM course_members WHERE courseId = ? ORDER BY role, uid', [cursoId]),
        sinCurso: {
          topics: db.get("SELECT COUNT(*) AS n FROM topics WHERE courseId IS NULL OR courseId = ''").n,
          exercises: db.get("SELECT COUNT(*) AS n FROM exercises WHERE courseId IS NULL OR courseId = ''").n,
          submissions: db.get("SELECT COUNT(*) AS n FROM submissions WHERE courseId IS NULL OR courseId = ''").n
        }
      };
    }));
  }

  ipcMain.handle('data:clearSession', guard(() => {
    roleVerify.olvidar();
    users.setActive(null);
    store.setActiveUser(null);
    courses.setActiveCourse(null);
    db.setOwner(null);
    if (ctx.onUserChange) ctx.onUserChange(null);
    return { ok: true };
  }));

  ipcMain.handle('data:me', guard(() => users.active()));

  ipcMain.handle('data:bootstrapInfo', guard(() => ({
    usuariosLocales: users.count(),
    profesoresLocales: users.countTeachers(),
    db: db.info()
  })));

  /* ========================================================= usuarios */

  ipcMain.handle('users:list', guard(() => {
    users.requireTeacher();
    return users.list();
  }));

  ipcMain.handle('users:students', guard(() => {
    users.requireTeacher();
    return users.students();
  }));

  ipcMain.handle('users:updateMe', guard((patch) => {
    const yo = users.requireUser();
    const vista = users.update(yo.uid, patch || {});
    notify('perfil');
    return { ok: true, usuario: vista };
  }));

  ipcMain.handle('users:update', guard((uid, patch) => {
    users.requireTeacher();
    const vista = users.update(uid, patch || {});
    if (!vista) return { ok: false, error: 'La cuenta no existe.' };
    notify('usuarios');
    return { ok: true, usuario: vista };
  }));

  ipcMain.handle('users:setRole', guard((uid, role) => {
    users.requireTeacher();
    const vista = users.setRole(uid, role === 'profesor' ? 'teacher' : role);
    notify('usuarios');
    return { ok: true, usuario: vista };
  }));

  /*
   * Solicitudes de ser profesor DE ESTE CURSO -no de cualquier otro-: solo las
   * ve (y las resuelve) el dueño del curso al que apuntó quien pidió el rol.
   */
  ipcMain.handle('users:solicitudesProfesor', guard(() => {
    const yo = users.requireTeacher();
    const cursoId = courses.requireActiveCourse().id;
    return users.solicitudesDeProfesor(cursoId);
  }));

  ipcMain.handle('users:aprobarSolicitudProfesor', guard((uid) => {
    const yo = users.requireTeacher();
    const cursoId = courses.requireActiveCourse().id;
    const target = users.byUid(uid);
    if (!target || target.teacherRequestedCourseId !== cursoId) {
      return { ok: false, error: 'Esa persona no pidió ser profesor de tu curso.' };
    }
    const res = courses.aprobarSolicitudDeProfesor(cursoId, yo.uid, uid);
    if (!res.ok) return res;
    users.setRole(uid, 'teacher');
    users.setSolicitudProfesor(uid, null);
    notify('usuarios');
    return { ok: true };
  }));

  ipcMain.handle('users:rechazarSolicitudProfesor', guard((uid) => {
    users.requireTeacher();
    const cursoId = courses.requireActiveCourse().id;
    const target = users.byUid(uid);
    // Sin esto, CUALQUIER profesor podía rechazar (a ciegas, solo con
    // adivinar el uid) la solicitud de OTRO curso -no filtraba nada, pero sí
    // dejaba a un aspirante a profesor bloqueado sin que su propio profesor
    // se enterara-. Misma comprobación que ya tiene aprobar.
    if (!target || target.teacherRequestedCourseId !== cursoId) {
      return { ok: false, error: 'Esa persona no pidió ser profesor de tu curso.' };
    }
    const vista = users.setSolicitudProfesor(uid, null);
    notify('usuarios');
    return { ok: true, usuario: vista };
  }));

  ipcMain.handle('users:remove', guard((uid) => {
    const yo = users.requireTeacher();
    if (yo.uid === uid) return { ok: false, error: 'No puedes eliminar tu propia cuenta.' };
    const ok = users.remove(uid);
    notify('usuarios');
    return { ok: ok };
  }));

  ipcMain.handle('users:setTutorialDone', guard((done) => {
    const yo = users.requireUser();
    return { ok: true, usuario: users.update(yo.uid, { tutorialDone: done !== false }) };
  }));

  /* ========================================================= temarios */

  ipcMain.handle('topics:list', guard(() => academic.listTopics()));

  ipcMain.handle('topics:save', guard((datos) => {
    const yo = users.requireTeacher();
    const res = academic.saveTopic(datos || {}, yo.uid);
    if (res.ok) notify('temarios');
    return res;
  }));

  ipcMain.handle('topics:delete', guard((id) => {
    users.requireTeacher();
    const res = academic.deleteTopic(id);
    if (res.ok) notify('temarios');
    return res;
  }));

  ipcMain.handle('topics:seed', guard(() => {
    const yo = users.requireTeacher();
    const res = academic.seedSuggestedTopics(yo.uid);
    notify('temarios');
    return res;
  }));

  /* ======================================================= ejercicios */

  ipcMain.handle('exercises:list', guard(() => academic.listExercises(users.requireUser())));

  ipcMain.handle('exercises:get', guard((id) => {
    const yo = users.requireUser();
    return academic.getExercise(id, yo.role === 'student' ? yo.uid : null);
  }));

  ipcMain.handle('exercises:save', guard((datos) => {
    const yo = users.requireTeacher();
    const res = academic.saveExercise(datos || {}, yo.uid);
    if (res.ok) notify('ejercicios');
    return res;
  }));

  ipcMain.handle('exercises:setStatus', guard((id, status) => {
    users.requireTeacher();
    const res = academic.setExerciseStatus(id, status);
    if (res.ok) notify('ejercicios');
    return res;
  }));

  ipcMain.handle('exercises:delete', guard((id) => {
    users.requireTeacher();
    const res = academic.deleteExercise(id);
    if (res.ok) notify('ejercicios');
    return res;
  }));

  /* =========================================================== cursos */

  ipcMain.handle('courses:mine', guard(() => {
    const yo = users.requireUser();
    return courses.forUser(yo.uid).map(courses.view);
  }));

  ipcMain.handle('courses:active', guard(() => courses.view(courses.activeCourse())));

  ipcMain.handle('courses:create', guard((nombre) => {
    const yo = users.requireTeacher();
    const res = courses.crear(yo.uid, nombre);
    if (res.ok) notify('cursos');
    return res;
  }));

  ipcMain.handle('courses:rename', guard((id, nombre) => {
    const yo = users.requireTeacher();
    const res = courses.renombrar(id, yo.uid, nombre);
    if (res.ok) notify('cursos');
    return res;
  }));

  ipcMain.handle('courses:regenerateCode', guard((id) => {
    const yo = users.requireTeacher();
    const res = courses.regenerarCodigo(id, yo.uid);
    if (res.ok) notify('cursos');
    return res;
  }));

  ipcMain.handle('courses:setStatus', guard((id, estado) => {
    const yo = users.requireTeacher();
    const res = courses.setEstado(id, yo.uid, estado);
    if (res.ok) notify('cursos');
    return res;
  }));

  /*
   * Resuelve un código de curso SIN unirse a él: quien elige "profesor" en el
   * alta necesita saber a qué curso apunta el código antes de decidir nada, y
   * no debe quedar matriculado como estudiante por el simple hecho de
   * consultarlo.
   */
  ipcMain.handle('courses:findByCode', guard((codigo) => {
    /*
     * SIN requireUser() a propósito: a quien está pidiendo ser profesor con
     * un código (auth.js, alta nueva) todavía no se le fijó el usuario activo
     * local -eso pasa después, en data:setSession-, así que exigirlo aquí
     * tiraba la cuenta a mitad de camino con "Debes iniciar sesión." antes de
     * que existiera ninguna sesión que iniciar. No hay nada más sensible que
     * exponer aquí que lo que ya expone traerCursoSiHaceFalta (join-course.js)
     * leyendo el curso completo directo de Firebase un momento antes, sin
     * ningún control local tampoco: solo hace falta haber creado ya la cuenta
     * de Firebase Auth (lo que ya pasó en este punto del alta).
     */
    const curso = courses.byCode(codigo);
    if (!curso || curso.status !== 'active') return { ok: false, error: 'Ese código no corresponde a ningún curso activo.' };
    return { ok: true, curso: courses.view(curso) };
  }));

  ipcMain.handle('courses:joinByCode', guard((codigo) => {
    const yo = users.requireUser();
    const res = courses.unirsePorCodigo(yo.uid, codigo);
    if (res.ok) {
      users.enqueueRosterFanout(yo.uid);
      notify('cursos');
    }
    return res;
  }));

  /*
   * Cambiar el curso activo (un profesor con varios cursos). Solo se puede
   * activar un curso del que se es dueño o miembro — no se puede "entrar" al
   * curso de otra persona escribiendo cualquier id a mano.
   */
  ipcMain.handle('courses:setActive', guard((id) => {
    const yo = users.requireUser();
    const permitido = courses.forUser(yo.uid).some((c) => c.id === id);
    if (!permitido) throw new Error('Ese curso no es tuyo.');
    courses.setActiveCourse(id);
    return courses.view(courses.activeCourse());
  }));

  ipcMain.handle('courses:moveStudent', guard((estudianteUid, cursoDestinoId) => {
    const yo = users.requireTeacher();
    const res = courses.moverEstudiante(estudianteUid, cursoDestinoId, yo.uid);
    if (res.ok) notify('cursos');
    return res;
  }));

  ipcMain.handle('courses:joinCoTeacher', guard((codigo) => {
    const yo = users.requireTeacher();
    const res = courses.unirseComoCoprofesor(yo.uid, codigo);
    if (res.ok) notify('cursos');
    return res;
  }));

  ipcMain.handle('courses:coTeachers', guard((courseId) => {
    const yo = users.requireUser();
    // Sin esto, cualquier usuario autenticado podía pedir la lista de
    // coprofesores de UN CURSO AJENO con solo adivinar su id -un curso no
    // debe transparentar quién lo administra a quien no es de él-.
    if (!courses.membershipRole(courseId, yo.uid)) throw new Error('Ese curso no es tuyo.');
    return courses.coProfesores(courseId);
  }));

  ipcMain.handle('courses:removeCoTeacher', guard((courseId, targetUid) => {
    const yo = users.requireTeacher();
    const res = courses.quitarCoprofesor(courseId, yo.uid, targetUid);
    if (res.ok) notify('cursos');
    return res;
  }));

  ipcMain.handle('courses:delete', guard((id) => {
    const yo = users.requireTeacher();
    const res = courses.eliminar(id, yo.uid);
    if (res.ok) notify('cursos');
    return res;
  }));

  /* ===================================================== grupos (curso) */

  ipcMain.handle('groups:list', guard(() => {
    users.requireUser();
    return groups.list();
  }));

  ipcMain.handle('groups:create', guard((nombre, color) => {
    const yo = users.requireTeacher();
    const res = groups.create(yo.uid, nombre, color);
    if (res.ok) notify('grupos');
    return res;
  }));

  ipcMain.handle('groups:rename', guard((id, nombre) => {
    const yo = users.requireTeacher();
    const res = groups.rename(id, yo.uid, nombre);
    if (res.ok) notify('grupos');
    return res;
  }));

  ipcMain.handle('groups:setMembers', guard((id, uids) => {
    const yo = users.requireTeacher();
    const res = groups.setMembers(id, yo.uid, uids);
    if (res.ok) notify('grupos');
    return res;
  }));

  ipcMain.handle('groups:delete', guard((id) => {
    const yo = users.requireTeacher();
    const res = groups.remove(id, yo.uid);
    if (res.ok) notify('grupos');
    return res;
  }));

  ipcMain.handle('exercises:setTargets', guard((exerciseId, datos) => {
    const yo = users.requireTeacher();
    const res = groups.setTargets(exerciseId, yo.uid, datos || {});
    if (res.ok) {
      const row = db.get('SELECT * FROM exercises WHERE id = ?', [exerciseId]);
      if (row) db.enqueue('exercises', exerciseId, 'upsert', academic.remoteExercise(row));
      notify('ejercicios');
    }
    return res;
  }));

  /* =========================================================== clases */

  ipcMain.handle('classes:list', guard(() => {
    const yo = users.requireUser();
    return yo.role === 'teacher' ? academic.listClasses() : academic.activeClasses(yo.uid);
  }));

  /*
   * "Mis clases" (estudiante): a diferencia de classes:list -que para un
   * estudiante solo devuelve la clase activa EN ESTE INSTANTE-, aqui tambien
   * van las programadas y un puñado de las cerradas recientes. requireUser()
   * y no requireTeacher(): es para cualquiera con sesion, no solo el profesor.
   */
  ipcMain.handle('classes:mine', guard(() => {
    const yo = users.requireUser();
    return academic.studentClasses(yo.uid);
  }));

  ipcMain.handle('classes:save', guard((datos) => {
    const yo = users.requireTeacher();
    const res = academic.saveClass(datos || {}, yo.uid);
    if (res.ok) notify('clases');
    return res;
  }));

  ipcMain.handle('classes:setStatus', guard((id, status) => {
    users.requireTeacher();
    const res = academic.setClassStatus(id, status);
    if (res.ok) notify('clases');
    return res;
  }));

  ipcMain.handle('classes:delete', guard((id) => {
    users.requireTeacher();
    const res = academic.deleteClass(id);
    if (res.ok) notify('clases');
    return res;
  }));

  /* ============================================================ retos */

  ipcMain.handle('challenges:list', guard(() => academic.listChallenges(users.requireUser())));

  ipcMain.handle('challenges:save', guard((datos) => {
    const yo = users.requireTeacher();
    const res = academic.saveChallenge(datos || {}, yo.uid);
    if (res.ok) notify('retos');
    return res;
  }));

  ipcMain.handle('challenges:delete', guard((id) => {
    users.requireTeacher();
    const res = academic.deleteChallenge(id);
    if (res.ok) notify('retos');
    return res;
  }));

  /* ========================================================= entregas */

  ipcMain.handle('submissions:start', guard((exerciseId) => {
    const yo = users.requireUser();
    if (yo.role !== 'student') return { ok: false, error: 'Solo los estudiantes resuelven ejercicios.' };
    const res = work.startAttempt(yo.uid, exerciseId);
    if (res.ok) notify('entregas');
    return res;
  }));

  ipcMain.handle('submissions:saveDraft', guard((id, datos) => {
    const yo = users.requireUser();
    const row = db.get('SELECT studentId FROM submissions WHERE id = ?', [id]);
    if (!row) return { ok: false, error: 'La entrega no existe.' };
    if (row.studentId !== yo.uid) return { ok: false, error: 'Esa entrega no es tuya.' };
    return work.saveDraft(id, datos || {});
  }));

  ipcMain.handle('submissions:submit', guard((id, datos) => {
    const yo = users.requireUser();
    const row = db.get('SELECT studentId FROM submissions WHERE id = ?', [id]);
    if (!row) return { ok: false, error: 'La entrega no existe.' };
    if (row.studentId !== yo.uid) return { ok: false, error: 'Esa entrega no es tuya.' };
    const res = work.submitWork(id, datos || {});
    if (res.ok) notify('entregas');
    return res;
  }));

  ipcMain.handle('submissions:get', guard((id) => {
    const yo = users.requireUser();
    const vista = work.getSubmission(id, { withDetail: true });
    if (!vista) return null;
    if (yo.role !== 'teacher' && vista.studentId !== yo.uid) {
      throw new Error('No puedes ver la entrega de otro estudiante.');
    }
    return vista;
  }));

  ipcMain.handle('submissions:mine', guard((exerciseId) => {
    const yo = users.requireUser();
    return work.listForStudent(yo.uid, exerciseId || null);
  }));

  ipcMain.handle('submissions:review', guard((filtro) => {
    users.requireTeacher();
    return work.listForReview(filtro || {});
  }));

  ipcMain.handle('submissions:counters', guard(() => {
    users.requireTeacher();
    return work.reviewCounters();
  }));

  ipcMain.handle('submissions:setStatus', guard((id, status) => {
    users.requireTeacher();
    const res = work.setStatus(id, status);
    if (res.ok) notify('entregas');
    return res;
  }));

  /*
   * El propio estudiante, al pulsar "Salir" de un ejercicio en curso.
   * Distinto de submissions:setStatus (solo profesor): aquí se comprueba
   * dueño y que siga abierto, para que nadie pueda tocar la entrega de otro
   * ni "abandonar" algo que ya fue entregado o calificado.
   */
  ipcMain.handle('submissions:abandon', guard((id) => {
    const yo = users.requireUser();
    const res = work.abandonByStudent(id, yo.uid);
    if (res.ok) notify('entregas');
    return res;
  }));

  ipcMain.handle('submissions:grade', guard((id, datos) => {
    const yo = users.requireTeacher();
    const res = work.gradeSubmission(id, datos || {}, yo.uid);
    if (res.ok) notify('calificacion');
    return res;
  }));

  ipcMain.handle('submissions:reopen', guard((id, motivo) => {
    const yo = users.requireTeacher();
    const res = work.reopenSubmission(id, motivo, yo.uid);
    if (res.ok) notify('entregas');
    return res;
  }));

  /*
   * Deja una entrega lista para ejecutarse, tal cual la escribio el estudiante.
   *
   * Se escriben TODOS sus archivos en una carpeta temporal, respetando la
   * estructura: asi, si el trabajo esta repartido en varios modulos, los import
   * funcionan solos -Python anade al camino la carpeta del archivo que ejecuta-
   * y el profesor no tiene que copiar nada a mano ni recomponer el proyecto.
   *
   * La carpeta es de usar y tirar: no toca la entrega ni los archivos de nadie.
   */
  ipcMain.handle('submissions:prepare', guard(async (submissionId, entradaPedida) => {
    const yo = users.requireUser();
    const row = db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
    if (!row) return { ok: false, error: 'La entrega ya no existe.' };
    if (yo.role !== 'teacher' && row.studentId !== yo.uid) {
      return { ok: false, error: 'Esta entrega no es tuya.' };
    }

    const lista = db.parseJson(row.files, []) || [];
    const aEscribir = lista.length
      ? lista
      : [{ name: 'main.py', content: row.code || '' }];

    const raizRevision = path.join(store.tmpDir(), 'revision');
    const carpeta = path.join(raizRevision, String(submissionId));
    try {
      fs.rmSync(carpeta, { recursive: true, force: true });
    } catch (err) { /* no existia: mejor */ }

    /*
     * Se barren las copias de dias anteriores. Son de usar y tirar, pero si no
     * se limpian van quedando ahi ocupando sitio en el equipo del profesor.
     */
    try {
      const limite = Date.now() - 24 * 3600 * 1000;
      for (const nombre of fs.readdirSync(raizRevision)) {
        const vieja = path.join(raizRevision, nombre);
        if (fs.statSync(vieja).mtimeMs < limite) fs.rmSync(vieja, { recursive: true, force: true });
      }
    } catch (err) { /* la carpeta puede no existir todavia */ }

    const escritos = await files.writeFileList(carpeta, aEscribir);
    if (!escritos.length) return { ok: false, error: 'La entrega no trae ningún archivo.' };

    const entrada = escritos.find((f) => f.name === entradaPedida) ||
      escritos.find((f) => f.name === row.entryFile) ||
      escritos.find((f) => f.name === 'main.py') ||
      escritos.find((f) => f.name === 'solucion.py') ||
      escritos.find((f) => /\.py$/i.test(f.name)) ||
      escritos[0];

    return {
      ok: true,
      carpeta: carpeta,
      entrada: entrada.path,
      entradaNombre: entrada.name,
      archivos: escritos.map((f) => ({ name: f.name, path: f.path }))
    };
  }));

  /* ================================================ retroalimentacion */

  ipcMain.handle('feedback:list', guard((submissionId) => {
    const yo = users.requireUser();
    const row = db.get('SELECT studentId FROM submissions WHERE id = ?', [submissionId]);
    if (!row) return [];
    if (yo.role !== 'teacher' && row.studentId !== yo.uid) {
      throw new Error('No puedes ver esa retroalimentación.');
    }
    return work.listFeedback(submissionId);
  }));

  ipcMain.handle('feedback:save', guard((datos) => {
    const yo = users.requireTeacher();
    const res = work.saveFeedback(datos || {}, yo.uid);
    if (res.ok) notify('feedback');
    return res;
  }));

  ipcMain.handle('feedback:delete', guard((id) => {
    users.requireTeacher();
    const res = work.deleteFeedback(id);
    notify('feedback');
    return res;
  }));

  /* ========================================================= eventos */

  ipcMain.handle('events:log', guard((datos) => {
    const yo = users.requireUser();
    const d = datos || {};
    return work.logEvent(yo.uid, d.exerciseId, d.submissionId, d.type, d.meta);
  }));

  ipcMain.handle('events:list', guard((filtro) => {
    const yo = users.requireUser();
    const f = Object.assign({}, filtro || {});
    if (yo.role !== 'teacher') f.studentId = yo.uid;
    return work.listEvents(f);
  }));

  /* ======================================================== progreso */

  ipcMain.handle('progress:mine', guard(() => {
    const yo = users.requireUser();
    return {
      progreso: work.progressFor(yo.uid),
      recientes: work.recentActivity(yo.uid, 6)
    };
  }));

  ipcMain.handle('progress:of', guard((studentId) => {
    users.requireTeacher();
    return {
      progreso: work.progressFor(studentId),
      recientes: work.recentActivity(studentId, 10),
      entregas: work.listForStudent(studentId, null)
    };
  }));

  ipcMain.handle('progress:recompute', guard((studentId) => {
    const yo = users.requireUser();
    const objetivo = yo.role === 'teacher' && studentId ? studentId : yo.uid;
    return work.recomputeProgress(objetivo);
  }));

  ipcMain.handle('progress:course', guard(() => {
    users.requireTeacher();
    return work.courseSummary();
  }));

  ipcMain.handle('progress:rankings', guard(() => {
    users.requireUser();
    return work.buildRankings();
  }));

  /* ================================================ fase 4: insignias */

  /*
   * Insignias y premios los escribe SOLO el profesor (requireTeacher). El
   * estudiante puede leer el catalogo activo y su propia vitrina, donde el
   * calculo de "lo que te falta" se hace en local sin escribir nada.
   */

  ipcMain.handle('badges:list', guard(() => {
    const yo = users.requireUser();
    return game.listBadges({ soloActivas: yo.role !== 'teacher' });
  }));

  ipcMain.handle('badges:save', guard((datos) => {
    const yo = users.requireTeacher();
    const out = game.saveBadge(datos || {}, yo.uid);
    if (out.ok) notify('insignias');
    return out;
  }));

  ipcMain.handle('badges:setActive', guard((id, activa) => {
    users.requireTeacher();
    const out = game.setBadgeActive(id, activa);
    if (out.ok) notify('insignias');
    return out;
  }));

  ipcMain.handle('badges:seed', guard(() => {
    const yo = users.requireTeacher();
    const out = game.seedCatalog(yo.uid);
    notify('insignias');
    return out;
  }));

  ipcMain.handle('badges:grant', guard((studentId, badgeId, motivo) => {
    const yo = users.requireTeacher();
    const out = game.grant(studentId, badgeId, yo.uid, motivo);
    if (out.ok) notify('insignias');
    return out;
  }));

  ipcMain.handle('badges:revoke', guard((studentId, badgeId) => {
    users.requireTeacher();
    const out = game.revoke(studentId, badgeId);
    notify('insignias');
    return out;
  }));

  ipcMain.handle('badges:mine', guard(() => {
    const yo = users.requireUser();
    return game.showcaseFor(yo.uid);
  }));

  ipcMain.handle('badges:of', guard((studentId) => {
    users.requireTeacher();
    return game.showcaseFor(studentId);
  }));

  ipcMain.handle('badges:holders', guard((badgeId) => {
    users.requireTeacher();
    return game.holders(badgeId || null);
  }));

  ipcMain.handle('badges:evaluate', guard((studentId) => {
    const yo = users.requireTeacher();
    const out = game.evaluate(studentId, yo.uid);
    if (out.nuevas.length) notify('insignias');
    return out;
  }));

  /* ================================================== fase 4: premios */

  ipcMain.handle('rewards:list', guard(() => {
    users.requireUser();
    return game.listRewards();
  }));

  ipcMain.handle('rewards:save', guard((datos) => {
    users.requireTeacher();
    const out = game.saveReward(datos || {});
    if (out.ok) notify('premios');
    return out;
  }));

  ipcMain.handle('rewards:delete', guard((id) => {
    users.requireTeacher();
    const out = game.deleteReward(id);
    notify('premios');
    return out;
  }));

  /* ================================================= fase 4: rankings */

  ipcMain.handle('rankings:config', guard(() => {
    users.requireUser();
    return game.rankingConfig();
  }));

  ipcMain.handle('rankings:setConfig', guard((patch) => {
    users.requireTeacher();
    const out = game.setRankingConfig(patch || {});
    notify('rankings');
    return out;
  }));

  /*
   * Espejo local del limite de puestos que publico el profesor. No escribe en
   * Firebase: solo guarda lo que se acaba de leer de config/rankingLimit.
   */
  ipcMain.handle('rankings:applyConfig', guard((patch) => {
    users.requireUser();
    const limite = Math.max(0, Math.min(500, Math.round(Number(patch && patch.limitePuestos) || 0)));
    db.setMeta('rankingLimit', String(limite));
    return game.rankingConfig();
  }));

  /*
   * Guarda el ranking que llega de Firebase, para poder verlo sin conexion.
   * La clave es el curso de quien lo guarda: con varios cursos en el mismo
   * equipo, cada uno tiene su propia copia y nunca se pisan entre sí.
   */
  ipcMain.handle('rankings:cache', guard((payload) => {
    const yo = users.requireUser();
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'Ranking vacío.' };
    const cursoId = courses.courseIdFor(yo.uid);
    if (!cursoId) return { ok: false, error: 'Sin curso todavía.' };
    db.upsert('ranking_cache', 'id', {
      id: cursoId,
      payload: db.toJson(payload),
      fetchedAt: db.nowIso()
    });
    return { ok: true };
  }));

  /*
   * Ranking listo para pintar.
   *
   * El profesor lo calcula en local (tiene todas las entregas). El estudiante
   * usa la copia descargada del nodo rankings/ de Firebase; si no hay ninguna
   * -primera vez sin conexion- se le dice con honestidad, en vez de mostrar un
   * ranking incompleto hecho solo con sus propios datos.
   *
   * El limite de puestos que ve un estudiante lo fija el profesor, pero su
   * propia posicion se anade siempre.
   */
  ipcMain.handle('rankings:get', guard(() => {
    const yo = users.requireUser();
    const cfg = game.rankingConfig();
    const cursoId = yo.role === 'teacher' ? courses.requireActiveCourse().id : courses.courseIdFor(yo.uid);
    const cache = cursoId ? db.get('SELECT * FROM ranking_cache WHERE id = ?', [cursoId]) : null;

    let datos = null;
    let fuente = 'local';
    let descargadoEn = null;

    if (yo.role === 'teacher') {
      datos = work.buildRankings(cursoId);
      db.upsert('ranking_cache', 'id', { id: cursoId, payload: db.toJson(datos), fetchedAt: db.nowIso() });
      descargadoEn = db.nowIso();
    } else if (cache) {
      datos = db.parseJson(cache.payload, null);
      fuente = 'descargado';
      descargadoEn = cache.fetchedAt;
    }

    if (!datos) {
      return {
        disponible: false,
        motivo: 'Todavía no se ha descargado ningún ranking. Conéctate una vez para verlo.',
        limitePuestos: cfg.limitePuestos,
        yo: null,
        global: [],
        topics: {},
        grades: {}
      };
    }

    const global = Array.isArray(datos.global) ? datos.global : [];
    let miFila = global.find((f) => f.uid === yo.uid) || null;
    let sinClasificar = false;

    /*
     * Un estudiante recien registrado todavia no esta en la copia publicada: el
     * ranking lo publica el profesor al calificar. En vez de dejarlo sin su
     * fila, se calcula con lo que hay en local y se marca como provisional.
     */
    if (!miFila && yo.role !== 'teacher') {
      const miCursoId = courses.courseIdFor(yo.uid);
      const p = miCursoId
        ? db.get("SELECT xp, completed FROM student_progress WHERE studentId = ? AND courseId = ? AND topicId = '*'",
          [yo.uid, miCursoId])
        : null;
      miFila = {
        position: global.length + 1,
        uid: yo.uid,
        name: ((yo.firstName || '') + ' ' + (yo.lastName || '')).trim() || yo.email,
        grade: yo.grade || '',
        color: yo.color || null,
        xp: p ? p.xp : 0,
        completed: p ? p.completed : 0,
        average: null,
        badges: miCursoId
          ? db.get('SELECT COUNT(*) AS n FROM user_badges WHERE studentId = ? AND courseId = ?', [yo.uid, miCursoId]).n
          : 0
      };
      sinClasificar = true;
    }
    const limite = yo.role === 'teacher' ? 0 : cfg.limitePuestos;
    const visibles = limite > 0 ? global.slice(0, limite) : global;

    return {
      disponible: true,
      fuente: fuente,
      actualizadoEn: datos.updatedAt || null,
      descargadoEn: descargadoEn,
      limitePuestos: cfg.limitePuestos,
      total: global.length,
      global: visibles,
      topics: datos.topics || {},
      grades: datos.grades || {},
      yo: miFila,
      yoSinClasificar: sinClasificar,
      yoFueraDeLista: !!(miFila && (sinClasificar || (limite > 0 && miFila.position > limite)))
    };
  }));

  /* ==================================================== sincronizacion */

  ipcMain.handle('sync:pending', guard((limite, soloEstado) => {
    users.requireUser();
    const n = Math.min(100, Math.max(1, Number(limite) || 25));
    // `soloEstado = 'pending'` sirve para no volver a topar en la misma vuelta
    // con lo que las reglas acaban de rechazar.
    const estados = soloEstado === 'pending' ? "('pending')" : "('pending','failed')";
    /*
     * Solo se ofrece lo que ESTA sesion puede subir. Un profesor puede subir
     * cualquier cosa -las reglas se lo permiten-, pero un estudiante solo lo
     * suyo: si intentara subir lo que dejo pendiente otra persona en el mismo
     * computador, las reglas lo rechazarian y ese cambio se perderia de vista.
     *
     * Las operaciones sin dueño son de versiones anteriores: se intentan igual.
     */
    const yo = users.requireUser();
    const filtroDueno = yo.role === 'teacher'
      ? ''
      : " AND (ownerUid = ? OR (ownerUid IS NULL AND status = 'pending'))";
    const params = yo.role === 'teacher' ? [n] : [yo.uid, n];

    // Primero lo urgente (entregas y notas), y dentro de cada prioridad, lo mas
    // antiguo: asi nada se queda atras por haber llegado despues.
    return db.all(
      'SELECT * FROM sync_queue WHERE status IN ' + estados + filtroDueno +
      ' ORDER BY priority, id LIMIT ?', params
    ).map((r) => Object.assign({}, r, { payload: db.parseJson(r.payload, null) }));
  }));

  ipcMain.handle('sync:markDone', guard((ids) => {
    const lista = Array.isArray(ids) ? ids : [ids];
    db.transaction(() => {
      for (const id of lista) {
        db.run("UPDATE sync_queue SET status = 'done', lastError = NULL WHERE id = ?", [Number(id)]);
      }
      // Se conserva un historial corto y se limpia lo viejo ya confirmado.
      db.run("DELETE FROM sync_queue WHERE status = 'done' AND id NOT IN" +
        " (SELECT id FROM sync_queue WHERE status = 'done' ORDER BY id DESC LIMIT 200)");
    });
    return { ok: true, confirmados: lista.length };
  }));

  ipcMain.handle('sync:markFailed', guard((id, error) => {
    db.run("UPDATE sync_queue SET status = 'failed', attempts = attempts + 1, lastError = ? WHERE id = ?",
      [String(error || '').slice(0, 300), Number(id)]);
    return { ok: true };
  }));

  /*
   * Vuelve a poner en la fila lo que fallo. Se usa desde «Estado de la
   * sincronizacion»: si algo se quedo atras por un problema de permisos que ya
   * se arreglo (por ejemplo, se publicaron las reglas), asi se reintenta sin
   * tener que tocar nada por dentro.
   */
  ipcMain.handle('sync:retryFailed', guard(() => {
    const yo = users.requireUser();
    const filtro = yo.role === 'teacher' ? '' : ' AND (ownerUid IS NULL OR ownerUid = ?)';
    const params = yo.role === 'teacher' ? [] : [yo.uid];
    const res = db.run("UPDATE sync_queue SET status = 'pending', lastError = NULL" +
      " WHERE status = 'failed'" + filtro, params);
    return { ok: true, reintentadas: res.changes || 0 };
  }));

  /*
   * Lo que cuenta la barra de estado es lo que ESTA sesion tiene por enviar. Que
   * a otra persona le quedara algo pendiente en este equipo no es asunto suyo.
   */
  ipcMain.handle('sync:stats', guard(() => {
    const yo = users.requireUser();
    if (yo.role === 'teacher') return db.queueStats();
    const filas = db.all(
      'SELECT status, COUNT(*) AS n FROM sync_queue' +
      ' WHERE (ownerUid IS NULL OR ownerUid = ?) GROUP BY status', [yo.uid]);
    const out = { pending: 0, sending: 0, done: 0, failed: 0 };
    for (const r of filas) out[r.status] = r.n;
    return out;
  }));

  /** Vuelca en SQLite lo que llega de Firebase (pull). */
  ipcMain.handle('sync:applyRemote', guard((entidad, registros) => {
    const lista = Array.isArray(registros) ? registros : [];
    let aplicados = 0;
    let conservados = 0;
    // Notas que llegan por primera vez: la interfaz las anuncia al estudiante.
    const calificaciones = [];
    /*
     * uids de estudiantes cuya fila de submissions se tocó de verdad en este
     * lote (no los "conservados"). El profesor recibe en cada sincronización
     * las entregas de TODO su curso -no solo las propias-, así que sin esto
     * el ranking (que lee el XP agregado de student_progress, no de
     * submissions.xpEarned directo) se quedaba desactualizado para cualquier
     * alumno cuya nota llegó por sync en vez de haberse puesto en vivo en
     * este mismo equipo.
     */
    const estudiantesConEntregaTocada = new Set();

    /*
     * Nunca se sobrescribe en silencio un cambio local mas reciente
     * (seccion 29): si lo de aqui esta mas al dia que lo que llega, se
     * conserva y sera la cola quien lo suba.
     */
    const localEsMasNuevo = (tabla, id, remoto) => {
      if (!remoto || !remoto.updatedAt) return false;
      const local = db.get('SELECT updatedAt FROM ' + tabla + ' WHERE id = ?', [id]);
      if (!local || !local.updatedAt) return false;
      return String(local.updatedAt) > String(remoto.updatedAt);
    };

    db.transaction(() => {
      for (const r of lista) {
        if (!r || !r.id) continue;
        const tabla = { topics: 'topics', exercises: 'exercises', classes: 'classes', challenges: 'challenges',
          groups: 'course_groups' }[entidad];
        if (tabla && localEsMasNuevo(tabla, r.id, r)) { conservados++; continue; }
        if (entidad === 'topics') {
          db.upsert('topics', 'id', {
            id: r.id,
            name: r.name || '',
            description: r.description || '',
            orderIndex: Number(r.orderIndex) || 0,
            status: r.status || 'active',
            color: r.color || '#4b8bf5',
            createdBy: r.createdBy || null,
            createdAt: r.createdAt || db.nowIso(),
            updatedAt: r.updatedAt || db.nowIso(),
            syncedAt: db.nowIso()
          });
          aplicados++;
        } else if (entidad === 'exercises') {
          db.upsert('exercises', 'id', {
            id: r.id,
            title: r.title || '',
            description: r.description || '',
            instructions: r.instructions || '',
            topicId: r.topicId || null,
            type: r.type || 'normal',
            difficulty: r.difficulty || 'easy',
            xp: Number(r.xp) || 0,
            maxScore: Number(r.maxScore) || 5,
            timeLimit: Number(r.timeLimit) || 0,
            status: r.status || 'draft',
            createdBy: r.createdBy || null,
            courseId: r.courseId || null,
            createdAt: r.createdAt || db.nowIso(),
            updatedAt: r.updatedAt || db.nowIso(),
            publishedAt: r.publishedAt || null,
            dueDate: r.dueDate || null,
            isClassOnly: r.isClassOnly ? 1 : 0,
            allowLateSubmission: r.allowLateSubmission === false ? 0 : 1,
            maxAttempts: Number(r.maxAttempts) || 0,
            starterCode: r.starterCode || '',
            rubric: db.toJson(academic.normalizarLista(r.rubric)),
            files: db.toJson(academic.normalizarLista(r.files)),
            syncedAt: db.nowIso()
          });
          /*
           * A quién va dirigido (fase 5): viaja embebido en el propio
           * ejercicio -no es una entidad aparte-, así que se aplica aquí. Sin
           * esto, un estudiante en OTRO equipo que el del profesor nunca
           * sabría que un ejercicio es (o deja de ser) solo para su grupo.
           */
          const destino = r.targets && typeof r.targets === 'object' ? r.targets : {};
          db.run('DELETE FROM exercise_targets WHERE exerciseId = ?', [r.id]);
          const ahoraTargets = db.nowIso();
          for (const uid of (Array.isArray(destino.estudiantes) ? destino.estudiantes : [])) {
            db.run('INSERT OR IGNORE INTO exercise_targets(exerciseId, targetType, targetId, createdAt)' +
              " VALUES (?, 'student', ?, ?)", [r.id, uid, ahoraTargets]);
          }
          for (const gid of (Array.isArray(destino.grupos) ? destino.grupos : [])) {
            db.run('INSERT OR IGNORE INTO exercise_targets(exerciseId, targetType, targetId, createdAt)' +
              " VALUES (?, 'group', ?, ?)", [r.id, gid, ahoraTargets]);
          }
          aplicados++;
        } else if (entidad === 'users') {
          const previo = users.byUid(r.id);
          db.upsert('users', 'uid', {
            uid: r.id,
            email: r.email || (previo && previo.email) || '',
            firstName: r.firstName || '',
            lastName: r.lastName || '',
            role: r.role || (previo && previo.role) || 'student',
            grade: r.grade || '',
            groupName: r.groupName || '',
            color: r.color || users.colorFor(r.id),
            photoURL: r.photoURL || null,
            photoUpdatedAt: r.photoURL ? (r.updatedAt || db.nowIso()) : null,
            tutorialDone: previo ? previo.tutorialDone : 0,
            active: r.active === false ? 0 : 1,
            createdAt: r.createdAt || (previo && previo.createdAt) || db.nowIso(),
            updatedAt: r.updatedAt || db.nowIso(),
            lastLoginAt: r.lastLoginAt || (previo && previo.lastLoginAt) || null,
            /*
             * Sin esto, la solicitud pendiente de un aspirante a profesor
             * (escrita directo en courses/$id/roster, ver auth.js) nunca
             * llegaba a la fila local de "users" del profesor dueño del
             * curso -y `solicitudesDeProfesor` la busca justo en SQLite, no
             * en Firebase-. Se toma tal cual venga (incluido null: así se
             * borra sola en cuanto el profesor la aprueba o la rechaza).
             */
            teacherRequestedAt: r.teacherRequestedAt || null,
            teacherRequestedCourseId: r.teacherRequestedCourseId || null,
            syncedAt: db.nowIso()
          });
          aplicados++;
        } else if (entidad === 'groups') {
          db.upsert('course_groups', 'id', {
            id: r.id,
            courseId: r.courseId || null,
            name: r.name || '',
            color: r.color || '#4b8bf5',
            createdAt: r.createdAt || db.nowIso(),
            updatedAt: r.updatedAt || db.nowIso(),
            syncedAt: db.nowIso()
          });
          if (Array.isArray(r.members)) {
            db.run('DELETE FROM course_group_members WHERE groupId = ?', [r.id]);
            for (const uid of r.members) {
              db.run('INSERT OR IGNORE INTO course_group_members(groupId, uid) VALUES (?, ?)', [r.id, uid]);
            }
          }
          aplicados++;
        } else if (entidad === 'classes') {
          db.upsert('classes', 'id', {
            id: r.id,
            title: r.title || '',
            topicId: r.topicId || null,
            teacherId: r.teacherId || null,
            courseId: r.courseId || null,
            status: r.status || 'scheduled',
            startTime: r.startTime || null,
            endTime: r.endTime || null,
            onClosePolicy: r.onClosePolicy || 'allow_finish',
            createdAt: r.createdAt || db.nowIso(),
            updatedAt: r.updatedAt || db.nowIso(),
            syncedAt: db.nowIso()
          });
          if (Array.isArray(r.exerciseIds)) {
            db.run('DELETE FROM class_exercises WHERE classId = ?', [r.id]);
            for (const exId of r.exerciseIds) {
              if (db.get('SELECT id FROM exercises WHERE id = ?', [exId])) {
                db.run('INSERT OR IGNORE INTO class_exercises(classId, exerciseId) VALUES (?, ?)', [r.id, exId]);
              }
            }
          }
          aplicados++;
        } else if (entidad === 'challenges') {
          db.upsert('challenges', 'id', {
            id: r.id,
            title: r.title || '',
            description: r.description || '',
            topicId: r.topicId || null,
            difficulty: r.difficulty || 'hard',
            xp: Number(r.xp) || 0,
            reward: r.reward || '',
            requirements: r.requirements || '',
            startDate: r.startDate || null,
            endDate: r.endDate || null,
            maxAttempts: Number(r.maxAttempts) || 1,
            status: r.status || 'draft',
            exerciseId: r.exerciseId || null,
            createdBy: r.createdBy || null,
            courseId: r.courseId || null,
            createdAt: r.createdAt || db.nowIso(),
            updatedAt: r.updatedAt || db.nowIso(),
            syncedAt: db.nowIso()
          });
          aplicados++;
        } else if (entidad === 'submissions') {
          // Solo se acepta lo que el servidor sabe y el cliente no puede fabricar:
          // nota, XP, comentario y estado de calificacion.
          const local = db.get('SELECT * FROM submissions WHERE id = ?', [r.id]);

          /*
           * Si esta entrega todavia tiene algo esperando en la cola de subida,
           * lo de aqui es MAS NUEVO que lo que hay en Firebase: aplicar el
           * remoto borraria una calificacion recien puesta. Se conserva y sera
           * la cola quien la suba.
           */
          const pendiente = db.get(
            "SELECT id FROM sync_queue WHERE entity = 'submissions' AND entityId = ?" +
            " AND status IN ('pending','sending','failed') LIMIT 1", [r.id]);
          if (local && pendiente) { conservados++; continue; }

          if (local) {
            /*
             * Si la entrega es de OTRA persona (el profesor mirando el trabajo
             * de un estudiante), su contenido manda: puede haber llegado con
             * mas archivos que la primera vez. Sobre lo propio no se toca nada:
             * lo de este equipo es lo mas nuevo.
             */
            const yo = users.getActiveUid();
            if (local.studentId !== yo && (r.code != null || r.files)) {
              db.run('UPDATE submissions SET code = ?, files = ?, entryFile = ?, submittedAt = ?,' +
                ' timeSpentSec = ?, isLate = ? WHERE id = ?',
                [r.code || '', db.toJson(r.files || []), r.entryFile || local.entryFile || null,
                  r.submittedAt || local.submittedAt,
                  Number(r.timeSpentSec) || local.timeSpentSec || 0,
                  r.isLate ? 1 : 0, r.id]);
            }

            const notaNueva = r.grade != null &&
              (local.grade == null || Number(local.grade) !== Number(r.grade) ||
                String(local.gradedAt || '') !== String(r.gradedAt || ''));

            db.run('UPDATE submissions SET grade = ?, xpEarned = ?, teacherComment = ?, status = ?,' +
              ' gradedAt = ?, gradedBy = ?, syncedAt = ? WHERE id = ?',
              [r.grade == null ? null : Number(r.grade), Number(r.xpEarned) || 0,
                r.teacherComment || '', r.status || local.status,
                r.gradedAt || null, r.gradedBy || null, db.nowIso(), r.id]);

            estudiantesConEntregaTocada.add(local.studentId);

            if (notaNueva) {
              const ej = db.get('SELECT title FROM exercises WHERE id = ?', [local.exerciseId]);
              calificaciones.push({
                submissionId: r.id,
                studentId: local.studentId,
                ejercicio: ej ? ej.title : 'Ejercicio',
                nota: Number(r.grade),
                maxScore: r.maxScore != null ? Number(r.maxScore) : (local.maxScore != null ? local.maxScore : 5),
                xp: Number(r.xpEarned) || 0,
                comentario: r.teacherComment || ''
              });
            }
          } else {
            db.upsert('submissions', 'id', {
              id: r.id,
              studentId: r.studentId,
              exerciseId: r.exerciseId,
              attemptNumber: Number(r.attemptNumber) || 1,
              code: r.code || '',
              files: db.toJson(r.files || []),
              entryFile: r.entryFile || null,
              status: r.status || 'submitted',
              startedAt: r.startedAt || null,
              submittedAt: r.submittedAt || null,
              grade: r.grade == null ? null : Number(r.grade),
              maxScore: r.maxScore == null ? null : Number(r.maxScore),
              xpEarned: Number(r.xpEarned) || 0,
              teacherComment: r.teacherComment || '',
              gradedAt: r.gradedAt || null,
              gradedBy: r.gradedBy || null,
              timeSpentSec: Number(r.timeSpentSec) || 0,
              isLate: r.isLate ? 1 : 0,
              classId: r.classId || null,
              courseId: r.courseId || null,
              updatedAt: r.updatedAt || db.nowIso(),
              syncedAt: db.nowIso()
            });
            estudiantesConEntregaTocada.add(r.studentId);
          }
          aplicados++;
        } else if (entidad === 'badges') {
          db.upsert('badges', 'id', {
            id: r.id,
            name: r.name || '',
            description: r.description || '',
            icon: r.icon || 'star',
            color: r.color || '#ffd43b',
            type: r.type === 'auto' ? 'auto' : 'manual',
            rule: db.toJson(r.rule || null),
            xpBonus: Number(r.xpBonus) || 0,
            active: r.active === false ? 0 : 1,
            createdBy: r.createdBy || null,
            createdAt: r.createdAt || db.nowIso(),
            updatedAt: r.updatedAt || db.nowIso(),
            syncedAt: db.nowIso()
          });
          aplicados++;
        } else if (entidad === 'userBadges') {
          if (!r.studentId || !r.badgeId) continue;
          db.upsert('user_badges', ['studentId', 'badgeId'], {
            id: r.id,
            studentId: r.studentId,
            badgeId: r.badgeId,
            courseId: r.courseId || null,
            grantedAt: r.grantedAt || db.nowIso(),
            grantedBy: r.grantedBy || null,
            reason: r.reason || '',
            syncedAt: db.nowIso()
          });
          aplicados++;
        } else if (entidad === 'rewards') {
          db.upsert('rewards', 'id', {
            id: r.id,
            scope: ['global', 'topic', 'challenge'].indexOf(r.scope) !== -1 ? r.scope : 'global',
            topicId: r.topicId || null,
            challengeId: r.challengeId || null,
            position: Number(r.position) || 1,
            badgeId: r.badgeId || null,
            title: r.title || '',
            description: r.description || '',
            active: r.active === false ? 0 : 1,
            createdAt: r.createdAt || db.nowIso(),
            updatedAt: r.updatedAt || db.nowIso(),
            syncedAt: db.nowIso()
          });
          aplicados++;
        } else if (entidad === 'feedback') {
          db.upsert('feedback', 'id', {
            id: r.id,
            submissionId: r.submissionId,
            courseId: r.courseId || null,
            file: r.file || null,
            line: Number(r.line) || 1,
            columnStart: r.columnStart == null ? null : Number(r.columnStart),
            columnEnd: r.columnEnd == null ? null : Number(r.columnEnd),
            type: r.type || 'suggestion',
            message: r.message || '',
            createdBy: r.createdBy || null,
            createdAt: r.createdAt || db.nowIso(),
            resolved: r.resolved ? 1 : 0,
            syncedAt: db.nowIso()
          });
          aplicados++;
        } else if (entidad === 'courses') {
          /*
           * Puede llegar de dos sitios: el arrastre normal del propio curso, o
           * la resolución de un código en otro equipo (join-course.js) antes
           * de intentar la unión local. Nunca se pisa un curso más nuevo con
           * uno más viejo -mismo criterio que el resto de catálogos-.
           */
          if (localEsMasNuevo('courses', r.id, r)) { conservados++; continue; }
          const previo = db.get('SELECT * FROM courses WHERE id = ?', [r.id]);
          db.upsert('courses', 'id', {
            id: r.id,
            name: r.name || (previo && previo.name) || 'Curso',
            teacherId: r.teacherId || (previo && previo.teacherId) || null,
            accessCode: r.accessCode || (previo && previo.accessCode) || '',
            status: r.status || (previo && previo.status) || 'active',
            rankingLimit: r.rankingLimit != null ? Number(r.rankingLimit) : (previo ? previo.rankingLimit : 10),
            createdAt: r.createdAt || (previo && previo.createdAt) || db.nowIso(),
            updatedAt: r.updatedAt || db.nowIso(),
            syncedAt: db.nowIso()
          });
          aplicados++;
        } else if (entidad === 'courseMembers') {
          /*
           * Matrícula que el profesor arrastra de un curso suyo: sin esto, un
           * estudiante que se unió desde OTRO equipo nunca aparecería en
           * course_members aquí -y todo lo que se filtra por curso lo daría
           * por no matriculado, aunque su perfil (roster) sí hubiera llegado.
           */
          db.upsert('course_members', ['courseId', 'uid'], {
            courseId: r.courseId,
            uid: r.uid,
            role: r.role || 'student',
            active: 1,
            joinedAt: r.joinedAt || db.nowIso(),
            syncedAt: db.nowIso()
          });
          aplicados++;
        }
      }
    });
    if (aplicados) {
      const yo = users.getActiveUid();
      if (yo) estudiantesConEntregaTocada.add(yo);
      // Uno por estudiante único, no por entrega: un lote de sincronización
      // de un profesor puede traer entregas de decenas de alumnos distintos.
      for (const uid of estudiantesConEntregaTocada) work.recomputeProgress(uid);
      notify('sincronizacion');
    }
    return { ok: true, aplicados, conservados, calificaciones };
  }));

  /* ============================================================ estado */

  ipcMain.handle('data:info', guard(() => ({
    db: db.info(),
    usuario: users.active(),
    carpetaProyectos: store.workspacesDir()
  })));

  ipcMain.handle('data:wipe', guard((confirmacion) => {
    if (confirmacion !== 'BORRAR TODO') return { ok: false, error: 'Confirmación incorrecta.' };
    users.requireTeacher();
    db.wipe();
    users.setActive(null);
    store.setActiveUser(null);
    notify('reinicio');
    return { ok: true };
  }));

  return {
    notify,
    flush: () => { /* SQLite escribe al vuelo; nada pendiente en memoria */ }
  };
}

module.exports = { register };
