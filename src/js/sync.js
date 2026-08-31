/*
 * Sincronizacion entre SQLite (local) y Firebase Realtime Database.
 *
 * Principios (secciones 7, 8, 22 y 29 del pliego):
 *  - El editor NUNCA escribe en Firebase. Escribe en SQLite.
 *  - Solo los hechos importantes entran en la cola: entrega, calificacion,
 *    publicacion, cambios de estado... El autoguardado se queda en local.
 *  - Nada local se borra hasta que Firebase confirma la escritura.
 *  - Sin conexion la aplicacion sigue funcionando; la cola espera.
 *
 * Aislamiento por curso (fase de "cursos"): todo lo academico -ejercicios,
 * clases, retos, entregas, comentarios, progreso, insignias concedidas,
 * ranking- vive anidado bajo `courses/<id>/...` en vez de en la raiz. El
 * curso lo decide la RUTA, no una condicion que se pueda olvidar: leer
 * `courses/<id>/submissions` sin saber `<id>` no es posible. Lo que sigue
 * siendo global (perfil, rol, catalogo de temas/insignias/premios) es
 * exactamente lo que no es dato de un curso concreto.
 *
 * Empuje (push): cola de SQLite -> Firebase.
 * Arrastre (pull): Firebase -> SQLite, disparado al entrar, cada pocos
 * minutos y cuando cambia una senal ligera.
 */

import * as fb from './firebase.js';

const INTERVALO_PUSH = 15000;
const INTERVALO_PULL = 180000;
const LOTE = 25;

/*
 * Donde vive cada entidad dentro de la Realtime Database.
 *
 * Las que llevan `cursoDe(payload)` viven anidadas bajo el curso al que
 * pertenece ESE dato concreto (el payload ya trae su propio `courseId` desde
 * SQLite); si no lo trajera por lo que sea, se usa el curso activo de la
 * sesion como ultimo recurso, para no perder la operacion.
 */
function cursoDe(payload) {
  return (payload && payload.courseId) || (usuario && usuario.cursoId) || 'sin-curso';
}

const RUTAS = {
  // --- globales: identidad y catalogo compartido por todo el colegio ---
  users: (id) => 'users/' + id,
  roles: (id) => 'roles/' + id,
  topics: (id) => 'topics/' + id,
  badges: (id) => 'badges/' + id,
  rewards: (id) => 'rewards/' + id,
  config: (id) => 'config/' + id,

  // --- el propio curso, y como se resuelve/entra a uno ---
  courses: (id) => 'courses/' + id,
  courseCodes: (id) => 'courseCodes/' + id,
  courseMembers: (id, p) => 'courses/' + cursoDe(p) + '/members/' + id,
  /*
   * Copia del perfil para la lista del profesor: el propio dueño la escribe
   * al sincronizar (id compuesto "<curso>:<uid>", el uid real vive en el
   * payload) para que un profesor NUNCA necesite leer `users/` ajeno.
   */
  courseRoster: (id, p) => 'courses/' + (p && p.courseId) + '/roster/' + (p && p.uid),

  // --- anidado bajo el curso: aqui esta el aislamiento real ---
  groups: (id, p) => 'courses/' + cursoDe(p) + '/groups/' + id,
  exercises: (id, p) => 'courses/' + cursoDe(p) + '/exercises/' + id,
  classes: (id, p) => 'courses/' + cursoDe(p) + '/classes/' + id,
  challenges: (id, p) => 'courses/' + cursoDe(p) + '/challenges/' + id,
  submissions: (id, p) => 'courses/' + cursoDe(p) + '/submissions/' + id,
  feedback: (id, p) => 'courses/' + cursoDe(p) + '/feedback/' + (p && p.submissionId ? p.submissionId : 'huerfanos') + '/' + id,
  gradeHistory: (id, p) => 'courses/' + cursoDe(p) + '/gradeHistory/' + (p && p.submissionId ? p.submissionId : 'huerfanos') + '/' + id,
  sessionEvents: (id, p) => 'courses/' + cursoDe(p) + '/sessionEvents/' + (p && p.studentId ? p.studentId : 'huerfanos') + '/' + id,
  studentProgress: (id, p) => 'courses/' + cursoDe(p) + '/studentProgress/' + id,
  userBadges: (id, p) => 'courses/' + cursoDe(p) + '/userBadges/' + (p && p.studentId ? p.studentId : 'huerfanos') + '/' + id,
  submissionSignals: (id, p) => 'courses/' + cursoDe(p) + '/submissionSignals/' + id
};

