#!/usr/bin/env node
/*
 * Prepara el runtime de Python EMBEBIDO de Python Classroom.
 *
 *   Windows : descarga el "Windows embeddable package" oficial de python.org,
 *             lo extrae en python/runtime/win-x64 y le instala pip.
 *   Linux/macOS : descarga un CPython portable (python-build-standalone). Si no
 *             es posible, crea un entorno virtual aislado a partir del python3
 *             del sistema.
 *
 * Uso:
 *   node scripts/setup-python.js            # runtime + paquetes base ligeros
 *   node scripts/setup-python.js --full     # + numpy, pandas, matplotlib
 *   node scripts/setup-python.js --no-packages
 *   node scripts/setup-python.js --force    # reinstala desde cero
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PY_DIR = path.join(ROOT, 'python');
const RUNTIME_DIR = path.join(PY_DIR, 'runtime');
const CACHE_DIR = path.join(PY_DIR, 'cache');

const PY_VERSION = '3.11.9';
const GETPIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes('--force');
const FULL = ARGS.includes('--full');
const NO_PACKAGES = ARGS.includes('--no-packages');

const BASE_PACKAGES = ['pip', 'setuptools', 'wheel', 'rich', 'colorama', 'requests'];
const FULL_PACKAGES = ['numpy', 'pandas', 'matplotlib'];

/* ------------------------------------------------------------------ utiles */

function log(msg) { process.stdout.write(msg + '\n'); }
function step(msg) { log('\n> ' + msg); }
function ok(msg) { log('  [ok] ' + msg); }
function warn(msg) { log('  [!] ' + msg); }

function platformKey() {
  if (process.platform === 'win32') return 'win-' + (process.arch === 'ia32' ? 'x86' : process.arch);
  return process.platform + '-' + process.arch;
}

function targetDir() { return path.join(RUNTIME_DIR, platformKey()); }

function download(url, destFile, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('demasiadas redirecciones: ' + url));
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    const tmp = destFile + '.part';
    const req = https.get(url, { headers: { 'User-Agent': 'PythonClassroom-Setup' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(download(next, destFile, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' al descargar ' + url));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      let lastPct = -1;
      const out = fs.createWriteStream(tmp);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && pct % 10 === 0) {
            lastPct = pct;
            process.stdout.write('  ... ' + pct + '%\r');
          }
        }
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => {
        process.stdout.write('              \r');
        fs.renameSync(tmp, destFile);
        resolve(destFile);
      }));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(180000, () => req.destroy(new Error('timeout de descarga: ' + url)));
  });
}

function fetchJson(url, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('demasiadas redirecciones'));
    const headers = { 'User-Agent': 'PythonClassroom-Setup', Accept: 'application/vnd.github+json' };
    https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchJson(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function run(cmd, args, opts) {
  const res = spawnSync(cmd, args, Object.assign({ stdio: 'inherit' }, opts || {}));
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(cmd + ' salio con codigo ' + res.status);
  return res;
}

function runQuiet(cmd, args, opts) {
  return spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts || {}));
}

