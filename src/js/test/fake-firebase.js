/*
 * Doble de Firebase en memoria, SOLO para las pruebas automatizadas.
 *
 * Implementa la misma superficie que usa src/js/firebase.js (Authentication y
 * Realtime Database) para poder ejercitar de extremo a extremo el registro, los
 * roles, la cola de sincronizacion y el arrastre de datos sin escribir nada en
 * el proyecto real del colegio.
 *
 * Incluye una version simplificada de las reglas de seguridad, de modo que las
 * pruebas tambien comprueban que un estudiante no puede tocar lo que no debe.
 * No sustituye a probar las reglas reales en Firebase Console.
 */

export function crear(opciones) {
  const opts = opciones || {};
  const cuentas = new Map();      // email -> { uid, email, password, displayName }
  let datos = {};                 // arbol de la Realtime Database
  let actual = null;              // usuario autenticado
  let seq = 0;
  const oyentesAuth = new Set();
  const oyentesValor = new Map(); // ruta -> Set(callback)
  let sinRed = false;
  let retardoMs = 0;      // red lenta simulada

  /* ------------------------------------------------------------- arbol */

  const partes = (ruta) => String(ruta).split('/').filter(Boolean);

  function leerRuta(ruta) {
    let nodo = datos;
    for (const p of partes(ruta)) {
      if (nodo == null || typeof nodo !== 'object') return null;
      nodo = nodo[p];
    }
    return nodo === undefined ? null : nodo;
  }

  function escribirRuta(ruta, valor) {
    const ps = partes(ruta);
    if (!ps.length) { datos = valor; return; }
    let nodo = datos;
    for (let i = 0; i < ps.length - 1; i++) {
      if (nodo[ps[i]] == null || typeof nodo[ps[i]] !== 'object') nodo[ps[i]] = {};
      nodo = nodo[ps[i]];
    }
    if (valor === null) delete nodo[ps[ps.length - 1]];
    else nodo[ps[ps.length - 1]] = JSON.parse(JSON.stringify(valor));
    avisar(ruta);
  }

  function avisar(rutaCambiada) {
    for (const [ruta, cbs] of oyentesValor) {
      if (rutaCambiada === ruta || rutaCambiada.indexOf(ruta + '/') === 0 || ruta.indexOf(rutaCambiada + '/') === 0) {
        const valor = leerRuta(ruta);
        for (const cb of cbs) {
          try { cb({ exists: () => valor != null, val: () => valor }); } catch (e) { /* aislado */ }
        }
      }
    }
  }

  /* ------------------------------------------ reglas (version reducida) */

  function rolDe(uid) { return leerRuta('roles/' + uid); }
  function esProfesor() { return !!actual && rolDe(actual.uid) === 'teacher'; }

  /*
   * Aislamiento por curso: lo academico vive bajo courses/$courseId/... y el
   * curso lo decide la RUTA, no una condicion que se pueda olvidar. Estas dos
   * comprobaciones son el equivalente reducido de lo que hacen las reglas
   * reales en cada nodo anidado (root.child('courses').child($courseId)...).
   */
  function esDuenoDelCurso(courseId) {
    const curso = leerRuta('courses/' + courseId);
    return !!curso && !!actual && curso.teacherId === actual.uid;
  }
  function esMiembroDelCurso(courseId) {
    if (esDuenoDelCurso(courseId)) return true;
    const miembros = leerRuta('courses/' + courseId + '/members') || {};
    return !!actual && Object.prototype.hasOwnProperty.call(miembros, actual.uid);
  }
  function esCoProfesorDelCurso(courseId) {
    const miembros = leerRuta('courses/' + courseId + '/members') || {};
    return !!actual && miembros[actual.uid] === 'co_teacher';
  }

  function permitirEscritura(ruta, valor) {
    if (!actual) return 'Debes iniciar sesión.';
    const ps = partes(ruta);
    const raiz = ps[0];

    if (raiz === 'config' && ps[1] === 'bootstrap') {
      // "Primero en llegar, se lo lleva": una sola vez por instalación, y ni
      // siquiera quien lo puso puede volver a escribirlo despues.
      return !leerRuta('config/bootstrap') ? null : 'PERMISSION_DENIED: ya hay alguien';
    }

    if (raiz === 'config') {
      // Global: solo el catalogo COMPARTIDO (temas, insignias, premios).
      return esProfesor() ? null : 'PERMISSION_DENIED: solo el profesor';
    }

    if (raiz === 'roles') {
      const uid = ps[1];
      if (esProfesor()) return null;
      if (uid !== actual.uid) return 'PERMISSION_DENIED: no puedes cambiar el rol de otro';
      if (leerRuta('roles/' + uid)) return 'PERMISSION_DENIED: tu rol ya está fijado';
      // Un alta solo puede declararse estudiante. Profesor: solo si ya
      // reclamó el bootstrap con su propio uid (es el primero de la instalación).
      if (valor === 'student') return null;
      if (valor === 'teacher' && leerRuta('config/bootstrap') === actual.uid) return null;
      return 'PERMISSION_DENIED: el rol de profesor se autoriza en Firebase';
    }

    if (raiz === 'users') {
      // Perfil GLOBAL: ya no lo escribe "cualquier profesor", solo el dueño.
      return ps[1] === actual.uid ? null : 'PERMISSION_DENIED';
    }

    if (raiz === 'userSignals') {
      // Global, no de un curso: solo dice "te calificaron o te concedieron
      // algo", sin identificar de qué curso -no hace falta aislarlo por curso,
      // y aislarlo complicaría el oyente sin ganar nada (ver sync.js:643).
      const uid = ps[1];
      return (uid === actual.uid || esProfesor()) ? null : 'PERMISSION_DENIED';
    }

    if (['topics', 'badges', 'rewards'].indexOf(raiz) !== -1) {
      return esProfesor() ? null : 'PERMISSION_DENIED: solo el profesor';
    }

    if (raiz === 'courseCodes') {
      const code = ps[1];
      if (!esProfesor()) return 'PERMISSION_DENIED: solo el profesor';
      if (leerRuta('courseCodes/' + code)) return 'PERMISSION_DENIED: código ya usado';
      if (!esDuenoDelCurso(valor)) return 'PERMISSION_DENIED: no eres el dueño de ese curso';
      return null;
    }

    if (raiz === 'courses') {
      const courseId = ps[1];
      const campo = ps[2];

      /*
       * `courses` se sube siempre como un PATCH del nodo entero (fb.actualizar
       * en sync.js: sobrescribir courses/<id> completo borraría members/
       * roster/exercises...), así que aquí `campo` viene undefined y `valor`
       * es el objeto con todos los metadatos a la vez -igual que una
       * actualización multi-ruta de verdad, que Firebase evalúa campo por
       * campo-. Se valida cada uno con la misma regla granular de abajo; los
       * demás campos (members, roster, exercises...) nunca llegan así -cada
       * uno es su propia entidad, con su propia ruta puntual- así que solo
       * hace falta cubrir los metadatos aquí.
       */
      if (!campo && valor && typeof valor === 'object') {
        const METADATOS = ['teacherId', 'name', 'accessCode', 'status', 'rankingLimit', 'createdAt', 'updatedAt'];
        /*
         * OJO con el orden: si el curso es NUEVO, `teacherId` viene en el
         * MISMO parche que `name`/`accessCode`/etc, y todavia no esta escrito
         * en el arbol -así que comprobar cada campo por separado contra el
         * arbol de ANTES del parche (como hace `leerRuta`) rechazaría los
         * demas campos aunque el parche entero sea legitimo-. Firebase de
         * verdad evalúa una actualización multi-ruta contra el arbol
         * RESULTANTE completo, no campo a campo contra el de antes; aquí se
         * imita calculando primero quién va a quedar de dueño CON este mismo
         * parche aplicado.
         */
        const dueñoActual = leerRuta('courses/' + courseId + '/teacherId');
        const trae = Object.prototype.hasOwnProperty.call(valor, 'teacherId');
        if (trae) {
          if (!esProfesor()) return 'PERMISSION_DENIED: solo el profesor';
          const ok = dueñoActual == null ? valor.teacherId === actual.uid : valor.teacherId === dueñoActual;
          if (!ok) return 'PERMISSION_DENIED: el curso ya tiene dueño';
        }
        const dueñoResultante = trae ? valor.teacherId : dueñoActual;
        if (dueñoResultante !== actual.uid) return 'PERMISSION_DENIED: solo el dueño del curso';
        for (const clave of Object.keys(valor)) {
          if (METADATOS.indexOf(clave) === -1) return 'PERMISSION_DENIED';
        }
        return null;
      }

      /*
       * Borrar el curso ENTERO (courses.eliminar en el proceso principal: se
       * llega aquí con `campo` undefined y `valor === null`, ruta
       * "courses/$courseId" sin más). No es el mismo caso que el parche de
       * arriba -ese exige un objeto-, así que necesita su propia rama: igual
       * que la regla real añadida a nivel de "$courseId" en
       * database.rules.json, solo el dueño puede tirar el nodo completo.
       */
      if (!campo && valor === null) {
        return esDuenoDelCurso(courseId) ? null : 'PERMISSION_DENIED: solo el dueño del curso';
      }

      if (campo === 'teacherId' || ['name', 'accessCode', 'status', 'rankingLimit', 'createdAt', 'updatedAt']
        .indexOf(campo) !== -1) {
        return permitirMetadatoDeCurso(courseId, campo, valor);
      }
      if (campo === 'members') {
        const uid = ps[3];
        if (esDuenoDelCurso(courseId)) return null;
        if (uid === actual.uid && !leerRuta(ruta) && valor === 'student') return null;
        return 'PERMISSION_DENIED';
      }
      if (campo === 'roster') {
        const uid = ps[3];
        return (uid === actual.uid || esDuenoDelCurso(courseId)) ? null : 'PERMISSION_DENIED';
      }
      if (campo === 'groups') {
        return esDuenoDelCurso(courseId) ? null : 'PERMISSION_DENIED: solo el profesor';
      }
      if (campo === 'config') {
        return esDuenoDelCurso(courseId) ? null : 'PERMISSION_DENIED: solo el profesor';
      }
      if (['exercises', 'classes', 'challenges', 'studentProgress', 'gradeHistory',
        'feedback', 'userBadges'].indexOf(campo) !== -1) {
        return esDuenoDelCurso(courseId) ? null : 'PERMISSION_DENIED: solo el profesor';
      }
      if (campo === 'sessionEvents') {
        // El propio estudiante registra sus eventos; el profesor también
        // puede (p. ej. REOPENED_BY_TEACHER, escrito desde su sesión).
        const uid = ps[3];
        return (uid === actual.uid || esDuenoDelCurso(courseId)) ? null : 'PERMISSION_DENIED';
      }
      if (campo === 'rankings') {
        return esDuenoDelCurso(courseId) ? null : 'PERMISSION_DENIED: solo el profesor';
      }
      if (campo === 'submissionSignals') {
        // Marca de tiempo sin datos: cualquier miembro del curso puede avisar.
        return esMiembroDelCurso(courseId) ? null : 'PERMISSION_DENIED';
      }
      if (campo === 'submissions') {
        return permitirEscrituraEntrega(courseId, ruta, valor);
      }
      return 'PERMISSION_DENIED';
    }

    return 'PERMISSION_DENIED';
  }

  /** Una sola clave de metadatos de `courses/<id>` (ver el llamador arriba). */
  function permitirMetadatoDeCurso(courseId, campo, valor) {
    if (campo === 'teacherId') {
      if (!esProfesor()) return 'PERMISSION_DENIED: solo el profesor';
      const previo = leerRuta('courses/' + courseId + '/teacherId');
      // Primera vez, o repetir el mismo dueño (un PATCH normal de metadatos
      // reenvía este campo aunque no haya cambiado): ambos se permiten,
      // igual que la regla real.
      if (previo == null) return valor === actual.uid ? null : 'PERMISSION_DENIED';
      return valor === previo ? null : 'PERMISSION_DENIED: el curso ya tiene dueño';
    }
    return esDuenoDelCurso(courseId) ? null : 'PERMISSION_DENIED: solo el dueño del curso';
  }

  function permitirEscrituraEntrega(courseId, ruta, valor) {
    /*
     * Los archivos de la entrega tienen tope, igual que en las reglas de
     * verdad: una entrega es un trabajo de clase, no un disco compartido.
     */
    const lista = valor && valor.files;
    if (Array.isArray(lista)) {
      if (lista.length > 200) return 'PERMISSION_DENIED: demasiados archivos en la entrega';
      for (const f of lista) {
        if (String((f && f.content) || '').length > 200000) {
          return 'PERMISSION_DENIED: un archivo de la entrega es demasiado grande';
        }
      }
    }
    if (esDuenoDelCurso(courseId)) return null;
    const previo = leerRuta(ruta) || {};
    if (previo.studentId && previo.studentId !== actual.uid) return 'PERMISSION_DENIED: no es tu entrega';
    if (valor && valor.studentId !== actual.uid) return 'PERMISSION_DENIED: no es tu entrega';
    // Escribir el nodo entero sin la nota tambien seria borrarla.
    const inmutables = ['grade', 'xpEarned', 'teacherComment', 'gradedAt', 'gradedBy'];
    for (const campo of inmutables) {
      const antes = previo[campo] == null ? null : previo[campo];
      const ahora = valor && valor[campo] != null ? valor[campo] : null;
      if (antes !== ahora) return 'PERMISSION_DENIED: un estudiante no puede tocar ' + campo;
    }
    const permitidos = ['draft', 'in_progress', 'submitted', 'late', 'abandoned'];
    if (valor && permitidos.indexOf(valor.status) === -1) {
      return 'PERMISSION_DENIED: estado no permitido para un estudiante';
    }
    return null;
  }

  function permitirLectura(ruta) {
    if (!actual) return 'Debes iniciar sesión.';
    const ps = partes(ruta);
    const raiz = ps[0];

    if (['topics', 'badges', 'rewards', 'config', 'roles', 'courseCodes'].indexOf(raiz) !== -1) return null;
    if (raiz === 'users') return ps[1] === actual.uid ? null : 'PERMISSION_DENIED';
    if (raiz === 'userSignals') return ps[1] === actual.uid ? null : 'PERMISSION_DENIED';

    if (raiz === 'courses') {
      const courseId = ps[1];
      const campo = ps[2];
      if (!campo) return esMiembroDelCurso(courseId) ? null : 'PERMISSION_DENIED';
      if (campo === 'roster') {
        const uid = ps[3];
        return (uid === actual.uid || esDuenoDelCurso(courseId) || esCoProfesorDelCurso(courseId))
          ? null : 'PERMISSION_DENIED';
      }
      if (['exercises', 'classes', 'challenges', 'groups', 'config',
        'rankings', 'submissionSignals'].indexOf(campo) !== -1) {
        return esMiembroDelCurso(courseId) ? null : 'PERMISSION_DENIED';
      }
      if (campo === 'studentProgress' || campo === 'userBadges') {
        const uid = ps[3];
        return (uid === actual.uid || esDuenoDelCurso(courseId)) ? null : 'PERMISSION_DENIED';
      }
      if (campo === 'sessionEvents') {
        const uid = ps[3];
        return (uid === actual.uid || esDuenoDelCurso(courseId)) ? null : 'PERMISSION_DENIED';
      }
      if (campo === 'feedback' || campo === 'gradeHistory') {
        const sub = leerRuta('courses/' + courseId + '/submissions/' + ps[3]);
        return (sub && sub.studentId === actual.uid) || esDuenoDelCurso(courseId) ? null : 'PERMISSION_DENIED';
      }
      if (campo === 'submissions') {
        if (ps.length === 3) {
          // Lectura llana de toda la colección: solo el dueño (el profesor
          // lista las entregas de su curso sin consulta). Un estudiante debe
          // usar una consulta por su propio studentId (ver permitirConsulta).
          return esDuenoDelCurso(courseId) ? null : 'PERMISSION_DENIED: usa una consulta por studentId';
        }
        const sub = leerRuta(ruta);
        return (!sub || sub.studentId === actual.uid || esDuenoDelCurso(courseId)) ? null : 'PERMISSION_DENIED';
      }
      /*
       * Cualquier otro campo (members, metadatos sueltos como name/status...)
       * no tiene una regla propia más estrecha ni en las reglas reales ni
       * aquí: en Firebase de verdad esas lecturas HEREDAN la regla del nodo
       * padre (courses/$courseId), que es "dueño o miembro". Sin este
       * fallback, members/ -que el profesor necesita leer para matricular a
       * quien se unió desde otro equipo- se rechazaría siempre.
       */
      return esMiembroDelCurso(courseId) ? null : 'PERMISSION_DENIED';
    }

    return 'PERMISSION_DENIED';
  }

  /**
   * Permiso para una consulta (orderByChild + equalTo), que es distinto de
   * leer un registro suelto: aquí sí importa CUÁL es el campo consultado. Hoy
   * solo existe una consulta real en toda la app -las entregas propias de un
   * estudiante-, así que se resuelve ese caso y se cae al criterio normal
   * para cualquier otro.
   */
  function permitirConsulta(ruta, consulta) {
    if (!actual) return 'Debes iniciar sesión.';
    const ps = partes(ruta);
    if (ps[0] === 'courses' && ps[2] === 'submissions') {
      const courseId = ps[1];
      if (esDuenoDelCurso(courseId)) return null;
      if (consulta && consulta.campo === 'studentId' && consulta.valor === actual.uid) return null;
      return 'PERMISSION_DENIED: usa una consulta por tu propio studentId';
    }
    return permitirLectura(ruta);
  }

  function fallo(mensaje) {
    const e = new Error(mensaje);
    e.code = mensaje.indexOf('PERMISSION_DENIED') === 0 ? 'PERMISSION_DENIED' : 'error';
    return e;
  }

  /*
   * Los oyentes de «.info/connected»: el Firebase de verdad avisa en cuanto se
   * cae la conexion y en cuanto vuelve, y la aplicacion se apoya en eso para
   * recuperarse sola. El doble tiene que hacer lo mismo o las pruebas no dirian
   * nada de lo que pasa en clase cuando se va el wifi.
   */
  function avisarConexion() {
    const oyentes = oyentesValor.get('.info/connected');
    if (!oyentes) return;
    for (const cb of oyentes) {
      try { cb({ exists: () => true, val: () => !sinRed }); } catch (e) { /* aislado */ }
    }
  }

  async function esperarRetardo() {
    if (!retardoMs) return;
    await new Promise((r) => setTimeout(r, retardoMs));
  }

  function comprobarRed() {
    if (sinRed) {
      const e = new Error('Network error');
      e.code = 'auth/network-request-failed';
      throw e;
    }
  }

  /* ---------------------------------------------------------- superficie */

  const api = {
    /* --- app --- */
    getApps: () => (api._app ? [api._app] : []),
    getApp: () => api._app,
    initializeApp: (cfg) => { api._app = { options: cfg, name: '[DEFAULT]' }; return api._app; },
    deleteApp: () => { api._app = null; },

    /* --- persistencias (no hacen nada en el doble) --- */
    indexedDBLocalPersistence: 'idb',
    browserLocalPersistence: 'local',
    inMemoryPersistence: 'memory',
    connectAuthEmulator: () => {},
    connectDatabaseEmulator: () => {},

    /* --- auth --- */
    initializeAuth: () => api._auth,
    getAuth: () => api._auth,

    onAuthStateChanged: (auth, cb) => {
      oyentesAuth.add(cb);
      setTimeout(() => { try { cb(actual); } catch (e) { /* aislado */ } }, 0);
      return () => oyentesAuth.delete(cb);
    },

    createUserWithEmailAndPassword: async (auth, email, password) => {
      comprobarRed();
      const correo = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) throw fallo('auth/invalid-email');
      if (String(password).length < 6) {
        const e = new Error('weak'); e.code = 'auth/weak-password'; throw e;
      }
      if (cuentas.has(correo)) {
        const e = new Error('en uso'); e.code = 'auth/email-already-in-use'; throw e;
      }
      seq += 1;
      const uid = 'uid_' + seq + '_' + Math.random().toString(36).slice(2, 8);
      // El proceso principal pide un ID token para comprobar el rol; en el doble
      // basta con uno que identifique al usuario ("fake:<uid>").
      const user = { uid: uid, email: correo, displayName: '', getIdToken: async () => 'fake:' + uid };
      cuentas.set(correo, Object.assign({ password: String(password) }, user));
      actual = user;
      emitirAuth();
      return { user };
    },

    signInWithEmailAndPassword: async (auth, email, password) => {
      comprobarRed();
      const correo = String(email).trim().toLowerCase();
      const cuenta = cuentas.get(correo);
      if (!cuenta || cuenta.password !== String(password)) {
        const e = new Error('credenciales'); e.code = 'auth/invalid-credential'; throw e;
      }
      actual = {
        uid: cuenta.uid, email: cuenta.email, displayName: cuenta.displayName,
        getIdToken: async () => 'fake:' + cuenta.uid
      };
      emitirAuth();
      return { user: actual };
    },

    signOut: async () => { actual = null; emitirAuth(); },

    updateProfile: async (user, patch) => {
      const cuenta = cuentas.get(user.email);
      if (cuenta) cuenta.displayName = patch.displayName || '';
      if (actual) actual.displayName = patch.displayName || '';
    },

    updatePassword: async (user, nueva) => {
      comprobarRed();
      if (String(nueva).length < 6) { const e = new Error('weak'); e.code = 'auth/weak-password'; throw e; }
      const cuenta = cuentas.get(user.email);
      if (cuenta) cuenta.password = String(nueva);
    },

    reauthenticateWithCredential: async (user, cred) => {
      comprobarRed();
      const cuenta = cuentas.get(user.email);
      if (!cuenta || cuenta.password !== cred.password) {
        const e = new Error('credenciales'); e.code = 'auth/wrong-password'; throw e;
      }
      return { user };
    },

    sendPasswordResetEmail: async (auth, email) => { comprobarRed(); return true; },

    EmailAuthProvider: {
      credential: (email, password) => ({ email: email, password: String(password) })
    },

    /* --- database --- */
    getDatabase: () => api._db,
    ref: (db, ruta) => ({ _ruta: ruta || '' }),
    child: (r, sub) => ({ _ruta: r._ruta + '/' + sub }),

    dbGet: async (r) => {
      comprobarRed();
      await esperarRetardo();
      if (r._ruta === '.info/connected') return { exists: () => true, val: () => true };
      if (r._consulta) {
        const err = permitirConsulta(r._ruta, r._consulta);
        if (err) throw fallo(err);
        const raiz = leerRuta(r._ruta) || {};
        const out = {};
        for (const [k, v] of Object.entries(raiz)) {
          if (v && v[r._consulta.campo] === r._consulta.valor) out[k] = v;
        }
        return { exists: () => Object.keys(out).length > 0, val: () => out };
      }
      const err = permitirLectura(r._ruta);
      if (err) throw fallo(err);
      const valor = leerRuta(r._ruta);
      return { exists: () => valor != null, val: () => valor };
    },

    dbSet: async (r, valor) => {
      comprobarRed();
      await esperarRetardo();
      const err = permitirEscritura(r._ruta, valor);
      if (err) throw fallo(err);
      escribirRuta(r._ruta, valor);
      return true;
    },

    dbUpdate: async (r, parche) => {
      comprobarRed();
      await esperarRetardo();
      const err = permitirEscritura(r._ruta, parche);
      if (err) throw fallo(err);
      const previo = leerRuta(r._ruta) || {};
      escribirRuta(r._ruta, Object.assign({}, previo, parche));
      return true;
    },

    dbRemove: async (r) => {
      comprobarRed();
      await esperarRetardo();
      const err = permitirEscritura(r._ruta, null);
      if (err) throw fallo(err);
      escribirRuta(r._ruta, null);
      return true;
    },

    dbPush: async (r, valor) => {
      seq += 1;
      const id = 'push_' + seq;
      escribirRuta(r._ruta + '/' + id, valor);
      return { key: id };
    },

    onValue: (r, cb) => {
      if (r._ruta === '.info/connected') {
        if (!oyentesValor.has('.info/connected')) oyentesValor.set('.info/connected', new Set());
        oyentesValor.get('.info/connected').add(cb);
        setTimeout(() => cb({ exists: () => true, val: () => !sinRed }), 0);
        return () => { oyentesValor.get('.info/connected').delete(cb); };
      }
      if (!oyentesValor.has(r._ruta)) oyentesValor.set(r._ruta, new Set());
      oyentesValor.get(r._ruta).add(cb);
      setTimeout(() => {
        const valor = leerRuta(r._ruta);
        cb({ exists: () => valor != null, val: () => valor });
      }, 0);
      return () => { const s = oyentesValor.get(r._ruta); if (s) s.delete(cb); };
    },

    off: () => {},

    query: (r, ...partesConsulta) => {
      const q = Object.assign({}, r);
      for (const p of partesConsulta) {
        if (p && p.tipo === 'orderByChild') q._campo = p.valor;
        if (p && p.tipo === 'equalTo') q._igual = p.valor;
        if (p && p.tipo === 'limitToLast') q._limite = p.valor;
      }
      if (q._campo) q._consulta = { campo: q._campo, valor: q._igual };
      return q;
    },
    orderByChild: (campo) => ({ tipo: 'orderByChild', valor: campo }),
    equalTo: (valor) => ({ tipo: 'equalTo', valor: valor }),
    limitToLast: (n) => ({ tipo: 'limitToLast', valor: n }),
    serverTimestamp: () => new Date().toISOString(),
    goOnline: () => { sinRed = false; avisarConexion(); },
    goOffline: () => { sinRed = true; avisarConexion(); },

    /* --- utilidades para las pruebas --- */
    /*
     * Escribe sin pasar por las reglas: representa lo que hace una persona con
     * acceso a la consola de Firebase (por ejemplo autorizar un profesor en
     * roles/<uid>). Ningun camino de la aplicacion usa esto.
     */
    _sembrar: (ruta, valor) => { escribirRuta(ruta, valor); return true; },
    _volcado: () => JSON.parse(JSON.stringify(datos)),
    _cuentas: () => Array.from(cuentas.values()).map((c) => ({ uid: c.uid, email: c.email })),
    _simularSinRed: (valor) => { sinRed = !!valor; avisarConexion(); return !sinRed; },
    /* Red lenta: cada lectura y cada escritura tardan estos milisegundos. */
    _simularRetardo: (ms) => { retardoMs = Math.max(0, Number(ms) || 0); return retardoMs; },
    _usuarioActual: () => actual,
    _reiniciar: () => { datos = {}; cuentas.clear(); actual = null; }
  };

  api._app = null;
  api._auth = { get currentUser() { return actual; } };
  api._db = { _fake: true };

  function emitirAuth() {
    for (const cb of oyentesAuth) {
      try { cb(actual); } catch (e) { /* aislado */ }
    }
  }

  if (opts.datosIniciales) datos = opts.datosIniciales;
  return api;
}