/** Cambios que deben avisar al resto DEL MISMO CURSO de que hay novedades. */
const ENTIDADES_PUBLICAS = ['exercises', 'classes', 'challenges'];
/** Cambios del catalogo COMPARTIDO por todo el colegio (rara vez cambian). */
const ENTIDADES_PUBLICAS_GLOBALES = ['topics', 'badges', 'rewards'];

const estado = {
  activo: false,
  trabajando: false,
  pendientes: 0,
  fallidas: 0,
  ultimaSubida: null,
  ultimaBajada: null,
  mensaje: '',
  error: null
};

let usuario = null;          // { uid, role, cursoId }
let quitarConexion = null;   // deja de mirar si hay conexion
let habiaConexion = true;    // para reaccionar solo cuando cambia
let timerPush = null;
let timerPull = null;
let quitarSenal = null;
let quitarSenalCurso = null;
let quitarSenalUsuario = null;
let quitarSenalEntregas = null;
const oyentes = new Set();

/* ------------------------------------------------------------- estado */

function emitir() {
  const copia = Object.assign({}, estado, { conexion: fb.snapshot() });
  for (const cb of oyentes) {
    try { cb(copia); } catch (err) { /* aislado */ }
  }
}

export function onEstado(cb) {
  oyentes.add(cb);
  cb(Object.assign({}, estado, { conexion: fb.snapshot() }));
  return () => oyentes.delete(cb);
}

export function estadoActual() {
  return Object.assign({}, estado, { conexion: fb.snapshot() });
}

/*
 * Cuantas cosas van en camino.
 *
 * Se cuentan las que estan esperando su turno, NO las que fallaron: una
 * operacion que las reglas rechazan no se va a enviar por mucho que se espere, y
 * dejaria la barra en ambar para siempre. Los fallos se ven -con su explicacion y
 * un boton para reintentarlos- en «Estado de la sincronizacion».
 */
async function refrescarPendientes() {
  try {
    const s = await window.pc.sync.stats();
    estado.pendientes = (s.pending || 0) + (s.sending || 0);
    estado.fallidas = s.failed || 0;
  } catch (err) {
    estado.pendientes = 0;
    estado.fallidas = 0;
  }
}

/** Vuelve a intentar lo que se quedo atras (desde el panel de estado). */
export async function reintentarFallidas() {
  const res = await window.pc.sync.retryFailed();
  await refrescarPendientes();
  emitir();
  if (res.reintentadas) await sincronizarAhora();
  return res;
}

function puedeSincronizar() {
  const c = fb.snapshot();
  return !!(usuario && c.disponible && c.habilitado && navigator.onLine);
}

/*
 * Justo despues de entrar, la aplicacion todavia esta terminando de abrir
 * archivos y paneles cuando ya se puede pulsar «Sincronizar ahora». Antes, en
 * ese hueco de unas decimas de segundo, la respuesta era «Sin conexion», que no
 * era verdad: solo era que esta parte aun no sabia quien habia entrado. Ahora se
 * lo pregunta a la sesion y sigue adelante.
 */
async function asegurarUsuario() {
  if (usuario) return usuario;
  try {
    const yo = await window.pc.session.me();
    if (yo && yo.uid) {
      usuario = { uid: yo.uid, role: yo.rol === 'profesor' ? 'teacher' : 'student', cursoId: null };
      estado.activo = true;
      await refrescarCursoActivo();
    }
  } catch (err) { /* sin sesion: no hay nada que sincronizar */ }
  return usuario;
}

/**
 * Refresca de que curso es esta sesion. Se llama al iniciar y cada vez que el
 * profesor cambia de curso activo (varios cursos posibles) o un estudiante se
 * une a uno nuevo.
 */