function extractArchive(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  // "tar" existe en Windows 10+ (bsdtar) y sabe leer .zip y .tar.gz
  let res = runQuiet('tar', ['-xf', archive, '-C', destDir]);
  if (res.status === 0) return;
  if (process.platform === 'win32') {
    const psCmd = 'Expand-Archive -LiteralPath ' + JSON.stringify(archive) +
      ' -DestinationPath ' + JSON.stringify(destDir) + ' -Force';
    res = runQuiet('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd]);
    if (res.status === 0) return;
  }
  throw new Error('no se pudo extraer ' + path.basename(archive) + ': ' + (res.stderr || res.error));
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

/* -------------------------------------------------------------- windows */

async function setupWindows(dest) {
  const suffix = process.arch === 'ia32' ? 'win32' : (process.arch === 'arm64' ? 'arm64' : 'amd64');
  const zipName = 'python-' + PY_VERSION + '-embed-' + suffix + '.zip';
  const url = 'https://www.python.org/ftp/python/' + PY_VERSION + '/' + zipName;
  const zipPath = path.join(CACHE_DIR, zipName);

  if (!fs.existsSync(zipPath)) {
    step('Descargando Python ' + PY_VERSION + ' embebido (' + zipName + ')');
    await download(url, zipPath);
  } else {
    step('Usando descarga en cache: ' + zipName);
  }
  ok('paquete listo (' + (fs.statSync(zipPath).size / 1048576).toFixed(1) + ' MB)');

  step('Extrayendo runtime en ' + path.relative(ROOT, dest));
  rmrf(dest);
  extractArchive(zipPath, dest);
  ok('extraido');

  // El paquete embebido trae site-packages desactivado: hay que habilitarlo.
  step('Habilitando site-packages e importacion de modulos');
  const pth = fs.readdirSync(dest).find((f) => /^python\d+\._pth$/.test(f));
  if (!pth) throw new Error('no se encontro el archivo ._pth en el paquete embebido');
  const zipStdlib = pth.replace('._pth', '.zip');
  const pthLines = [zipStdlib, '.', 'Lib\\site-packages', '', '# habilitado por Python Classroom', 'import site', ''];
  fs.writeFileSync(path.join(dest, pth), pthLines.join('\r\n'), 'utf8');
  fs.mkdirSync(path.join(dest, 'Lib', 'site-packages'), { recursive: true });
  fs.mkdirSync(path.join(dest, 'Scripts'), { recursive: true });

  /*
   * Con ._pth, Python deja de anadir la carpeta del archivo que se ejecuta a las
   * rutas de importacion, y un trabajo repartido en varios modulos no funciona.
   * Se restablece con un sitecustomize (la aplicacion tambien lo comprueba al
   * arrancar, por si el runtime viene de otro sitio).
   */
  fs.writeFileSync(
    path.join(dest, 'Lib', 'site-packages', 'sitecustomize.py'),
    [
      '# Generado por Python Classroom: no editar a mano.',
      'import sys',
      'import os',
      '',
      'try:',
      '    _ruta = sys.argv[0] if sys.argv else ""',
      '    if _ruta:',
      '        _dir = os.path.dirname(os.path.abspath(_ruta))',
      '        if _dir and os.path.isdir(_dir) and _dir not in sys.path:',
      '            sys.path.insert(0, _dir)',
      'except Exception:',
      '    pass',
      ''
    ].join('\n'), 'utf8');
  ok(pth + ' configurado');

  const exe = path.join(dest, 'python.exe');

  step('Instalando pip');
  const getpip = path.join(CACHE_DIR, 'get-pip.py');
  if (!fs.existsSync(getpip)) await download(GETPIP_URL, getpip);
  run(exe, [getpip, '--no-warn-script-location', '--no-cache-dir'], { cwd: dest });
  ok('pip instalado');

  return exe;
}

/* ---------------------------------------------------------------- posix */

async function setupPosix(dest) {
  const triple = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'aarch64' : 'x86_64') + '-apple-darwin'
    : (process.arch === 'arm64' ? 'aarch64' : 'x86_64') + '-unknown-linux-gnu';

  try {
    step('Buscando CPython portable (python-build-standalone)');
    const rel = await fetchJson('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest');
    const wanted = (rel.assets || []).filter((a) =>
      a.name.indexOf('cpython-3.11.') === 0 &&
      a.name.indexOf(triple) !== -1 &&
      a.name.endsWith('install_only.tar.gz'));
    if (!wanted.length) throw new Error('no hay build para ' + triple);
    const asset = wanted[0];
    const tarPath = path.join(CACHE_DIR, asset.name);
    if (!fs.existsSync(tarPath)) await download(asset.browser_download_url, tarPath);
    ok('descargado ' + asset.name);

    step('Extrayendo runtime');
    const staging = path.join(CACHE_DIR, 'staging');
    rmrf(staging);
    extractArchive(tarPath, staging);
    const inner = path.join(staging, 'python');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    rmrf(dest);
    fs.renameSync(fs.existsSync(inner) ? inner : staging, dest);
    rmrf(staging);
    const exe = path.join(dest, 'bin', 'python3');
    fs.chmodSync(exe, 0o755);
    ok('CPython portable listo');
    return exe;
  } catch (err) {
    warn('CPython portable no disponible (' + err.message + '). Plan B: entorno virtual local.');
  }

  step('Creando entorno virtual aislado a partir del python3 del sistema');
  const sys = ['python3', 'python'].find((c) => runQuiet(c, ['--version']).status === 0);
  if (!sys) throw new Error('no hay python3 en el sistema y no se pudo descargar CPython portable');
  rmrf(dest);
  run(sys, ['-m', 'venv', dest]);
  ok('venv creado');
  return path.join(dest, 'bin', 'python');
}

/* ------------------------------------------------------------------ main */

async function main() {
  log('==========================================');
  log('  Python Classroom - runtime de Python');
  log('==========================================');
  log('  plataforma : ' + platformKey());
  log('  destino    : ' + path.relative(ROOT, targetDir()));

  const dest = targetDir();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });

  const manifestPath = path.join(RUNTIME_DIR, 'runtime.json');
  if (fs.existsSync(manifestPath) && !FORCE) {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const abs = path.isAbsolute(m.executable) ? m.executable : path.join(ROOT, m.executable);
      if (m.executable && fs.existsSync(abs)) {
        const probe = runQuiet(abs, ['--version']);
        if (probe.status === 0) {
          log('\nEl runtime ya esta instalado: ' + (probe.stdout || probe.stderr).trim());
          log('Usa --force para reinstalarlo.');
          if (!NO_PACKAGES) await installPackages(abs);
          return;
        }
      }
    } catch (e) { /* manifiesto corrupto: reinstalamos */ }
  }

  if (FORCE) rmrf(dest);

  const exe = process.platform === 'win32' ? await setupWindows(dest) : await setupPosix(dest);

  step('Verificando instalacion');
  const probe = runQuiet(exe, ['-c', 'import sys, platform; print(platform.python_version()); print(sys.executable)']);
  if (probe.status !== 0) throw new Error('el interprete no responde: ' + (probe.stderr || ''));
  const lines = probe.stdout.trim().split(/\r?\n/);
  ok('Python ' + lines[0]);
  const pipv = runQuiet(exe, ['-m', 'pip', '--version']);
  if (pipv.status !== 0) throw new Error('pip no funciona: ' + (pipv.stderr || ''));
  ok(pipv.stdout.trim().split(' from ')[0]);

  fs.writeFileSync(manifestPath, JSON.stringify({
    version: lines[0],
    platform: platformKey(),
    // Ruta relativa a la raiz del proyecto: sobrevive a mover/instalar la app.
    executable: path.relative(ROOT, exe).split(path.sep).join('/'),
    home: path.relative(ROOT, dest).split(path.sep).join('/'),
    embedded: true,
    installedAt: new Date().toISOString(),
    setupVersion: 1
  }, null, 2), 'utf8');
  ok('manifiesto escrito en python/runtime/runtime.json');

  if (!NO_PACKAGES) await installPackages(exe);

  log('\n==========================================');
  log('  Runtime listo. Ejecuta:  npm start');
  log('==========================================\n');
}

async function installPackages(exe) {
  const list = FULL ? BASE_PACKAGES.concat(FULL_PACKAGES) : BASE_PACKAGES;
  if (!list.length) return;
  step('Instalando paquetes educativos base: ' + list.join(', '));
  const env = Object.assign({}, process.env, {
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1'
  });
  const res = spawnSync(exe, ['-m', 'pip', 'install', '--upgrade', '--no-warn-script-location'].concat(list), {
    stdio: 'inherit',
    env: env
  });
  if (res.status !== 0) warn('algunos paquetes no se instalaron (reintenta desde la app, seccion Librerias)');
  else ok('paquetes instalados');
}

main().catch((err) => {
  log('\nERROR: ' + err.message);
  log('Sugerencia: revisa tu conexion y vuelve a ejecutar  npm run setup:python -- --force');
  process.exit(1);
});
