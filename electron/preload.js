'use strict';
/*
 * Puente seguro entre el proceso principal y la interfaz.
 *
 * El renderer NO tiene acceso a Node: solo puede llamar a esta lista cerrada de
 * funciones. Firebase (autenticacion y Realtime Database) vive en el renderer
 * porque necesita el entorno de navegador; SQLite vive aqui detras, en el
 * proceso principal, y se consulta por estos canales.
 */

const { contextBridge, ipcRenderer } = require('electron');

/*
 * ipcRenderer.invoke envuelve los errores con "Error invoking remote method…".
 * Los limpiamos para poder mostrarlos tal cual en la interfaz.
 */
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args).catch((err) => {
  const raw = String((err && err.message) || err);
  const clean = raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^Error:\s*/, '');
  const e = new Error(clean || 'Error desconocido');
  e.channel = channel;
  throw e;
});

/** Suscribe un listener y devuelve la funcion para cancelarlo. */
function on(channel, handler) {
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('pc', {
  dev: process.argv.includes('--pc-dev'),
  e2e: process.argv.includes('--pc-e2e'),

  /* ------------------------------------------------- sesion y usuarios */
  session: {
    set: (perfil) => invoke('data:setSession', perfil),
    clear: () => invoke('data:clearSession'),
    me: () => invoke('data:me'),
    bootstrapInfo: () => invoke('data:bootstrapInfo')
  },

  /* Solo existe en las pruebas automatizadas (ver electron/ipc/data.js). */
  test: {
    seedIdentity: (entradas) => invoke('test:seedIdentity', entradas),
    setPhoto: (url) => invoke('test:setPhoto', url),
    olvidarNota: (id) => invoke('test:olvidarNota', id),
    probarMigracionCursos: () => invoke('test:probarMigracionCursos'),
    olvidarCuentaDePrueba: (uid) => invoke('test:olvidarCuentaDePrueba', uid)
  },

  users: {
    list: () => invoke('users:list'),
    students: () => invoke('users:students'),
    updateMe: (patch) => invoke('users:updateMe', patch),
    update: (uid, patch) => invoke('users:update', uid, patch),
    setRole: (uid, role) => invoke('users:setRole', uid, role),
    remove: (uid) => invoke('users:remove', uid),
    setTutorialDone: (done) => invoke('users:setTutorialDone', done),
    solicitudesProfesor: () => invoke('users:solicitudesProfesor'),
    aprobarSolicitudProfesor: (uid) => invoke('users:aprobarSolicitudProfesor', uid),
    rechazarSolicitudProfesor: (uid) => invoke('users:rechazarSolicitudProfesor', uid)
  },

  /* ------------------------------------------------- capa academica */
  topics: {
    list: () => invoke('topics:list'),
    save: (datos) => invoke('topics:save', datos),
    remove: (id) => invoke('topics:delete', id),
    seed: () => invoke('topics:seed')
  },

  exercises: {
    list: () => invoke('exercises:list'),
    get: (id) => invoke('exercises:get', id),
    save: (datos) => invoke('exercises:save', datos),
    setStatus: (id, status) => invoke('exercises:setStatus', id, status),
    remove: (id) => invoke('exercises:delete', id),
    setTargets: (id, datos) => invoke('exercises:setTargets', id, datos)
  },

  /* --------------------------------------------------------------- cursos */
  courses: {
    mine: () => invoke('courses:mine'),
    active: () => invoke('courses:active'),
    create: (nombre) => invoke('courses:create', nombre),
    findByCode: (codigo) => invoke('courses:findByCode', codigo),
    joinByCode: (codigo) => invoke('courses:joinByCode', codigo),
    rename: (id, nombre) => invoke('courses:rename', id, nombre),
    regenerateCode: (id) => invoke('courses:regenerateCode', id),
    setStatus: (id, estado) => invoke('courses:setStatus', id, estado),
    setActive: (id) => invoke('courses:setActive', id),
    moveStudent: (uid, cursoDestinoId) => invoke('courses:moveStudent', uid, cursoDestinoId),
    joinCoTeacher: (codigo) => invoke('courses:joinCoTeacher', codigo),
    coTeachers: (courseId) => invoke('courses:coTeachers', courseId),
    removeCoTeacher: (courseId, targetUid) => invoke('courses:removeCoTeacher', courseId, targetUid),
    remove: (id) => invoke('courses:delete', id)
  },

  groups: {
    list: () => invoke('groups:list'),
    create: (nombre, color) => invoke('groups:create', nombre, color),
    rename: (id, nombre) => invoke('groups:rename', id, nombre),
    setMembers: (id, uids) => invoke('groups:setMembers', id, uids),
    remove: (id) => invoke('groups:delete', id)
  },

  classes: {
    list: () => invoke('classes:list'),
    save: (datos) => invoke('classes:save', datos),
    setStatus: (id, status) => invoke('classes:setStatus', id, status),
    remove: (id) => invoke('classes:delete', id)
  },

  challenges: {
    list: () => invoke('challenges:list'),
    save: (datos) => invoke('challenges:save', datos),
    remove: (id) => invoke('challenges:delete', id)
  },

  submissions: {
    start: (exerciseId) => invoke('submissions:start', exerciseId),
    saveDraft: (id, datos) => invoke('submissions:saveDraft', id, datos),
    submit: (id, datos) => invoke('submissions:submit', id, datos),
    get: (id) => invoke('submissions:get', id),
    mine: (exerciseId) => invoke('submissions:mine', exerciseId),
    review: (filtro) => invoke('submissions:review', filtro),
    counters: () => invoke('submissions:counters'),
    setStatus: (id, status) => invoke('submissions:setStatus', id, status),
    grade: (id, datos) => invoke('submissions:grade', id, datos),
    reopen: (id, motivo) => invoke('submissions:reopen', id, motivo),
    prepare: (id) => invoke('submissions:prepare', id)
  },

  feedback: {
    list: (submissionId) => invoke('feedback:list', submissionId),
    save: (datos) => invoke('feedback:save', datos),
    remove: (id) => invoke('feedback:delete', id)
  },

  events: {
    log: (datos) => invoke('events:log', datos),
    list: (filtro) => invoke('events:list', filtro)
  },

  /* ------------------------------------------- insignias, premios, ranking */
  badges: {
    list: () => invoke('badges:list'),
    save: (datos) => invoke('badges:save', datos),
    setActive: (id, activa) => invoke('badges:setActive', id, activa),
    seed: () => invoke('badges:seed'),
    grant: (studentId, badgeId, motivo) => invoke('badges:grant', studentId, badgeId, motivo),
    revoke: (studentId, badgeId) => invoke('badges:revoke', studentId, badgeId),
    mine: () => invoke('badges:mine'),
    of: (studentId) => invoke('badges:of', studentId),
    holders: (badgeId) => invoke('badges:holders', badgeId),
    evaluate: (studentId) => invoke('badges:evaluate', studentId)
  },

  rewards: {
    list: () => invoke('rewards:list'),
    save: (datos) => invoke('rewards:save', datos),
    remove: (id) => invoke('rewards:delete', id)
  },

  rankings: {
    get: () => invoke('rankings:get'),
    config: () => invoke('rankings:config'),
    setConfig: (patch) => invoke('rankings:setConfig', patch),
    cache: (payload) => invoke('rankings:cache', payload),
    applyConfig: (patch) => invoke('rankings:applyConfig', patch)
  },

  progress: {
    mine: () => invoke('progress:mine'),
    of: (studentId) => invoke('progress:of', studentId),
    recompute: (studentId) => invoke('progress:recompute', studentId),
    course: () => invoke('progress:course'),
    rankings: () => invoke('progress:rankings')
  },

  /* ------------------------------ estadisticas, informes e intercambio */
  stats: {
    course: () => invoke('stats:course'),
    student: (studentId) => invoke('stats:student', studentId),
    criterio: () => invoke('stats:criterio'),
    setCriterio: (patch) => invoke('stats:setCriterio', patch)
  },

  pclass: {
    exportar: (que, id) => invoke('pclass:export', que, id),
    exportarA: (que, id, destino) => invoke('pclass:exportTo', que, id, destino),
    abrir: (ruta) => invoke('pclass:open', ruta),
    previa: (ruta) => invoke('pclass:importPreview', ruta),
    importar: (ruta, modo) => invoke('pclass:import', ruta, modo)
  },

  reports: {
    csv: (destino) => invoke('report:csv', destino),
    json: (destino) => invoke('report:json', destino),
    student: (studentId, destino) => invoke('report:student', studentId, destino),
    open: (ruta) => invoke('report:openFile', ruta)
  },

  backups: {
    list: () => invoke('backup:list'),
    create: () => invoke('backup:create'),
    restore: (archivo) => invoke('backup:restore', archivo),
    reveal: () => invoke('backup:reveal'),
    importPreview: (ruta) => invoke('backup:importPreview', ruta),
    import: (ruta, modo) => invoke('backup:import', ruta, modo)
  },

  sync: {
    pending: (limite, soloEstado) => invoke('sync:pending', limite, soloEstado),
    markDone: (ids) => invoke('sync:markDone', ids),
    markFailed: (id, error) => invoke('sync:markFailed', id, error),
    stats: () => invoke('sync:stats'),
    retryFailed: () => invoke('sync:retryFailed'),
    applyRemote: (entidad, registros) => invoke('sync:applyRemote', entidad, registros)
  },

  data: {
    info: () => invoke('data:info'),
    wipe: (confirmacion) => invoke('data:wipe', confirmacion),
    onChanged: (cb) => on('data:changed', cb)
  },

  /* ------------------------------------------------------------ archivos */
  files: {
    openFolderDialog: () => invoke('fs:openFolderDialog'),
    openFileDialog: () => invoke('fs:openFileDialog'),
    openFilesDialog: () => invoke('fs:openFilesDialog'),
    saveAsDialog: (name) => invoke('fs:saveAsDialog', name),
    openWorkspace: (folder) => invoke('fs:openWorkspace', folder),
    list: (dir) => invoke('fs:list', dir),
    collect: (dir, opciones) => invoke('fs:collect', dir, opciones),
    importFolder: (dir) => invoke('fs:importFolder', dir),
    read: (file) => invoke('fs:read', file),
    write: (file, content) => invoke('fs:write', file, content),
    createFile: (dir, name) => invoke('fs:createFile', dir, name),
    createDir: (dir, name) => invoke('fs:createDir', dir, name),
    rename: (target, name) => invoke('fs:rename', target, name),
    remove: (target) => invoke('fs:delete', target),
    reveal: (target) => invoke('fs:reveal', target),
    exists: (target) => invoke('fs:exists', target),
    createProject: (parent, name) => invoke('fs:createProject', parent, name),
    newProjectDialog: (name) => invoke('fs:newProjectDialog', name),
    defaultWorkspacesDir: () => invoke('fs:defaultWorkspacesDir'),
    onChanged: (cb) => on('fs:changed', cb)
  },

  /* -------------------------------------------------------------- python */
  python: {
    run: (payload) => invoke('py:run', payload),
    stop: (runId) => invoke('py:stop', runId),
    stdin: (runId, text) => invoke('py:stdin', runId, text),
    endStdin: (runId) => invoke('py:endStdin', runId),
    check: (code, label) => invoke('py:check', code, label),
    moduleSymbols: (name) => invoke('py:moduleSymbols', name),
    active: () => invoke('py:active'),
    runtime: (force) => invoke('py:runtime', force),
    onEvent: (cb) => on('py:event', cb)
  },

  /* ------------------------------------------------------------ terminal */
  terminal: {
    create: (cwd) => invoke('term:create', cwd),
    exec: (id, line) => invoke('term:exec', id, line),
    input: (id, text) => invoke('term:input', id, text),
    endInput: (id) => invoke('term:endInput', id),
    interrupt: (id) => invoke('term:interrupt', id),
    setCwd: (id, cwd) => invoke('term:setCwd', id, cwd),
    dispose: (id) => invoke('term:dispose', id),
    onEvent: (cb) => on('term:event', cb)
  },

  /* ----------------------------------------------------------- librerias */
  packages: {
    list: () => invoke('pkg:list'),
    outdated: () => invoke('pkg:outdated'),
    catalog: () => invoke('pkg:catalog'),
    search: (q, opts) => invoke('pkg:search', q, opts),
    info: (name) => invoke('pkg:info', name),
    install: (name, version) => invoke('pkg:install', name, version),
    upgrade: (name) => invoke('pkg:upgrade', name),
    uninstall: (name) => invoke('pkg:uninstall', name),
    cancel: () => invoke('pkg:cancel'),
    busy: () => invoke('pkg:busy'),
    onEvent: (cb) => on('pkg:event', cb)
  },

  /* ------------------------------------------------------ configuracion */
  config: {
    get: () => invoke('cfg:get'),
    set: (patch) => invoke('cfg:set', patch),
    reset: () => invoke('cfg:reset'),
    session: () => invoke('cfg:session'),
    setSession: (patch) => invoke('cfg:setSession', patch),
    paths: () => invoke('cfg:paths'),
    firebase: () => invoke('cfg:firebase'),
    setFirebase: (patch) => invoke('cfg:setFirebase', patch)
  },

  /* ---------------------------------------------------------------- app */
  app: {
    info: () => invoke('app:info'),
    openExternal: (url) => invoke('app:openExternal', url),
    copy: (text) => invoke('app:copy', text),
    paste: () => invoke('app:paste'),
    confirm: (options) => invoke('app:confirm', options),
    startup: () => invoke('app:startup'),
    exportData: () => invoke('app:exportData'),
    resetLocalData: () => invoke('app:resetLocalData'),
    onMenu: (cb) => on('menu', cb),
    onError: (cb) => on('app:error', cb)
  },

  /* ------------------------------------------------------------ ventana */
  win: {
    minimize: () => invoke('win:minimize'),
    maximize: () => invoke('win:maximize'),
    close: () => invoke('win:close'),
    isMaximized: () => invoke('win:isMaximized'),
    toggleFullScreen: () => invoke('win:toggleFullScreen'),
    isFullScreen: () => invoke('win:isFullScreen'),
    setTitle: (t) => invoke('win:setTitle', t),
    reload: () => invoke('win:reload'),
    devtools: () => invoke('win:devtools'),
    onState: (cb) => on('win:state', cb)
  },

  /* ------------------------------------------------- runtime de python */
  runtime: {
    setup: (options) => invoke('runtime:setup', options),
    cancelSetup: () => invoke('runtime:cancelSetup'),
    prepareState: () => invoke('runtime:prepareState'),
    prepare: (options) => invoke('runtime:prepare', options),
    onEvent: (cb) => on('runtime:event', cb)
  },

  /* ------------------------------------------------- fotos de perfil */
  photo: {
    config: () => invoke('photo:config'),
    setConfig: (patch) => invoke('photo:setConfig', patch),
    upload: (dataUrl) => invoke('photo:upload', dataUrl),
    remove: () => invoke('photo:remove'),
    url: (url, lado) => invoke('photo:url', url, lado)
  },

  /* ------------------------------------------------------ actualizaciones */
  updates: {
    config: () => invoke('updates:config'),
    setConfig: (patch) => invoke('updates:setConfig', patch),
    check: () => invoke('updates:check')
  }
});
