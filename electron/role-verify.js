'use strict';
/*
 * Verificacion del rol en el proceso principal.
 *
 * EL PROBLEMA QUE RESUELVE
 * ------------------------
 * Antes, quien decidia si alguien era profesor era la INTERFAZ: el renderer
 * leia roles/<uid> en Firebase y le pasaba el resultado al proceso principal,
 * que se lo creia. Dos formas de romperlo:
 *
 *   1. Con las herramientas de desarrollo abiertas, cualquiera podia llamar a
 *      window.pc.session.set({ uid, email, remoteRole: 'teacher' }) y quedarse
 *      como profesor en ese equipo: calificar, repartir XP, conceder insignias
 *      y ver la lista completa de cuentas.
 *   2. Borrando la base local, el equipo volvia a "no hay nadie", y la primera
 *      cuenta que entraba se quedaba con el rol que ella misma pidiera.
 *
 * COMO SE RESUELVE
 * ----------------
 * El rol ya no lo dice el renderer: lo comprueba el proceso principal contra
 * Firebase, con el ID token de la sesion y por HTTPS (API REST, sin SDK):
 *
 *   1. accounts:lookup  ->  confirma que el token es valido, que no ha
 *      caducado, que pertenece a ESTE proyecto y de quien es (uid y correo).
 *      La identidad sale del token, no de lo que diga la interfaz.
 *   2. GET roles/<uid>.json?auth=<idToken>  ->  el rol, leido de la fuente de
 *      verdad con los permisos de ese mismo usuario.
 *
 * Sin conexion no se concede nada nuevo: se conserva el ultimo rol que SI se
 * verifico en este equipo (users.roleVerifiedAt). Si la base local se borro, no
 * hay rol verificado que conservar y la sesion entra como estudiante hasta que
 * se pueda comprobar. Es la unica respuesta honesta: un cliente sin red no
 * puede demostrar que alguien es profesor.
 */

const https = require('https');
const firebaseConfig = require('./firebase-config');

const CACHE_MS = 120000;         // no se repregunta el rol en cada pantalla
const TIMEOUT_MS = 8000;

const cache = new Map();         // uid -> { role, email, at }
let stub = null;                 // solo pruebas automatizadas

/** Sustituye la comprobacion real. Se usa unicamente desde las pruebas. */
function setStub(fn) {
  stub = typeof fn === 'function' ? fn : null;
  cache.clear();
  return !!stub;
}

function pedirJson(opciones, cuerpo) {
  return new Promise((resolve, reject) => {
    const req = https.request(opciones, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { texto += c; });
      res.on('end', () => {
        let datos = null;
        try { datos = texto ? JSON.parse(texto) : null; } catch (err) { datos = null; }
        resolve({ status: res.statusCode, datos: datos });
      });
    });
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(new Error('Firebase no respondió a tiempo.')); });
    req.on('error', reject);
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

/** accounts:lookup: de quien es este token. */
async function identidad(idToken, apiKey) {
  const cuerpo = JSON.stringify({ idToken: idToken });
  const res = await pedirJson({
    method: 'POST',
    hostname: 'identitytoolkit.googleapis.com',
    path: '/v1/accounts:lookup?key=' + encodeURIComponent(apiKey),
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo) }
  }, cuerpo);

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const motivo = res.datos && res.datos.error ? res.datos.error.message : 'TOKEN_RECHAZADO';
    const e = new Error(motivo);
    e.rechazado = true;      // el token no vale: no es un problema de red
    throw e;
  }
  if (res.status !== 200 || !res.datos || !Array.isArray(res.datos.users) || !res.datos.users.length) {
    throw new Error('Respuesta inesperada de Firebase Authentication (' + res.status + ').');
  }
  const u = res.datos.users[0];
  return { uid: u.localId, email: (u.email || '').toLowerCase(), deshabilitado: !!u.disabled };
}

/** roles/<uid>: el rol, leido con los permisos del propio usuario. */
async function rolRemoto(uid, idToken, databaseURL) {
  const url = new URL(databaseURL);
  const res = await pedirJson({
    method: 'GET',
    hostname: url.hostname,
    path: '/roles/' + encodeURIComponent(uid) + '.json?auth=' + encodeURIComponent(idToken)
  });
  if (res.status === 401 || res.status === 403) {
    // Las reglas no dejan leer roles/: no se puede afirmar que sea profesor.
    return null;
  }
  if (res.status !== 200) throw new Error('Realtime Database respondió ' + res.status + '.');
  return typeof res.datos === 'string' ? res.datos : null;
}

/**
 * Comprueba identidad y rol.
 *
 * Devuelve:
 *   { ok: true,  uid, email, role, verifiedAt }
 *   { ok: false, rechazado: true,  error }   token invalido o caducado
 *   { ok: false, offline: true,    error }   no se pudo comprobar (red, reglas)
 */
async function verificar(datos) {
  const idToken = datos && datos.idToken ? String(datos.idToken) : '';
  if (!idToken) return { ok: false, rechazado: true, error: 'Falta el token de sesión.' };

  if (stub) return stub({ idToken: idToken, uid: datos.uid, email: datos.email });

  const { config, options } = firebaseConfig.get();
  if (options && options.enabled === false) {
    return { ok: false, offline: true, error: 'Firebase está desactivado en este equipo.' };
  }
  if (!config.apiKey || !config.databaseURL) {
    return { ok: false, offline: true, error: 'Falta la configuración de Firebase.' };
  }

  const enCache = cache.get(datos && datos.uid ? datos.uid : '');
  if (enCache && Date.now() - enCache.at < CACHE_MS && enCache.idToken === idToken) {
    return { ok: true, uid: enCache.uid, email: enCache.email, role: enCache.role, verifiedAt: enCache.verifiedAt };
  }

  try {
    const quien = await identidad(idToken, config.apiKey);
    if (quien.deshabilitado) {
      return { ok: false, rechazado: true, error: 'Esta cuenta está deshabilitada en Firebase.' };
    }
    const rol = await rolRemoto(quien.uid, idToken, config.databaseURL);
    const salida = {
      ok: true,
      uid: quien.uid,
      email: quien.email,
      role: rol === 'teacher' ? 'teacher' : 'student',
      verifiedAt: new Date().toISOString()
    };
    cache.set(salida.uid, Object.assign({ at: Date.now(), idToken: idToken }, salida));
    return salida;
  } catch (err) {
    const mensaje = err && err.message ? err.message : String(err);
    if (err && err.rechazado) return { ok: false, rechazado: true, error: mensaje };
    return { ok: false, offline: true, error: mensaje };
  }
}

function olvidar(uid) {
  if (uid) cache.delete(uid); else cache.clear();
}

module.exports = { verificar, setStub, olvidar, CACHE_MS };
