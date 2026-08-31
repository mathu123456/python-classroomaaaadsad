'use strict';
/*
 * Ejecucion de codigo Python.
 *
 * Reglas duras:
 *  - El codigo del alumno NUNCA se ejecuta dentro del proceso de Electron.
 *    Siempre va en un proceso hijo independiente con su propio stdin/stdout/stderr.
 *  - Toda ejecucion tiene tiempo maximo configurable y se puede cancelar.
 *  - Al matar un proceso se mata tambien su arbol de hijos (Windows: taskkill /T).
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { StringDecoder } = require('string_decoder');

const runtime = require('../runtime');
const store = require('../store');
const files = require('./files');

let runSeq = 0;
let untitledSeq = 0;
/** @type {Map<string, object>} ejecuciones vivas */
const runs = new Map();

function nowMs() { return Date.now(); }

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 8000 });
    } catch (err) { /* el proceso ya no existe */ }
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch (err) {
      try { process.kill(pid, 'SIGKILL'); } catch (err2) { /* ya termino */ }
    }
  }
}

/** Prepara el archivo .py que se va a ejecutar y devuelve {script, cwd, label}. */
async function materialize(payload) {
  const settings = store.getSettings();
  const session = store.getSession();

  if (payload.filePath) {
    // Mismo guardia que el resto de operaciones de archivo.
    const file = files.assertAllowed(payload.filePath);
    // Autoguardado: lo que se ejecuta es exactamente lo que se ve en el editor.
    if (typeof payload.code === 'string') {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, payload.code, 'utf8');
    }
    return { script: file, cwd: path.dirname(file), label: path.basename(file), saved: true };
  }

  untitledSeq += 1;
  const tmp = path.join(store.tmpDir(), 'sin_titulo_' + untitledSeq + '.py');
  await fsp.writeFile(tmp, payload.code || '', 'utf8');
  const cwd = session.workspace && fs.existsSync(session.workspace) ? session.workspace : store.tmpDir();
  return { script: tmp, cwd: cwd, label: payload.label || 'sin_titulo.py', saved: false, settings: settings };
}

