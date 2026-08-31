'use strict';
/*
 * Resolucion del interprete de Python que usa Python Classroom.
 *
 * Prioridad:
 *   1. Copia del runtime en <userData>/python/runtime (la que se puede escribir)
 *   2. Runtime embebido descrito en python/runtime/runtime.json
 *   3. Interprete detectado automaticamente dentro de python/runtime/<plataforma>
 *   4. Python del sistema (solo como red de seguridad, se avisa en la interfaz)
 *
 * Todo el resto de la aplicacion (ejecucion, terminal, pip) pasa por aqui, de
 * modo que nunca se usa el Python global si existe uno embebido.
 *
 * FASE 6 · por que se copia el runtime a userData
 * -----------------------------------------------
 * Instalada en "C:\Program Files", la carpeta de la aplicacion es de solo
 * lectura para el estudiante, asi que "pip install" fallaria sin permisos de
 * administrador. De las dos soluciones posibles se eligio COPIAR el runtime a
 * <userData>/python/runtime en el primer arranque:
 *
 *   - Con PIP_TARGET + PYTHONPATH (la otra opcion) pip instala, pero "pip
 *     uninstall" no sabe desinstalar de un --target, y la aplicacion tiene un
 *     gestor de librerias con boton de desinstalar: quedaria a medias.
 *   - Con la copia, pip funciona entero (instalar, actualizar y desinstalar) y
 *     cada usuario del equipo tiene su propio entorno, que es justo lo que hace
 *     falta en un computador compartido del colegio.
 *
 * El coste es una copia unica de unos pocos cientos de MB en el primer arranque,
 * con su pantalla de progreso. Si la carpeta de instalacion SI se puede escribir
 * (modo desarrollo), no se copia nada.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { app } = require('electron');

let cached = null;

function projectRoot() {
  // En desarrollo: la raiz del repo. Empaquetado: process.resourcesPath (extraResources).
  return app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
}

function runtimeDir() {
  return path.join(projectRoot(), 'python', 'runtime');
}

function platformKey() {
  if (process.platform === 'win32') return 'win-' + (process.arch === 'ia32' ? 'x86' : process.arch);
  return process.platform + '-' + process.arch;
}

function probe(exe) {
  if (!exe || !fs.existsSync(exe)) return null;
  const res = spawnSync(exe, ['-c', 'import sys;print(sys.version.split()[0]);print(sys.executable)'], {
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true
  });
  if (res.status !== 0 || !res.stdout) return null;
  const lines = res.stdout.trim().split(/\r?\n/);
  return { version: lines[0], realExecutable: lines[1] || exe };
}

/** Carpeta donde vive la copia escribible del runtime. */
function userRuntimeDir() {
  return path.join(app.getPath('userData'), 'python', 'runtime');
}

/** ¿Se puede escribir dentro de esta carpeta? */
function esEscribible(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  const testigo = path.join(dir, '.pc-escritura-' + process.pid);
  try {
    fs.writeFileSync(testigo, 'ok');
    fs.unlinkSync(testigo);
    return true;
  } catch (err) {
    return false;
  }
}

/** Runtime ya copiado en la carpeta del usuario. */
function fromUserData() {
  const dir = path.join(userRuntimeDir(), platformKey());
  const candidatos = process.platform === 'win32'
    ? [path.join(dir, 'python.exe')]
    : [path.join(dir, 'bin', 'python3'), path.join(dir, 'bin', 'python')];
  for (const exe of candidatos) {
    const info = probe(exe);
    if (info) {
      return {
        ok: true,
        embedded: true,
        source: 'copia del usuario',
        executable: exe,
        home: dir,
        version: info.version,
        installedAt: null,
        userCopy: true
      };
    }
  }
  return null;
}

/** Cuenta archivos para poder informar del progreso de la copia. */
function contarArchivos(dir) {
  let n = 0;
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.isDirectory()) n += contarArchivos(path.join(dir, entrada.name));
    else n++;
  }
  return n;
}

function copiarArbol(origen, destino, estado, onProgress) {
  fs.mkdirSync(destino, { recursive: true });
  for (const entrada of fs.readdirSync(origen, { withFileTypes: true })) {
    const desde = path.join(origen, entrada.name);
    const hasta = path.join(destino, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === '__pycache__') continue;
      copiarArbol(desde, hasta, estado, onProgress);
    } else {
      if (/\.(pyc|part)$/i.test(entrada.name)) continue;
      fs.copyFileSync(desde, hasta);
      estado.hechos++;
      if (onProgress && estado.hechos % 40 === 0) {
        onProgress({ hechos: estado.hechos, total: estado.total, archivo: entrada.name });
      }
    }
  }
}

