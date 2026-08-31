'use strict';
/*
 * Persistencia local: SQLite real mediante node:sqlite (incluido en el runtime
 * de Electron, sin modulos nativos que compilar).
 *
 * SQLite es la FUENTE DE VERDAD para la interfaz: todo lo que se lee en
 * pantalla sale de aqui, tambien sin conexion. Firebase se usa para
 * autenticacion y para sincronizar; lo que llega de Firebase se vuelca aqui, y
 * lo que se genera aqui sale hacia Firebase a traves de la cola sync_queue.
 *
 * El archivo vive en <userData>/python-classroom.db, fuera de la instalacion,
 * para que actualizar la aplicacion no borre nada.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { app } = require('electron');

const SCHEMA_VERSION = 11;

let db = null;
let dbPath = null;

/* ------------------------------------------------------------------ util */

function newId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function nowIso() { return new Date().toISOString(); }

/** JSON tolerante: nunca revienta por un campo corrupto. */
function parseJson(text, fallback) {
  if (text == null || text === '') return fallback;
  try { return JSON.parse(text); } catch (err) { return fallback; }
}

function toJson(value) {
  if (value == null) return null;
  try { return JSON.stringify(value); } catch (err) { return null; }
}

/* --------------------------------------------------------------- esquema */

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Espejo local de los perfiles. La identidad la gobierna Firebase Auth:
-- aqui solo se guarda lo necesario para trabajar sin conexion.
CREATE TABLE IF NOT EXISTS users (
  uid            TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  firstName      TEXT NOT NULL DEFAULT '',
  lastName       TEXT NOT NULL DEFAULT '',
  role           TEXT NOT NULL DEFAULT 'student',
  -- Cuando el proceso principal comprobo ese rol contra Firebase. Si esta a
  -- NULL, el rol no esta demostrado y no da permisos de profesor.
  roleVerifiedAt TEXT,
  -- Cuando pidio ser profesor de un curso (NULL = no lo ha pedido). No da
  -- ningun permiso por si solo: solo marca la solicitud pendiente de revisar.
  teacherRequestedAt       TEXT,
  -- A que curso lo pidio: es quien debe aprobarlo (el dueno de ESE curso).
  teacherRequestedCourseId TEXT,
  grade          TEXT NOT NULL DEFAULT '',
  groupName      TEXT NOT NULL DEFAULT '',
  color          TEXT NOT NULL DEFAULT '#4b8bf5',
  -- Solo la URL de la foto de perfil (Cloudinary). Las imagenes nunca se
  -- guardan aqui ni en la base remota.
  photoURL       TEXT,
  photoUpdatedAt TEXT,
  tutorialDone   INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  createdAt      TEXT NOT NULL,
  updatedAt      TEXT NOT NULL,
  lastLoginAt    TEXT,
  syncedAt       TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS topics (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  orderIndex  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active',
  color       TEXT NOT NULL DEFAULT '#4b8bf5',
  createdBy   TEXT,
  courseId    TEXT,               -- de que curso partio (el temario en si se comparte)
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL,
  syncedAt    TEXT
);
CREATE INDEX IF NOT EXISTS idx_topics_order ON topics(orderIndex);

CREATE TABLE IF NOT EXISTS exercises (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  instructions        TEXT NOT NULL DEFAULT '',
  topicId             TEXT,
  type                TEXT NOT NULL DEFAULT 'normal',   -- normal|timed|class|challenge|project
  difficulty          TEXT NOT NULL DEFAULT 'easy',     -- easy|medium|hard
  xp                  INTEGER NOT NULL DEFAULT 10,
  maxScore            REAL    NOT NULL DEFAULT 5,
  timeLimit           INTEGER NOT NULL DEFAULT 0,       -- minutos, 0 = sin limite
  status              TEXT NOT NULL DEFAULT 'draft',    -- draft|published|active|closed|archived
  createdBy           TEXT,
  courseId            TEXT,                             -- de que curso es: lo ven solo sus miembros
  createdAt           TEXT NOT NULL,
  updatedAt           TEXT NOT NULL,
  publishedAt         TEXT,
  dueDate             TEXT,
  isClassOnly         INTEGER NOT NULL DEFAULT 0,
  allowLateSubmission INTEGER NOT NULL DEFAULT 1,
  maxAttempts         INTEGER NOT NULL DEFAULT 0,       -- 0 = ilimitados
  starterCode         TEXT NOT NULL DEFAULT '',
  rubric              TEXT,                             -- JSON: [{id,name,points}]
  files               TEXT,                             -- JSON: [{name,content}] para proyectos
  syncedAt            TEXT,
  FOREIGN KEY (topicId) REFERENCES topics(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_exercises_topic  ON exercises(topicId);
CREATE INDEX IF NOT EXISTS idx_exercises_status ON exercises(status);

CREATE TABLE IF NOT EXISTS classes (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  topicId    TEXT,
  teacherId  TEXT,
  courseId   TEXT,                                  -- de que curso es esta ventana de horario
  status     TEXT NOT NULL DEFAULT 'scheduled',   -- scheduled|active|closed
  startTime  TEXT,
  endTime    TEXT,
  onClosePolicy TEXT NOT NULL DEFAULT 'allow_finish', -- allow_finish|block
  createdAt  TEXT NOT NULL,
  updatedAt  TEXT NOT NULL,
  syncedAt   TEXT
);
CREATE INDEX IF NOT EXISTS idx_classes_status ON classes(status);

CREATE TABLE IF NOT EXISTS class_exercises (
  classId    TEXT NOT NULL,
  exerciseId TEXT NOT NULL,
  PRIMARY KEY (classId, exerciseId),
  FOREIGN KEY (classId)    REFERENCES classes(id)   ON DELETE CASCADE,
  FOREIGN KEY (exerciseId) REFERENCES exercises(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS submissions (
  id             TEXT PRIMARY KEY,
  studentId      TEXT NOT NULL,
  exerciseId     TEXT NOT NULL,
  attemptNumber  INTEGER NOT NULL DEFAULT 1,
  code           TEXT NOT NULL DEFAULT '',
  files          TEXT,                                -- JSON: [{name,content}]
  entryFile      TEXT,                                -- cual de ellos se ejecuta
  status         TEXT NOT NULL DEFAULT 'draft',       -- draft|in_progress|submitted|under_review|graded|returned|abandoned|late
  startedAt      TEXT,
  submittedAt    TEXT,
  grade          REAL,
  maxScore       REAL,
  xpEarned       INTEGER NOT NULL DEFAULT 0,
  teacherComment TEXT NOT NULL DEFAULT '',
  gradedAt       TEXT,
  gradedBy       TEXT,
  timeSpentSec   INTEGER NOT NULL DEFAULT 0,
  isLate         INTEGER NOT NULL DEFAULT 0,
  classId        TEXT,
  courseId       TEXT,               -- copia del curso del ejercicio: aisla la entrega de otros cursos
  updatedAt      TEXT NOT NULL,
  syncedAt       TEXT,
  UNIQUE (studentId, exerciseId, attemptNumber)
);
CREATE INDEX IF NOT EXISTS idx_sub_student  ON submissions(studentId);
CREATE INDEX IF NOT EXISTS idx_sub_exercise ON submissions(exerciseId);
CREATE INDEX IF NOT EXISTS idx_sub_status   ON submissions(status);

CREATE TABLE IF NOT EXISTS feedback (
  id           TEXT PRIMARY KEY,
  submissionId TEXT NOT NULL,
  courseId     TEXT,                                -- de que curso es (el de la entrega)
  file         TEXT,                                -- a que archivo de la entrega
  line         INTEGER NOT NULL DEFAULT 1,
  columnStart  INTEGER,
  columnEnd    INTEGER,
  type         TEXT NOT NULL DEFAULT 'suggestion',  -- error|warning|suggestion|positive|question
  message      TEXT NOT NULL DEFAULT '',
  createdBy    TEXT,
  createdAt    TEXT NOT NULL,
  resolved     INTEGER NOT NULL DEFAULT 0,
  syncedAt     TEXT,
  FOREIGN KEY (submissionId) REFERENCES submissions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_feedback_sub ON feedback(submissionId);

CREATE TABLE IF NOT EXISTS grade_history (
  id           TEXT PRIMARY KEY,
  submissionId TEXT NOT NULL,
  courseId     TEXT,                                -- de que curso es (el de la entrega)
  oldGrade     REAL,
  newGrade     REAL,
  oldXp        INTEGER,
  newXp        INTEGER,
  reason       TEXT NOT NULL DEFAULT '',
  changedBy    TEXT,
  changedAt    TEXT NOT NULL,
  syncedAt     TEXT,
  FOREIGN KEY (submissionId) REFERENCES submissions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_gh_sub ON grade_history(submissionId);

CREATE TABLE IF NOT EXISTS challenges (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  topicId      TEXT,
  difficulty   TEXT NOT NULL DEFAULT 'hard',
  xp           INTEGER NOT NULL DEFAULT 100,
  reward       TEXT NOT NULL DEFAULT '',
  requirements TEXT NOT NULL DEFAULT '',
  startDate    TEXT,
  endDate      TEXT,
  maxAttempts  INTEGER NOT NULL DEFAULT 1,
  status       TEXT NOT NULL DEFAULT 'draft',
  exerciseId   TEXT,
  createdBy    TEXT,
  courseId     TEXT,                                -- de que curso es este reto
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL,
  syncedAt     TEXT
);

CREATE TABLE IF NOT EXISTS session_events (
  id           TEXT PRIMARY KEY,
  studentId    TEXT NOT NULL,
  exerciseId   TEXT,
  submissionId TEXT,
  courseId     TEXT,               -- de que curso es (el del ejercicio/entrega que lo origino)
  type         TEXT NOT NULL,   -- FOCUS_LOST|FOCUS_GAINED|WINDOW_MINIMIZED|EXERCISE_EXIT|APPLICATION_CLOSED|...
  timestamp    TEXT NOT NULL,
  meta         TEXT,
  syncedAt     TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_student ON session_events(studentId);
CREATE INDEX IF NOT EXISTS idx_events_sub     ON session_events(submissionId);

-- Cola de salida hacia Firebase. Nada local se borra hasta confirmar el envio.
CREATE TABLE IF NOT EXISTS sync_queue (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  opId      TEXT,               -- identificador unico de la operacion (evita duplicados)
  ownerUid  TEXT,               -- quien la genero: en un equipo compartido importa
  entity    TEXT NOT NULL,      -- users|topics|exercises|submissions|feedback|...
  entityId  TEXT NOT NULL,
  op        TEXT NOT NULL,      -- upsert|delete
  priority  INTEGER NOT NULL DEFAULT 5,  -- 1 alta (entregas, notas) · 5 media · 9 baja
  payload   TEXT,               -- JSON con el cuerpo a escribir
  createdAt TEXT NOT NULL,
  updatedAt TEXT,
  attempts  INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  status    TEXT NOT NULL DEFAULT 'pending'   -- pending|sending|done|failed
);
CREATE INDEX IF NOT EXISTS idx_queue_status ON sync_queue(status, priority, id);

-- Progreso calculado; se recalcula tras cada cambio relevante.
-- El progreso es POR CURSO: es la pieza central de "cada curso a su propio
-- ritmo". Un mismo tema puede tener avances distintos en dos cursos distintos.
CREATE TABLE IF NOT EXISTS student_progress (
  studentId   TEXT NOT NULL,
  courseId    TEXT NOT NULL DEFAULT '',
  topicId     TEXT NOT NULL,       -- '*' = totales del estudiante en ese curso
  completed   INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL DEFAULT 0,
  passed      INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  xp          INTEGER NOT NULL DEFAULT 0,
  xpAvailable INTEGER NOT NULL DEFAULT 0,
  average     REAL,
  timeSpentSec INTEGER NOT NULL DEFAULT 0,
  updatedAt   TEXT NOT NULL,
  PRIMARY KEY (studentId, courseId, topicId)
);

-- ============================ fase 4: gamificacion ============================

-- Catalogo de insignias. Solo el profesor las crea; el estudiante solo las lee.
CREATE TABLE IF NOT EXISTS badges (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT 'star',      -- simbolo del sprite de src/index.html
  color       TEXT NOT NULL DEFAULT '#ffd43b',
  type        TEXT NOT NULL DEFAULT 'manual',    -- auto|manual
  rule        TEXT,                              -- JSON con la condicion (solo si type = auto)
  xpBonus     INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  createdBy   TEXT,
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL,
  syncedAt    TEXT
);
CREATE INDEX IF NOT EXISTS idx_badges_active ON badges(active);

-- Concesiones. La clave compuesta impide conceder dos veces la misma insignia.
CREATE TABLE IF NOT EXISTS user_badges (
  id        TEXT NOT NULL,
  studentId TEXT NOT NULL,
  badgeId   TEXT NOT NULL,
  courseId  TEXT,                  -- en que curso se concedio (el catalogo de insignias es comun)
  grantedAt TEXT NOT NULL,
  grantedBy TEXT,
  reason    TEXT NOT NULL DEFAULT '',
  syncedAt  TEXT,
  PRIMARY KEY (studentId, badgeId)
);
CREATE INDEX IF NOT EXISTS idx_ub_student ON user_badges(studentId);
CREATE INDEX IF NOT EXISTS idx_ub_badge   ON user_badges(badgeId);

-- Premios por posicion de ranking o por reto.
CREATE TABLE IF NOT EXISTS rewards (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL DEFAULT 'global',    -- global|topic|challenge
  topicId     TEXT,
  challengeId TEXT,
  position    INTEGER NOT NULL DEFAULT 1,        -- 1|2|3
  badgeId     TEXT,
  title       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL,
  syncedAt    TEXT
);
CREATE INDEX IF NOT EXISTS idx_rewards_scope ON rewards(scope, active);

-- Ultimo ranking descargado de Firebase, para poder mostrarlo sin conexion.
-- El id es 'last' con un solo curso; con varios pasara a ser el propio
-- courseId (fase de rankings por curso, mas adelante).
CREATE TABLE IF NOT EXISTS ranking_cache (
  id          TEXT PRIMARY KEY,   -- 'last'
  payload     TEXT NOT NULL,
  fetchedAt   TEXT NOT NULL
);

-- ================================ fase de cursos ================================
--
-- Un curso es el ecosistema aislado de un profesor: sus estudiantes, sus
-- ejercicios, su ritmo. Antes de esto, toda la base era un unico curso
-- implicito; la migracion de abajo (migrarACursos) lo hace explicito.

CREATE TABLE IF NOT EXISTS courses (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,               -- "10A", "Curso general"...
  teacherId    TEXT NOT NULL,               -- dueno; se fija al crear, no se reasigna
  accessCode   TEXT NOT NULL,               -- codigo que se dicta en clase para unirse
  status       TEXT NOT NULL DEFAULT 'active',   -- active|archived
  rankingLimit INTEGER NOT NULL DEFAULT 10,
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL,
  syncedAt     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_code ON courses(accessCode);
CREATE INDEX IF NOT EXISTS idx_courses_teacher ON courses(teacherId);

-- Matricula: quien pertenece a que curso. Un profesor no necesita fila aqui
-- para SU propio curso (courses.teacherId ya lo dice); esta tabla es para los
-- estudiantes y para un co-profesor eventual.
CREATE TABLE IF NOT EXISTS course_members (
  courseId TEXT NOT NULL,
  uid      TEXT NOT NULL,
  role     TEXT NOT NULL DEFAULT 'student',   -- student|co_teacher
  active   INTEGER NOT NULL DEFAULT 1,        -- baja logica: no se pierde el historial
  joinedAt TEXT NOT NULL,
  syncedAt TEXT,
  PRIMARY KEY (courseId, uid)
);
CREATE INDEX IF NOT EXISTS idx_course_members_uid ON course_members(uid);

-- Subgrupos con nombre dentro de un curso ("Equipo A"), para asignar
-- ejercicios a varios estudiantes de una vez sin marcarlos uno a uno.
CREATE TABLE IF NOT EXISTS course_groups (
  id        TEXT PRIMARY KEY,
  courseId  TEXT NOT NULL,
  name      TEXT NOT NULL,
  color     TEXT NOT NULL DEFAULT '#4b8bf5',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  syncedAt  TEXT
);
CREATE INDEX IF NOT EXISTS idx_course_groups_course ON course_groups(courseId);

CREATE TABLE IF NOT EXISTS course_group_members (
  groupId TEXT NOT NULL,
  uid     TEXT NOT NULL,
  PRIMARY KEY (groupId, uid)
);
CREATE INDEX IF NOT EXISTS idx_cgm_uid ON course_group_members(uid);

-- A quien va dirigido un ejercicio. SIN FILAS AQUI = para todo el curso (es el
-- caso de siempre y el de cualquier ejercicio ya existente: no hace falta
-- migrar nada para conservar el comportamiento actual).
CREATE TABLE IF NOT EXISTS exercise_targets (
  exerciseId TEXT NOT NULL,
  targetType TEXT NOT NULL,      -- 'student' | 'group'
  targetId   TEXT NOT NULL,      -- uid si es student, id de course_groups si es group
  createdAt  TEXT NOT NULL,
  PRIMARY KEY (exerciseId, targetType, targetId)
);
CREATE INDEX IF NOT EXISTS idx_extargets_exercise ON exercise_targets(exerciseId);
`;

/* ----------------------------------------------------------- migracion */

/*
 * Migracion del esquema. Las tablas nuevas las crea el propio SCHEMA con
 * CREATE TABLE IF NOT EXISTS; aqui solo se anaden columnas a tablas que ya
 * existian, para no perder ni una fila de datos del colegio.
 */
const COLUMNAS_NUEVAS = {
  3: [
    ['rewards', 'challengeId', 'TEXT']
  ],
  4: [
    ['users', 'roleVerifiedAt', 'TEXT']
  ],
  5: [
    ['users', 'photoURL', 'TEXT'],
    ['users', 'photoUpdatedAt', 'TEXT']
  ],
  6: [
    ['sync_queue', 'opId', 'TEXT'],
    ['sync_queue', 'priority', 'INTEGER NOT NULL DEFAULT 5'],
    ['sync_queue', 'updatedAt', 'TEXT']
  ],
  8: [
    ['sync_queue', 'ownerUid', 'TEXT']
  ],
  9: [
    ['feedback', 'file', 'TEXT'],
    ['submissions', 'entryFile', 'TEXT']
  ],
  10: [
    ['topics', 'courseId', 'TEXT'],
    ['exercises', 'courseId', 'TEXT'],
    ['classes', 'courseId', 'TEXT'],
    ['challenges', 'courseId', 'TEXT'],
    ['session_events', 'courseId', 'TEXT'],
    ['submissions', 'courseId', 'TEXT'],
    ['user_badges', 'courseId', 'TEXT'],
    ['feedback', 'courseId', 'TEXT'],
    ['grade_history', 'courseId', 'TEXT']
  ],
  11: [
    ['users', 'teacherRequestedAt', 'TEXT'],
    ['users', 'teacherRequestedCourseId', 'TEXT']
  ]
};

/** Lee la version guardada sin pasar por getMeta (la tabla puede no existir). */
function leerVersionCruda(conexion) {
  try {
    const row = conexion.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get();
    return row && row.value ? Number(row.value) : null;
  } catch (err) {
    return null;   // base recien creada: no hay tabla meta todavia
  }
}

function columnas(tabla) {
  try {
    return db.prepare('PRAGMA table_info(' + tabla + ')').all().map((c) => c.name);
  } catch (err) {
    return [];
  }
}

/*
 * Cambios que no son columnas nuevas (indices, limpiezas). Se ejecutan una vez
 * al pasar por esa version.
 */
const SENTENCIAS_NUEVAS = {
  7: [
    // El indice unico anterior abarcaba tambien las filas ya enviadas y hacia
    // fallar la siguiente subida de la misma cosa.
    'DROP INDEX IF EXISTS idx_queue_opid'
  ]
};

/*
 * student_progress cambia de clave primaria (studentId, topicId) a
 * (studentId, courseId, topicId): el progreso es POR CURSO, para que cada uno
 * avance a su ritmo. Un ALTER TABLE normal no puede tocar la clave primaria en
 * SQLite, asi que se recrea la tabla entera. Se detecta si hace falta mirando
 * si la columna courseId ya existe (una base nueva la trae de fabrica en el
 * propio SCHEMA y no pasa por aqui).
 */
function recrearProgresoPorCurso() {
  const existentes = columnas('student_progress');
  if (!existentes.length || existentes.indexOf('courseId') !== -1) return;
  db.exec(`
    CREATE TABLE student_progress_v10 (
      studentId    TEXT NOT NULL,
      courseId     TEXT NOT NULL DEFAULT '',
      topicId      TEXT NOT NULL,
      completed    INTEGER NOT NULL DEFAULT 0,
      total        INTEGER NOT NULL DEFAULT 0,
      passed       INTEGER NOT NULL DEFAULT 0,
      failed       INTEGER NOT NULL DEFAULT 0,
      xp           INTEGER NOT NULL DEFAULT 0,
      xpAvailable  INTEGER NOT NULL DEFAULT 0,
      average      REAL,
      timeSpentSec INTEGER NOT NULL DEFAULT 0,
      updatedAt    TEXT NOT NULL,
      PRIMARY KEY (studentId, courseId, topicId)
    );
    INSERT INTO student_progress_v10
      (studentId, courseId, topicId, completed, total, passed, failed, xp, xpAvailable, average, timeSpentSec, updatedAt)
      SELECT studentId, '', topicId, completed, total, passed, failed, xp, xpAvailable, average, timeSpentSec, updatedAt
      FROM student_progress;
    DROP TABLE student_progress;
    ALTER TABLE student_progress_v10 RENAME TO student_progress;
  `);
}

function migrate(versionPrevia) {
  // Recorre todas las definiciones para reparar bases cuyo numero de esquema
  // avanzo antes de completar una migracion anterior.
  for (let v = 1; v <= SCHEMA_VERSION; v++) {
    for (const sql of SENTENCIAS_NUEVAS[v] || []) {
      try { db.exec(sql); } catch (err) { console.error('[sqlite] migracion:', err && err.message); }
    }
    for (const [tabla, columna, tipo] of COLUMNAS_NUEVAS[v] || []) {
      const existentes = columnas(tabla);
      if (!existentes.length || existentes.indexOf(columna) !== -1) continue;
      try {
        db.exec('ALTER TABLE ' + tabla + ' ADD COLUMN ' + columna + ' ' + tipo);
      } catch (err) { /* la columna ya estaba */ }
    }
    if (v === 10) {
      try { recrearProgresoPorCurso(); } catch (err) { console.error('[sqlite] migracion progreso:', err && err.message); }
    }
  }
}

/* --------------------------------------------------- copias de seguridad */

/**
 * Vuelca el diario WAL dentro del archivo principal.
 *
 * Todo lo que copie o restaure la aplicacion tiene que pasar por aqui: en modo
 * WAL los ultimos COMMIT viven en <base>-wal hasta que SQLite los integra, y
 * copiar solo el .db perderia esos cambios sin avisar.
 */
function checkpoint() {
  try {
    if (db) db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.error('[sqlite] no se pudo volcar el WAL:', err && err.message);
  }
}

/** Carpeta de copias de seguridad de la base de datos. */
function backupsDir() {
  const d = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/*
 * Copias existentes, de la mas reciente a la mas antigua.
 *
 * El orden sale del NOMBRE del archivo, que lleva la fecha en ISO: en Windows,
 * copyFileSync conserva la fecha de modificacion del origen, asi que todas las
 * copias comparten mtime y ordenar por fecha del sistema no sirve.
 */
function listBackups() {
  try {
    return fs.readdirSync(backupsDir())
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const ruta = path.join(backupsDir(), f);
        let st = null;
        try { st = fs.statSync(ruta); } catch (err) { return null; }
        const sello = (f.match(/(\d{4}-\d{2}-\d{2}T[\d-]+Z)/) || [])[1];
        return {
          name: f,
          path: ruta,
          sizeBytes: st.size,
          createdAt: sello ? sello.replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z') : st.mtime.toISOString(),
          orden: sello || st.mtime.toISOString()
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(b.orden).localeCompare(String(a.orden)));
  } catch (err) {
    return [];
  }
}

/** Conserva como maximo las cinco copias mas recientes. */
function pruneBackups(maximo) {
  const sobran = listBackups().slice(Math.max(1, maximo || 5));
  for (const b of sobran) {
    try { fs.unlinkSync(b.path); } catch (err) { /* ya no esta */ }
  }
  return sobran.length;
}

/**
 * Copia la base de datos tal como esta en disco. La etiqueta acaba en el nombre
 * del archivo para saber por que se hizo: migracion, copia manual o previa a
 * una restauracion.
 */
function backupNow(etiqueta) {
  const origen = dbPath;
  if (!origen || !fs.existsSync(origen)) return { ok: false, error: 'Todavía no hay base de datos que copiar.' };
  // La base va en modo WAL: sin volcar el diario, la copia se quedaria sin los
  // ultimos cambios confirmados, que todavia viven en el archivo -wal.
  checkpoint();
  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(backupsDir(), 'python-classroom-' + sello + '-' + (etiqueta || 'manual') + '.db');
  fs.copyFileSync(origen, destino);
  // La copia hereda la fecha del original en Windows; se marca con la de ahora.
  try { const ahora = new Date(); fs.utimesSync(destino, ahora, ahora); } catch (err) { /* no critico */ }
  pruneBackups(5);
  return { ok: true, path: destino, name: path.basename(destino), sizeBytes: fs.statSync(destino).size, createdAt: nowIso() };
}

function backupBeforeMigration(versionPrevia) {
  try {
    checkpoint();
    const sello = new Date().toISOString().replace(/[:.]/g, '-');
    const destino = path.join(backupsDir(), 'python-classroom-' + sello + '-esquema-v' + versionPrevia + '.db');
    fs.copyFileSync(dbPath, destino);
    pruneBackups(5);
  } catch (err) {
    // Una copia fallida no debe impedir abrir la aplicacion.
    console.error('[sqlite] no se pudo copiar antes de migrar:', err && err.message);
  }
}

/**
 * Restaura una copia. La base activa se guarda antes como copia propia, de modo
 * que restaurar tambien se puede deshacer.
 */
function restoreBackup(archivo) {
  const origen = path.resolve(String(archivo || ''));
  if (!fs.existsSync(origen)) return { ok: false, error: 'La copia no existe.' };
  if (path.dirname(origen) !== backupsDir()) {
    return { ok: false, error: 'Solo se pueden restaurar copias de la carpeta de copias.' };
  }
  backupNow('previa-restauracion');
  const destino = dbPath;
  close();
  // Los diarios de la base anterior no valen para la copia que entra.
  for (const sufijo of ['-wal', '-shm']) {
    try { fs.unlinkSync(destino + sufijo); } catch (err) { /* no existia */ }
  }
  fs.copyFileSync(origen, destino);
  open();
  return { ok: true, restaurada: path.basename(origen) };
}

/* ------------------------------------------------------------- conexion */

/*
 * Alfabeto sin caracteres que se confunden al dictarlos en voz alta en clase
 * (0/O, 1/I/L). Un codigo de 6 sirve de sobra para las decenas de cursos que
 * puede llegar a tener un colegio.
 */
const ALFABETO_CODIGO_CURSO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generarCodigoDeCurso() {
  for (let intento = 0; intento < 20; intento++) {
    let codigo = '';
    for (let i = 0; i < 6; i++) {
      codigo += ALFABETO_CODIGO_CURSO[Math.floor(Math.random() * ALFABETO_CODIGO_CURSO.length)];
    }
    if (!get('SELECT 1 FROM courses WHERE accessCode = ?', [codigo])) return codigo;
  }
  // Practicamente imposible de llegar aqui, pero nunca se deja sin codigo.
  return 'C' + Date.now().toString(36).toUpperCase();
}

/*
 * Migracion a "cursos" (una sola vez, marcada en meta).
 *
 * Antes de que existieran los cursos, toda la base era un unico curso
 * implicito. Esto lo hace explicito: se crea "Curso general" con el profesor
 * mas antiguo como dueno, se matricula a todo el que ya habia y se etiqueta
 * con su id lo que antes no tenia curso. Nada se borra ni se mueve de tabla:
 * solo se rellena un campo que antes no existia.
 *
 * Es puramente LOCAL. Subir estos cambios a Firebase (y que las reglas
 * empiecen a exigir el curso) es un paso posterior, deliberadamente separado:
 * mientras tanto la aplicacion sigue hablando con Firebase exactamente igual
 * que antes, sin ningun riesgo para quien todavia no tiene esta version.
 */
function migrarACursos() {
  if (getMeta('cursosMigradosV1') === '1') return;

  transaction(() => {
    const profesores = all("SELECT uid FROM users WHERE role = 'teacher' ORDER BY createdAt ASC");
    if (!profesores.length) {
      // Instalacion nueva, todavia sin nadie: no hay nada que migrar.
      setMeta('cursosMigradosV1', '1');
      return;
    }

    const ahora = nowIso();
    const cursoId = newId('course');
    run(
      'INSERT INTO courses(id, name, teacherId, accessCode, status, rankingLimit, createdAt, updatedAt)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [cursoId, 'Curso general', profesores[0].uid, generarCodigoDeCurso(), 'active', 10, ahora, ahora]);

    /*
     * Si ya habia mas de un profesor (el modelo de antes lo permitia sin
     * ningun aislamiento), los demas entran como co-profesores del mismo
     * curso: nadie se queda fuera el dia de la migracion. Repartirlos en
     * cursos separados, si hiciera falta, es una herramienta manual de mas
     * adelante, no algo que la migracion pueda adivinar por si sola.
     */
    for (const p of profesores.slice(1)) {
      run('INSERT OR IGNORE INTO course_members(courseId, uid, role, active, joinedAt) VALUES (?, ?, ?, 1, ?)',
        [cursoId, p.uid, 'co_teacher', ahora]);
    }

    const estudiantes = all("SELECT uid FROM users WHERE role = 'student'");
    for (const est of estudiantes) {
      run('INSERT OR IGNORE INTO course_members(courseId, uid, role, active, joinedAt) VALUES (?, ?, ?, 1, ?)',
        [cursoId, est.uid, 'student', ahora]);
    }

    for (const tabla of ['topics', 'exercises', 'classes', 'challenges', 'submissions', 'session_events',
      'user_badges', 'feedback', 'grade_history']) {
      run('UPDATE ' + tabla + " SET courseId = ? WHERE courseId IS NULL OR courseId = ''", [cursoId]);
    }
    run("UPDATE student_progress SET courseId = ? WHERE courseId IS NULL OR courseId = ''", [cursoId]);

    setMeta('cursosMigradosV1', '1');
    setMeta('cursoGeneralId', cursoId);
  });
}

function open() {
  if (db) return db;
  dbPath = path.join(app.getPath('userData'), 'python-classroom.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const existia = fs.existsSync(dbPath);
  db = new DatabaseSync(dbPath);
  const versionPrevia = existia ? leerVersionCruda(db) : null;
  if (versionPrevia != null && versionPrevia !== SCHEMA_VERSION) backupBeforeMigration(versionPrevia);
  try { db.exec('DROP INDEX IF EXISTS idx_queue_opid'); } catch (err) { /* no existia */ }
  db.exec(SCHEMA);
  migrate(versionPrevia);
  // Se crea despues de migrar: las bases antiguas pueden no tener opId.
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_opid_pend ON sync_queue(opId) WHERE status IN ('pending', 'sending', 'failed')");
  const version = getMeta('schemaVersion');
  if (version !== String(SCHEMA_VERSION)) setMeta('schemaVersion', String(SCHEMA_VERSION));
  if (!getMeta('createdAt')) setMeta('createdAt', nowIso());
  migrarACursos();
  return db;
}

function close() {
  if (db) { try { db.close(); } catch (err) { /* ya cerrada */ } db = null; }
}

function conn() { return db || open(); }

/* ---------------------------------------------------------- primitivas */

/** SELECT que devuelve varias filas. */
function all(sql, params) {
  return conn().prepare(sql).all(...(params || []));
}

/** SELECT que devuelve una fila (o null). */
function get(sql, params) {
  const row = conn().prepare(sql).get(...(params || []));
  return row === undefined ? null : row;
}

/** INSERT/UPDATE/DELETE. Devuelve {changes, lastInsertRowid}. */
function run(sql, params) {
  return conn().prepare(sql).run(...(params || []));
}

function exec(sql) { conn().exec(sql); }

/** Ejecuta fn dentro de una transaccion; revierte si algo falla. */
function transaction(fn) {
  const c = conn();
  c.exec('BEGIN');
  try {
    const out = fn();
    c.exec('COMMIT');
    return out;
  } catch (err) {
    try { c.exec('ROLLBACK'); } catch (e) { /* ya revertida */ }
    throw err;
  }
}

/* ----------------------------------------------------------------- meta */

function getMeta(key) {
  const row = get('SELECT value FROM meta WHERE key = ?', [key]);
  return row ? row.value : null;
}

function setMeta(key, value) {
  run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value == null ? null : String(value)]);
  return value;
}

/* ----------------------------------------------- ayudas de alto nivel */

/**
 * INSERT ... ON CONFLICT(clave) DO UPDATE con las columnas de `data`.
 *
 * `pk` puede ser una columna o un array de columnas: la clausula ON CONFLICT
 * tiene que nombrar EXACTAMENTE la clave primaria (o el indice unico) de la
 * tabla, y hay tablas con clave compuesta, como student_progress.
 */
function upsert(table, pk, data) {
  const claves = Array.isArray(pk) ? pk : [pk];
  const cols = Object.keys(data);
  const marks = cols.map(() => '?').join(', ');
  const sets = cols
    .filter((c) => claves.indexOf(c) === -1)
    .map((c) => c + ' = excluded.' + c)
    .join(', ');
  const sql = 'INSERT INTO ' + table + ' (' + cols.join(', ') + ') VALUES (' + marks + ')' +
    ' ON CONFLICT(' + claves.join(', ') + ') DO UPDATE SET ' +
    (sets || claves[0] + ' = excluded.' + claves[0]);
  run(sql, cols.map((c) => data[c]));
  return data[claves[0]];
}

/*
 * Prioridad por tipo de dato. Lo que un estudiante o un profesor esta esperando
 * ver va primero; las cifras derivadas pueden llegar un segundo despues.
 *
 *   1  entregas, calificaciones y cierres de ejercicio
 *   5  progreso, XP, insignias, ranking
 *   9  el resto
 */
const PRIORIDADES = {
  /*
   * El curso va SIEMPRE primero, antes que nada de lo que cuelga de el: las
   * reglas de seguridad comprueban "es dueño de courses/<id>" en cada
   * escritura anidada, y si el curso todavia no existe en Firebase esa
   * comprobacion falla -y un rechazo por permisos no se reintenta solo, se
   * queda marcado como fallido para siempre (ver empujarAhora en sync.js)-.
   */
  courses: 0,
  submissions: 1,
  gradeHistory: 1,
  feedback: 1,
  exercises: 1,
  classes: 1,
  courseCodes: 2,
  courseMembers: 2,
  studentProgress: 5,
  userBadges: 5,
  badges: 5,
  rewards: 5,
  challenges: 5,
  topics: 5,
  users: 5,
  roles: 5,
  config: 5,
  sessionEvents: 9
};

/*
 * De quien son las operaciones que se encolan ahora.
 *
 * En un computador del colegio se turnan varias personas. Sin esto, la sesion de
 * un estudiante intentaba subir lo que habia dejado pendiente el profesor (o
 * otro estudiante), las reglas lo rechazaban -con razon- y esos cambios se
 * quedaban sin subir hasta que alguien se diera cuenta.
 */
let duenoActual = null;

function setOwner(uid) { duenoActual = uid || null; return duenoActual; }
function getOwner() { return duenoActual; }

function prioridadDe(entity, dada) {
  const n = Number(dada);
  if (isFinite(n) && n >= 1 && n <= 9) return Math.round(n);
  return PRIORIDADES[entity] != null ? PRIORIDADES[entity] : 5;
}

/**
 * Encola un cambio para enviarlo a Firebase cuando haya conexion.
 *
 * Dos cosas importantes:
 *
 *  - DEDUPLICACION: si ya hay una operacion pendiente para lo mismo (misma
 *    entidad, mismo identificador y misma operacion), se actualiza esa en vez de
 *    anadir otra. Guardar cinco veces seguidas no genera cinco subidas, y una
 *    entrega no puede acabar duplicada aunque la interfaz insista.
 *  - IDENTIFICADOR: cada operacion tiene un opId unico y estable, que sirve
 *    tanto para la deduplicacion como para poder seguirle el rastro.
 */
function enqueue(entity, entityId, op, payload, opciones) {
  const o = opciones || {};
  const operacion = op || 'upsert';
  const prioridad = prioridadDe(entity, o.priority);
  const opId = o.opId || (entity + ':' + entityId + ':' + operacion);
  const ahora = nowIso();

  const pendiente = get(
    "SELECT id FROM sync_queue WHERE opId = ? AND status IN ('pending','failed') LIMIT 1", [opId]);

  if (pendiente) {
    run('UPDATE sync_queue SET payload = ?, priority = ?, updatedAt = ?,' +
      " status = 'pending', attempts = 0, lastError = NULL WHERE id = ?",
      [toJson(payload), prioridad, ahora, pendiente.id]);
    return pendiente.id;
  }

  const res = run(
    'INSERT INTO sync_queue(opId, ownerUid, entity, entityId, op, priority, payload, createdAt, updatedAt)' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [opId, o.ownerUid || duenoActual, entity, entityId, operacion, prioridad,
      toJson(payload), ahora, ahora]);
  return res.lastInsertRowid;
}

function queueStats() {
  const rows = all('SELECT status, COUNT(*) AS n FROM sync_queue GROUP BY status');
  const out = { pending: 0, sending: 0, done: 0, failed: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

function stats() {
  const tablas = ['users', 'topics', 'exercises', 'classes', 'submissions', 'feedback',
    'grade_history', 'challenges', 'session_events', 'sync_queue',
    'badges', 'user_badges', 'rewards'];
  const out = {};
  for (const t of tablas) {
    const row = get('SELECT COUNT(*) AS n FROM ' + t);
    out[t] = row ? row.n : 0;
  }
  return out;
}

function info() {
  return {
    path: dbPath,
    schemaVersion: SCHEMA_VERSION,
    createdAt: getMeta('createdAt'),
    sizeBytes: dbPath && fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
    tables: stats(),
    queue: queueStats()
  };
}

/** Borra todo el contenido (solo para pruebas y para "empezar de cero"). */
function wipe() {
  transaction(() => {
    for (const t of ['session_events', 'grade_history', 'feedback', 'submissions', 'class_exercises',
      'classes', 'challenges', 'exercises', 'topics', 'student_progress', 'sync_queue',
      'user_badges', 'rewards', 'badges', 'ranking_cache',
      'exercise_targets', 'course_group_members', 'course_groups', 'course_members', 'courses',
      'users']) {
      run('DELETE FROM ' + t);
    }
  });
}

module.exports = {
  SCHEMA_VERSION,
  open,
  close,
  conn,
  all,
  get,
  run,
  exec,
  transaction,
  getMeta,
  setMeta,
  upsert,
  enqueue,
  PRIORIDADES,
  setOwner,
  getOwner,
  queueStats,
  stats,
  info,
  wipe,
  backupNow,
  checkpoint,
  listBackups,
  restoreBackup,
  pruneBackups,
  backupsDir,
  newId,
  nowIso,
  parseJson,
  toJson,
  migrarACursos
};