async function refrescarCursoActivo() {
  if (!usuario) return null;
  try {
    const curso = await window.pc.courses.active();
    // La sesion pudo cerrarse mientras se esperaba la respuesta: `usuario` ya
    // no existe entonces, y no hay cursoId de quien ya no esta.
    if (!usuario) return null;
    usuario.cursoId = curso ? curso.id : null;
  } catch (err) { /* sin sesion o sin curso: se queda como estaba */ }
  return usuario ? usuario.cursoId : null;
}

/** Se llama desde la interfaz cuando el curso activo cambia. */
export async function actualizarCurso() {
  await refrescarCursoActivo();
  detenerSenalesDeCurso();
  iniciarSenalesDeCurso();
}

/* ============================================================== empuje */

/*
 * Las operaciones de sincronizacion van EN FILA, de una en una.
 *
 * Antes, si llegaba una subida mientras habia una descarga en marcha, la subida
 * se descartaba sin mas y lo que estaba en la cola se quedaba ahi hasta la
 * siguiente pasada. Ahora espera su turno: nada se pierde y nunca hay dos
 * hablando con la base a la vez.
 */
let fila = Promise.resolve();

function enFila(fn) {
  const siguiente = fila.then(fn, fn);
  fila = siguiente.catch(() => {});
  return siguiente;
}

/** Vacia la cola local hacia Firebase. Devuelve cuantos elementos subio. */
export function empujar() {
  return enFila(() => empujarAhora());
}

