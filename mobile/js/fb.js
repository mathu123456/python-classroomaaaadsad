/*
 * Firebase para la app móvil.
 *
 * La app de escritorio pide la configuración al proceso principal (window.pc);
 * aquí no hay proceso principal, así que la configuración va en el propio
 * archivo. No es un secreto: la apiKey de una app web de Firebase es un
 * identificador público y lo que protege los datos son las Security Rules
 * (firebase/database.rules.json). Sin ellas publicadas, nada de esto es seguro.
 *
 * Se reutiliza el mismo bundle del SDK que usa el escritorio
 * (src/js/vendor/firebase.js), así que las dos aplicaciones hablan exactamente
 * el mismo idioma con la misma base de datos.
 */

import * as SDK from '../../src/js/vendor/firebase.js';

export const CONFIG = {
  apiKey: 'AIzaSyAEknnirKZmndaJkyaFJSuE4JC0rw3_64A',
  authDomain: 'classroom-python-94ff5.firebaseapp.com',
  projectId: 'classroom-python-94ff5',
  storageBucket: 'classroom-python-94ff5.firebasestorage.app',
  messagingSenderId: '477753164744',
  appId: '1:477753164744:web:acf3e5c88f7fb3598976fd',
  databaseURL: 'https://classroom-python-94ff5-default-rtdb.firebaseio.com'
};

let app = null;
let auth = null;
let db = null;
let listo = false;
let error = null;

/** Traduce los códigos de Firebase a algo que un estudiante entienda. */
export function traducirError(err) {
  const code = String((err && (err.code || err.message)) || '');
  const mapa = {
    'auth/invalid-email': 'El correo no tiene un formato válido.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/wrong-password': 'Correo o contraseña incorrectos.',
    'auth/user-not-found': 'No hay ninguna cuenta con ese correo.',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/too-many-requests': 'Demasiados intentos. Espera un momento.',
    'auth/network-request-failed': 'Sin conexión: no se pudo hablar con Firebase.',
    'auth/operation-not-allowed': 'El acceso con correo y contraseña no está activado en Firebase.'
  };
  for (const [clave, texto] of Object.entries(mapa)) {
    if (code.indexOf(clave) !== -1) return texto;
  }
  if (code.indexOf('PERMISSION_DENIED') !== -1) {
    return 'Firebase rechazó la operación por las reglas de seguridad.';
  }
  return code || 'Error desconocido.';
}

export function init() {
  if (listo) return { ok: true };
  try {
    app = SDK.getApps().length ? SDK.getApp() : SDK.initializeApp(CONFIG);
    auth = SDK.initializeAuth(app, { persistence: SDK.indexedDBLocalPersistence });
    db = SDK.getDatabase(app);
    listo = true;
    return { ok: true };
  } catch (err) {
    error = traducirError(err);
    return { ok: false, error: error };
  }
}

export function estado() {
  return { listo: listo, error: error, online: navigator.onLine, proyecto: CONFIG.projectId };
}

export function usuarioActual() { return auth ? auth.currentUser : null; }

export function onAuth(cb) {
  if (!auth) return () => {};
  return SDK.onAuthStateChanged(auth, cb);
}

/** Espera el primer estado de sesión (o null si no hay). */
export function primerEstado(timeoutMs) {
  return new Promise((resolve) => {
    let hecho = false;
    const fin = (u) => { if (!hecho) { hecho = true; resolve(u); } };
    const quitar = onAuth((u) => { fin(u); try { quitar(); } catch (e) { /* nada */ } });
    setTimeout(() => fin(null), timeoutMs || 8000);
  });
}

export async function entrar(correo, password) {
  const res = await SDK.signInWithEmailAndPassword(auth, String(correo).trim().toLowerCase(), String(password));
  return res.user;
}

export async function registrar(correo, password, nombreCompleto) {
  const res = await SDK.createUserWithEmailAndPassword(auth, String(correo).trim().toLowerCase(), String(password));
  if (nombreCompleto) {
    try { await SDK.updateProfile(res.user, { displayName: nombreCompleto }); } catch (err) { /* no critico */ }
  }
  return res.user;
}

export async function salir() { await SDK.signOut(auth); }

export async function recuperar(correo) {
  await SDK.sendPasswordResetEmail(auth, String(correo).trim().toLowerCase());
}

/* -------------------------------------------------- base de datos */

export async function leer(ruta) {
  const snap = await SDK.dbGet(SDK.ref(db, ruta));
  return snap.exists() ? snap.val() : null;
}

export async function escribir(ruta, valor) {
  await SDK.dbSet(SDK.ref(db, ruta), valor);
  return true;
}

export async function actualizar(ruta, parche) {
  await SDK.dbUpdate(SDK.ref(db, ruta), parche);
  return true;
}

/** Consulta por hijo indexado (la que usan las reglas para las entregas). */
export async function consultarPor(ruta, campo, valor) {
  const q = SDK.query(SDK.ref(db, ruta), SDK.orderByChild(campo), SDK.equalTo(valor));
  const snap = await SDK.dbGet(q);
  return snap.exists() ? snap.val() : null;
}

export function escuchar(ruta, cb, onError) {
  return SDK.onValue(SDK.ref(db, ruta),
    (snap) => cb(snap.exists() ? snap.val() : null),
    (err) => { if (onError) onError(traducirError(err)); });
}

/** Convierte un nodo {id: valor} en lista con el id dentro. */
export function comoLista(objeto) {
  if (!objeto || typeof objeto !== 'object') return [];
  return Object.entries(objeto).map(([id, valor]) =>
    Object.assign({ id: id }, valor && typeof valor === 'object' ? valor : { valor: valor }));
}
