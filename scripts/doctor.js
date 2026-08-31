#!/usr/bin/env node
/*
 * Diagnostico de la instalacion de Python Classroom.
 *   node scripts/doctor.js
 *
 * Comprueba, sin abrir la interfaz, que todas las piezas de la Fase 1 y la
 * Fase 2 estan en su sitio y funcionan de verdad.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let fails = 0;
let warns = 0;

function ok(label, extra) { console.log('  [OK]   ' + label + (extra ? '  -> ' + extra : '')); }
function bad(label, extra) { fails++; console.log('  [FALLA] ' + label + (extra ? '  -> ' + extra : '')); }
function warn(label, extra) { warns++; console.log('  [AVISO] ' + label + (extra ? '  -> ' + extra : '')); }
function head(t) { console.log('\n' + t + '\n' + '-'.repeat(t.length)); }

function exists(rel, label) {
  const p = path.join(ROOT, rel);
  if (fs.existsSync(p)) { ok(label || rel); return true; }
  bad(label || rel, 'no existe ' + rel);
  return false;
}

function run(exe, args, opts) {
  return spawnSync(exe, args, Object.assign({ encoding: 'utf8', timeout: 60000, windowsHide: true }, opts || {}));
}

console.log('=================================================');
console.log('  Python Classroom - diagnostico');
console.log('=================================================');

head('1. Estructura del proyecto');
exists('package.json');
exists('electron/main.js');
exists('electron/preload.js');
exists('electron/runtime.js');
exists('electron/ipc/python.js');
exists('electron/ipc/terminal.js');
exists('electron/ipc/packages.js');
exists('electron/ipc/files.js');
exists('electron/ipc/system.js');
exists('src/index.html');
exists('src/js/app.js');
exists('src/js/editor.js');
exists('python/tools/pcheck.py');
// fase 3: SQLite local + Firebase
exists('electron/sqlite.js');
exists('electron/firebase-config.js');
exists('electron/ipc/data.js');
exists('electron/repos/users.js');
exists('electron/repos/academic.js');
exists('electron/repos/work.js');
exists('src/js/firebase.js');
exists('src/js/sync.js');
exists('src/js/auth.js');
exists('src/js/router.js');
exists('src/js/dashboard.js');
exists('src/js/exercises.js');
exists('src/js/review.js');
exists('src/js/exercise-session.js');
exists('src/js/projects.js');
exists('src/js/tutorial.js');
exists('src/css/dashboard.css');
exists('firebase/database.rules.json');

head('2. Dependencias de Node');
if (fs.existsSync(path.join(ROOT, 'node_modules'))) {
  ok('node_modules presente');
  for (const dep of ['@codemirror/view', '@codemirror/lang-python', 'esbuild', 'electron', 'firebase']) {
    if (fs.existsSync(path.join(ROOT, 'node_modules', dep))) ok(dep);
    else bad(dep, 'falta; ejecuta npm install');
  }
} else {
  bad('node_modules', 'ejecuta npm install');
}

head('3. Bundles del renderer');
for (const [rel, minimo] of [['src/js/vendor/cm6.js', 100000], ['src/js/vendor/firebase.js', 50000]]) {
  const bundle = path.join(ROOT, rel);
  if (!fs.existsSync(bundle)) { bad(rel, 'ejecuta npm run build:vendor'); continue; }
  const bytes = fs.statSync(bundle).size;
  if (bytes > minimo) ok(rel, (bytes / 1024).toFixed(1) + ' KB');
  else bad(rel, 'parece incompleto (' + (bytes / 1024).toFixed(1) + ' KB); ejecuta npm run build:vendor');
}

head('4. Runtime de Python');
const manifestPath = path.join(ROOT, 'python', 'runtime', 'runtime.json');
let exe = null;
if (fs.existsSync(manifestPath)) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    exe = path.isAbsolute(m.executable) ? m.executable : path.join(ROOT, m.executable);
    ok('manifiesto runtime.json', 'Python ' + m.version + ' (' + m.platform + ')');
  } catch (err) {
    bad('runtime.json', 'archivo corrupto');
  }
} else {
  bad('runtime.json', 'ejecuta npm run setup:python');
}

if (exe && fs.existsSync(exe)) {
  ok('ejecutable', exe);
  const v = run(exe, ['-c', 'import sys;print(sys.version.split()[0])']);
  if (v.status === 0) ok('el interprete responde', 'Python ' + v.stdout.trim());
  else bad('el interprete no responde', (v.stderr || '').slice(0, 200));

  const pip = run(exe, ['-m', 'pip', '--version']);
  if (pip.status === 0) ok('pip disponible', pip.stdout.trim().split(' from ')[0]);
  else bad('pip no disponible', (pip.stderr || '').slice(0, 200));

  const site = run(exe, ['-c', 'import site,sys;print(len([p for p in sys.path if "site-packages" in p]))']);
  if (site.status === 0 && parseInt(site.stdout.trim(), 10) > 0) ok('site-packages habilitado');
  else warn('site-packages', 'puede que pip no encuentre donde instalar');

  const list = run(exe, ['-m', 'pip', 'list', '--format=json', '--disable-pip-version-check']);
  if (list.status === 0) {
    try {
      const pkgs = JSON.parse(list.stdout);
      ok('paquetes instalados', pkgs.length + ' -> ' + pkgs.slice(0, 8).map((p) => p.name).join(', '));
    } catch (e) { warn('no se pudo leer la lista de paquetes'); }
  }

  head('5. Ejecucion real de codigo');
  const hello = run(exe, ['-u', '-c', 'print("hola desde python classroom")']);
  if (hello.status === 0 && /hola desde python classroom/.test(hello.stdout)) ok('print()', hello.stdout.trim());
  else bad('print()', (hello.stderr || '').slice(0, 200));

  const err = run(exe, ['-u', '-c', 'raise ValueError("prueba")']);
  if (err.status !== 0 && /ValueError/.test(err.stderr)) ok('captura de excepciones', 'codigo ' + err.status);
  else bad('captura de excepciones');

  const stdin = run(exe, ['-u', '-c', 'print("hola", input())'], { input: 'mundo\n' });
  if (stdin.status === 0 && /hola mundo/.test(stdin.stdout)) ok('input() por stdin', stdin.stdout.trim());
  else bad('input() por stdin', (stdin.stderr || '').slice(0, 200));

  const utf = run(exe, ['-u', '-c', 'print("acentos: áéíóú ñ ✓")'], {
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' })
  });
  if (utf.status === 0 && /áéíóú/.test(utf.stdout)) ok('salida UTF-8', utf.stdout.trim());
  else bad('salida UTF-8', JSON.stringify((utf.stdout || '').trim()));

  head('6. Comprobador de sintaxis');
  const tool = path.join(ROOT, 'python', 'tools', 'pcheck.py');
  const good = run(exe, ['-I', '-u', tool, 'x.py'], { input: 'x = 1\nprint(x)\n' });
  const bad1 = run(exe, ['-I', '-u', tool, 'x.py'], { input: 'def f(:\n  pass\n' });
  try {
    const g = JSON.parse(good.stdout);
    const b = JSON.parse(bad1.stdout);
    if (g.ok && g.diagnostics.length === 0) ok('codigo valido -> sin errores');
    else bad('codigo valido', good.stdout);
    if (!b.ok && b.diagnostics.length === 1 && b.diagnostics[0].line === 1) {
      ok('codigo invalido -> error detectado', 'linea ' + b.diagnostics[0].line + ': ' + b.diagnostics[0].message);
    } else bad('codigo invalido', bad1.stdout);
  } catch (e) {
    bad('pcheck.py', 'salida no valida: ' + (good.stdout || good.stderr || '').slice(0, 200));
  }
} else if (exe) {
  bad('ejecutable', 'no existe ' + exe);
}

head('7. SQLite local (fase 3)');
try {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t(id TEXT PRIMARY KEY, n INTEGER)');
  db.prepare('INSERT INTO t VALUES (?,?)').run('a', 1);
  db.prepare("INSERT INTO t VALUES (?,?) ON CONFLICT(id) DO UPDATE SET n = excluded.n").run('a', 2);
  const fila = db.prepare('SELECT n FROM t WHERE id = ?').get('a');
  if (fila && fila.n === 2) ok('node:sqlite disponible y funcional', 'upsert e indices OK');
  else bad('node:sqlite', 'resultado inesperado: ' + JSON.stringify(fila));
  db.close();
} catch (err) {
  bad('node:sqlite', err.message);
}

const dbUsuario = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'Python Classroom', 'python-classroom.db')
  : null;
if (dbUsuario && fs.existsSync(dbUsuario)) {
  const cabecera = fs.readFileSync(dbUsuario).slice(0, 15).toString('utf8');
  if (cabecera === 'SQLite format 3') {
    ok('base de datos del usuario', dbUsuario + '  (' + Math.round(fs.statSync(dbUsuario).size / 1024) + ' KB)');
  } else {
    bad('base de datos del usuario', 'cabecera inesperada');
  }
} else {
  warn('base de datos del usuario', 'todavia no existe (se crea al abrir la app)');
}

head('8. Configuracion de Firebase');
try {
  const reglas = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase', 'database.rules.json'), 'utf8'));
  const r = reglas.rules;
  if (!r) throw new Error('el archivo no tiene la clave "rules"');
  if (r['.read'] !== false || r['.write'] !== false) bad('reglas', 'la raiz deberia estar cerrada por defecto');
  else ok('reglas: raiz cerrada por defecto');
  for (const nodo of ['roles', 'users', 'exercises', 'submissions', 'feedback', 'rankings']) {
    if (r[nodo]) ok('regla para ' + nodo);
    else bad('regla para ' + nodo, 'falta');
  }
  const submissions = JSON.stringify(r.submissions);
  if (submissions.indexOf('grade') !== -1 && submissions.indexOf("=== 'teacher'") !== -1) {
    ok('la nota solo la puede escribir un profesor');
  } else {
    bad('reglas de nota', 'no se encontro la restriccion sobre "grade"');
  }
} catch (err) {
  bad('firebase/database.rules.json', err.message);
}

try {
  const cfg = require(path.join(ROOT, 'electron', 'firebase-config.js'));
  const d = cfg.DEFAULTS;
  for (const clave of ['apiKey', 'authDomain', 'projectId', 'databaseURL', 'appId']) {
    if (d[clave]) ok('config.' + clave, clave === 'apiKey' ? d[clave].slice(0, 12) + '…' : d[clave]);
    else bad('config.' + clave, 'falta');
  }
} catch (err) {
  bad('electron/firebase-config.js', err.message);
}

head('Resultado');
if (fails === 0 && warns === 0) console.log('  Todo correcto. Ejecuta:  npm start');
else if (fails === 0) console.log('  Listo con ' + warns + ' aviso(s). Ejecuta:  npm start');
else console.log('  ' + fails + ' problema(s) y ' + warns + ' aviso(s). Revisa arriba.');
console.log('');
process.exit(fails ? 1 : 0);
