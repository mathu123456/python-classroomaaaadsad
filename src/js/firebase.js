/*
 * Cliente de Firebase (autenticacion + Realtime Database).
 *
 * Vive en el renderer porque el SDK necesita el entorno de navegador
 * (IndexedDB para recordar la sesion, WebSocket para la base de datos).
 * El resto de la aplicacion habla con este modulo, nunca con el SDK directo.
 *
 * Reglas de la casa:
 *  - Nada aqui lanza al importarse: si Firebase no esta configurado o no hay
 *    red, la aplicacion sigue funcionando en local y este modulo lo informa.
 *  - La primera vez hay que iniciar sesion con Internet. Despues la sesion
 *    queda guardada y la aplicacion funciona sin conexion hasta cerrar sesion.
 */

import * as SDK from './vendor/firebase.js';

/*
 * Punto de inyeccion para pruebas: en modo desarrollo, si existe
 * window.__pcFakeFirebase se usa ese doble en lugar del SDK real. Sirve para
 * ejercitar de extremo a extremo el registro, los roles y la sincronizacion
 * sin escribir en el proyecto de Firebase del colegio.
 */
let FB = SDK;

/** Se resuelve al arrancar, no al importar, para que las pruebas puedan inyectar. */
function resolverImplementacion() {
  FB = (typeof window !== 'undefined' && window.pc && window.pc.dev && window.__pcFakeFirebase)
    ? window.__pcFakeFirebase
    : SDK;
  return FB;
}

const estado = {
  disponible: false,      // el SDK arranco correctamente
  habilitado: true,       // el usuario no lo desactivo
  conectado: false,       // hay conexion viva con la Realtime Database
  online: navigator.onLine,
  error: null,
  config: null,
  proyecto: null
};

let app = null;
let auth = null;
let database = null;
let listoPromesa = null;
const oyentesEstado = new Set();
const oyentesAuth = new Set();

/* ------------------------------------------------------------- mensajes */

const MENSAJES = {
  'auth/invalid-email': 'El correo no tiene un formato válido.',
  'auth/user-disabled': 'Esta cuenta está desactivada. Habla con tu profesor.',
  'auth/user-not-found': 'No existe ninguna cuenta con ese correo.',
  'auth/wrong-password': 'La contraseña no es correcta.',
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/invalid-login-credentials': 'Correo o contraseña incorrectos.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
  'auth/weak-password': 'La contraseña es demasiado débil (mínimo 6 caracteres).',
  'auth/too-many-requests': 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
  'auth/requires-recent-login': 'Por seguridad, vuelve a iniciar sesión antes de hacer este cambio.',
  'auth/network-request-failed':
    'No se pudo contactar con Firebase. Comprueba tu conexión a Internet.',
  'auth/operation-not-allowed':
    'El acceso con correo y contraseña no está activado en Firebase. ' +
    'Actívalo en Firebase Console → Authentication → Sign-in method → Email/Password.',
  'auth/configuration-not-found':
    'Firebase Authentication no está configurado en este proyecto. ' +
    'Actívalo en Firebase Console → Authentication → Get started → Email/Password.',
  'auth/api-key-not-valid': 'La apiKey de Firebase no es válida. Revisa la configuración.',
  'PERMISSION_DENIED':
    'Firebase rechazó la operación por las reglas de seguridad. ' +
    'Comprueba que has publicado firebase/database.rules.json en tu proyecto.'
};

export function traducirError(err) {
  if (!err) return 'Error desconocido.';
  const code = String(err.code || '').replace('auth/', 'auth/');
  if (MENSAJES[code]) return MENSAJES[code];
  const texto = String(err.message || err);
  for (const clave of Object.keys(MENSAJES)) {
    if (texto.indexOf(clave) !== -1) return MENSAJES[clave];
  }
  if (/permission_denied/i.test(texto)) return MENSAJES.PERMISSION_DENIED;
  if (/network|offline|unavailable/i.test(texto)) {
    return 'Sin conexión con Firebase. Tu trabajo se guarda en este equipo.';
  }
  return texto.replace(/^Firebase:\s*/, '').replace(/\s*\(auth\/[^)]+\)\.?$/, '');
}

/* --------------------------------------------------------------- estado */

