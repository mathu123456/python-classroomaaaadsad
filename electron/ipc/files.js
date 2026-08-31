'use strict';
/*
 * IPC de sistema de archivos: explorador, apertura/guardado, proyectos.
 *
 * Toda ruta que toca el disco pasa por assertAllowed(): solo se permite trabajar
 * dentro de las carpetas que el usuario ha abierto explicitamente (dialogo del
 * sistema) o dentro del area de datos de la propia aplicacion.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { dialog, shell } = require('electron');

const store = require('../store');

const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const TEXT_EXT = new Set([
  '.py', '.pyw', '.txt', '.md', '.json', '.csv', '.tsv', '.html', '.htm', '.css',
  '.js', '.ts', '.xml', '.yml', '.yaml', '.ini', '.cfg', '.toml', '.log', '.sql',
  '.pclass', '.env', '.bat', '.sh', '.gitignore', ''
]);

/** Raices autorizadas para operaciones de archivo. */
const allowedRoots = new Set();
let watcher = null;
let watchTimer = null;

function normalize(p) {
  return path.resolve(p);
}

function allowRoot(p) {
  if (!p) return;
  allowedRoots.add(normalize(p));
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function assertAllowed(p) {
  const target = normalize(p);
  for (const root of allowedRoots) {
    if (isInside(target, root)) return target;
  }
  throw new Error('Acceso denegado a una ruta fuera del espacio de trabajo: ' + target);
}

function initRoots() {
  allowRoot(store.workspacesDir());
  allowRoot(store.tmpDir());
  const session = store.getSession();
  if (session.workspace && fs.existsSync(session.workspace)) allowRoot(session.workspace);
  for (const r of session.recent || []) if (fs.existsSync(r)) allowRoot(r);
}

/**
 * Al cambiar de usuario se vacia la lista de rutas permitidas y se vuelve a
 * construir: en un equipo compartido, un estudiante no hereda el acceso a las
 * carpetas que abrio el anterior.
 */
function resetRoots() {
  allowedRoots.clear();
  initRoots();
  return allowedRoots.size;
}

function iconFor(name, isDir) {
  if (isDir) return 'folder';
  const ext = path.extname(name).toLowerCase();
  if (ext === '.py' || ext === '.pyw') return 'python';
  if (ext === '.json') return 'json';
  if (ext === '.md' || ext === '.txt') return 'text';
  if (ext === '.csv' || ext === '.tsv') return 'table';
  if (ext === '.pclass') return 'pclass';
  return 'file';
}

const HIDDEN = new Set(['__pycache__', '.git', 'node_modules', '.venv', '.idea', '.vscode', '.DS_Store']);

/*
 * Limites al recoger una carpeta entera (entregas de varios archivos).
 *
 * Una entrega viaja dentro de un registro de la base de datos compartida, asi
 * que no puede ser un proyecto de cualquier tamano. Estos numeros dan de sobra
 * para un trabajo de clase con varios modulos y dejan fuera lo que no tiene
 * sentido entregar (imagenes, entornos virtuales, datos enormes).
 */
const LIMITES_CARPETA = {
  maxArchivos: 60,
  maxBytesArchivo: 200 * 1024,
  maxBytesTotal: 1500 * 1024,
  maxProfundidad: 6
};

/** Nombre relativo con barras normales: se ve igual en Windows y en Linux. */
function relativoPosix(base, full) {
  return path.relative(base, full).split(path.sep).join('/');
}

/**
 * Recoge el contenido de texto de una carpeta, con sus subcarpetas.
 *
 * Devuelve lo que se puede entregar y, por separado, lo que se dejo fuera y por
 * que: al estudiante hay que decirselo, no callarselo.
 */
async function collectFolder(dirPath, opciones) {
  const base = assertAllowed(dirPath);
  const o = opciones || {};
  const excluir = new Set((o.excluir || []).map((x) => String(x)));
  const maxArchivos = Math.min(Number(o.maxArchivos) || LIMITES_CARPETA.maxArchivos, 200);
  const maxBytesTotal = Math.min(Number(o.maxBytesTotal) || LIMITES_CARPETA.maxBytesTotal, 4 * 1024 * 1024);

  const archivos = [];
  const omitidos = [];
  let bytes = 0;

  async function recorrer(dir, profundidad) {
    if (profundidad > LIMITES_CARPETA.maxProfundidad) {
      omitidos.push({ name: relativoPosix(base, dir), motivo: 'la carpeta está muy anidada' });
      return;
    }
    let entradas = [];
    try {
      entradas = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    entradas.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));

    for (const e of entradas) {
      if (HIDDEN.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = relativoPosix(base, full);
      if (excluir.has(rel) || excluir.has(e.name)) continue;

      if (e.isDirectory()) {
        await recorrer(full, profundidad + 1);
        continue;
      }
      if (!e.isFile()) continue;

      const ext = path.extname(e.name).toLowerCase();
      if (!TEXT_EXT.has(ext)) {
        omitidos.push({ name: rel, motivo: 'no es un archivo de texto' });
        continue;
      }
      let st;
      try { st = await fsp.stat(full); } catch (err) { continue; }
      if (st.size > LIMITES_CARPETA.maxBytesArchivo) {
        omitidos.push({ name: rel, motivo: 'pesa más de ' + Math.round(LIMITES_CARPETA.maxBytesArchivo / 1024) + ' KB' });
        continue;
      }
      if (archivos.length >= maxArchivos) {
        omitidos.push({ name: rel, motivo: 'ya se alcanzó el máximo de ' + maxArchivos + ' archivos' });
        continue;
      }
      if (bytes + st.size > maxBytesTotal) {
        omitidos.push({ name: rel, motivo: 'la entrega completa no puede pasar de ' +
          Math.round(maxBytesTotal / 1024) + ' KB' });
        continue;
      }

      let buf;
      try { buf = await fsp.readFile(full); } catch (err) { continue; }
      if (looksBinary(buf) && ext !== '') {
        omitidos.push({ name: rel, motivo: 'no es un archivo de texto' });
        continue;
      }
      archivos.push({ name: rel, content: buf.toString('utf8'), bytes: st.size });
      bytes += st.size;
    }
  }

  await recorrer(base, 0);
  return { carpeta: base, archivos: archivos, omitidos: omitidos, bytes: bytes };
}

/** Copia una carpeta entera dentro de otra, respetando los mismos limites. */
async function copyFolderInto(origen, destinoPadre, nombre) {
  const destino = assertAllowed(destinoPadre);
  const src = path.resolve(origen);
  if (isInside(destino, src)) {
    throw new Error('No se puede copiar una carpeta dentro de sí misma.');
  }

  const raiz = uniquePath(destino, nombre || path.basename(src));
  let copiados = 0;
  const omitidos = [];

  async function copiar(desdeDir, haciaDir, profundidad) {
    if (profundidad > LIMITES_CARPETA.maxProfundidad) return;
    await fsp.mkdir(haciaDir, { recursive: true });
    let entradas = [];
    try {
      entradas = await fsp.readdir(desdeDir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const e of entradas) {
      if (HIDDEN.has(e.name)) continue;
      const desde = path.join(desdeDir, e.name);
      const hacia = path.join(haciaDir, e.name);
      if (e.isDirectory()) {
        await copiar(desde, hacia, profundidad + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      let st;
      try { st = await fsp.stat(desde); } catch (err) { continue; }
      if (!TEXT_EXT.has(ext)) {
        omitidos.push({ name: e.name, motivo: 'no es un archivo de texto' });
        continue;
      }
      if (st.size > LIMITES_CARPETA.maxBytesArchivo) {
        omitidos.push({ name: e.name, motivo: 'pesa más de ' + Math.round(LIMITES_CARPETA.maxBytesArchivo / 1024) + ' KB' });
        continue;
      }
      await fsp.copyFile(desde, hacia);
      copiados++;
    }
  }

  await copiar(src, raiz, 0);
  return { path: raiz, name: path.basename(raiz), copiados: copiados, omitidos: omitidos };
}

/**
 * Escribe una lista de archivos [{name, content}] dentro de una carpeta.
 *
 * Se usa para dejar una entrega lista para ejecutarse. Los nombres vienen de
 * otro equipo, asi que se limpian: nada de rutas absolutas ni de «..».
 */
async function writeFileList(destinoDir, lista) {
  const destino = path.resolve(destinoDir);
  await fsp.mkdir(destino, { recursive: true });
  const escritos = [];
  for (const f of lista || []) {
    const bruto = String((f && f.name) || '').replace(/\\/g, '/');
    const partes = bruto.split('/')
      .map((x) => x.trim())
      .filter((x) => x && x !== '.' && x !== '..')
      .map((x) => x.replace(/[:*?"<>|]/g, '_'));
    if (!partes.length) continue;
    const full = path.join(destino, partes.join(path.sep));
    if (!isInside(full, destino)) continue;
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, String((f && f.content) || ''), 'utf8');
    escritos.push({ name: partes.join('/'), path: full });
  }
  return escritos;
}

async function listDir(dirPath) {
  const dir = assertAllowed(dirPath);
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (HIDDEN.has(e.name)) continue;
    const full = path.join(dir, e.name);
    let size = 0;
    let mtime = 0;
    try {
      const st = await fsp.stat(full);
      size = st.size;
      mtime = st.mtimeMs;
    } catch (err) { continue; }
    out.push({
      name: e.name,
      path: full,
      type: e.isDirectory() ? 'dir' : 'file',
      icon: iconFor(e.name, e.isDirectory()),
      size: size,
      mtime: mtime
    });
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'es', { numeric: true });
  });
  return out;
}

function looksBinary(buf) {
  const len = Math.min(buf.length, 4096);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

async function readTextFile(filePath) {
  const file = assertAllowed(filePath);
  const st = await fsp.stat(file);
  if (st.size > MAX_TEXT_BYTES) {
    throw new Error('El archivo pesa ' + (st.size / 1048576).toFixed(1) + ' MB y supera el limite del editor (8 MB).');
  }
  const buf = await fsp.readFile(file);
  const ext = path.extname(file).toLowerCase();
  if (looksBinary(buf) && !TEXT_EXT.has(ext)) {
    throw new Error('Este archivo es binario y no se puede abrir en el editor.');
  }
  return {
    path: file,
    name: path.basename(file),
    content: buf.toString('utf8'),
    size: st.size,
    mtime: st.mtimeMs
  };
}

async function writeTextFile(filePath, content) {
  const file = assertAllowed(filePath);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.pcsave';
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, file);
  const st = await fsp.stat(file);
  return { path: file, size: st.size, mtime: st.mtimeMs };
}

function uniquePath(dir, name) {
  let candidate = path.join(dir, name);
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, base + '_' + i + ext);
    i++;
  }
  return candidate;
}

const PROJECT_MAIN = [
  '# main.py - punto de entrada del proyecto',
  '',
  '',
  'def main():',
  '    print("Hola desde Python Classroom")',
  '',
  '',
  'if __name__ == "__main__":',
  '    main()',
  ''
].join('\n');

const PROJECT_FUNCS = [
  '"""Funciones auxiliares del proyecto."""',
  '',
  '',
  'def saludar(nombre):',
  '    return f"Hola, {nombre}!"',
  '',
  '',
  'def promedio(numeros):',
  '    if not numeros:',
  '        return 0',
  '    return sum(numeros) / len(numeros)',
  ''
].join('\n');

async function createProject(parentDir, name) {
  const parent = assertAllowed(parentDir);
  const safe = String(name || 'MiProyecto').replace(/[\\/:*?"<>|]/g, '_').trim() || 'MiProyecto';
  const root = uniquePath(parent, safe);
  await fsp.mkdir(root, { recursive: true });
  allowRoot(root);
  await fsp.writeFile(path.join(root, 'main.py'), PROJECT_MAIN, 'utf8');
  await fsp.writeFile(path.join(root, 'funciones.py'), PROJECT_FUNCS, 'utf8');
  await fsp.writeFile(path.join(root, 'datos.json'), JSON.stringify({ ejemplo: true, valores: [1, 2, 3] }, null, 2), 'utf8');
  await fsp.writeFile(path.join(root, 'README.txt'),
    'Proyecto ' + path.basename(root) + '\n\nCreado con Python Classroom.\n' +
    'Ejecuta main.py con el boton Ejecutar o con Ctrl+Enter.\n', 'utf8');
  return { path: root, name: path.basename(root) };
}

function stopWatch() {
  if (watcher) {
    try { watcher.close(); } catch (err) { /* ignorado */ }
    watcher = null;
  }
  if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
}

function startWatch(root, send) {
  stopWatch();
  if (!root || !fs.existsSync(root)) return;
  try {
    watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
      if (filename && /(\.pcsave$|__pycache__)/.test(String(filename))) return;
      if (watchTimer) clearTimeout(watchTimer);
      watchTimer = setTimeout(() => send('fs:changed', { root: root }), 300);
    });
    watcher.on('error', () => stopWatch());
  } catch (err) {
    // fs.watch recursivo no esta disponible en todas las plataformas: se ignora.
  }
}

function register(ipcMain, ctx) {
  initRoots();
  const send = (channel, payload) => {
    const win = ctx.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  ipcMain.handle('fs:openFolderDialog', async () => {
    const res = await dialog.showOpenDialog(ctx.getWindow(), {
      title: 'Abrir carpeta de proyecto',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths.length) return null;
    const folder = res.filePaths[0];
    allowRoot(folder);
    store.pushRecent(folder);
    store.setSession({ workspace: folder });
    startWatch(folder, send);
    return { path: folder, name: path.basename(folder) };
  });

  ipcMain.handle('fs:openFileDialog', async () => {
    const res = await dialog.showOpenDialog(ctx.getWindow(), {
      title: 'Abrir archivo',
      properties: ['openFile'],
      filters: [
        { name: 'Python', extensions: ['py', 'pyw'] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePaths.length) return null;
    const file = res.filePaths[0];
    allowRoot(path.dirname(file));
    return readTextFile(file);
  });

  ipcMain.handle('fs:openFilesDialog', async () => {
    const res = await dialog.showOpenDialog(ctx.getWindow(), {
      title: 'Subir archivos del ejercicio',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Archivos de texto y Python', extensions: ['py', 'pyw', 'txt', 'md', 'json', 'csv', 'tsv'] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePaths.length) return [];
    const files = [];
    for (const file of res.filePaths) {
      allowRoot(path.dirname(file));
      const loaded = await readTextFile(file);
      files.push({ name: loaded.name, content: loaded.content });
    }
    return files;
  });

  ipcMain.handle('fs:saveAsDialog', async (_e, defaultName) => {
    const res = await dialog.showSaveDialog(ctx.getWindow(), {
      title: 'Guardar como',
      defaultPath: defaultName || 'sin_titulo.py',
      filters: [
        { name: 'Python', extensions: ['py'] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePath) return null;
    allowRoot(path.dirname(res.filePath));
    return { path: res.filePath, name: path.basename(res.filePath) };
  });

  ipcMain.handle('fs:openWorkspace', async (_e, folder) => {
    const root = assertAllowed(folder);
    if (!fs.existsSync(root)) throw new Error('La carpeta ya no existe: ' + root);
    store.pushRecent(root);
    store.setSession({ workspace: root });
    startWatch(root, send);
    return { path: root, name: path.basename(root) };
  });

  ipcMain.handle('fs:list', (_e, dirPath) => listDir(dirPath));
  ipcMain.handle('fs:read', (_e, filePath) => readTextFile(filePath));
  ipcMain.handle('fs:write', (_e, filePath, content) => writeTextFile(filePath, content));

  /* Recoge una carpeta entera: es lo que se entrega cuando hay varios archivos. */
  ipcMain.handle('fs:collect', (_e, dirPath, opciones) => collectFolder(dirPath, opciones));

  /*
   * Trae una carpeta de fuera (la elige el usuario en el dialogo del sistema) y
   * la copia dentro del espacio de trabajo: asi se entregan trabajos que ya
   * estaban hechos, con sus modulos, sin tener que rehacerlos.
   */
  ipcMain.handle('fs:importFolder', async (_e, destinoDir) => {
    const destino = assertAllowed(destinoDir);
    const res = await dialog.showOpenDialog(ctx.getWindow(), {
      title: 'Elegir la carpeta que quieres añadir',
      properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return copyFolderInto(res.filePaths[0], destino, null);
  });

  ipcMain.handle('fs:createFile', async (_e, dirPath, name) => {
    const dir = assertAllowed(dirPath);
    const file = uniquePath(dir, name || 'nuevo_archivo.py');
    await fsp.writeFile(file, '', 'utf8');
    return { path: file, name: path.basename(file) };
  });

  ipcMain.handle('fs:createDir', async (_e, dirPath, name) => {
    const dir = assertAllowed(dirPath);
    const target = uniquePath(dir, name || 'nueva_carpeta');
    await fsp.mkdir(target, { recursive: true });
    return { path: target, name: path.basename(target) };
  });

  ipcMain.handle('fs:rename', async (_e, target, newName) => {
    const src = assertAllowed(target);
    const clean = String(newName).replace(/[\\/:*?"<>|]/g, '_');
    const dst = path.join(path.dirname(src), clean);
    if (fs.existsSync(dst)) throw new Error('Ya existe un elemento con ese nombre.');
    await fsp.rename(src, dst);
    return { path: dst, name: path.basename(dst) };
  });

  ipcMain.handle('fs:delete', async (_e, target) => {
    const p = assertAllowed(target);
    await shell.trashItem(p);
    return { path: p };
  });

  ipcMain.handle('fs:reveal', (_e, target) => {
    shell.showItemInFolder(assertAllowed(target));
    return true;
  });

  ipcMain.handle('fs:exists', (_e, target) => fs.existsSync(normalize(target)));

  ipcMain.handle('fs:createProject', async (_e, parentDir, name) => {
    const parent = parentDir ? parentDir : store.workspacesDir();
    return createProject(parent, name);
  });

  ipcMain.handle('fs:newProjectDialog', async (_e, name) => {
    const res = await dialog.showOpenDialog(ctx.getWindow(), {
      title: 'Elige donde crear el proyecto',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: store.workspacesDir()
    });
    if (res.canceled || !res.filePaths.length) return null;
    allowRoot(res.filePaths[0]);
    const project = await createProject(res.filePaths[0], name);
    store.pushRecent(project.path);
    store.setSession({ workspace: project.path });
    startWatch(project.path, send);
    return project;
  });

  ipcMain.handle('fs:defaultWorkspacesDir', () => store.workspacesDir());

  return {
    allowRoot: allowRoot,
    assertAllowed: assertAllowed,
    resetRoots: resetRoots,
    stopWatch: stopWatch,
    startWatch: startWatch
  };
}

module.exports = {
  register, allowRoot, assertAllowed, resetRoots, initRoots,
  collectFolder, copyFolderInto, writeFileList, LIMITES_CARPETA
};