/**
 * Deja disponible un runtime en el que pip pueda escribir.
 *
 * Devuelve { ok, copiado, motivo, runtime }. No copia nada si la carpeta de
 * instalacion ya es escribible o si la copia del usuario ya existe.
 *
 * `opciones.forzar` copia igualmente. Sirve para dos cosas: reparar una copia
 * desde la propia aplicacion y poder probar de verdad -en desarrollo, donde la
 * carpeta si se puede escribir- el camino que se usara al instalar en
 * "C:\Program Files".
 */
function ensureWritable(onProgress, opciones) {
  const forzar = !!(opciones && opciones.forzar);
  const yaCopiado = fromUserData();
  if (yaCopiado && !forzar) {
    cached = null;
    return { ok: true, copiado: false, motivo: 'La copia del usuario ya existía.', runtime: get(true) };
  }

  const origenDir = path.join(runtimeDir(), platformKey());
  if (!fs.existsSync(origenDir)) {
    const rt = get(true);
    return {
      ok: rt.ok,
      copiado: false,
      motivo: 'No hay runtime embebido que copiar; se usa ' + rt.source + '.',
      runtime: rt
    };
  }

  if (esEscribible(origenDir) && !forzar) {
    return {
      ok: true,
      copiado: false,
      motivo: 'La carpeta de instalación se puede escribir: pip trabaja ahí mismo.',
      runtime: get(true)
    };
  }

  const destino = path.join(userRuntimeDir(), platformKey());
  const estado = { hechos: 0, total: contarArchivos(origenDir) };
  if (onProgress) onProgress({ hechos: 0, total: estado.total, archivo: '' });
  copiarArbol(origenDir, destino, estado, onProgress);
  if (onProgress) onProgress({ hechos: estado.total, total: estado.total, archivo: '' });

  cached = null;
  const rt = get(true);
  return {
    ok: rt.ok,
    copiado: true,
    archivos: estado.total,
    destino: destino,
    motivo: forzar
      ? 'Copia del runtime a la carpeta del usuario, pedida a mano.'
      : 'La carpeta de instalación es de solo lectura: el runtime se copió a la carpeta del usuario.',
    runtime: rt
  };
}

/** Estado de la preparacion, para la pantalla de primer arranque. */
function prepareState() {
  const origenDir = path.join(runtimeDir(), platformKey());
  const copia = fromUserData();
  return {
    plataforma: platformKey(),
    hayEmbebido: fs.existsSync(origenDir),
    instalacionEscribible: esEscribible(origenDir),
    hayCopiaUsuario: !!copia,
    carpetaUsuario: userRuntimeDir(),
    necesitaCopia: fs.existsSync(origenDir) && !esEscribible(origenDir) && !copia
  };
}

function fromManifest() {
  const manifest = path.join(runtimeDir(), 'runtime.json');
  if (!fs.existsSync(manifest)) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  } catch (err) {
    return null;
  }
  if (!data.executable) return null;
  const exe = path.isAbsolute(data.executable)
    ? data.executable
    : path.resolve(projectRoot(), data.executable);
  const info = probe(exe);
  if (!info) return null;
  const home = data.home
    ? (path.isAbsolute(data.home) ? data.home : path.resolve(projectRoot(), data.home))
    : path.dirname(exe);
  return {
    ok: true,
    embedded: true,
    source: 'embebido',
    executable: exe,
    home: home,
    version: info.version,
    installedAt: data.installedAt || null
  };
}

function fromConvention() {
  const dir = path.join(runtimeDir(), platformKey());
  const candidates = process.platform === 'win32'
    ? [path.join(dir, 'python.exe')]
    : [path.join(dir, 'bin', 'python3'), path.join(dir, 'bin', 'python')];
  for (const exe of candidates) {
    const info = probe(exe);
    if (info) {
      return {
        ok: true,
        embedded: true,
        source: 'embebido',
        executable: exe,
        home: dir,
        version: info.version,
        installedAt: null
      };
    }
  }
  return null;
}