async function empujarAhora() {
  if (!puedeSincronizar()) return 0;
  estado.trabajando = true;
  estado.mensaje = 'Sincronizando…';
  emitir();

  let subidos = 0;
  let rechazados = 0;
  let huboPublico = false;           // catalogo del curso (ejercicios, clases, retos)
  let huboPublicoGlobal = false;     // catalogo compartido (temas, insignias, premios)
  let huboEntregas = false;
  /*
   * Dos listas, no una: `courses/<id>/config/lastChange` solo lo puede escribir
   * el DUEÑO del curso (regla real), así que solo se toca en los cursos donde
   * de verdad cambió el catálogo (ejercicios/clases/retos). Un estudiante
   * entregando su trabajo NO es un cambio de catálogo -mezclar ambos en el
   * mismo conjunto hacía que la entrega de un estudiante intentara ese mismo
   * escritura y las reglas la rechazaran con PERMISSION_DENIED-.
   */
  const cursosConCatalogo = new Set();
  const cursosConEntregas = new Set();
  const afectados = new Set();

  try {
    for (let vuelta = 0; vuelta < 20; vuelta++) {
      const lote = await window.pc.sync.pending(LOTE, rechazados ? 'pending' : null);
      if (!lote.length) break;

      for (const item of lote) {
        const ruta = RUTAS[item.entity];
        if (!ruta) {
          // Entidad desconocida: se marca como hecha para no bloquear la cola.
          await window.pc.sync.markDone(item.id);
          continue;
        }
        try {
          const destino = ruta(item.entityId, item.payload);
          /*
           * courseMembers escribe solo el rol (una cadena): el resto del
           * payload (courseId, uid) es para resolver la RUTA, no para
           * guardarse -Firebase valida ese nodo como texto, no como objeto-.
           * courseRoster lleva ese mismo courseId/uid de más, pero aquí sí
           * guarda un objeto: se descartan esos dos campos y se sube el resto
           * (el perfil, tal cual ya viaja a `users/`).
           */
          let valor;
          if (item.entity === 'courseMembers' && item.payload) {
            valor = item.payload.role;
          } else if (item.entity === 'courseRoster' && item.payload) {
            const { courseId, uid, ...perfil } = item.payload;
            valor = limpiar(perfil);
          } else {
            valor = limpiar(item.payload);
          }

          if (item.op === 'delete') {
            await fb.borrar(destino);
          } else if (item.entity === 'courses') {
            /*
             * PATCH, no reemplazo: `courses/<id>` tiene como hijos `members`,
             * `roster`, `exercises`, `submissions`... Sobrescribir el nodo
             * entero con solo los metadatos (nombre, código...) borraría todo
             * lo demas de un plumazo. Se actualizan solo esos campos.
             */
            await fb.actualizar(destino, valor);
          } else {
            await fb.escribir(destino, valor);
          }
          await window.pc.sync.markDone(item.id);
          subidos++;
          if (ENTIDADES_PUBLICAS.indexOf(item.entity) !== -1) {
            huboPublico = true;
            cursosConCatalogo.add(cursoDe(item.payload));
          }
          if (ENTIDADES_PUBLICAS_GLOBALES.indexOf(item.entity) !== -1) huboPublicoGlobal = true;
          if (item.payload && item.payload.studentId &&
            (item.entity === 'submissions' || item.entity === 'userBadges')) {
            afectados.add(item.payload.studentId);
          }
          if (item.entity === 'submissions') {
            huboEntregas = true;
            cursosConEntregas.add(cursoDe(item.payload));
          }
        } catch (err) {
          const mensaje = fb.traducirError(err);
          await window.pc.sync.markFailed(item.id, mensaje);
          estado.error = mensaje;

          /*
           * Un rechazo por permisos no se arregla reintentando: ese elemento
           * quedaria delante bloqueando la cola para siempre. Se deja marcado
           * como fallido y se sigue con el resto. Un problema de red, en cambio,
           * si es pasajero: se corta la vuelta y se reintenta luego.
           */
          const esPermiso = String((err && err.code) || '').indexOf('PERMISSION_DENIED') !== -1 ||
            /PERMISSION_DENIED|reglas de seguridad/i.test(mensaje);
          if (!esPermiso) throw err;
          rechazados++;
          continue;
        }
      }
    }

    /*
     * Señales ligeras para que los demas equipos DEL MISMO CURSO sepan que hay
     * novedades sin mantener escuchas sobre colecciones enteras. El catalogo
     * compartido (temas/insignias/premios) usa la señal global de siempre,
     * porque cambia para todo el colegio a la vez.
     */
    if (huboPublicoGlobal) {
      try { await fb.escribir('config/lastChange', new Date().toISOString()); } catch (err) { /* no critico */ }
    }
    for (const cursoId of cursosConCatalogo) {
      if (!cursoId || cursoId === 'sin-curso') continue;
      try {
        await fb.escribir('courses/' + cursoId + '/config/lastChange', new Date().toISOString());
      } catch (err) { /* no critico */ }
    }
    for (const uid of afectados) {
      if (uid === usuario.uid) continue;
      try { await fb.escribir('userSignals/' + uid + '/lastChange', new Date().toISOString()); } catch (err) { /* no critico */ }
    }

    /*
     * Si lo que subio fue una entrega, se toca una marca de tiempo que el
     * profesor DE ESE CURSO escucha: asi la ve aparecer en su bandeja al
     * momento, sin esperar la siguiente pasada y sin que nadie tenga que
     * recargar nada.
     */
    if (huboEntregas) {
      for (const cursoId of cursosConEntregas) {
        if (!cursoId || cursoId === 'sin-curso') continue;
        try {
          await fb.escribir('courses/' + cursoId + '/submissionSignals/lastChange', new Date().toISOString());
        } catch (err) { /* no critico */ }
      }
    }

    estado.ultimaSubida = new Date().toISOString();
    estado.error = null;
    estado.mensaje = subidos ? subidos + ' cambio(s) sincronizado(s)' : '';
    if (rechazados) {
      estado.mensaje = (estado.mensaje ? estado.mensaje + ' · ' : '') +
        rechazados + ' rechazado(s) por las reglas';
    }
  } catch (err) {
    estado.mensaje = 'No se pudo sincronizar. Tu trabajo está guardado en este equipo.';
  } finally {
    estado.trabajando = false;
    await refrescarPendientes();
    emitir();
  }
  return subidos;
}

/** Quita nulos y campos locales antes de subir. */
function limpiar(payload) {
  if (payload == null || typeof payload !== 'object') return payload;
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined || v === null) continue;
    if (k === 'syncedAt' || k === 'id') continue;
    out[k] = v;
  }
  return out;
}

/* ============================================================ arrastre */

