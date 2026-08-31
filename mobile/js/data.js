/*
 * Capa de datos de la app móvil.
 *
 * Diferencia clave con el escritorio: aquí NO hay SQLite. La fuente de verdad
 * es la Realtime Database, y lo que se guarda en el teléfono es solo una copia
 * para poder mirar sin conexión (localStorage, que en un móvil es lo que hay).
 *
 * Las claves y los nodos son exactamente los mismos que usa la aplicación de
 * escritorio, así que una entrega hecha desde el teléfono aparece en la bandeja
 * del profesor como cualquier otra.
 */

import * as fb from './fb.js';

const CACHE = 'pc-movil-cache-v1';

/* ------------------------------------------------------------- cache */

function leerCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE) || '{}');
  } catch (err) {
    return {};
  }
}

function guardarCache(clave, valor) {
  const todo = leerCache();
  todo[clave] = { valor: valor, en: new Date().toISOString() };
  try {
    localStorage.setItem(CACHE, JSON.stringify(todo));
  } catch (err) {
    // Sin espacio: se sigue trabajando en línea, no se rompe nada.
  }
}

export function desdeCache(clave) {
  const entrada = leerCache()[clave];
  return entrada ? entrada : null;
}

/**
 * Lee de Firebase y guarda copia; si falla, devuelve la copia y avisa de que es
 * antigua. Nunca inventa datos.
 */
async function conCache(clave, ruta) {
  try {
    const valor = await fb.leer(ruta);
    guardarCache(clave, valor);
    return { valor: valor, deCache: false, en: new Date().toISOString() };
  } catch (err) {
    const copia = desdeCache(clave);
    if (!copia) throw err;
    return { valor: copia.valor, deCache: true, en: copia.en, error: fb.traducirError(err) };
  }
}

/* ------------------------------------------------------------ perfil */

export async function miPerfil(uid) {
  const res = await conCache('perfil', 'users/' + uid);
  const rol = await miRol(uid);
  const p = res.valor || {};
  return {
    uid: uid,
    nombre: (String(p.firstName || '') + ' ' + String(p.lastName || '')).trim() || p.email || '',
    correo: p.email || '',
    grado: p.grade || '',
    grupo: p.groupName || '',
    color: p.color || '#4b8bf5',
    rol: rol,
    deCache: res.deCache
  };
}

export async function miRol(uid) {
  const res = await conCache('rol', 'roles/' + uid);
  return res.valor === 'teacher' ? 'profesor' : 'estudiante';
}

/** Crea el perfil de un alta nueva. El rol lo escribe como 'student'. */
export async function crearPerfilEstudiante(uid, datos) {
  const ahora = new Date().toISOString();
  await fb.escribir('roles/' + uid, 'student');
  await fb.escribir('users/' + uid, {
    email: datos.correo,
    firstName: datos.nombre,
    lastName: datos.apellido,
    grade: datos.grado || '',
    groupName: datos.grupo || '',
    active: true,
    createdAt: ahora,
    updatedAt: ahora,
    lastLoginAt: ahora
  });
}

/* -------------------------------------------------- temario y ejercicios */

export async function temas() {
  const res = await conCache('topics', 'topics');
  const lista = fb.comoLista(res.valor);
  return { items: lista, deCache: res.deCache, en: res.en };
}

export async function ejercicios() {
  const res = await conCache('exercises', 'exercises');
  const lista = fb.comoLista(res.valor)
    .filter((e) => ['published', 'active', 'closed'].indexOf(e.status) !== -1)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return { items: lista, deCache: res.deCache, en: res.en };
}

export async function retos() {
  const res = await conCache('challenges', 'challenges');
  const lista = fb.comoLista(res.valor).filter((r) => r.status === 'published');
  return { items: lista, deCache: res.deCache, en: res.en };
}

/* --------------------------------------------------------- mis entregas */

export async function misEntregas(uid) {
  try {
    const datos = await fb.consultarPor('submissions', 'studentId', uid);
    const lista = fb.comoLista(datos)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    guardarCache('submissions', datos);
    return { items: lista, deCache: false };
  } catch (err) {
    const copia = desdeCache('submissions');
    if (!copia) throw err;
    return { items: fb.comoLista(copia.valor), deCache: true, en: copia.en };
  }
}

/** Comentarios por línea de una entrega (solo los de las propias). */
export async function comentarios(submissionId) {
  try {
    return fb.comoLista(await fb.leer('feedback/' + submissionId));
  } catch (err) {
    return [];
  }
}