function fromSystem() {
  const names = process.platform === 'win32'
    ? ['python.exe', 'python3.exe', 'py.exe']
    : ['python3', 'python'];
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of pathDirs) {
      const exe = path.join(dir, name);
      const info = probe(exe);
      if (info) {
        return {
          ok: true,
          embedded: false,
          source: 'sistema',
          executable: info.realExecutable || exe,
          home: path.dirname(info.realExecutable || exe),
          version: info.version,
          installedAt: null,
          warning: 'Se esta usando el Python instalado en el sistema. ' +
            'Ejecuta "npm run setup:python" para instalar el runtime embebido de Python Classroom.'
        };
      }
    }
  }
  return null;
}

/** Devuelve la informacion del runtime activo (con cache). */
/*
 * «No module named…» aunque el modulo este al lado: el arreglo.
 *
 * El paquete embebido de Python para Windows trae un archivo `python311._pth`
 * que fija la lista de rutas de importacion entera. Con el, Python deja de hacer
 * lo que hace siempre: anadir la carpeta del archivo que se ejecuta. Resultado:
 * un trabajo repartido en varios modulos -main.py + utilidades.py, que es
 * justo lo que se pide en clase- no funcionaba, y PYTHONPATH tampoco servia
 * porque `._pth` tambien lo ignora.
 *
 * Se restablece el comportamiento normal con un `sitecustomize.py` dentro del
 * runtime: Python lo importa al arrancar y ahi se anade la carpeta del script.
 */
const SITECUSTOMIZE = [
  '# Generado por Python Classroom: no editar a mano.',
  '#',
  '# Devuelve el comportamiento normal de Python en el paquete embebido:',
  '# la carpeta del archivo que se ejecuta tiene que poder importarse, para que',
  '# un programa repartido en varios modulos funcione.',
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
].join('\n');

function asegurarSitecustomize(rt) {
  if (!rt || !rt.ok || !rt.home) return;
  try {
    const destino = path.join(rt.home, 'Lib', 'site-packages', 'sitecustomize.py');
    if (fs.existsSync(destino)) {
      const actual = fs.readFileSync(destino, 'utf8');
      if (actual.indexOf('Generado por Python Classroom') !== -1) return;
      // Si alguien puso el suyo, no se pisa: manda el del usuario.
      if (actual.trim()) return;
    }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, SITECUSTOMIZE, 'utf8');
  } catch (err) {
    // Runtime de solo lectura: se avisa en el diagnostico, no se rompe nada.
  }
}

function get(force) {
  if (cached && !force) return cached;
  cached = fromUserData() || fromManifest() || fromConvention() || fromSystem() || {
    ok: false,
    embedded: false,
    source: 'ninguno',
    executable: null,
    home: null,
    version: null,
    error: 'No se encontro ningun interprete de Python. Ejecuta "npm run setup:python" ' +
      'para instalar el runtime embebido.'
  };
  cached.platformKey = platformKey();
  cached.runtimeDir = runtimeDir();
  asegurarSitecustomize(cached);
  return cached;
}

function invalidate() { cached = null; }

/** Directorios que hay que anteponer al PATH para que python/pip sean los internos. */
function binDirs() {
  const rt = get();
  if (!rt.ok) return [];
  const dirs = [];
  if (rt.home) {
    dirs.push(rt.home);
    dirs.push(path.join(rt.home, 'Scripts'));
    dirs.push(path.join(rt.home, 'bin'));
  }
  dirs.push(path.dirname(rt.executable));
  return dirs.filter((d, i, arr) => fs.existsSync(d) && arr.indexOf(d) === i);
}

/**
 * Entorno para cualquier proceso hijo (script del alumno, terminal, pip).
 * - Fuerza UTF-8 y salida sin buffer para que la consola muestre texto al instante.
 * - Antepone el runtime interno al PATH.
 * - Limpia variables globales de Python que podrian romper el runtime embebido.
 */
function childEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  delete env.PYTHONSTARTUP;
  delete env.PYTHONEXECUTABLE;
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  env.PYTHONUNBUFFERED = '1';
  env.PYTHONDONTWRITEBYTECODE = '1';
  env.PIP_DISABLE_PIP_VERSION_CHECK = '1';
  env.PYTHONCLASSROOM = '1';

  const dirs = binDirs();
  if (dirs.length) {
    // En Windows la variable puede llamarse Path/PATH indistintamente.
    const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
    env[key] = dirs.join(path.delimiter) + path.delimiter + (env[key] || '');
  }
  return env;
}

module.exports = {
  get,
  invalidate,
  asegurarSitecustomize,
  childEnv,
  binDirs,
  projectRoot,
  runtimeDir,
  platformKey,
  userRuntimeDir,
  esEscribible,
  ensureWritable,
  prepareState
};
