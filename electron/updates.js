'use strict';
/*
 * Actualizaciones (fase 6).
 *
 * QUE HACE HOY
 *   Consulta -solo cuando el usuario lo pide o cuando lo activa en la
 *   configuracion- la ultima publicacion (release) de un repositorio de GitHub
 *   y compara su version con la instalada. Si hay una mas nueva lo dice y ofrece
 *   abrir la pagina de descarga en el navegador. NO descarga ni instala nada por
 *   su cuenta, y por lo tanto nunca puede tocar la base de datos, las
 *   preferencias, los proyectos ni el runtime del usuario.
 *
 * QUE FALTA PARA QUE SEA AUTOMATICA
 *   1. Anadir la dependencia `electron-updater` y el bloque `publish` de
 *      electron-builder apuntando al mismo repositorio (provider: github).
 *   2. Publicar los instaladores como assets de la release, junto con el
 *      `latest.yml` que genera electron-builder.
 *   3. Sustituir `check()` por `autoUpdater.checkForUpdates()` y enganchar los
 *      eventos update-available / download-progress / update-downloaded a los
 *      mismos canales IPC que ya usa la interfaz (updates:event).
 *   4. Firmar el instalador si se quiere evitar el aviso de SmartScreen (queda
 *      fuera del alcance: el pliego excluye la firma de pago).
 *
 * Nada de esto cambia donde viven los datos: SQLite y las preferencias estan en
 * <userData>, fuera de la carpeta de instalacion, asi que una actualizacion no
 * los toca. Ademas, antes de cualquier migracion de esquema se hace una copia
 * (electron/sqlite.js -> backupNow).
 */

const https = require('https');
const { app } = require('electron');
const store = require('./store');

const REPO_DEFECTO = 'python-classroom/python-classroom';

function config() {
  const s = store.getSettings();
  return {
    repo: s.updateRepo || REPO_DEFECTO,
    comprobarAlIniciar: s.updateCheckOnStart === true,
    automaticas: false        // todavia no: ver el comentario de arriba
  };
}

function setConfig(patch) {
  const p = patch || {};
  const cambios = {};
  if (typeof p.repo === 'string') cambios.updateRepo = p.repo.trim().slice(0, 120);
  if (typeof p.comprobarAlIniciar === 'boolean') cambios.updateCheckOnStart = p.comprobarAlIniciar;
  store.setSettings(cambios);
  return config();
}

/** Compara dos versiones tipo 1.2.3. Devuelve 1, 0 o -1. */
function comparar(a, b) {
  const pa = String(a || '0').replace(/^v/, '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').replace(/^v/, '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function pedirJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'PythonClassroom/' + app.getVersion(), Accept: 'application/vnd.github+json' },
      timeout: timeoutMs || 8000
    }, (res) => {
      if (res.statusCode === 404) { res.resume(); reject(new Error('No hay publicaciones en ese repositorio.')); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('GitHub respondió ' + res.statusCode + '.')); return; }
      let cuerpo = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { cuerpo += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(cuerpo)); } catch (err) { reject(new Error('Respuesta ilegible de GitHub.')); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('GitHub no respondió a tiempo.')); });
    req.on('error', reject);
  });
}

/** Comprueba si hay una version mas nueva publicada. Nunca descarga nada. */
async function check() {
  const cfg = config();
  const actual = app.getVersion();
  try {
    const release = await pedirJson('https://api.github.com/repos/' + cfg.repo + '/releases/latest');
    const remota = String(release.tag_name || release.name || '').replace(/^v/, '');
    const hayNueva = comparar(remota, actual) > 0;
    return {
      ok: true,
      actual: actual,
      disponible: remota || null,
      hayNueva: hayNueva,
      publicadaEn: release.published_at || null,
      notas: String(release.body || '').slice(0, 4000),
      url: release.html_url || null,
      repo: cfg.repo,
      automaticas: cfg.automaticas,
      mensaje: hayNueva
        ? 'Hay una versión nueva (' + remota + '). Se descarga desde la página de publicaciones; ' +
          'tus datos, tus proyectos y el runtime no se tocan al actualizar.'
        : 'Ya tienes la versión más reciente publicada.'
    };
  } catch (err) {
    return {
      ok: false,
      actual: actual,
      repo: cfg.repo,
      error: err && err.message ? err.message : String(err),
      mensaje: 'No se pudo comprobar si hay actualizaciones. Puedes seguir trabajando con normalidad.'
    };
  }
}

module.exports = { config, setConfig, check, comparar, REPO_DEFECTO };
