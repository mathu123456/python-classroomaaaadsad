'use strict';
/*
 * Terminal integrada.
 *
 * No usa un PTY nativo (evita compilar modulos nativos y mantiene el instalador
 * ligero): cada comando se lanza como proceso hijo con stdin/stdout/stderr por
 * tuberia, y la sesion mantiene su propio directorio de trabajo.
 *
 * El PATH de la sesion lleva delante el runtime interno, de modo que "python" y
 * "pip" SIEMPRE son los de Python Classroom aunque el equipo tenga otro Python.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const runtime = require('../runtime');
const store = require('../store');
const { killTree } = require('./python');

const sessions = new Map();
let seq = 0;

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function defaultCwd() {
  const s = store.getSession();
  if (s.workspace && fs.existsSync(s.workspace)) return s.workspace;
  const ws = store.workspacesDir();
  return fs.existsSync(ws) ? ws : os.homedir();
}

function splitFirstToken(line) {
  const m = String(line).trim().match(/^("[^"]+"|'[^']+'|\S+)\s*([\s\S]*)$/);
  if (!m) return { cmd: '', rest: '' };
  return { cmd: m[1].replace(/^["']|["']$/g, ''), rest: m[2] };
}

function unquote(s) {
  return String(s).trim().replace(/^["']|["']$/g, '');
}

/*
 * Importante en Windows: NO se puede hacer spawn('cmd.exe', ['/c', linea]).
 * Node escapa las comillas internas con barras invertidas y cmd.exe no las
 * entiende, asi que un comando como  python -c "print(1)"  se rompe en
 * silencio. La opcion shell:true delega el entrecomillado en Node, que aplica
 * las reglas correctas de cmd.exe (windowsVerbatimArguments).
 */
function shellFor(line) {
  const settings = store.getSettings();
  if (process.platform === 'win32') {
    const sh = settings.terminalShell || '';
    if (/powershell|pwsh/i.test(sh)) {
      return { file: sh, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', line] };
    }
    return { file: line, args: [], shell: true };
  }
  return { file: line, args: [], shell: settings.terminalShell || true };
}

/** Reescribe comandos para forzar el uso del runtime interno. */
function rewrite(line) {
  const rt = runtime.get();
  if (!rt.ok) return null;
  const trimmed = line.trim();
  const { cmd, rest } = splitFirstToken(trimmed);
  const low = cmd.toLowerCase().replace(/\.exe$/, '');

  if ((low === 'python' || low === 'python3' || low === 'py') && !rest.trim()) {
    // REPL interactivo: -i fuerza los prompts aunque stdin sea una tuberia.
    return { file: rt.executable, args: ['-i', '-u', '-q'], interactive: true };
  }
  return null;
}

function makeSession(ctx, cwd) {
  seq += 1;
  const id = 'term_' + seq;
  const session = {
    id: id,
    cwd: cwd || defaultCwd(),
    child: null,
    bytes: 0,
    outDec: null,
    errDec: null
  };
  sessions.set(id, session);
  return session;
}

function emit(ctx, id, type, extra) {
  ctx.send('term:event', Object.assign({ id: id, type: type }, extra || {}));
}

function finishCommand(ctx, session, code, signal) {
  if (!session.child) return;
  const dec = session.outDec ? session.outDec.end() : '';
  const decErr = session.errDec ? session.errDec.end() : '';
  if (dec) emit(ctx, session.id, 'data', { data: dec, stream: 'stdout' });
  if (decErr) emit(ctx, session.id, 'data', { data: decErr, stream: 'stderr' });
  session.child = null;
  session.outDec = null;
  session.errDec = null;
  session.bytes = 0;
  emit(ctx, session.id, 'done', { code: code, signal: signal || null, cwd: session.cwd });
}

function exec(ctx, id, line) {
  const session = sessions.get(id);
  if (!session) return { ok: false, error: 'La sesion de terminal no existe.' };
  if (session.child) return { ok: false, error: 'Ya hay un comando en ejecucion. Usa Ctrl+C para detenerlo.' };

  const raw = String(line == null ? '' : line);
  const trimmed = raw.trim();

  if (!trimmed) {
    emit(ctx, id, 'done', { code: 0, cwd: session.cwd });
    return { ok: true, builtin: true };
  }

  const { cmd, rest } = splitFirstToken(trimmed);
  const low = cmd.toLowerCase();

  // ---- comandos internos de la terminal -----------------------------------
  if (low === 'cls' || low === 'clear') {
    emit(ctx, id, 'clear', {});
    emit(ctx, id, 'done', { code: 0, cwd: session.cwd });
    return { ok: true, builtin: true };
  }

  if (low === 'exit' || low === 'salir') {
    emit(ctx, id, 'data', { data: 'Sesion de terminal reiniciada.\n', stream: 'stdout' });
    session.cwd = defaultCwd();
    emit(ctx, id, 'done', { code: 0, cwd: session.cwd });
    return { ok: true, builtin: true };
  }

  if (low === 'pwd' || (low === 'cd' && !rest.trim() && process.platform === 'win32')) {
    emit(ctx, id, 'data', { data: session.cwd + '\n', stream: 'stdout' });
    emit(ctx, id, 'done', { code: 0, cwd: session.cwd });
    return { ok: true, builtin: true };
  }

  if (low === 'cd') {
    const raw2 = unquote(rest) || os.homedir();
    const target = path.resolve(session.cwd, raw2);
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      session.cwd = target;
      emit(ctx, id, 'done', { code: 0, cwd: session.cwd });
    } else {
      emit(ctx, id, 'data', { data: 'No existe el directorio: ' + target + '\n', stream: 'stderr' });
      emit(ctx, id, 'done', { code: 1, cwd: session.cwd });
    }
    return { ok: true, builtin: true };
  }

  if (low === 'ayuda' || low === 'help-pc') {
    const rt = runtime.get();
    const help = [
      'Terminal de Python Classroom',
      '-----------------------------------------',
      'python              abre el interprete interactivo interno',
      'python archivo.py   ejecuta un script',
      'pip list            paquetes instalados',
      'pip install nombre  instala un paquete',
      'cd <carpeta>        cambia de directorio',
      'cls / clear         limpia la terminal',
      'Ctrl+C              detiene el comando en ejecucion',
      '',
      'Interprete: ' + (rt.ok ? rt.executable : 'no disponible'),
      ''
    ].join('\n');
    emit(ctx, id, 'data', { data: help, stream: 'stdout' });
    emit(ctx, id, 'done', { code: 0, cwd: session.cwd });
    return { ok: true, builtin: true };
  }

  // ---- proceso real --------------------------------------------------------
  const special = rewrite(trimmed);
  const spec = special || shellFor(trimmed);
  const spawnOptions = {
    cwd: session.cwd,
    env: runtime.childEnv(),
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe']
  };
  if (spec.shell) spawnOptions.shell = spec.shell;

  let child;
  try {
    child = spawn(spec.file, spec.args, spawnOptions);
  } catch (err) {
    emit(ctx, id, 'data', { data: 'No se pudo ejecutar: ' + err.message + '\n', stream: 'stderr' });
    emit(ctx, id, 'done', { code: -1, cwd: session.cwd });
    return { ok: false, error: err.message };
  }

  session.child = child;
  session.outDec = new StringDecoder('utf8');
  session.errDec = new StringDecoder('utf8');
  session.bytes = 0;
  emit(ctx, id, 'started', { pid: child.pid, interactive: !!(special && special.interactive) });

  const push = (stream, dec) => (buf) => {
    session.bytes += buf.length;
    if (session.bytes > MAX_OUTPUT_BYTES) {
      if (!session.truncated) {
        session.truncated = true;
        emit(ctx, id, 'data', { data: '\n[salida truncada: supera 4 MB]\n', stream: 'stderr' });
        killTree(child.pid);
      }
      return;
    }
    emit(ctx, id, 'data', { data: dec.write(buf), stream: stream });
  };

  child.stdout.on('data', push('stdout', session.outDec));
  child.stderr.on('data', push('stderr', session.errDec));
  child.on('error', (err) => {
    emit(ctx, id, 'data', { data: 'Error: ' + err.message + '\n', stream: 'stderr' });
  });
  child.on('close', (code, signal) => {
    session.truncated = false;
    finishCommand(ctx, session, code, signal);
  });

  return { ok: true, pid: child.pid };
}