function comoLista(objeto) {
  if (!objeto || typeof objeto !== 'object') return [];
  return Object.entries(objeto).map(([id, valor]) =>
    Object.assign({ id: id }, valor && typeof valor === 'object' ? valor : { value: valor }));
}

/** Trae de Firebase lo que este usuario necesita y lo vuelca en SQLite. */
export function arrastrar() {
  return enFila(() => arrastrarAhora());
}

async function arrastrarAhora() {
  if (!puedeSincronizar()) return { ok: false, motivo: 'sin conexión' };
  await refrescarCursoActivo();
  const cursoId = usuario.cursoId;
  estado.trabajando = true;
  estado.mensaje = 'Descargando novedades…';
  emitir();

  const resumen = {};
  try {
    /* --- catalogo COMPARTIDO por todo el colegio: temas, insignias, premios --- */
    for (const entidad of ['topics', 'badges', 'rewards']) {
      const lista = comoLista(await fb.leer(entidad));
      if (lista.length) resumen[entidad] = (await window.pc.sync.applyRemote(entidad, lista)).aplicados;
    }

    /* --- el propio curso (por si otro equipo lo actualizo: nombre, código...) --- */
    if (cursoId) {
      const curso = await fb.leer('courses/' + cursoId);
      if (curso) {
        await window.pc.sync.applyRemote('courses', [Object.assign({ id: cursoId }, curso)]);
      }

      /* --- catalogo DEL CURSO: grupos, ejercicios, clases, retos --- */
      for (const entidad of ['groups', 'exercises', 'classes', 'challenges']) {
        const datos = await fb.leer('courses/' + cursoId + '/' + entidad);
        const lista = comoLista(datos);
        if (lista.length) {
          const res = await window.pc.sync.applyRemote(entidad, lista.map((r) => Object.assign({ courseId: cursoId }, r)));
          resumen[entidad] = res.aplicados;
        }
      }

      /*
       * Insignias concedidas. El estudiante lee SOLO su propia rama; el profesor
       * NO se trae userBadges/ entero en cada pasada -eso es lo que pide evitar la
       * seccion 11 de la fase 4-: lo hace bajo demanda, cuando abre el panel de
       * premios (funcion arrastrarInsignias).
       */
      if (usuario.role !== 'teacher') {
        const concedidas = [];
        const mios = (await fb.leer('courses/' + cursoId + '/userBadges/' + usuario.uid)) || {};
        for (const [badgeId, valor] of Object.entries(mios)) {
          concedidas.push(Object.assign({ id: badgeId, studentId: usuario.uid, badgeId: badgeId, courseId: cursoId },
            valor && typeof valor === 'object' ? valor : {}));
        }
        if (concedidas.length) {
          resumen.userBadges = (await window.pc.sync.applyRemote('userBadges', concedidas)).aplicados;
        }
      }

      /* --- ranking publicado: se guarda para poder verlo sin conexion --- */
      try {
        const ranking = await fb.leer('courses/' + cursoId + '/rankings');
        if (ranking) {
          await window.pc.rankings.cache(ranking);
          resumen.rankings = 1;
        }
      } catch (err) { /* sin permiso o sin datos: se ignora */ }

      /* --- limite de puestos que el profesor decidio mostrar --- */
      if (usuario.role !== 'teacher') {
        try {
          const limite = await fb.leer('courses/' + cursoId + '/rankingLimit');
          if (limite != null) await window.pc.rankings.applyConfig({ limitePuestos: Number(limite) });
        } catch (err) { /* no critico */ }
      }
    }

    /* --- perfiles: el profesor los necesita todos los de SU curso --- */
    if (usuario.role === 'teacher' && cursoId) {
      const roster = comoLista(await fb.leer('courses/' + cursoId + '/roster'));
      const roles = (await fb.leer('roles')) || {};
      for (const p of roster) p.role = roles[p.id] || p.role || 'student';
      if (roster.length) resumen.users = (await window.pc.sync.applyRemote('users', roster)).aplicados;

      /*
       * Matrícula: sin esto el profesor tendria el perfil de cada estudiante
       * (roster, arriba) pero ninguna fila local de course_members -y todo lo
       * que se filtra por curso ("Estudiantes y cuentas", estadisticas,
       * ranking...) los daria por no matriculados. Se lee de la misma rama
       * que un estudiante escribe una sola vez al unirse (courses.js).
       */
      const miembros = comoLista(await fb.leer('courses/' + cursoId + '/members'))
        .map((p) => ({ id: p.id, courseId: cursoId, uid: p.id, role: p.role || p.value || 'student' }));
      if (miembros.length) {
        resumen.courseMembers = (await window.pc.sync.applyRemote('courseMembers', miembros)).aplicados;
      }
    }

    /* --- entregas --- */
    let entregas = [];
    if (cursoId) {
      if (usuario.role === 'teacher') {
        // Se traen las mas recientes, no todo el historico (seccion 30).
        const datos = await fb.leer('courses/' + cursoId + '/submissions');
        entregas = comoLista(datos)
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
          .slice(0, 400);
      } else {
        const datos = await fb.consultarPor('courses/' + cursoId + '/submissions', 'studentId', usuario.uid);
        entregas = comoLista(datos);
      }
    }
    if (entregas.length) {
      entregas = entregas.map((e) => Object.assign({ courseId: cursoId }, e));
      const res = await window.pc.sync.applyRemote('submissions', entregas);
      resumen.submissions = res.aplicados;
      /*
       * Notas que acaban de llegar. Solo se anuncian las propias: al profesor no
       * le interesa un aviso por cada nota que el mismo acaba de poner.
       */
      const mias = (res.calificaciones || []).filter((c) => c.studentId === usuario.uid);
      for (const c of mias) avisarCalificacion(c);
    }

    /* --- retroalimentacion: se pide por entrega, no la coleccion entera --- */
    if (cursoId) {
      const conNota = entregas
        .filter((e) => ['graded', 'returned', 'under_review'].indexOf(e.status) !== -1)
        .slice(0, 120);
      const comentarios = [];
      for (const e of conNota) {
        try {
          const datos = await fb.leer('courses/' + cursoId + '/feedback/' + e.id);
          for (const f of comoLista(datos)) {
            comentarios.push(Object.assign({ submissionId: e.id, courseId: cursoId }, f));
          }
        } catch (err) { /* sin permiso o sin datos: se ignora */ }
      }
      if (comentarios.length) {
        resumen.feedback = (await window.pc.sync.applyRemote('feedback', comentarios)).aplicados;
      }
    }

    estado.ultimaBajada = new Date().toISOString();
    estado.error = null;
    estado.mensaje = '';
    return { ok: true, resumen };
  } catch (err) {
    estado.error = fb.traducirError(err);
    estado.mensaje = estado.error;
    return { ok: false, error: estado.error };
  } finally {
    estado.trabajando = false;
    emitir();
  }
}

