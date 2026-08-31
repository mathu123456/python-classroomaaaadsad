'use strict';
/*
 * Configuracion de Firebase.
 *
 * Los valores por defecto son los del proyecto del colegio. NO son secretos:
 * la apiKey de una app web de Firebase es un identificador publico, va siempre
 * en el cliente y por si sola no da acceso a nada. Lo que protege los datos son
 * las Security Rules (firebase/database.rules.json).
 *
 * Se pueden sobrescribir sin tocar el codigo creando
 * <userData>/firebase.json, util para usar otro proyecto o el emulador.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  apiKey: 'AIzaSyAEknnirKZmndaJkyaFJSuE4JC0rw3_64A',
  authDomain: 'classroom-python-94ff5.firebaseapp.com',
  projectId: 'classroom-python-94ff5',
  storageBucket: 'classroom-python-94ff5.firebasestorage.app',
  messagingSenderId: '477753164744',
  appId: '1:477753164744:web:acf3e5c88f7fb3598976fd',
  // Realtime Database: no venia en el fragmento original y es obligatorio.
  // Comprobado que existe y responde en esta URL.
  databaseURL: 'https://classroom-python-94ff5-default-rtdb.firebaseio.com'
};

const OPCIONES_DEFAULT = {
  enabled: true,          // false = la app trabaja 100% local, sin tocar la red
  emulator: null          // p. ej. { host: '127.0.0.1', authPort: 9099, dbPort: 9000 }
};

function file() {
  return path.join(app.getPath('userData'), 'firebase.json');
}

function read() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (err) {
    return {};
  }
}

function get() {
  const propio = read();
  return {
    config: Object.assign({}, DEFAULTS, propio.config || {}),
    options: Object.assign({}, OPCIONES_DEFAULT, propio.options || {}),
    archivo: file(),
    personalizado: Object.keys(propio).length > 0
  };
}

function set(patch) {
  const actual = read();
  const siguiente = {
    config: Object.assign({}, actual.config || {}, (patch && patch.config) || {}),
    options: Object.assign({}, actual.options || {}, (patch && patch.options) || {})
  };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(siguiente, null, 2), 'utf8');
  fs.renameSync(tmp, file());
  return get();
}

module.exports = { DEFAULTS, get, set, file };
