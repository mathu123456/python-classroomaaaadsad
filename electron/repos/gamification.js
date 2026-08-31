'use strict';
/*
 * Insignias, premios y rankings (fase 4).
 *
 * Regla de seguridad que gobierna todo este modulo: igual que la nota y el XP,
 * las insignias y los premios SOLO los concede el profesor. El cliente del
 * estudiante puede calcular que le corresponde -para mostrarlo en su vitrina
 * con la condicion que le falta- pero nunca escribe la concesion: la funcion
 * que graba (grant / evaluate) se llama unicamente desde el flujo de
 * calificacion del profesor, y las Security Rules rechazan cualquier escritura
 * de un estudiante en badges/, userBadges/, rewards/ y rankings/.
 *
 * Todas las condiciones automaticas se evaluan con lo que ya hay en SQLite: sin
 * conexion tambien funcionan.
 */

const db = require('../sqlite');
const courses = require('./courses');
const users = require('./users');
const academic = require('./academic');

const TIPOS_REGLA = [
  'exercises_completed',
  'topic_exercises',
  'topic_completed',
  'perfect_scores',
  'challenges_completed',
  'no_late',
  'fast_finish',
  'streak_days',
  'first_submission'
];

const ESTADOS_CERRADOS = ['graded', 'returned'];

/* ------------------------------------------------------------- utiles */