/**
 * Trae todas las insignias concedidas EN ESTE CURSO. Solo la usa el profesor y
 * solo cuando abre el panel de premios: asi no se descarga userBadges/ entero
 * en cada sincronizacion (seccion 11 de la fase 4).
 */
export async function arrastrarInsignias() {
  if (!puedeSincronizar() || usuario.role !== 'teacher' || !usuario.cursoId) {
    return { ok: false, motivo: 'sin conexión' };
  }
  try {
    const todos = (await fb.leer('courses/' + usuario.cursoId + '/userBadges')) || {};
    const concedidas = [];
    for (const [uid, mapa] of Object.entries(todos)) {
      for (const [badgeId, valor] of Object.entries(mapa || {})) {
        concedidas.push(Object.assign({ id: badgeId, studentId: uid, badgeId: badgeId, courseId: usuario.cursoId },
          valor && typeof valor === 'object' ? valor : {}));
      }
    }
    if (!concedidas.length) return { ok: true, aplicados: 0 };
    const res = await window.pc.sync.applyRemote('userBadges', concedidas);
    return { ok: true, aplicados: res.aplicados };
  } catch (err) {
    return { ok: false, error: fb.traducirError(err) };
  }
}

/** Sube el ranking recalculado DE ESTE CURSO. Solo lo hace el profesor. */
export async function publicarRankings() {
  if (!puedeSincronizar() || usuario.role !== 'teacher' || !usuario.cursoId) return false;
  try {
    /*
     * Escribe DIRECTO a Firebase (no pasa por la cola con prioridades), así
     * que hay que asegurarse de que el propio curso ya llegó allá antes de
     * intentarlo: si se llama justo después de calificar por primera vez en
     * un curso recién creado (por ejemplo la primerísima calificación de un
     * profesor nuevo), `courses/<id>` puede no existir todavía en Firebase
     * -la cola normal lo sube con la prioridad más alta, pero eso no ayuda
     * aquí porque esta escritura no pasa por la cola-, y las reglas
     * rechazarían el ranking con PERMISSION_DENIED aunque el profesor sí sea
     * el dueño. Vaciar la cola primero (barato si ya estaba vacía) lo evita.
     */
    await empujar();
    const r = await window.pc.progress.rankings();
    await fb.escribir('courses/' + usuario.cursoId + '/rankings', r);
    await window.pc.rankings.cache(r);
    return true;
  } catch (err) {
    estado.error = fb.traducirError(err);
    emitir();
    return false;
  }
}

