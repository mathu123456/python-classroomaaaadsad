'use strict';
/*
 * Gestor de librerias (pip del runtime interno).
 *
 * - Listar / actualizar / instalar / desinstalar paquetes con salida en vivo.
 * - Buscar en un catalogo educativo local (funciona sin Internet) y consultar
 *   PyPI por nombre exacto cuando hay conexion.
 * - Nunca usa el pip del Python global del sistema.
 */

const https = require('https');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const runtime = require('../runtime');
const catalog = require('../catalog');

let current = null;   // operacion pip en curso
let opSeq = 0;

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,213}$/;

function validName(name) {
  return NAME_RE.test(String(name || '').trim());
}

function pipJson(args) {
  return new Promise((resolve) => {
    const rt = runtime.get();
    if (!rt.ok) return resolve({ ok: false, error: rt.error, items: [] });
    const child = spawn(rt.executable, ['-m', 'pip'].concat(args), {
      env: runtime.childEnv(), windowsHide: true
    });
    let out = '';
    let err = '';
    const guard = setTimeout(() => { try { child.kill(); } catch (e) { /* noop */ } }, 90000);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(guard); resolve({ ok: false, error: e.message, items: [] }); });
    child.on('close', (code) => {
      clearTimeout(guard);
      if (code !== 0) return resolve({ ok: false, error: err.trim() || ('pip salio con codigo ' + code), items: [] });
      try {
        resolve({ ok: true, items: JSON.parse(out.trim() || '[]') });
      } catch (e) {
        resolve({ ok: false, error: 'Respuesta de pip no valida.', items: [] });
      }
    });
  });
}