function num(value, def, min, max) {
  const n = Number(value);
  if (!isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function enumOr(value, lista, def) {
  return lista.indexOf(value) !== -1 ? value : def;
}

/* ============================================================ catalogo */

/*
 * Catalogo sugerido: el profesor lo carga de una vez, igual que el temario.
 * Los iconos son simbolos que ya existen en el sprite de src/index.html.
 */
const CATALOGO_SUGERIDO = [
  {
    name: 'Pythonista',
    description: 'Tu primera entrega. De aquí en adelante todo es práctica.',
    icon: 'py', color: '#4b8bf5', xpBonus: 10,
    rule: { tipo: 'first_submission' }
  },
  {
    name: 'Constante',
    description: 'Diez ejercicios completados.',
    icon: 'check-circle', color: '#4bcf87', xpBonus: 30,
    rule: { tipo: 'exercises_completed', n: 10 }
  },
  {
    name: 'Maestro de lógica',
    description: 'Cinco entregas con la nota máxima.',
    icon: 'target', color: '#c58cf5', xpBonus: 40,
    rule: { tipo: 'perfect_scores', n: 5 }
  },
  {
    name: 'Velocista',
    description: 'Terminar un ejercicio cronometrado en menos de la mitad del tiempo.',
    icon: 'clock', color: '#ffd43b', xpBonus: 25,
    rule: { tipo: 'fast_finish', porcentaje: 50 }
  },
  {
    name: 'Puntual',
    description: 'Diez entregas seguidas a tiempo.',
    icon: 'check', color: '#57c7d4', xpBonus: 25,
    rule: { tipo: 'no_late', n: 10 }
  },
  {
    name: 'Retador',
    description: 'Completar un reto especial.',
    icon: 'star', color: '#ff7ab2', xpBonus: 50,
    rule: { tipo: 'challenges_completed', n: 1 }
  },
  {
    name: 'Especialista en Funciones',
    description: 'Cinco ejercicios del tema Funciones, completados.',
    icon: 'target', color: '#c58cf5', xpBonus: 150,
    // El tema se elige al cargar el catalogo: se busca por nombre.
    rule: { tipo: 'topic_exercises', n: 5, temaNombre: 'Funciones' }
  },
  {
    name: 'Maestro del tema',
    description: 'Completar un tema entero.',
    icon: 'book', color: '#f0b23a', xpBonus: 60,
    rule: { tipo: 'topic_completed' }
  }
];

function badgeView(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    nombre: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    type: row.type,
    rule: db.parseJson(row.rule, null),
    xpBonus: row.xpBonus,
    active: !!row.active,
    activa: !!row.active,
    createdAt: row.createdAt,
    otorgadas: row.holders || 0
  };
}

function listBadges(opciones) {
  const soloActivas = opciones && opciones.soloActivas;
  // Cuántos la ganaron EN ESTE CURSO, no en todo el colegio -otro curso no
  // debe ni transparentar cuánta gente tiene una insignia-.
  const cursoId = (courses.activeCourse() || {}).id || null;
  return db.all(
    'SELECT b.*, (SELECT COUNT(*) FROM user_badges ub WHERE ub.badgeId = b.id AND ub.courseId = ?) AS holders' +
    ' FROM badges b' + (soloActivas ? ' WHERE b.active = 1' : '') +
    ' ORDER BY b.active DESC, b.name',
    [cursoId]
  ).map(badgeView);
}

function getBadge(id) {
  return badgeView(db.get('SELECT * FROM badges WHERE id = ?', [id]));
}

/** Valida la regla de una insignia automatica. */
function validarRegla(regla) {
  if (!regla || typeof regla !== 'object') return { ok: false, error: 'Falta la condición de la insignia.' };
  const tipo = String(regla.tipo || regla.type || '');
  if (TIPOS_REGLA.indexOf(tipo) === -1) return { ok: false, error: 'Condición desconocida: ' + tipo };
  const out = { tipo: tipo };
  if (['exercises_completed', 'perfect_scores', 'challenges_completed', 'no_late', 'streak_days'].indexOf(tipo) !== -1) {
    out.n = num(regla.n, 1, 1, 10000);
  }
  if (tipo === 'topic_exercises') {
    out.n = num(regla.n, 1, 1, 10000);
    const tema = regla.topicId || regla.temaId;
    if (!tema) return { ok: false, error: 'Elige el tema del reto.' };
    out.topicId = String(tema);
  }
  if (tipo === 'topic_completed' && (regla.topicId || regla.temaId)) out.topicId = String(regla.topicId || regla.temaId);
  if (tipo === 'fast_finish') out.porcentaje = num(regla.porcentaje, 50, 1, 99);
  return { ok: true, regla: out };
}

function saveBadge(datos, actorUid) {
  const name = users.clean(datos.name || datos.nombre, 60);
  if (name.length < 2) return { ok: false, errores: { name: 'Escribe el nombre de la insignia.' } };

  const dup = db.get('SELECT id FROM badges WHERE lower(name) = lower(?) AND id <> ?', [name, datos.id || '']);
  if (dup) return { ok: false, errores: { name: 'Ya existe una insignia con ese nombre.' } };

  const previo = datos.id ? db.get('SELECT * FROM badges WHERE id = ?', [datos.id]) : null;
  if (datos.id && !previo) return { ok: false, error: 'La insignia no existe.' };

  const tipo = enumOr(datos.type, ['auto', 'manual'], 'manual');
  let regla = null;
  if (tipo === 'auto') {
    const v = validarRegla(datos.rule || datos.regla);
    if (!v.ok) return { ok: false, errores: { rule: v.error } };
    regla = v.regla;
  }

  const row = {
    id: previo ? previo.id : db.newId('badge'),
    name: name,
    description: users.clean(datos.description || datos.descripcion, 300),
    icon: users.clean(datos.icon, 30) || 'star',
    color: users.clean(datos.color, 20) || '#ffd43b',
    type: tipo,
    rule: db.toJson(regla),
    xpBonus: num(datos.xpBonus, 0, 0, 100000),
    active: datos.active === false ? 0 : 1,
    createdBy: previo ? previo.createdBy : actorUid,
    createdAt: previo ? previo.createdAt : db.nowIso(),
    updatedAt: db.nowIso(),
    syncedAt: null
  };
  db.upsert('badges', 'id', row);
  db.enqueue('badges', row.id, 'upsert', remoteBadge(row));
  return { ok: true, insignia: badgeView(row) };
}

function setBadgeActive(id, activa) {
  const row = db.get('SELECT * FROM badges WHERE id = ?', [id]);
  if (!row) return { ok: false, error: 'La insignia no existe.' };
  db.run('UPDATE badges SET active = ?, updatedAt = ? WHERE id = ?', [activa ? 1 : 0, db.nowIso(), id]);
  const actualizado = db.get('SELECT * FROM badges WHERE id = ?', [id]);
  db.enqueue('badges', id, 'upsert', remoteBadge(actualizado));
  return { ok: true, insignia: badgeView(actualizado) };
}

/** Carga el catalogo sugerido sin duplicar lo que ya existe. */
function seedCatalog(actorUid) {
  let creadas = 0;
  db.transaction(() => {
    for (const plantilla of CATALOGO_SUGERIDO) {
      if (db.get('SELECT id FROM badges WHERE lower(name) = lower(?)', [plantilla.name])) continue;
      /*
       * Algunas condiciones apuntan a un tema por su nombre (los retos por
       * temario). Si ese tema no existe todavia en este curso, la insignia no se
       * crea: mas vale no tenerla que tenerla apuntando a nada.
       */
      let regla = plantilla.rule;
      if (regla && regla.temaNombre) {
        const tema = db.get('SELECT id FROM topics WHERE lower(name) = lower(?)', [regla.temaNombre]);
        if (!tema) continue;
        regla = { tipo: regla.tipo, n: regla.n, topicId: tema.id };
      }

      const row = {
        id: db.newId('badge'),
        name: plantilla.name,
        description: plantilla.description,
        icon: plantilla.icon,
        color: plantilla.color,
        type: 'auto',
        rule: db.toJson(regla),
        xpBonus: plantilla.xpBonus,
        active: 1,
        createdBy: actorUid,
        createdAt: db.nowIso(),
        updatedAt: db.nowIso(),
        syncedAt: null
      };
      db.upsert('badges', 'id', row);
      db.enqueue('badges', row.id, 'upsert', remoteBadge(row));
      creadas++;
    }
  });
  return { ok: true, creadas };
}

function remoteBadge(row) {
  return {
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    type: row.type,
    rule: db.parseJson(row.rule, null),
    xpBonus: row.xpBonus,
    active: !!row.active,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

/* ================================================ hechos del estudiante */

/**
 * Todo lo que hace falta para evaluar cualquier regla, en una sola pasada por
 * las entregas del estudiante. Se calcula con SQL indexado (idx_sub_student).
 */
function factsFor(studentUid) {
  const entregas = db.all(
    'SELECT s.*, e.timeLimit AS exTimeLimit, e.maxScore AS exMaxScore, e.topicId AS exTopicId' +
    ' FROM submissions s LEFT JOIN exercises e ON e.id = s.exerciseId' +
    ' WHERE s.studentId = ? ORDER BY COALESCE(s.submittedAt, s.updatedAt)',
    [studentUid]);

  const retosPorEjercicio = new Set(
    db.all('SELECT exerciseId FROM challenges WHERE exerciseId IS NOT NULL').map((r) => r.exerciseId));

  const completados = new Set();
  const retosCompletados = new Set();
  const dias = new Set();
  let entregasTotales = 0;
  let notasPerfectas = 0;
  let rachaPuntual = 0;
  let mejorRachaPuntual = 0;
  let masRapido = null;     // porcentaje del tiempo limite consumido, el menor

  for (const s of entregas) {
    const cerrada = ESTADOS_CERRADOS.indexOf(s.status) !== -1;
    const entregada = cerrada || ['submitted', 'under_review', 'late'].indexOf(s.status) !== -1;
    if (!entregada) continue;

    entregasTotales++;
    completados.add(s.exerciseId);
    if (retosPorEjercicio.has(s.exerciseId) && cerrada) retosCompletados.add(s.exerciseId);

    const cuando = s.submittedAt || s.updatedAt;
    if (cuando) dias.add(String(cuando).slice(0, 10));

    const maxScore = s.maxScore != null ? s.maxScore : s.exMaxScore;
    if (s.grade != null && maxScore != null && s.grade >= maxScore) notasPerfectas++;

    if (s.isLate) rachaPuntual = 0;
    else { rachaPuntual++; mejorRachaPuntual = Math.max(mejorRachaPuntual, rachaPuntual); }

    const limite = (s.exTimeLimit || 0) * 60;
    if (limite > 0 && s.timeSpentSec > 0) {
      const pct = Math.round((s.timeSpentSec / limite) * 100);
      if (masRapido == null || pct < masRapido) masRapido = pct;
    }
  }

  // Ejercicios completados por tema, para los retos de un temario concreto.
  const porTema = {};
  for (const s of entregas) {
    const cerrada = ESTADOS_CERRADOS.indexOf(s.status) !== -1;
    const entregada = cerrada || ['submitted', 'under_review', 'late'].indexOf(s.status) !== -1;
    if (!entregada || !s.exTopicId) continue;
    if (!porTema[s.exTopicId]) porTema[s.exTopicId] = new Set();
    porTema[s.exTopicId].add(s.exerciseId);
  }
  const ejerciciosPorTema = {};
  for (const [tema, conjunto] of Object.entries(porTema)) ejerciciosPorTema[tema] = conjunto.size;

  const temasCompletos = db.all(
    "SELECT topicId FROM student_progress WHERE studentId = ? AND topicId <> '*'" +
    ' AND total > 0 AND completed >= total', [studentUid]).map((r) => r.topicId);

  return {
    studentId: studentUid,
    entregas: entregasTotales,
    ejerciciosCompletados: completados.size,
    retosCompletados: retosCompletados.size,
    notasPerfectas: notasPerfectas,
    rachaPuntual: mejorRachaPuntual,
    rachaPuntualActual: rachaPuntual,
    diasConActividad: dias.size,
    temasCompletos: temasCompletos,
    ejerciciosPorTema: ejerciciosPorTema,
    porcentajeMasRapido: masRapido
  };
}

/**
 * Evalua una regla contra los hechos. Devuelve el avance real, para poder
 * decirle al estudiante exactamente que le falta.
 */
function evalRule(regla, hechos) {
  const r = regla || {};
  const tipo = r.tipo || r.type;

  const conObjetivo = (actual, objetivo, unidad) => ({
    cumple: actual >= objetivo,
    actual: actual,
    objetivo: objetivo,
    texto: actual >= objetivo
      ? 'Conseguida'
      : 'Te falta' + (objetivo - actual === 1 ? ' ' : 'n ') + (objetivo - actual) + ' ' + unidad
  });

  switch (tipo) {
    case 'first_submission':
      return {
        cumple: hechos.entregas >= 1, actual: Math.min(1, hechos.entregas), objetivo: 1,
        texto: hechos.entregas >= 1 ? 'Conseguida' : 'Entrega tu primer ejercicio'
      };
    case 'exercises_completed':
      return conObjetivo(hechos.ejerciciosCompletados, r.n || 1, 'ejercicio(s)');
    case 'perfect_scores':
      return conObjetivo(hechos.notasPerfectas, r.n || 1, 'nota(s) perfecta(s)');
    case 'challenges_completed':
      return conObjetivo(hechos.retosCompletados, r.n || 1, 'reto(s)');
    case 'no_late':
      return conObjetivo(hechos.rachaPuntual, r.n || 1, 'entrega(s) seguida(s) a tiempo');
    case 'streak_days':
      return conObjetivo(hechos.diasConActividad, r.n || 1, 'día(s) con actividad');
    case 'topic_exercises': {
      const objetivo = r.n || 1;
      const hechos_ = (hechos.ejerciciosPorTema || {})[r.topicId] || 0;
      const nombre = academic.topicName(r.topicId);
      return {
        cumple: hechos_ >= objetivo,
        actual: hechos_,
        objetivo: objetivo,
        texto: hechos_ >= objetivo
          ? 'Conseguida'
          : 'Te falta' + (objetivo - hechos_ === 1 ? ' ' : 'n ') + (objetivo - hechos_) +
            ' ejercicio(s) de ' + nombre
      };
    }
    case 'topic_completed': {
      if (r.topicId) {
        const hecho = hechos.temasCompletos.indexOf(r.topicId) !== -1;
        return {
          cumple: hecho, actual: hecho ? 1 : 0, objetivo: 1,
          texto: hecho ? 'Conseguida' : 'Completa el tema ' + academic.topicName(r.topicId)
        };
      }
      return {
        cumple: hechos.temasCompletos.length >= 1,
        actual: hechos.temasCompletos.length, objetivo: 1,
        texto: hechos.temasCompletos.length ? 'Conseguida' : 'Completa un tema entero'
      };
    }
    case 'fast_finish': {
      const objetivo = r.porcentaje || 50;
      const pct = hechos.porcentajeMasRapido;
      return {
        cumple: pct != null && pct < objetivo,
        actual: pct == null ? null : pct,
        objetivo: objetivo,
        texto: pct != null && pct < objetivo
          ? 'Conseguida'
          : 'Entrega un ejercicio cronometrado usando menos del ' + objetivo + '% del tiempo' +
            (pct == null ? '' : ' (tu mejor marca: ' + pct + '%)')
      };
    }
    default:
      return { cumple: false, actual: 0, objetivo: 1, texto: 'Condición desconocida' };
  }
}

/* =========================================================== concesion */

function userBadgeView(row) {
  return {
    id: row.id,
    studentId: row.studentId,
    badgeId: row.badgeId,
    grantedAt: row.grantedAt,
    grantedBy: row.grantedBy,
    reason: row.reason
  };
}

function hasBadge(studentUid, badgeId) {
  return !!db.get('SELECT badgeId FROM user_badges WHERE studentId = ? AND badgeId = ?', [studentUid, badgeId]);
}

/**
 * Concede una insignia. La clave compuesta ya impide el duplicado, pero se
 * comprueba antes para no ensuciar la cola de sincronizacion con una escritura
 * que no cambia nada.
 */
function grant(studentUid, badgeId, teacherUid, motivo) {
  const badge = db.get('SELECT * FROM badges WHERE id = ?', [badgeId]);
  if (!badge) return { ok: false, error: 'La insignia no existe.' };
  if (!db.get('SELECT uid FROM users WHERE uid = ?', [studentUid])) {
    return { ok: false, error: 'El estudiante no existe en este equipo.' };
  }
  if (hasBadge(studentUid, badgeId)) return { ok: true, repetida: true, insignia: badgeView(badge) };

  const courseId = courses.courseIdFor(studentUid);
  const row = {
    id: db.newId('ub'),
    studentId: studentUid,
    badgeId: badgeId,
    courseId: courseId,
    grantedAt: db.nowIso(),
    grantedBy: teacherUid || null,
    reason: users.clean(motivo, 300),
    syncedAt: null
  };
  db.upsert('user_badges', ['studentId', 'badgeId'], row);
  /*
   * opId explícito: dos estudiantes distintos pueden ganar la MISMA insignia
   * (mismo badgeId) antes de que la cola se vacíe. Sin esto, la deduplicación
   * de db.enqueue (que por defecto junta entity+entityId) trataría "Pythonista
   * para Ana" y "Pythonista para Luis" como la MISMA operación pendiente, y
   * la segunda pisaría el payload de la primera antes de que ninguna subiera.
   */
  db.enqueue('userBadges', badgeId, 'upsert', {
    studentId: studentUid,
    badgeId: badgeId,
    courseId: courseId,
    grantedAt: row.grantedAt,
    grantedBy: row.grantedBy,
    reason: row.reason
  }, { opId: 'userBadges:' + studentUid + ':' + badgeId + ':upsert' });
  return { ok: true, repetida: false, concesion: userBadgeView(row), insignia: badgeView(badge) };
}

function revoke(studentUid, badgeId) {
  const courseId = courses.courseIdFor(studentUid);
  db.run('DELETE FROM user_badges WHERE studentId = ? AND badgeId = ?', [studentUid, badgeId]);
  db.enqueue('userBadges', badgeId, 'delete', { studentId: studentUid, badgeId: badgeId, courseId: courseId },
    { opId: 'userBadges:' + studentUid + ':' + badgeId + ':delete' });
  return { ok: true };
}

/**
 * Evalua las insignias automaticas de un estudiante y concede las nuevas.
 * Se llama desde el flujo de calificacion del PROFESOR (repos/work.js), justo
 * despues de recalcular el progreso.
 */
function evaluate(studentUid, teacherUid) {
  const hechos = factsFor(studentUid);
  const nuevas = [];
  for (const b of db.all("SELECT * FROM badges WHERE active = 1 AND type = 'auto'")) {
    if (hasBadge(studentUid, b.id)) continue;
    const regla = db.parseJson(b.rule, null);
    const res = evalRule(regla, hechos);
    if (!res.cumple) continue;
    const out = grant(studentUid, b.id, teacherUid, 'Condición cumplida: ' + (res.texto === 'Conseguida' ? b.name : res.texto));
    if (out.ok && !out.repetida) nuevas.push(badgeView(b));
  }
  return { nuevas: nuevas, hechos: hechos };
}

/**
 * Vitrina de un estudiante: lo que tiene y lo que le falta, con la condicion
 * exacta que queda pendiente.
 */
function showcaseFor(studentUid) {
  const hechos = factsFor(studentUid);
  const concedidas = new Map();
  for (const r of db.all('SELECT * FROM user_badges WHERE studentId = ?', [studentUid])) {
    concedidas.set(r.badgeId, r);
  }

  const items = db.all('SELECT * FROM badges WHERE active = 1 ORDER BY name').map((b) => {
    const tengo = concedidas.get(b.id);
    const regla = db.parseJson(b.rule, null);
    const avance = b.type === 'auto' ? evalRule(regla, hechos) : null;
    return {
      id: b.id,
      name: b.name,
      description: b.description,
      icon: b.icon,
      color: b.color,
      type: b.type,
      xpBonus: b.xpBonus,
      conseguida: !!tengo,
      grantedAt: tengo ? tengo.grantedAt : null,
      reason: tengo ? tengo.reason : '',
      grantedBy: tengo ? tengo.grantedBy : null,
      /*
       * Texto de la ficha. Ojo con el caso intermedio: la condicion puede estar
       * cumplida y la insignia todavia no concedida, porque las automaticas se
       * conceden cuando el profesor califica. Decirlo asi es mas honesto que
       * poner "Conseguida" en una insignia que el estudiante aun no tiene.
       */
      comoSeConsigue: b.type === 'manual'
        ? 'La concede tu profesor.'
        : (tengo
          ? (avance ? avance.texto : '')
          : (avance && avance.cumple
            ? 'Ya cumples la condición: se concederá en tu próxima calificación.'
            : (avance ? avance.texto : ''))),
      avance: avance ? { actual: avance.actual, objetivo: avance.objetivo } : null
    };
  });

  return {
    studentId: studentUid,
    conseguidas: items.filter((i) => i.conseguida).length,
    total: items.length,
    xpExtra: items.filter((i) => i.conseguida).reduce((a, i) => a + (i.xpBonus || 0), 0),
    insignias: items,
    hechos: hechos
  };
}

/**
 * Quien tiene cada insignia. Solo lo usa el panel del profesor, y solo entre
 * SUS estudiantes: sin esto, cualquier profesor vería quién ganó qué en
 * cualquier otro curso del colegio.
 */
function holders(badgeId) {
  const cursoId = courses.requireActiveCourse().id;
  const where = ['ub.studentId IN (SELECT uid FROM course_members WHERE courseId = ? AND active = 1)'];
  const params = [cursoId];
  if (badgeId) { where.push('ub.badgeId = ?'); params.push(badgeId); }
  const sql = 'SELECT ub.*, u.firstName, u.lastName, u.email, u.color, u.grade, u.photoURL' +
    ' FROM user_badges ub JOIN users u ON u.uid = ub.studentId' +
    ' WHERE ' + where.join(' AND ') +
    ' ORDER BY ub.grantedAt DESC';
  return db.all(sql, params).map((r) => ({
    studentId: r.studentId,
    badgeId: r.badgeId,
    nombre: (r.firstName + ' ' + r.lastName).trim() || r.email,
    correo: r.email,
    color: r.color,
    foto: r.photoURL || null,
    grado: r.grade,
    grantedAt: r.grantedAt,
    grantedBy: r.grantedBy,
    reason: r.reason
  }));
}

/* ============================================================= premios */

function rewardView(row) {
  if (!row) return null;
  const badge = row.badgeId ? db.get('SELECT name, icon, color FROM badges WHERE id = ?', [row.badgeId]) : null;
  return {
    id: row.id,
    scope: row.scope,
    topicId: row.topicId,
    tema: row.topicId ? academic.topicName(row.topicId) : null,
    challengeId: row.challengeId,
    reto: row.challengeId
      ? ((db.get('SELECT title FROM challenges WHERE id = ?', [row.challengeId]) || {}).title || null)
      : null,
    position: row.position,
    badgeId: row.badgeId,
    insignia: badge ? { name: badge.name, icon: badge.icon, color: badge.color } : null,
    title: row.title,
    description: row.description,
    active: !!row.active
  };
}

function listRewards() {
  return db.all('SELECT * FROM rewards ORDER BY scope, position').map(rewardView);
}

function saveReward(datos) {
  const scope = enumOr(datos.scope, ['global', 'topic', 'challenge'], 'global');
  const previo = datos.id ? db.get('SELECT * FROM rewards WHERE id = ?', [datos.id]) : null;
  if (datos.id && !previo) return { ok: false, error: 'El premio no existe.' };
  if (datos.badgeId && !db.get('SELECT id FROM badges WHERE id = ?', [datos.badgeId])) {
    return { ok: false, errores: { badgeId: 'Esa insignia no existe.' } };
  }
  if (scope === 'topic' && !datos.topicId) {
    return { ok: false, errores: { topicId: 'Elige el tema del premio.' } };
  }
  if (scope === 'challenge' && !datos.challengeId) {
    return { ok: false, errores: { challengeId: 'Elige el reto del premio.' } };
  }

  const row = {
    id: previo ? previo.id : db.newId('reward'),
    scope: scope,
    topicId: scope === 'topic' ? String(datos.topicId) : null,
    challengeId: scope === 'challenge' ? String(datos.challengeId) : null,
    position: scope === 'challenge' ? 1 : num(datos.position, 1, 1, 3),
    badgeId: datos.badgeId || null,
    title: users.clean(datos.title || datos.titulo, 120),
    description: users.clean(datos.description || datos.descripcion, 300),
    active: datos.active === false ? 0 : 1,
    createdAt: previo ? previo.createdAt : db.nowIso(),
    updatedAt: db.nowIso(),
    syncedAt: null
  };
  db.upsert('rewards', 'id', row);
  db.enqueue('rewards', row.id, 'upsert', {
    scope: row.scope,
    topicId: row.topicId,
    challengeId: row.challengeId,
    position: row.position,
    badgeId: row.badgeId,
    title: row.title,
    description: row.description,
    active: !!row.active,
    updatedAt: row.updatedAt
  });
  return { ok: true, premio: rewardView(row) };
}

function deleteReward(id) {
  db.run('DELETE FROM rewards WHERE id = ?', [id]);
  db.enqueue('rewards', id, 'delete', null);
  return { ok: true };
}

/**
 * Premio de un reto: al calificar la entrega de un ejercicio asociado a un
 * reto, si hay premio configurado se concede su insignia.
 */
function grantChallengeReward(studentUid, exerciseId, teacherUid) {
  const reto = db.get('SELECT * FROM challenges WHERE exerciseId = ?', [exerciseId]);
  if (!reto) return { concedidas: [] };
  const premio = db.get(
    "SELECT * FROM rewards WHERE scope = 'challenge' AND challengeId = ? AND active = 1", [reto.id]);
  if (!premio || !premio.badgeId) return { concedidas: [] };
  const out = grant(studentUid, premio.badgeId, teacherUid,
    'Premio del reto «' + reto.title + '»');
  return { concedidas: out.ok && !out.repetida ? [out.insignia] : [] };
}

/* =========================================== configuracion del ranking */

/*
 * Cuantos puestos ve un estudiante. 0 = todos. Es un ajuste DEL CURSO -cada
 * profesor decide el suyo-, así que vive en courses.rankingLimit, no en una
 * clave global compartida por todo el colegio.
 */
function rankingConfig(courseId) {
  const curso = courseId ? courses.byId(courseId) : courses.activeCourse();
  const limite = curso ? num(curso.rankingLimit, 10, 0, 500) : 10;
  return { limitePuestos: limite };
}

function setRankingConfig(patch) {
  const curso = courses.requireActiveCourse();
  const limite = num(patch && patch.limitePuestos, num(curso.rankingLimit, 10, 0, 500), 0, 500);
  courses.setRankingLimit(curso.id, limite);
  return rankingConfig(curso.id);
}

module.exports = {
  TIPOS_REGLA,
  CATALOGO_SUGERIDO,
  badgeView,
  listBadges,
  getBadge,
  saveBadge,
  setBadgeActive,
  seedCatalog,
  validarRegla,
  factsFor,
  evalRule,
  grant,
  revoke,
  hasBadge,
  evaluate,
  showcaseFor,
  holders,
  listRewards,
  saveReward,
  deleteReward,
  grantChallengeReward,
  rankingConfig,
  setRankingConfig
};