function startRun(ctx, payload) {
  const rt = runtime.get();
  if (!rt.ok) {
    return Promise.resolve({ ok: false, error: rt.error });
  }

  // Solo una ejecucion activa a la vez: el boton Ejecutar reemplaza la anterior.
  for (const id of Array.from(runs.keys())) stopRun(id, 'reemplazada');

  return materialize(payload).then((target) => {
    const settings = store.getSettings();
    const timeoutMs = typeof payload.timeoutMs === 'number' ? payload.timeoutMs : settings.runTimeoutMs;
    const args = ['-u'];
    if (payload.isolated !== false) args.push('-X', 'utf8');
    args.push(target.script);
    if (Array.isArray(payload.args)) args.push.apply(args, payload.args.map(String));

    runSeq += 1;
    const runId = 'run_' + runSeq + '_' + nowMs().toString(36);
    const startedAt = nowMs();

    let child;
    try {
      child = spawn(rt.executable, args, {
        cwd: target.cwd,
        env: runtime.childEnv(),
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (err) {
      return { ok: false, error: 'No se pudo iniciar Python: ' + err.message };
    }

    const rec = {
      id: runId,
      child: child,
      startedAt: startedAt,
      script: target.script,
      label: target.label,
      cwd: target.cwd,
      timedOut: false,
      stopped: false,
      finished: false,
      timer: null,
      bytesOut: 0
    };
    runs.set(runId, rec);

    const send = (type, extra) => ctx.send('py:event', Object.assign({ type: type, runId: runId }, extra || {}));

    send('start', {
      file: target.script,
      label: target.label,
      cwd: target.cwd,
      command: rt.executable + ' -u ' + path.basename(target.script),
      pythonVersion: rt.version,
      startedAt: startedAt,
      timeoutMs: timeoutMs
    });

    const outDec = new StringDecoder('utf8');
    const errDec = new StringDecoder('utf8');

    child.stdout.on('data', (buf) => {
      rec.bytesOut += buf.length;
      send('stdout', { data: outDec.write(buf) });
    });
    child.stderr.on('data', (buf) => {
      rec.bytesOut += buf.length;
      send('stderr', { data: errDec.write(buf) });
    });

    child.on('error', (err) => {
      send('stderr', { data: 'Error del proceso: ' + err.message + '\n' });
    });

    if (timeoutMs && timeoutMs > 0) {
      rec.timer = setTimeout(() => {
        if (rec.finished) return;
        rec.timedOut = true;
        send('timeout', { timeoutMs: timeoutMs });
        killTree(child.pid);
        // Red de seguridad: si el arbol se resiste, forzamos el cierre logico.
        setTimeout(() => {
          if (!rec.finished) finish(null, 'SIGKILL');
        }, 2500);
      }, timeoutMs);
    }

    function finish(code, signal) {
      if (rec.finished) return;
      rec.finished = true;
      if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
      const tailOut = outDec.end();
      const tailErr = errDec.end();
      if (tailOut) send('stdout', { data: tailOut });
      if (tailErr) send('stderr', { data: tailErr });
      runs.delete(runId);
      send('exit', {
        code: code,
        signal: signal || null,
        durationMs: nowMs() - rec.startedAt,
        timedOut: rec.timedOut,
        stopped: rec.stopped,
        bytes: rec.bytesOut
      });
      if (!target.saved) {
        fsp.unlink(target.script).catch(() => { /* el temporal puede haber desaparecido */ });
      }
    }

    child.on('close', (code, signal) => finish(code, signal));

    return {
      ok: true,
      runId: runId,
      file: target.script,
      label: target.label,
      cwd: target.cwd,
      timeoutMs: timeoutMs,
      pythonVersion: rt.version
    };
  }).catch((err) => ({ ok: false, error: err.message }));
}

function stopRun(runId, reason) {
  const rec = runId ? runs.get(runId) : Array.from(runs.values())[0];
  if (!rec) return { ok: false, error: 'No hay ninguna ejecucion activa.' };
  rec.stopped = true;
  rec.stopReason = reason || 'usuario';
  killTree(rec.child.pid);
  return { ok: true, runId: rec.id };
}

function writeStdin(runId, text) {
  const rec = runId ? runs.get(runId) : Array.from(runs.values())[0];
  if (!rec || rec.finished) return { ok: false, error: 'No hay ninguna ejecucion esperando entrada.' };
  try {
    rec.child.stdin.write(text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function closeStdin(runId) {
  const rec = runId ? runs.get(runId) : Array.from(runs.values())[0];
  if (!rec || rec.finished) return { ok: false };
  try { rec.child.stdin.end(); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
}

/** Comprobacion de sintaxis real usando el compilador de Python. */
function syntaxCheck(code, fileLabel) {
  return new Promise((resolve) => {
    const rt = runtime.get();
    if (!rt.ok) return resolve({ ok: false, diagnostics: [], error: rt.error });
    const tool = path.join(runtime.projectRoot(), 'python', 'tools', 'pcheck.py');
    if (!fs.existsSync(tool)) return resolve({ ok: true, diagnostics: [] });

    const child = spawn(rt.executable, ['-I', '-u', tool, fileLabel || '<editor>'], {
      env: runtime.childEnv(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    const guard = setTimeout(() => { try { child.kill(); } catch (e) { /* ya murio */ } }, 10000);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', () => { clearTimeout(guard); resolve({ ok: false, diagnostics: [] }); });
    child.on('close', () => {
      clearTimeout(guard);
      try {
        resolve(JSON.parse(out.trim() || '{"ok":true,"diagnostics":[]}'));
      } catch (e) {
        resolve({ ok: false, diagnostics: [], error: err.slice(0, 400) });
      }
    });
    child.stdin.write(code, 'utf8');
    child.stdin.end();
  });
}

/** Simbolos exportados por un modulo instalado, para el autocompletado. */
function moduleSymbols(moduleName) {
  return new Promise((resolve) => {
    const rt = runtime.get();
    if (!rt.ok || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(String(moduleName || ''))) return resolve([]);
    const script =
      'import json,sys\n' +
      'try:\n' +
      '    m=__import__(sys.argv[1], fromlist=["*"])\n' +
      '    names=[n for n in dir(m) if not n.startswith("_")]\n' +
      '    out=[]\n' +
      '    for n in names[:400]:\n' +
      '        try:\n' +
      '            v=getattr(m,n); k="function" if callable(v) else "variable"\n' +
      '        except Exception:\n' +
      '            k="variable"\n' +
      '        out.append({"label":n,"type":k})\n' +
      '    print(json.dumps(out))\n' +
      'except Exception:\n' +
      '    print("[]")\n';
    const child = spawn(rt.executable, ['-I', '-c', script, String(moduleName)], {
      env: runtime.childEnv(), windowsHide: true
    });
    let out = '';
    const guard = setTimeout(() => { try { child.kill(); } catch (e) { /* noop */ } }, 8000);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.on('error', () => { clearTimeout(guard); resolve([]); });
    child.on('close', () => {
      clearTimeout(guard);
      try { resolve(JSON.parse(out.trim() || '[]')); } catch (e) { resolve([]); }
    });
  });
}

function register(ipcMain, ctx) {
  ipcMain.handle('py:run', (_e, payload) => startRun(ctx, payload || {}));
  ipcMain.handle('py:stop', (_e, runId) => stopRun(runId));
  ipcMain.handle('py:stdin', (_e, runId, text) => writeStdin(runId, text));
  ipcMain.handle('py:endStdin', (_e, runId) => closeStdin(runId));
  ipcMain.handle('py:check', (_e, code, label) => syntaxCheck(code, label));
  ipcMain.handle('py:moduleSymbols', (_e, name) => moduleSymbols(name));
  ipcMain.handle('py:active', () => Array.from(runs.values()).map((r) => ({
    runId: r.id, label: r.label, startedAt: r.startedAt
  })));

  ipcMain.handle('py:runtime', (_e, force) => {
    const rt = runtime.get(!!force);
    return {
      ok: rt.ok,
      version: rt.version,
      executable: rt.executable,
      home: rt.home,
      embedded: rt.embedded,
      source: rt.source,
      platform: rt.platformKey,
      warning: rt.warning || null,
      error: rt.error || null
    };
  });

  return {
    stopAll: () => { for (const id of Array.from(runs.keys())) stopRun(id, 'cierre'); }
  };
}

module.exports = { register, killTree };