function register(ipcMain, ctx) {
  ipcMain.handle('term:create', (_e, cwd) => {
    const s = makeSession(ctx, cwd);
    const rt = runtime.get();
    return {
      id: s.id,
      cwd: s.cwd,
      python: rt.ok ? { version: rt.version, executable: rt.executable, embedded: rt.embedded } : null,
      platform: process.platform
    };
  });

  ipcMain.handle('term:exec', (_e, id, line) => exec(ctx, id, line));

  ipcMain.handle('term:input', (_e, id, text) => {
    const s = sessions.get(id);
    if (!s || !s.child) return { ok: false, error: 'No hay ningun proceso esperando entrada.' };
    try { s.child.stdin.write(text); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('term:endInput', (_e, id) => {
    const s = sessions.get(id);
    if (!s || !s.child) return { ok: false };
    try { s.child.stdin.end(); return { ok: true }; } catch (err) { return { ok: false }; }
  });

  ipcMain.handle('term:interrupt', (_e, id) => {
    const s = sessions.get(id);
    if (!s || !s.child) return { ok: false, error: 'No hay ningun proceso en ejecucion.' };
    killTree(s.child.pid);
    return { ok: true };
  });

  ipcMain.handle('term:setCwd', (_e, id, cwd) => {
    const s = sessions.get(id);
    if (!s) return { ok: false };
    if (cwd && fs.existsSync(cwd)) s.cwd = path.resolve(cwd);
    return { ok: true, cwd: s.cwd };
  });

  ipcMain.handle('term:dispose', (_e, id) => {
    const s = sessions.get(id);
    if (s && s.child) killTree(s.child.pid);
    sessions.delete(id);
    return { ok: true };
  });

  return {
    disposeAll: () => {
      for (const s of sessions.values()) if (s.child) killTree(s.child.pid);
      sessions.clear();
    }
  };
}

module.exports = { register };