/* =============================================== avisos a la interfaz */

const oyentesNota = new Set();

/** La interfaz se suscribe para anunciar una calificacion recien llegada. */
export function onCalificacion(cb) {
  oyentesNota.add(cb);
  return () => oyentesNota.delete(cb);
}

function avisarCalificacion(datos) {
  for (const cb of oyentesNota) {
    try { cb(datos); } catch (err) { /* aislado */ }
  }
}

/*
 * Arrastre con freno: varias senales seguidas (el profesor publica tres notas en
 * diez segundos) no deben provocar tres descargas. Se agrupan en una.
 */
let temporizadorArrastre = null;

function arrastrarPronto(motivo) {
  if (temporizadorArrastre) clearTimeout(temporizadorArrastre);
  temporizadorArrastre = setTimeout(() => {
    temporizadorArrastre = null;
    estado.mensaje = '';
    arrastrar().catch(() => {});
  }, 600);
  if (motivo) estado.ultimaSenal = motivo;
}

/* ============================================================= ciclo */

/** Sincronizacion completa bajo demanda (boton "Sincronizar ahora"). */
export async function sincronizarAhora() {
  await asegurarUsuario();
  if (!puedeSincronizar()) {
    estado.mensaje = usuario
      ? 'Sin conexión: tu trabajo está guardado en este equipo.'
      : '';
    emitir();
    return { ok: false, motivo: usuario ? 'sin conexión' : 'sin sesión' };
  }
  await empujar();
  const res = await arrastrar();
  if (usuario.role === 'teacher') await publicarRankings();
  return res;
}

export async function iniciar(perfil) {
  usuario = perfil ? { uid: perfil.uid, role: perfil.role || (perfil.rol === 'profesor' ? 'teacher' : 'student'), cursoId: null } : null;
  detenerTimers();
  if (!usuario) return;

  estado.activo = true;
  await refrescarPendientes();
  await refrescarCursoActivo();
  emitir();

  // Primera pasada en segundo plano: no bloquea el arranque de la interfaz.
  setTimeout(() => { sincronizarAhora().catch(() => {}); }, 800);

  timerPush = setInterval(() => { empujar().catch(() => {}); }, INTERVALO_PUSH);
  timerPull = setInterval(() => { arrastrar().catch(() => {}); }, INTERVALO_PULL);

  /*
   * Recuperacion automatica: en el momento en que vuelve la conexion se envia lo
   * que quedo esperando, sin aguardar la pasada de cada quince segundos y sin
   * que nadie tenga que pulsar nada. Es lo que se ve cuando el wifi del colegio
   * se cae un rato en medio de una clase.
   */
  habiaConexion = fb.snapshot().conectado !== false;
  quitarConexion = fb.onEstado((c) => {
    const hay = !!(c.disponible && c.habilitado && c.conectado !== false);
    if (hay && !habiaConexion) {
      habiaConexion = true;
      estado.mensaje = 'Sincronizando…';
      emitir();
      sincronizarAhora().catch(() => {});
    } else if (!hay && habiaConexion) {
      habiaConexion = false;
      estado.mensaje = 'Sin conexión: tu trabajo está guardado en este equipo.';
      emitir();
    }
  });
  window.addEventListener('online', alVolverLaRed);

  /*
   * Señales ligeras en vez de escuchar colecciones enteras:
   *
   *   config/lastChange                     cambio algo del catalogo COMPARTIDO
   *   userSignals/<uid>/lastChange           te calificaron o te concedieron algo
   *   courses/<curso>/config/lastChange      cambio el catalogo DE ESTE CURSO
   *   courses/<curso>/submissionSignals/...  alguien entrego (solo el profesor)
   *
   * Con 60 estudiantes son 60 oyentes sobre valores de texto, no colecciones.
   */
  try {
    quitarSenal = fb.escuchar('config/lastChange', (valor) => {
      if (!valor || estado._ultimaSenal === valor) return;
      estado._ultimaSenal = valor;
      arrastrarPronto('novedades del catálogo compartido');
    }, () => {});

    quitarSenalUsuario = fb.escuchar('userSignals/' + usuario.uid + '/lastChange', (valor) => {
      if (!valor || estado._ultimaSenalUsuario === valor) return;
      estado._ultimaSenalUsuario = valor;
      arrastrarPronto('novedades tuyas');
    }, () => {});

    iniciarSenalesDeCurso();
  } catch (err) { /* sin escuchas: quedan los temporizadores */ }
}

