/*
 * Almacenamiento local del renderer (IndexedDB).
 *
 * Guarda lo que pertenece a la interfaz y debe sobrevivir a un cierre
 * inesperado sin tocar el disco del proyecto:
 *   - drafts   : borradores de archivos sin guardar y autoguardado
 *   - history  : historial de la terminal y de la consola
 *   - meta     : banderas de la interfaz (tutorial visto, ultimo panel, ...)
 *
 * Los archivos reales del alumno viven en el sistema de archivos, no aqui.
 */

const DB_NAME = 'python-classroom';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('history')) {
        db.createObjectStore('history', { keyPath: 'kind' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try {
      result = fn(s);
    } catch (err) {
      reject(err);
      return;
    }
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/* ---------------------------------------------------------- borradores */

export const drafts = {
  /** doc: {id, name, path, content, dirty, updatedAt} */
  save(doc) {
    return tx('drafts', 'readwrite', (s) => s.put(Object.assign({}, doc, { updatedAt: Date.now() })));
  },
  get(id) {
    return tx('drafts', 'readonly', (s) => s.get(id));
  },
  all() {
    return tx('drafts', 'readonly', (s) => s.getAll());
  },
  remove(id) {
    return tx('drafts', 'readwrite', (s) => s.delete(id));
  },
  clear() {
    return tx('drafts', 'readwrite', (s) => s.clear());
  }
};

/* ---------------------------------------------------------- historiales */

export const history = {
  async get(kind) {
    const row = await tx('history', 'readonly', (s) => s.get(kind));
    return (row && row.items) || [];
  },
  async push(kind, value, max = 200) {
    const items = await history.get(kind);
    const next = [value].concat(items.filter((v) => v !== value)).slice(0, max);
    await tx('history', 'readwrite', (s) => s.put({ kind, items: next }));
    return next;
  },
  async clear(kind) {
    await tx('history', 'readwrite', (s) => s.put({ kind, items: [] }));
  }
};

/* --------------------------------------------------------------- meta */

export const meta = {
  async get(key, fallback = null) {
    const row = await tx('meta', 'readonly', (s) => s.get(key));
    return row ? row.value : fallback;
  },
  set(key, value) {
    return tx('meta', 'readwrite', (s) => s.put({ key, value }));
  }
};

export function ready() {
  return open().then(() => true).catch(() => false);
}