function emitirEstado() {
  const copia = snapshot();
  for (const cb of oyentesEstado) {
    try { cb(copia); } catch (err) { /* un oyente roto no rompe el resto */ }
  }
}

export function snapshot() {
  return {
    disponible: estado.disponible,
    habilitado: estado.habilitado,
    conectado: estado.conectado,
    online: estado.online,
    error: estado.error,
    proyecto: estado.proyecto,
    databaseURL: estado.config ? estado.config.databaseURL : null,
    usuario: auth && auth.currentUser
      ? { uid: auth.currentUser.uid, email: auth.currentUser.email, displayName: auth.currentUser.displayName }
      : null
  };
}

export function onEstado(cb) {
  oyentesEstado.add(cb);
  cb(snapshot());
  return () => oyentesEstado.delete(cb);
}

export function onAuth(cb) {
  oyentesAuth.add(cb);
  return () => oyentesAuth.delete(cb);
}

window.addEventListener('online', () => { estado.online = true; emitirEstado(); });
window.addEventListener('offline', () => { estado.online = false; estado.conectado = false; emitirEstado(); });

/* ------------------------------------------------------------- arranque */

/** Inicializa el SDK una sola vez. Nunca lanza: informa por el estado. */
export function init() {
  if (listoPromesa) return listoPromesa;
  listoPromesa = (async () => {
    try {
      resolverImplementacion();
      const cfg = await window.pc.config.firebase();
      estado.config = cfg.config;
      estado.habilitado = cfg.options.enabled !== false;
      estado.proyecto = cfg.config.projectId;

      if (!estado.habilitado) {
        estado.error = 'Firebase está desactivado en la configuración: la app trabaja solo en local.';
        emitirEstado();
        return snapshot();
      }
      if (!cfg.config.apiKey || !cfg.config.databaseURL) {
        estado.error = 'Falta apiKey o databaseURL en la configuración de Firebase.';
        emitirEstado();
        return snapshot();
      }

      app = FB.getApps().length ? FB.getApp() : FB.initializeApp(cfg.config);

      // indexedDBLocalPersistence deja la sesion guardada en el equipo: tras el
      // primer inicio con Internet, la app abre sin conexion.
      auth = FB.initializeAuth(app, {
        persistence: [FB.indexedDBLocalPersistence, FB.browserLocalPersistence, FB.inMemoryPersistence]
      });
      database = FB.getDatabase(app);

      if (cfg.options.emulator && cfg.options.emulator.host) {
        const em = cfg.options.emulator;
        if (em.authPort) FB.connectAuthEmulator(auth, 'http://' + em.host + ':' + em.authPort, { disableWarnings: true });
        if (em.dbPort) FB.connectDatabaseEmulator(database, em.host, em.dbPort);
      }

      // Indicador de conexion real con la base de datos.
      FB.onValue(FB.ref(database, '.info/connected'), (snap) => {
        estado.conectado = snap.val() === true;
        emitirEstado();
      }, () => { estado.conectado = false; emitirEstado(); });

      FB.onAuthStateChanged(auth, (user) => {
        for (const cb of oyentesAuth) {
          try { cb(user); } catch (err) { /* aislado */ }
        }
        emitirEstado();
      });

      estado.disponible = true;
      estado.error = null;
    } catch (err) {
      estado.disponible = false;
      estado.error = traducirError(err);
      console.warn('[firebase] no se pudo inicializar:', err);
    }
    emitirEstado();
    return snapshot();
  })();
  return listoPromesa;
}

function exigirAuth() {
  if (!auth) throw new Error(estado.error || 'Firebase no está disponible en este equipo.');
  return auth;
}

function exigirDb() {
  if (!database) throw new Error(estado.error || 'La base de datos de Firebase no está disponible.');
  return database;
}

/* -------------------------------------------------------- autenticacion */

export function usuarioActual() {
  return auth ? auth.currentUser : null;
}

/** Espera a que el SDK resuelva si hay sesion guardada (una sola vez). */
export function esperarPrimerEstado(timeoutMs) {
  return new Promise((resolve) => {
    if (!auth) return resolve(null);
    let resuelto = false;
    const listo = (user) => {
      if (resuelto) return;
      resuelto = true;
      resolve(user || null);
    };
    const cancelar = FB.onAuthStateChanged(auth, (user) => { cancelar(); listo(user); }, () => listo(null));
    setTimeout(() => listo(auth.currentUser || null), timeoutMs || 6000);
  });
}