function idEntrega(uid, exerciseId, intento) {
  return 'sub_movil_' + uid.slice(0, 8) + '_' + exerciseId.slice(-8) + '_' + intento;
}

/**
 * Entrega desde el teléfono.
 *
 * Escribe el mismo nodo que la aplicación de escritorio, con los campos que las
 * reglas permiten a un estudiante: NUNCA nota, XP ni comentario del profesor.
 */
export async function entregar(uid, ejercicio, codigo, datosPrevios) {
  const previas = (datosPrevios || []).filter((s) => s.exerciseId === ejercicio.id);
  const intento = previas.reduce((max, s) => Math.max(max, Number(s.attemptNumber) || 0), 0) + 1;
  const ahora = new Date().toISOString();
  const id = idEntrega(uid, ejercicio.id, intento);

  const tarde = !!(ejercicio.dueDate && new Date(ejercicio.dueDate).getTime() < Date.now());
  if (tarde && ejercicio.allowLateSubmission === false) {
    throw new Error('La fecha límite pasó y este ejercicio no admite entregas tardías.');
  }

  const cuerpo = {
    studentId: uid,
    exerciseId: ejercicio.id,
    attemptNumber: intento,
    code: String(codigo || ''),
    status: tarde ? 'late' : 'submitted',
    startedAt: ahora,
    submittedAt: ahora,
    maxScore: Number(ejercicio.maxScore) || 5,
    timeSpentSec: 0,
    isLate: tarde,
    updatedAt: ahora,
    origen: 'movil'
  };

  await fb.escribir('submissions/' + id, cuerpo);
  return Object.assign({ id: id }, cuerpo);
}

/** Guarda el borrador en el teléfono. No toca Firebase: es trabajo en curso. */
export function guardarBorrador(exerciseId, codigo) {
  try {
    localStorage.setItem('pc-borrador-' + exerciseId, JSON.stringify({ codigo: codigo, en: new Date().toISOString() }));
  } catch (err) { /* sin espacio */ }
}

export function borrador(exerciseId) {
  try {
    const raw = localStorage.getItem('pc-borrador-' + exerciseId);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

export function olvidarBorrador(exerciseId) {
  try { localStorage.removeItem('pc-borrador-' + exerciseId); } catch (err) { /* nada */ }
}

/* --------------------------------------------------- ranking e insignias */

export async function ranking() {
  const res = await conCache('rankings', 'rankings');
  const datos = res.valor || {};
  return {
    global: Array.isArray(datos.global) ? datos.global : [],
    topics: datos.topics || {},
    grades: datos.grades || {},
    actualizadoEn: datos.updatedAt || null,
    deCache: res.deCache,
    descargadoEn: res.en
  };
}

export async function limitePuestos() {
  try {
    const n = await fb.leer('config/rankingLimit');
    return n == null ? 0 : Math.max(0, Number(n) || 0);
  } catch (err) {
    return 0;
  }
}

export async function insignias(uid) {
  const catalogo = await conCache('badges', 'badges');
  let mias = {};
  try {
    mias = (await fb.leer('userBadges/' + uid)) || {};
    guardarCache('userBadges', mias);
  } catch (err) {
    const copia = desdeCache('userBadges');
    mias = copia ? copia.valor || {} : {};
  }

  const items = fb.comoLista(catalogo.valor)
    .filter((b) => b.active !== false)
    .map((b) => Object.assign({}, b, {
      conseguida: !!mias[b.id],
      grantedAt: mias[b.id] ? mias[b.id].grantedAt : null,
      reason: mias[b.id] ? mias[b.id].reason : ''
    }))
    .sort((a, b) => (b.conseguida ? 1 : 0) - (a.conseguida ? 1 : 0) ||
      String(a.name || '').localeCompare(String(b.name || ''), 'es'));

  return {
    items: items,
    conseguidas: items.filter((b) => b.conseguida).length,
    deCache: catalogo.deCache
  };
}

/* ------------------------------------------------------------- progreso */

/** Progreso publicado por el profesor (studentProgress/<uid>). */
export async function miProgreso(uid) {
  try {
    const p = await fb.leer('studentProgress/' + uid);
    guardarCache('progreso', p);
    return p || null;
  } catch (err) {
    const copia = desdeCache('progreso');
    return copia ? copia.valor : null;
  }
}