/** Las dos señales que dependen de CUÁL es el curso activo ahora mismo. */
function iniciarSenalesDeCurso() {
  if (!usuario || !usuario.cursoId) return;
  const cursoId = usuario.cursoId;
  try {
    quitarSenalCurso = fb.escuchar('courses/' + cursoId + '/config/lastChange', (valor) => {
      if (!valor || estado._ultimaSenalCurso === valor) return;
      estado._ultimaSenalCurso = valor;
      arrastrarPronto('novedades del curso');
    }, () => {});

    if (usuario.role === 'teacher') {
      quitarSenalEntregas = fb.escuchar('courses/' + cursoId + '/submissionSignals/lastChange', (valor) => {
        if (!valor || estado._ultimaSenalEntregas === valor) return;
        estado._ultimaSenalEntregas = valor;
        arrastrarPronto('entregas nuevas');
      }, () => {});
    }
  } catch (err) { /* sin escuchas: quedan los temporizadores */ }
}

function detenerSenalesDeCurso() {
  if (quitarSenalCurso) { quitarSenalCurso(); quitarSenalCurso = null; }
  if (quitarSenalEntregas) { quitarSenalEntregas(); quitarSenalEntregas = null; }
  estado._ultimaSenalCurso = null;
  estado._ultimaSenalEntregas = null;
}

/** El sistema operativo dice que hay red otra vez: se intenta enseguida. */
function alVolverLaRed() {
  if (!usuario) return;
  sincronizarAhora().catch(() => {});
}

function detenerTimers() {
  if (quitarConexion) { quitarConexion(); quitarConexion = null; }
  window.removeEventListener('online', alVolverLaRed);
  if (timerPush) { clearInterval(timerPush); timerPush = null; }
  if (timerPull) { clearInterval(timerPull); timerPull = null; }
  if (quitarSenal) { quitarSenal(); quitarSenal = null; }
  if (quitarSenalUsuario) { quitarSenalUsuario(); quitarSenalUsuario = null; }
  detenerSenalesDeCurso();
  if (temporizadorArrastre) { clearTimeout(temporizadorArrastre); temporizadorArrastre = null; }
}

export function detener() {
  detenerTimers();
  usuario = null;
  estado.activo = false;
  estado.pendientes = 0;
  estado.mensaje = '';
  estado._ultimaSenal = null;
  estado._ultimaSenalUsuario = null;
  emitir();
}

/** Aviso desde la interfaz de que hay algo nuevo que subir. */
export function notificarCambioLocal() {
  refrescarPendientes().then(emitir);
  if (puedeSincronizar() && !estado.trabajando) {
    setTimeout(() => { empujar().catch(() => {}); }, 400);
  }
}

window.addEventListener('online', () => {
  if (estado.activo) setTimeout(() => sincronizarAhora().catch(() => {}), 1200);
});