function pipShow(name) {
  return new Promise((resolve) => {
    const rt = runtime.get();
    if (!rt.ok || !validName(name)) return resolve(null);
    const child = spawn(rt.executable, ['-m', 'pip', 'show', String(name)], {
      env: runtime.childEnv(), windowsHide: true
    });
    let out = '';
    const guard = setTimeout(() => { try { child.kill(); } catch (e) { /* noop */ } }, 30000);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.on('error', () => { clearTimeout(guard); resolve(null); });
    child.on('close', () => {
      clearTimeout(guard);
      if (!out.trim()) return resolve(null);
      const info = {};
      out.split(/\r?\n/).forEach((line) => {
        const i = line.indexOf(':');
        if (i > 0) info[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      });
      resolve(info.name ? info : null);
    });
  });
}

function pypi(name) {
  return new Promise((resolve) => {
    if (!validName(name)) return resolve(null);
    const url = 'https://pypi.org/pypi/' + encodeURIComponent(name) + '/json';
    const req = https.get(url, { headers: { 'User-Agent': 'PythonClassroom' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; if (data.length > 4e6) req.destroy(); });
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve({
            name: j.info.name,
            version: j.info.version,
            summary: j.info.summary || '',
            author: j.info.author || j.info.author_email || '',
            homepage: j.info.home_page || (j.info.project_urls && j.info.project_urls.Homepage) || '',
            license: j.info.license || '',
            requiresPython: j.info.requires_python || '',
            releases: Object.keys(j.releases || {}).slice(-40).reverse()
          });
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(12000, () => { req.destroy(); resolve(null); });
  });
}

function runPip(ctx, op, args, label) {
  const rt = runtime.get();
  if (!rt.ok) return { ok: false, error: rt.error };
  if (current) return { ok: false, error: 'Ya hay una operacion de pip en curso: ' + current.op };

  opSeq += 1;
  const opId = 'pip_' + opSeq;
  const started = Date.now();
  const child = spawn(rt.executable, ['-m', 'pip'].concat(args), {
    env: runtime.childEnv({ PIP_PROGRESS_BAR: 'off' }),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  current = { opId: opId, op: op, child: child, label: label };

  const send = (type, extra) => ctx.send('pkg:event', Object.assign({ opId: opId, op: op, name: label, type: type }, extra || {}));
  send('start', { command: 'pip ' + args.join(' ') });

  const outDec = new StringDecoder('utf8');
  const errDec = new StringDecoder('utf8');
  child.stdout.on('data', (b) => send('log', { data: outDec.write(b), stream: 'stdout' }));
  child.stderr.on('data', (b) => send('log', { data: errDec.write(b), stream: 'stderr' }));
  child.on('error', (e) => send('log', { data: 'Error: ' + e.message + '\n', stream: 'stderr' }));
  child.on('close', (code, signal) => {
    const tail = outDec.end();
    const tailErr = errDec.end();
    if (tail) send('log', { data: tail, stream: 'stdout' });
    if (tailErr) send('log', { data: tailErr, stream: 'stderr' });
    current = null;
    send('done', { code: code, signal: signal || null, durationMs: Date.now() - started, ok: code === 0 });
  });

  return { ok: true, opId: opId };
}

function register(ipcMain, ctx) {
  ipcMain.handle('pkg:list', async () => {
    const res = await pipJson(['list', '--format=json', '--disable-pip-version-check']);
    if (!res.ok) return res;
    const items = res.items.map((p) => {
      const cat = catalog.find((c) => c.name.toLowerCase() === String(p.name).toLowerCase());
      return {
        name: p.name,
        version: p.version,
        summary: cat ? cat.summary : '',
        installed: true
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    return { ok: true, items: items };
  });

  ipcMain.handle('pkg:outdated', async () => {
    const res = await pipJson(['list', '--outdated', '--format=json', '--disable-pip-version-check']);
    if (!res.ok) return res;
    return {
      ok: true,
      items: res.items.map((p) => ({
        name: p.name, version: p.version, latest: p.latest_version, type: p.latest_filetype
      }))
    };
  });

  ipcMain.handle('pkg:catalog', () => catalog);

  ipcMain.handle('pkg:search', async (_e, query, opts) => {
    const q = String(query || '').trim().toLowerCase();
    const online = !(opts && opts.offline === true);
    const installedRes = await pipJson(['list', '--format=json', '--disable-pip-version-check']);
    const installed = new Map();
    if (installedRes.ok) {
      for (const p of installedRes.items) installed.set(String(p.name).toLowerCase().replace(/_/g, '-'), p.version);
    }

    const key = (n) => String(n).toLowerCase().replace(/_/g, '-');
    const local = catalog
      .filter((c) => !q || c.name.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        (c.tags || []).some((t) => t.includes(q)))
      .map((c) => ({
        name: c.name,
        summary: c.summary,
        tags: c.tags || [],
        source: 'catalogo',
        installedVersion: installed.get(key(c.name)) || null
      }));

    let remote = null;
    if (q && online && !local.some((l) => l.name.toLowerCase() === q)) {
      const info = await pypi(q);
      if (info) {
        remote = {
          name: info.name,
          summary: info.summary,
          tags: [],
          source: 'pypi',
          latest: info.version,
          installedVersion: installed.get(key(info.name)) || null
        };
      }
    }

    const items = remote ? [remote].concat(local) : local;
    return { ok: true, items: items, online: online, query: q };
  });

  ipcMain.handle('pkg:info', async (_e, name) => {
    if (!validName(name)) return { ok: false, error: 'Nombre de paquete no valido.' };
    const [local, remote] = await Promise.all([pipShow(name), pypi(name)]);
    const cat = catalog.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
    if (!local && !remote) {
      return { ok: false, error: 'No se encontro informacion de "' + name + '". Revisa el nombre o tu conexion.' };
    }
    return {
      ok: true,
      name: (remote && remote.name) || (local && local.name) || name,
      installedVersion: local ? local.version : null,
      latestVersion: remote ? remote.version : null,
      summary: (remote && remote.summary) || (local && local.summary) || (cat && cat.summary) || '',
      author: (remote && remote.author) || (local && local.author) || '',
      homepage: (remote && remote.homepage) || (local && local['home-page']) || '',
      license: (remote && remote.license) || (local && local.license) || '',
      requiresPython: remote ? remote.requiresPython : '',
      location: local ? local.location : '',
      requires: local && local.requires ? local.requires.split(',').map((s) => s.trim()).filter(Boolean) : [],
      releases: remote ? remote.releases : [],
      offline: !remote
    };
  });

  ipcMain.handle('pkg:install', (_e, name, version) => {
    if (!validName(name)) return { ok: false, error: 'Nombre de paquete no valido.' };
    const spec = version ? String(name) + '==' + String(version).replace(/[^0-9A-Za-z.\-+]/g, '') : String(name);
    return runPip(ctx, 'install', ['install', '--no-input', '--disable-pip-version-check', spec], String(name));
  });

  ipcMain.handle('pkg:upgrade', (_e, name) => {
    if (!validName(name)) return { ok: false, error: 'Nombre de paquete no valido.' };
    return runPip(ctx, 'upgrade', ['install', '--upgrade', '--no-input', '--disable-pip-version-check', String(name)], String(name));
  });

  ipcMain.handle('pkg:uninstall', (_e, name) => {
    if (!validName(name)) return { ok: false, error: 'Nombre de paquete no valido.' };
    return runPip(ctx, 'uninstall', ['uninstall', '--yes', '--disable-pip-version-check', String(name)], String(name));
  });

  ipcMain.handle('pkg:cancel', () => {
    if (!current) return { ok: false, error: 'No hay ninguna operacion en curso.' };
    require('./python').killTree(current.child.pid);
    return { ok: true };
  });

  ipcMain.handle('pkg:busy', () => ({ busy: !!current, op: current ? current.op : null, name: current ? current.label : null }));

  return { cancelAll: () => { if (current) require('./python').killTree(current.child.pid); } };
}

module.exports = { register };