export async function entrar(correo, password) {
  const a = exigirAuth();
  const cred = await FB.signInWithEmailAndPassword(a, String(correo).trim(), String(password));
  return cred.user;
}

export async function registrar(correo, password, nombreCompleto) {
  const a = exigirAuth();
  const cred = await FB.createUserWithEmailAndPassword(a, String(correo).trim(), String(password));
  if (nombreCompleto) {
    try { await FB.updateProfile(cred.user, { displayName: nombreCompleto }); } catch (err) { /* opcional */ }
  }
  return cred.user;
}

export async function salir() {
  if (!auth) return;
  await FB.signOut(auth);
}

export async function cambiarPassword(actual, nueva) {
  const a = exigirAuth();
  const user = a.currentUser;
  if (!user) throw new Error('No hay ninguna sesión abierta.');
  const cred = FB.EmailAuthProvider.credential(user.email, String(actual));
  await FB.reauthenticateWithCredential(user, cred);
  await FB.updatePassword(user, String(nueva));
  return true;
}

export async function recuperarPassword(correo) {
  const a = exigirAuth();
  await FB.sendPasswordResetEmail(a, String(correo).trim());
  return true;
}

export async function actualizarNombre(nombreCompleto) {
  const a = exigirAuth();
  if (!a.currentUser) return false;
  await FB.updateProfile(a.currentUser, { displayName: nombreCompleto });
  return true;
}

/* --------------------------------------------------- Realtime Database */

export async function leer(ruta) {
  const d = exigirDb();
  const snap = await FB.dbGet(FB.ref(d, ruta));
  return snap.exists() ? snap.val() : null;
}

export async function escribir(ruta, valor) {
  const d = exigirDb();
  await FB.dbSet(FB.ref(d, ruta), valor);
  return true;
}

export async function actualizar(ruta, parche) {
  const d = exigirDb();
  await FB.dbUpdate(FB.ref(d, ruta), parche);
  return true;
}

export async function borrar(ruta) {
  const d = exigirDb();
  await FB.dbRemove(FB.ref(d, ruta));
  return true;
}

/** Escucha un nodo. Devuelve la funcion para dejar de escuchar. */
export function escuchar(ruta, cb, onError) {
  const d = exigirDb();
  const r = FB.ref(d, ruta);
  const off = FB.onValue(r, (snap) => cb(snap.exists() ? snap.val() : null),
    (err) => { if (onError) onError(err); });
  return () => { try { off(); } catch (e) { /* ya cancelado */ } };
}

/** Consulta por hijo indexado (p. ej. entregas de un estudiante). */
export async function consultarPor(ruta, campo, valor, limite) {
  const d = exigirDb();
  const partes = [FB.orderByChild(campo), FB.equalTo(valor)];
  if (limite) partes.push(FB.limitToLast(limite));
  const snap = await FB.dbGet(FB.query(FB.ref(d, ruta), ...partes));
  return snap.exists() ? snap.val() : null;
}

/**
 * Comprobacion rapida de que el proyecto responde y las reglas dejan leer.
 * Se usa en el panel de diagnostico.
 */
export async function diagnostico() {
  const out = {
    configurado: !!estado.config,
    sdk: estado.disponible,
    online: navigator.onLine,
    conectado: estado.conectado,
    sesion: !!(auth && auth.currentUser),
    lecturaOk: false,
    escrituraOk: false,
    mensaje: estado.error
  };
  if (!estado.disponible) return out;
  try {
    // Una lectura cualquiera que las reglas permiten a cualquier sesion.
    await leer('config/lastChange');
    out.lecturaOk = true;
  } catch (err) {
    out.mensaje = traducirError(err);
    return out;
  }
  const user = usuarioActual();
  if (user) {
    try {
      await escribir('users/' + user.uid + '/lastSeenAt', new Date().toISOString());
      out.escrituraOk = true;
    } catch (err) {
      out.mensaje = traducirError(err);
    }
  }
  return out;
}
