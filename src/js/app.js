/*
 * Python Classroom - arranque de la interfaz.
 *
 * Une las piezas del entorno de programacion (editor, documentos, explorador,
 * consola, terminal, librerias, runtime, configuracion) con la capa academica
 * de la fase 3 (sesion, paginas de Inicio / Ejercicios / Proyectos / Curso y
 * tutorial). La logica concreta vive en cada modulo; aqui solo esta el cableado.
 */

import { $, $$, el, icon, clear, toast, modal, promptDialog, contextMenu, makeResizer, debounce } from './ui.js';
import * as editor from './editor.js';
import * as documents from './documents.js';
import * as explorer from './explorer.js';
import * as consoleView from './console.js';
import * as terminal from './terminal.js';
import * as packages from './packages.js';
import * as settingsPanel from './settings.js';
import * as runtimePanel from './runtime-panel.js';
import * as auth from './auth.js';
import * as router from './router.js';
import * as dashboard from './dashboard.js';
import * as exercises from './exercises.js';
import * as projects from './projects.js';
import * as review from './review.js';
import * as rankings from './rankings.js';
import * as estadisticas from './stats.js';
import * as primerArranque from './first-run.js';
import { cambiarFoto, ajustesFotos } from './photo.js';
import * as badges from './badges.js';
import * as sesionEjercicio from './exercise-session.js';
import * as sync from './sync.js';
import { entregarCarpeta } from './entregar-carpeta.js';
import * as tutorial from './tutorial.js';
import { applyAppTheme } from './theme.js';
import { meta } from './storage.js';
import { clearModuleCache } from './completions.js';

let settings = {};
let session = {};
let usuario = null;
let activeSideView = 'explorer';
let panelCollapsed = false;
let allowClose = false;
let lastDiagnostics = [];

let estadoSync = null;

/* =========================================================== utilidades */

function inTextField() {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && !a.closest('.cm-editor');
}

function applyVisualSettings() {
  document.documentElement.style.setProperty('--editor-font-size', settings.fontSize + 'px');
  document.documentElement.style.setProperty('--console-font-size', settings.consoleFontSize + 'px');
  applyAppTheme(settings.theme);
  const themeIcon = $('#btn-theme').querySelector('use');
  themeIcon.setAttribute('href', settings.theme === 'light' ? '#i-moon' : '#i-sun');
  $('#sb-indent').textContent = 'Espacios: ' + settings.tabSize;
}

async function saveSettings(patch) {
  settings = await window.pc.config.set(patch);
  return settings;
}

function setRunState(state, label) {
  const box = $('#run-state');
  box.className = 'run-state' + (state ? ' ' + state : '');
  $('#run-state-text').textContent = label;
  $('#btn-run').disabled = state === 'running';
  $('#btn-stop').disabled = state !== 'running';
}

function updateTitle() {
  const doc = documents.current();
  const root = explorer.getRoot();
  const parts = [];
  if (doc) parts.push((doc.dirty ? '● ' : '') + doc.name);
  if (root) parts.push(root.name);
  $('#tb-title').textContent = parts.join('  —  ');
  window.pc.win.setTitle((parts.length ? parts.join(' — ') + ' — ' : '') + 'Python Classroom');
  $('#sb-saved').textContent = doc ? (doc.dirty ? 'Sin guardar' : 'Guardado') : '';
  $('#sb-saved').className = 'sb-item ' + (doc && doc.dirty ? 'warn' : 'ok');
}

function updateCursor(info) {
  const c = info || editor.cursorInfo();
  $('#sb-cursor').textContent = 'Ln ' + c.line + ', Col ' + c.col + (c.sel ? '  (' + c.sel + ' sel.)' : '');
}

/*
 * Estado de conexion: tres estados y nada mas.
 *
 *   🟢 Conectado        todo al dia
 *   🟡 Sincronizando…   hay algo en camino
 *   🔴 Sin conexión     se sigue trabajando en el equipo
 *
 * Nada de nombres de servicios ni de detalles internos: quien mira la barra solo
 * necesita saber si su trabajo esta llegando o esperando.
 */
function updateSyncChip(s) {
  estadoSync = s;
  const chip = $('#sb-sync');
  if (!chip) return;
  const c = s.conexion || {};

  const sinRed = !navigator.onLine || !c.conectado || !c.disponible || !c.habilitado;
  const trabajando = !!s.trabajando || (!sinRed && !!s.pendientes);

  let clase = 'sb-item';
  let texto = 'Conectado';
  let punto = 'verde';

  if (sinRed) {
    clase += ' warn';
    texto = 'Sin conexión';
    punto = 'rojo';
  } else if (trabajando) {
    clase += ' accent';
    texto = 'Sincronizando…';
    punto = 'ambar';
  } else {
    clase += ' ok';
  }

  chip.className = clase;
  chip.title = sinRed
    ? 'Tu trabajo se guarda en este equipo y se enviará solo cuando vuelva la conexión.'
    : trabajando
      ? 'Enviando lo último que hiciste.'
      : 'Todo actualizado.';
  clear(chip).append(
    el('span', { class: 'punto-estado ' + punto }),
    document.createTextNode(' ' + texto));
}

/** Vuelve a leer el usuario activo y repinta lo que le muestra. */
async function refrescarUsuario() {
  usuario = await window.pc.session.me();
  updateUserChip();
  updateTitle();
  await refrescarCursoActivo();
  if (router.enPagina()) await router.refresh();
}

function updateUserChip() {
  const avatar = $('#user-avatar');
  const chip = $('#sb-user');
  const btn = $('#act-user');
  if (!usuario) {
    btn.hidden = true;
    chip.hidden = true;
    return;
  }
  btn.hidden = false;
  avatar.textContent = usuario.iniciales;
  avatar.style.background = usuario.color || 'var(--accent)';
  btn.title = usuario.nombreCompleto + '  ·  ' + usuario.correo;

  chip.hidden = false;
  clear(chip).append(
    icon(usuario.rol === 'profesor' ? 'users' : 'graduation', 12),
    document.createTextNode(' ' + usuario.nombre + (usuario.rol === 'profesor' ? ' (profesor)' : ''))
  );
  $('#act-curso').hidden = usuario.rol !== 'profesor';
  const botonStats = document.querySelector('.act-btn[data-page="estadisticas"]');
  if (botonStats) botonStats.hidden = usuario.rol !== 'profesor';
  const botonEntregas = document.querySelector('.act-btn[data-page="entregas"]');
  if (botonEntregas) botonEntregas.title = usuario.rol === 'profesor' ? 'Entregas por revisar' : 'Mis entregas';
}

/*
 * Qué curso está activo. Con un solo curso (el caso normal por ahora) esto
 * solo informa; cuando un profesor tenga varios, es su recordatorio de en
 * cuál está trabajando -las pantallas de ejercicios, entregas y estadísticas
 * se refieren siempre a este-.
 */
async function refrescarCursoActivo() {
  // La sincronización necesita saber de qué curso sincronizar en cuanto cambia.
  if (usuario) sync.actualizarCurso().catch(() => {});
  const chip = $('#sb-course');
  if (!chip) return;
  const curso = usuario ? await window.pc.courses.active() : null;
  if (!curso) { chip.hidden = true; return; }
  chip.hidden = false;
  clear(chip).append(icon('graduation', 12), document.createTextNode(' ' + curso.nombre));
  chip.title = 'Curso activo: ' + curso.nombre + '  ·  código ' + curso.codigo;
}

/* ====================================================== vistas laterales */

function showSideView(name) {
  if (router.enPagina()) {
    router.showIDE(name);
    aplicarVistaLateral(name);
    return;
  }
  if (activeSideView === name && !$('#sidebar').classList.contains('collapsed')) {
    $('#sidebar').classList.add('collapsed');
    return;
  }
  aplicarVistaLateral(name);
}

function aplicarVistaLateral(name) {
  $('#sidebar').classList.remove('collapsed');
  activeSideView = name || activeSideView;
  for (const btn of $$('.act-btn[data-view]')) btn.classList.toggle('active', btn.dataset.view === activeSideView);
  for (const view of $$('.side-view')) view.classList.toggle('active', view.dataset.view === activeSideView);
  if (activeSideView === 'packages') packages.activate();
  if (activeSideView === 'python') runtimePanel.load();
}

function toggleSidebar() {
  if (router.enPagina()) { irIDE(); return; }
  $('#sidebar').classList.toggle('collapsed');
}

function irIDE() {
  router.showIDE(activeSideView);
  aplicarVistaLateral(activeSideView);
  const view = editor.getView();
  if (view) requestAnimationFrame(() => view.requestMeasure());
}

/* ============================================================== panel */

function showPanelTab(name) {
  if (router.enPagina()) irIDE();
  for (const t of $$('.ptab')) t.classList.toggle('active', t.dataset.tab === name);
  for (const v of $$('.panel-view')) v.classList.toggle('active', v.dataset.view === name);
  if (panelCollapsed) togglePanel(true);
  if (name === 'terminal') {
    terminal.ensureStarted(explorer.getRoot() ? explorer.getRoot().path : null).then(() => terminal.focus());
  }
  if (name === 'console') consoleView.focusInput();
  meta.set('panelTab', name).catch(() => {});
}

function activePanelTab() {
  const t = document.querySelector('.ptab.active');
  return t ? t.dataset.tab : 'console';
}

function togglePanel(forceOpen) {
  const panel = $('#panel');
  panelCollapsed = forceOpen === true ? false : !panelCollapsed;
  panel.classList.toggle('collapsed', panelCollapsed);
  $('#panel-collapse').querySelector('use')
    .setAttribute('href', panelCollapsed ? '#i-chevron-up' : '#i-chevron-down');
}

function clearActivePanel() {
  const tab = activePanelTab();
  if (tab === 'terminal') terminal.clear();
  else if (tab === 'problems') renderProblems([]);
  else consoleView.clear();
}

/* ========================================================== problemas */

function renderProblems(list) {
  lastDiagnostics = list || [];
  const host = $('#problem-list');
  clear(host);
  const badge = $('#problems-badge');
  badge.textContent = String(lastDiagnostics.length);
  badge.classList.toggle('zero', lastDiagnostics.length === 0);
  $('#sb-problems').textContent = lastDiagnostics.length
    ? lastDiagnostics.length + ' problema' + (lastDiagnostics.length > 1 ? 's' : '')
    : '';
  $('#sb-problems').className = 'sb-item ' + (lastDiagnostics.length ? 'error' : '');

  if (!lastDiagnostics.length) {
    host.append(el('div', { class: 'empty-note' }, 'No hay problemas detectados.'));
    return;
  }
  const doc = documents.current();
  for (const d of lastDiagnostics) {
    host.append(el('div', {
      class: 'problem',
      onclick: () => editor.commands.gotoPosition(d.line, d.col)
    },
      el('span', { class: 'pico' }, icon('alert', 14)),
      el('div', { class: 'ptext' },
        el('b', null, (d.type ? d.type + ': ' : '') + d.message),
        el('small', null, (doc ? doc.name : 'editor') + '  ·  línea ' + d.line + ', columna ' + d.col)
      )
    ));
  }
}

const runSyntaxCheck = debounce(async () => {
  const doc = documents.current();
  if (!doc) { editor.applyDiagnostics([]); renderProblems([]); return; }
  const code = editor.getValue();
  if (!/\.pyw?$/i.test(doc.name)) { editor.applyDiagnostics([]); renderProblems([]); return; }
  try {
    const res = await window.pc.python.check(code, doc.name);
    const list = (res && res.diagnostics) || [];
    editor.applyDiagnostics(list);
    renderProblems(list);
  } catch (err) { /* si el interprete no esta, no hay diagnosticos */ }
}, 650);

/* ============================================================ ejecutar */

async function runCurrent(explicitPath) {
  const rt = runtimePanel.current();
  if (rt && !rt.ok) {
    toast('No hay intérprete de Python disponible. Instálalo desde el panel "Runtime de Python".',
      { title: 'No se puede ejecutar', type: 'err', timeout: 7000 });
    showSideView('python');
    return;
  }

  if (router.enPagina()) irIDE();
  if (explicitPath) await documents.openPath(explicitPath);

  const doc = documents.current();
  if (!doc) { toast('Abre o crea un archivo antes de ejecutar.', { type: 'warn' }); return; }

  documents.syncActive();
  if (doc.path && doc.dirty) {
    const okSave = await documents.save(doc.id);
    if (!okSave) return;
  }

  showPanelTab('console');
  setRunState('running', 'Ejecutando ' + doc.name);
  const res = await consoleView.run({
    code: editor.getValue(),
    filePath: doc.path || null
  });
  if (!res) setRunState('error', 'Error');
}

async function stopRun() {
  const ok = await consoleView.stop();
  if (!ok) setRunState('', 'Listo');
}

/* ============================================================= paginas */

async function irPagina(nombre) {
  if (!usuario) return;
  if ((nombre === 'curso' || nombre === 'estadisticas') && usuario.rol !== 'profesor') return;
  await router.show(nombre);
}

function pageHooks() {
  return {
    irInicio: () => irPagina('inicio'),
    irEjercicios: () => irPagina('ejercicios'),
    irProyectos: () => irPagina('proyectos'),
    irEntregas: () => irPagina('entregas'),
    irCurso: () => irPagina('curso'),
    irRankings: () => irPagina('rankings'),
    irEstadisticas: () => irPagina('estadisticas'),
    irEditor: () => irIDE(),
    irConsola: () => showPanelTab('console'),
    irTerminal: () => showPanelTab('terminal'),
    irLibrerias: () => showSideView('packages'),
    crearEjercicio: () => exercises.nuevoEjercicio(),
    refrescar: () => router.refresh(),
    refrescarCurso: () => refrescarCursoActivo(),
    mostrarPagina: (p) => irPagina(p),
    abrirEjercicio: (id) => sesionEjercicio.abrir(id),
    verResultado: (id) => review.mostrarResultado(id),
    abrirProyecto: abrirProyecto,
    onPublicado: () => sync.notificarCambioLocal(),
    onCalificado: (submission) => onCalificado(submission),
    probarCodigo: probarEntrega,
    abrirCarpeta: abrirCopiaDeEntrega,
    entregarCarpeta: entregarLoQueEstoyHaciendo
  };
}

/*
 * Despues de calificar: la cola sube la nota y, ya que el ranking cambio, se
 * recalcula y se publica. Un aviso discreto lista las insignias nuevas; nada de
 * animaciones (seccion 12 de la fase 4).
 */
async function onCalificado(submission) {
  sync.notificarCambioLocal();
  const nuevas = submission && submission.insigniasNuevas;
  if (nuevas && nuevas.length) {
    toast(nuevas.map((b) => b.name).join(', '),
      { title: nuevas.length === 1 ? 'Insignia concedida' : nuevas.length + ' insignias concedidas', type: 'ok' });
  }
  await sync.publicarRankings();
}

/** Abre una copia del codigo de una entrega en el editor del profesor. */
async function probarEntrega(s) {
  irIDE();
  showPanelTab('console');
  setRunState('running', 'Ejecutando entrega de ' + (s.studentName || 'estudiante'));
  const res = await consoleView.run({
    code: s.code || '',
    filePath: null,
    label: 'entrega_' + s.id + '.py'
  });
  if (!res) setRunState('error', 'Error');
}

/*
 * Entregar lo que ya se esta haciendo.
 *
 * No todo el trabajo nace desde la lista de ejercicios: muchas veces el
 * estudiante ya tiene su proyecto empezado -con sus modulos, sus datos y su
 * estructura- y lo que quiere es entregar ESO. Se envia la carpeta abierta tal
 * y como esta, sin rehacerla dentro de la aplicacion.
 */
async function entregarLoQueEstoyHaciendo() {
  const sesion = await window.pc.config.session();
  const carpeta = sesion && sesion.workspace;
  if (!carpeta) {
    toast('Abre primero la carpeta de tu proyecto (Archivo → Abrir carpeta…).',
      { type: 'warn', timeout: 6000 });
    return;
  }
  await documents.saveAll();
  const abierto = documents.current();
  const activo = abierto ? abierto.path : null;
  await entregarCarpeta(carpeta, activo, async () => {
    sync.notificarCambioLocal();
    await irPagina('inicio');
  });
}

/** Abre en el editor una copia de la entrega que el profesor esta revisando. */
async function abrirCopiaDeEntrega(carpeta, archivo) {
  const ws = await window.pc.files.openWorkspace(carpeta);
  await explorer.setRoot(ws);
  terminal.setCwd(ws.path);
  if (archivo) await documents.openPath(archivo);
  irIDE();
  showPanelTab('console');
}

async function abrirProyecto(ruta, nombre) {
  try {
    const carpeta = await window.pc.files.openWorkspace(ruta);
    await explorer.setRoot(carpeta);
    terminal.setCwd(carpeta.path);
    const sep = carpeta.path.indexOf('\\') !== -1 ? '\\' : '/';
    const main = carpeta.path + sep + 'main.py';
    if (await window.pc.files.exists(main)) await documents.openPath(main);
    irIDE();
    toast('Proyecto abierto: ' + (nombre || carpeta.name), { type: 'ok', timeout: 2400 });
  } catch (err) {
    toast(err.message, { title: 'No se pudo abrir', type: 'err' });
  }
}

/* ============================================================= menus */

const MENUS = {
  archivo: () => [
    { label: 'Nuevo archivo', key: 'Ctrl+N', icon: 'new-file', action: () => { irIDE(); documents.newFile(); } },
    { label: 'Abrir archivo…', key: 'Ctrl+O', icon: 'file', action: () => { irIDE(); documents.openDialog(); } },
    { label: 'Abrir carpeta…', key: 'Ctrl+K', icon: 'folder-open', action: openFolder },
    { label: 'Nuevo proyecto…', icon: 'new-folder', action: () => projects.nuevoProyecto() },
    'divider',
    { label: 'Guardar', key: 'Ctrl+S', icon: 'save', action: () => documents.save() },
    { label: 'Guardar como…', key: 'Ctrl+Shift+S', action: () => documents.saveAs() },
    { label: 'Guardar todo', action: async () => { const n = await documents.saveAll(); toast(n + ' archivo(s) guardado(s)', { type: 'ok' }); } },
    'divider',
    { label: 'Cerrar pestaña', key: 'Ctrl+W', action: () => documents.close() },
    'divider',
    {
      label: 'Entregar esta carpeta como ejercicio…',
      key: 'Ctrl+E',
      icon: 'graduation',
      action: () => entregarLoQueEstoyHaciendo()
    },
    { label: 'Abrir un .pclass…', icon: 'json', action: () => estadisticas.verPclass() },
    { label: 'Comprobar la instalación…', icon: 'check-circle', action: () => primerArranque.ejecutar({ forzar: true }) },
    { label: 'Exportar mis datos…', icon: 'download', action: exportarDatos }
  ],
  editar: () => [
    { label: 'Deshacer', key: 'Ctrl+Z', action: () => editor.commands.undo() },
    { label: 'Rehacer', key: 'Ctrl+Y', action: () => editor.commands.redo() },
    'divider',
    { label: 'Cortar', key: 'Ctrl+X', action: () => editor.commands.cut() },
    { label: 'Copiar', key: 'Ctrl+C', action: () => editor.commands.copy() },
    { label: 'Pegar', key: 'Ctrl+V', action: () => editor.commands.paste() },
    { label: 'Seleccionar todo', key: 'Ctrl+A', action: () => editor.commands.selectAll() },
    'divider',
    { label: 'Buscar', key: 'Ctrl+F', icon: 'search', action: () => editor.commands.find() },
    { label: 'Buscar y reemplazar', key: 'Ctrl+H', action: () => editor.commands.find() },
    { label: 'Comentar / descomentar', key: 'Ctrl+/', action: () => editor.commands.comment() },
    { label: 'Ir a la línea…', action: gotoLineDialog }
  ],
  ejecutar: () => [
    { label: 'Ejecutar archivo', key: 'Ctrl+Enter', icon: 'play', action: () => runCurrent() },
    { label: 'Detener', key: 'Ctrl+Shift+C', icon: 'stop', action: stopRun },
    'divider',
    { label: 'Limpiar consola', key: 'Ctrl+L', icon: 'broom', action: () => consoleView.clear() },
    { label: 'Abrir terminal', key: 'Ctrl+ñ', icon: 'terminal', action: () => showPanelTab('terminal') },
    { label: 'Comprobar sintaxis ahora', action: () => runSyntaxCheck.flush() }
  ],
  ver: () => [
    { label: 'Inicio', key: 'Ctrl+1', icon: 'home', action: () => irPagina('inicio') },
    { label: 'Ejercicios', key: 'Ctrl+2', icon: 'tasks', action: () => irPagina('ejercicios') },
    { label: usuario && usuario.rol === 'profesor' ? 'Entregas' : 'Mis entregas', key: 'Ctrl+3', icon: 'check-circle', action: () => irPagina('entregas') },
    { label: 'Proyectos', key: 'Ctrl+4', icon: 'graduation', action: () => irPagina('proyectos') },
    usuario && usuario.rol === 'profesor'
      ? { label: 'Estudiantes y curso', key: 'Ctrl+5', icon: 'users', action: () => irPagina('curso') }
      : null,
    { label: 'Rankings', key: 'Ctrl+6', icon: 'chart', action: () => irPagina('rankings') },
    usuario && usuario.rol === 'profesor'
      ? { label: 'Estadísticas', key: 'Ctrl+7', icon: 'chart', action: () => irPagina('estadisticas') }
      : null,
    { label: 'Volver al editor', icon: 'file', action: irIDE },
    'divider',
    { label: 'Explorador', key: 'Ctrl+Shift+E', icon: 'folder', action: () => showSideView('explorer') },
    { label: 'Librerías', key: 'Ctrl+Shift+P', icon: 'package', action: () => showSideView('packages') },
    { label: 'Runtime de Python', icon: 'py', action: () => showSideView('python') },
    { label: 'Configuración', key: 'Ctrl+,', icon: 'settings', action: () => showSideView('settings') },
    'divider',
    { label: 'Mostrar/ocultar barra lateral', key: 'Ctrl+B', action: toggleSidebar },
    { label: 'Mostrar/ocultar panel', key: 'Ctrl+J', action: () => togglePanel() },
    { label: 'Pantalla completa', key: 'F11', action: () => window.pc.win.toggleFullScreen() },
    'divider',
    { label: 'Cambiar tema', icon: 'sun', action: toggleTheme },
    { label: 'Aumentar texto', key: 'Ctrl++', action: () => zoom(1) },
    { label: 'Reducir texto', key: 'Ctrl+-', action: () => zoom(-1) },
    { label: 'Restablecer zoom', key: 'Ctrl+0', action: () => zoom(0) }
  ].filter(Boolean),
  cuenta: () => [
    {
      label: 'Cambiar mi foto',
      icon: 'eye',
      action: async () => {
        const yo = await window.pc.session.me();
        if (yo) await cambiarFoto(yo, refrescarUsuario);
      }
    },
    { label: 'Mi perfil', icon: 'edit', action: () => auth.perfilModal() },
    { label: 'Cambiar contraseña', icon: 'key', action: () => auth.passwordModal() },
    { label: 'Ver el tutorial otra vez', icon: 'book', action: verTutorial },
    usuario && usuario.rol === 'estudiante'
      ? {
        label: 'Unirme a un curso',
        icon: 'graduation',
        action: async () => {
          const { unirseACurso } = await import('./join-course.js');
          const curso = await unirseACurso({});
          if (curso) await refrescarUsuario();
        }
      }
      : null,
    usuario && usuario.rol === 'profesor'
      ? {
        label: 'Ser coprofesor de otro curso',
        icon: 'graduation',
        action: async () => {
          const { unirseComoCoprofesor } = await import('./join-course.js');
          const curso = await unirseComoCoprofesor();
          if (curso) await refrescarCursoActivo();
        }
      }
      : null,
    'divider',
    { label: 'Exportar mis datos', icon: 'download', action: exportarDatos },
    { label: 'Sincronizar ahora', icon: 'refresh', action: sincronizarAhora },
    { label: 'Estado de la conexión', icon: 'info', action: mostrarDiagnostico },
    'divider',
    { label: 'Cerrar sesión', icon: 'logout', action: () => auth.logout() }
  ].filter(Boolean),
  ayuda: () => [
    { label: 'Guía rápida', icon: 'book', action: () => showSideView('help') },
    { label: 'Tutorial interactivo', icon: 'play', action: verTutorial },
    { label: 'Atajos de teclado', action: showShortcuts },
    { label: 'Acerca de Python Classroom', icon: 'info', action: showAbout }
  ]
};

function wireMenubar() {
  for (const btn of $$('#menubar button')) {
    btn.addEventListener('click', () => {
      const rect = btn.getBoundingClientRect();
      const items = MENUS[btn.dataset.menu]();
      btn.classList.add('open');
      const m = contextMenu(rect.left, rect.bottom + 2, items);
      const observer = new MutationObserver(() => {
        if (!document.body.contains(m)) { btn.classList.remove('open'); observer.disconnect(); }
      });
      observer.observe(document.body, { childList: true });
    });
  }
}

/* ============================================================ acciones */

async function sincronizarAhora() {
  const c = auth.estadoConexion();
  if (!c.disponible) {
    toast('Sin conexión con el servidor. Tu trabajo sigue guardado en este equipo.', { type: 'warn' });
    return;
  }
  toast('Sincronizando…', { type: 'info', timeout: 1500 });
  const res = await sync.sincronizarAhora();
  toast(res && res.ok ? 'Sincronización completada' : 'No se pudo sincronizar del todo',
    { type: res && res.ok ? 'ok' : 'warn' });
  if (router.enPagina()) router.refresh();
}

async function mostrarDiagnostico() {
  const info = await window.pc.data.info();
  const cfg = await window.pc.config.firebase();
  const c = auth.estadoConexion();
  const s = sync.estadoActual();
  const fila = (k, v) => [el('dt', null, k), el('dd', null, String(v))];
  const body = el('div', null,
    el('p', null, 'Tu trabajo se guarda en este equipo y se envía solo cuando hay conexión.'),
    el('dl', { class: 'info-grid', style: { padding: 0 } },
      fila('Curso', c.proyecto || '—'),
      fila('Conexión con el curso', c.conectado ? 'sí' : 'no'),
      fila('Internet', navigator.onLine ? 'sí' : 'no'),
      fila('Esperando para enviarse', s.pendientes),
      fila('Se quedaron atrás', s.fallidas || 0),
      fila('Última subida', s.ultimaSubida || '—'),
      fila('Última bajada', s.ultimaBajada || '—'),
      fila('Base de datos', info.db.path),
      fila('Tamaño', Math.round(info.db.sizeBytes / 1024) + ' KB'),
      fila('Configuración', cfg.archivo)),
    s.fallidas
      ? el('div', { class: 'form-note warn' },
        s.fallidas === 1
          ? 'Un cambio no se pudo enviar. Puedes volver a intentarlo con el botón de abajo.'
          : s.fallidas + ' cambios no se pudieron enviar. Puedes volver a intentarlo con el botón de abajo.')
      : null,
    c.error ? el('div', { class: 'form-note err' }, c.error) : null,
    el('div', { class: 'form-note' },
      'Registros locales: ' + Object.entries(info.db.tables).map(([k, v]) => k + ' ' + v).join(' · ')));
  const botones = [{ label: 'Cerrar', value: null }];
  if (s.fallidas) botones.push({ label: 'Reintentar lo que quedó atrás', value: 'retry' });
  botones.push({ label: 'Sincronizar ahora', value: 'sync', primary: true });

  const respuesta = await modal({ title: 'Estado de la sincronización', body, wide: true, buttons: botones });
  if (respuesta === 'sync') sincronizarAhora();
  if (respuesta === 'retry') {
    const res = await sync.reintentarFallidas();
    toast(res.reintentadas
      ? 'Se están enviando otra vez ' + res.reintentadas + ' cambio(s)'
      : 'No quedaba nada por reintentar', { type: 'ok' });
  }
}

async function exportarDatos() {
  const res = await window.pc.app.exportData();
  if (res.ok) toast('Datos exportados en ' + res.path, { type: 'ok', timeout: 6000 });
}

async function openFolder() {
  const folder = await window.pc.files.openFolderDialog();
  if (!folder) return;
  irIDE();
  await explorer.setRoot(folder);
  terminal.setCwd(folder.path);
  const s = await window.pc.config.session();
  explorer.setRecent(s.recent || []);
  toast('Carpeta abierta: ' + folder.name, { type: 'ok', timeout: 2200 });
}

async function openRecent(path) {
  try {
    const folder = await window.pc.files.openWorkspace(path);
    irIDE();
    await explorer.setRoot(folder);
    terminal.setCwd(folder.path);
  } catch (err) {
    toast(err.message, { title: 'No se pudo abrir', type: 'err' });
  }
}

async function toggleTheme() {
  await saveSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' });
  applyVisualSettings();
  documents.applySettings(settings);
  settingsPanel.update(settings);
}

async function zoom(dir) {
  let size = settings.fontSize;
  if (dir === 0) size = 14;
  else size = Math.min(34, Math.max(9, size + dir));
  await saveSettings({ fontSize: size });
  applyVisualSettings();
}

async function gotoLineDialog() {
  const n = await promptDialog({ title: 'Ir a la línea', label: 'Número de línea', value: '1', okLabel: 'Ir' });
  const num = parseInt(n, 10);
  if (num) editor.commands.gotoLine(num);
}

function verTutorial() {
  if (!usuario) return;
  tutorial.start(usuario.rol, pageHooks(), () => {
    if (router.enPagina()) router.refresh();
  });
}

function showShortcuts() {
  const rows = [
    ['Ctrl + 1 / 2 / 3', 'Inicio · Ejercicios · Proyectos'],
    ['Ctrl + Enter', 'Ejecutar el archivo'],
    ['Ctrl + Shift + C', 'Detener la ejecución'],
    ['Ctrl + S', 'Guardar'],
    ['Ctrl + Shift + S', 'Guardar como'],
    ['Ctrl + N', 'Nuevo archivo'],
    ['Ctrl + O', 'Abrir archivo'],
    ['Ctrl + K', 'Abrir carpeta'],
    ['Ctrl + W', 'Cerrar pestaña'],
    ['Ctrl + Z / Ctrl + Y', 'Deshacer / Rehacer'],
    ['Ctrl + F / Ctrl + H', 'Buscar / Reemplazar'],
    ['Ctrl + /', 'Comentar o descomentar'],
    ['Tab / Shift + Tab', 'Indentar / Desindentar'],
    ['Ctrl + Espacio', 'Forzar autocompletado'],
    ['Alt + ↑ / Alt + ↓', 'Mover la línea'],
    ['Shift + Alt + ↑ / ↓', 'Duplicar la línea'],
    ['Ctrl + Shift + K', 'Borrar la línea'],
    ['Ctrl + D', 'Añadir la siguiente ocurrencia a la selección'],
    ['Ctrl + Shift + L', 'Seleccionar todas las ocurrencias'],
    ['Ctrl + Alt + L', 'Seleccionar la línea completa'],
    ['Alt + clic', 'Añadir otro cursor'],
    ['Ctrl + L', 'Limpiar la consola'],
    ['Ctrl + J', 'Mostrar u ocultar el panel'],
    ['Ctrl + B', 'Mostrar u ocultar la barra lateral'],
    ['Ctrl + + / Ctrl + -', 'Zoom del editor'],
    ['F11', 'Pantalla completa']
  ];
  const body = el('div', { class: 'keys', style: { display: 'grid', gap: '6px' } });
  for (const [k, d] of rows) {
    body.append(el('div', { style: { display: 'grid', gridTemplateColumns: '170px 1fr', gap: '12px', alignItems: 'center' } },
      el('kbd', null, k), el('span', { style: { color: 'var(--text-muted)' } }, d)));
  }
  modal({ title: 'Atajos de teclado', body, wide: true, buttons: [{ label: 'Cerrar', value: null, primary: true }] });
}

async function showAbout() {
  const info = await window.pc.app.info();
  const rt = runtimePanel.current();
  let estado = null;
  try { estado = await window.pc.data.info(); } catch (err) { /* sin sesion */ }

  const body = el('div', null,
    el('p', null, 'IDE educativo de Python. Funciona sin conexión: el editor, el intérprete, la consola, la terminal y tus datos son locales.'),
    el('dl', { class: 'info-grid', style: { padding: 0 } },
      el('dt', null, 'Versión'), el('dd', null, info.version),
      el('dt', null, 'Electron'), el('dd', null, info.electron),
      el('dt', null, 'Chromium'), el('dd', null, info.chrome),
      el('dt', null, 'Node'), el('dd', null, info.node),
      el('dt', null, 'Python'), el('dd', null, rt && rt.ok ? rt.version + (rt.embedded ? ' (interno)' : ' (sistema)') : 'no disponible'),
      el('dt', null, 'Sistema'), el('dd', null, info.platform + ' ' + info.arch),
      estado ? el('dt', null, 'Base de datos') : null,
      estado ? el('dd', null, estado.db.path) : null,
      estado ? el('dt', null, 'Conexión') : null,
      estado ? el('dd', null, (auth.estadoConexion().proyecto || '—') +
        (auth.estadoConexion().conectado ? ' (conectado)' : ' (sin conexión)')) : null
    )
  );
  modal({ title: 'Python Classroom', body, buttons: [{ label: 'Cerrar', value: null, primary: true }] });
}

function renderHelp() {
  const body = $('#help-body');
  clear(body);
  const section = (title, items) => {
    body.append(el('div', { class: 'side-section-title' }, title));
    for (const [t, d] of items) {
      body.append(el('div', { style: { padding: '6px 12px' } },
        el('b', { style: { fontSize: '12.5px', display: 'block' } }, t),
        el('span', { style: { fontSize: '11.5px', color: 'var(--text-muted)' } }, d)));
    }
  };
  section('Primeros pasos', [
    ['1. Crea un archivo', 'Ctrl+N, o abre una carpeta con Ctrl+K para trabajar en un proyecto.'],
    ['2. Escribe código', 'El autocompletado aparece solo; con Ctrl+Espacio lo fuerzas.'],
    ['3. Ejecuta', 'Ctrl+Enter. La salida aparece en la pestaña Consola.'],
    ['4. Responde a input()', 'Cuando el programa pida datos, escribe en la caja inferior y pulsa Enter.']
  ]);
  section('Tu curso', [
    ['Inicio (Ctrl+1)', 'Tu progreso: ejercicios, XP y tiempo dedicado.'],
    ['Ejercicios (Ctrl+2)', 'Lo que ha publicado el profesor. Empezar crea tu carpeta de trabajo.'],
    ['Proyectos (Ctrl+3)', 'Tus carpetas de trabajo, guardadas en tu perfil de este equipo.']
  ]);
  section('Si algo va mal', [
    ['Bucle infinito', 'La ejecución se corta sola al llegar al tiempo máximo (ajustable en Configuración).'],
    ['Error de sintaxis', 'Se subraya en rojo y aparece en la pestaña Problemas.'],
    ['Falta una librería', 'Ve a Librerías, búscala e instálala (necesita Internet una vez).']
  ]);
  section('Terminal', [
    ['python', 'Abre el intérprete interactivo interno.'],
    ['pip list', 'Muestra los paquetes instalados.'],
    ['cd carpeta', 'Cambia de directorio.'],
    ['ayuda', 'Lista los comandos disponibles.']
  ]);
  body.append(el('div', { style: { padding: '12px', display: 'grid', gap: '6px' } },
    el('button', { class: 'btn outline block', onclick: verTutorial }, 'Ver el tutorial'),
    el('button', { class: 'btn outline block', onclick: showShortcuts }, 'Ver todos los atajos')));
}

/* ======================================================== redimensionar */

function wireResizers() {
  const sidebar = $('#sidebar');
  makeResizer($('#sidebar-resizer'), (x) => {
    const left = sidebar.getBoundingClientRect().left;
    const w = Math.min(560, Math.max(180, x - left));
    sidebar.style.width = w + 'px';
  }, {
    axis: 'x',
    onEnd: () => saveSettings({ sidebarWidth: sidebar.getBoundingClientRect().width | 0 })
  });

  const panel = $('#panel');
  makeResizer($('#panel-resizer'), (y) => {
    if (panelCollapsed) return;
    const bottom = panel.getBoundingClientRect().bottom;
    const h = Math.min(window.innerHeight - 200, Math.max(80, bottom - y));
    panel.style.height = h + 'px';
  }, {
    axis: 'y',
    onEnd: () => saveSettings({ panelHeight: panel.getBoundingClientRect().height | 0 })
  });
}

/* =========================================================== atajos */

function wireGlobalKeys() {
  window.addEventListener('keydown', (e) => {
    if (!$('#auth-screen').hidden) return;      // en la pantalla de acceso no hay atajos de la app
    const ctrl = e.ctrlKey || e.metaKey;
    const inEditor = !!e.target.closest('.cm-editor');

    if (ctrl && !e.shiftKey && !e.altKey && ['1', '2', '3', '4', '5', '6', '7'].indexOf(e.key) !== -1) {
      e.preventDefault();
      const destino = {
        1: 'inicio', 2: 'ejercicios', 3: 'entregas', 4: 'proyectos',
        5: 'curso', 6: 'rankings', 7: 'estadisticas'
      }[e.key];
      irPagina(destino);
      return;
    }
    if (ctrl && e.key === 'b' && !e.shiftKey) { e.preventDefault(); toggleSidebar(); return; }
    if (ctrl && e.key === 'j') { e.preventDefault(); togglePanel(); return; }
    // Ctrl+E: entregar la carpeta en la que se esta trabajando.
    if (ctrl && !e.shiftKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      entregarLoQueEstoyHaciendo();
      return;
    }
    if (ctrl && e.key === ',') { e.preventDefault(); showSideView('settings'); return; }
    if (ctrl && e.shiftKey && (e.key === 'E' || e.key === 'e')) { e.preventDefault(); showSideView('explorer'); return; }
    if (ctrl && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); showSideView('packages'); return; }
    if (ctrl && (e.key === 'ñ' || e.key === '`')) { e.preventDefault(); showPanelTab('terminal'); return; }
    if (e.key === 'F5') { e.preventDefault(); runCurrent(); return; }
    if (ctrl && e.key === 'Tab') { e.preventDefault(); documents.nextTab(e.shiftKey ? -1 : 1); return; }
    if (ctrl && e.key === 'w' && !inEditor) { e.preventDefault(); documents.close(); return; }
    if (ctrl && e.key === 'Enter' && !inEditor) { e.preventDefault(); runCurrent(); return; }
    if (ctrl && e.key === 's' && !inEditor) { e.preventDefault(); documents.save(); return; }
  }, true);

  window.pc.app.onMenu((action) => {
    if (!$('#auth-screen').hidden) return;
    switch (action) {
      case 'file:new': return documents.newFile();
      case 'file:open': return documents.openDialog();
      case 'folder:open': return openFolder();
      case 'file:save': return documents.save();
      case 'file:saveAs': return documents.saveAs();
      case 'run:start': return runCurrent();
      case 'run:stop': return stopRun();
      case 'console:clear': return clearActivePanel();
      case 'edit:undo': return inTextField() ? document.execCommand('undo') : editor.commands.undo();
      case 'edit:redo': return inTextField() ? document.execCommand('redo') : editor.commands.redo();
      case 'edit:selectAll': return inTextField() ? document.activeElement.select() : editor.commands.selectAll();
      case 'edit:find': return editor.commands.find();
      case 'edit:comment': return inTextField() ? undefined : editor.commands.comment();
      case 'zoom:in': return zoom(1);
      case 'zoom:out': return zoom(-1);
      case 'zoom:reset': return zoom(0);
      default: return undefined;
    }
  });
}

function wireWindowControls() {
  $('#win-min').addEventListener('click', () => window.pc.win.minimize());
  $('#win-max').addEventListener('click', () => window.pc.win.maximize());
  $('#win-close').addEventListener('click', requestClose);
  window.pc.win.onState((state) => {
    if (state && typeof state.maximized === 'boolean') {
      $('#win-max').querySelector('use').setAttribute('href', state.maximized ? '#i-restore' : '#i-max');
      const authMax = $('#auth-max').querySelector('use');
      if (authMax) authMax.setAttribute('href', state.maximized ? '#i-restore' : '#i-max');
    }
    if (state && typeof state.fullScreen === 'boolean') {
      document.body.classList.toggle('zen', state.fullScreen);
    }
  });
}

async function requestClose() {
  if (documents.hasUnsaved()) {
    const res = await modal({
      title: 'Cambios sin guardar',
      body: el('p', null, 'Hay archivos con cambios sin guardar. ¿Qué quieres hacer?'),
      buttons: [
        { label: 'Cancelar', value: 'cancel' },
        { label: 'Salir sin guardar', value: 'discard', variant: 'danger' },
        { label: 'Guardar y salir', value: 'save', primary: true }
      ]
    });
    if (res === 'cancel' || res == null) return;
    if (res === 'save') await documents.saveAll();
  }
  allowClose = true;
  window.pc.win.close();
}

/* ====================================================== sesion iniciada */

async function onLogin(user, opciones) {
  usuario = user;

  // Las preferencias y la sesion de trabajo son de este usuario.
  settings = await window.pc.config.get();
  session = await window.pc.config.session();
  applyVisualSettings();
  if (settings.sidebarWidth) $('#sidebar').style.width = settings.sidebarWidth + 'px';
  if (settings.panelHeight) $('#panel').style.height = settings.panelHeight + 'px';
  documents.updateSettings(settings);
  documents.rebuildStates(settings);
  settingsPanel.update(settings);
  updateUserChip();
  refrescarCursoActivo();

  // Carpeta de trabajo y pestañas de la ultima vez.
  explorer.setRecent(session.recent || []);
  if (session.workspace) {
    try {
      const folder = await window.pc.files.openWorkspace(session.workspace);
      await explorer.setRoot(folder, session.recent);
    } catch (err) {
      await explorer.setRoot(null, session.recent);
    }
  } else {
    await explorer.setRoot(null, session.recent);
  }
  await documents.restoreSession(session);
  documents.renderTabs();

  await runtimePanel.load();
  setRunState('', 'Listo');
  updateTitle();
  updateCursor();
  runSyntaxCheck();

  // La sincronizacion arranca en segundo plano: la app ya es usable.
  await sync.iniciar(usuario);

  // Primera pantalla: el tablero.
  await irPagina('inicio');

  if (!user.tutorialCompletado) {
    setTimeout(() => verTutorial(), opciones && opciones.primeraVez ? 500 : 250);
  }
}

async function onLogout() {
  sesionEjercicio.cerrar();
  sync.detener();
  review.cerrarRevision();
  await documents.resetForUserChange();
  await explorer.setRoot(null, []);
  consoleView.clear();
  terminal.reset();
  packages.reset();
  renderProblems([]);
  router.showIDE('explorer');
  usuario = null;
  updateUserChip();
  refrescarCursoActivo();
  updateTitle();
}

/* ============================================================== inicio */

async function boot() {
  // En pruebas se sustituye el SDK de Firebase por un doble en memoria, para
  // ejercitar todo el flujo (registro, roles, cola, sincronizacion) sin tocar
  // el proyecto real del colegio.
  if (window.pc.dev && window.pc.e2e && !window.__pcFakeFirebase) {
    try {
      const doble = await import('./test/fake-firebase.js');
      window.__pcFakeFirebase = doble.crear();
    } catch (err) {
      console.warn('[e2e] no se pudo cargar el doble de Firebase:', err);
    }
  }

  settings = await window.pc.config.get();
  session = await window.pc.config.session();

  applyVisualSettings();
  if (settings.sidebarWidth) $('#sidebar').style.width = settings.sidebarWidth + 'px';
  if (settings.panelHeight) $('#panel').style.height = settings.panelHeight + 'px';

  /* ---- editor ---- */
  editor.createEditor($('#editor-host'), settings, {
    change: () => { documents.onEditorChange(); updateTitle(); runSyntaxCheck(); },
    cursor: (info) => updateCursor(info),
    save: () => documents.save(),
    saveAs: () => documents.saveAs(),
    run: () => runCurrent(),
    stop: () => stopRun(),
    closeTab: () => documents.close(),
    clearConsole: () => clearActivePanel()
  });

  /* ---- modulos del IDE ---- */
  documents.init(settings, {
    onActivate: (doc) => {
      updateTitle();
      updateCursor();
      runSyntaxCheck();
      if (doc && doc.path) explorer.markActiveFile(doc.path);
    },
    onChange: () => updateTitle(),
    onSaved: (doc, opts) => {
      updateTitle();
      if (!opts.silent) toast('Guardado: ' + doc.name, { type: 'ok', timeout: 1600 });
    },
    onTabContextMenu: (event, doc) => {
      contextMenu(event.clientX, event.clientY, [
        { label: 'Guardar', icon: 'save', action: () => documents.save(doc.id) },
        { label: 'Guardar como…', action: () => documents.saveAs(doc.id) },
        'divider',
        { label: 'Cerrar', action: () => documents.close(doc.id) },
        { label: 'Cerrar las demás', action: async () => { for (const d of documents.all()) if (d.id !== doc.id) await documents.close(d.id); } },
        'divider',
        doc.path && { label: 'Copiar ruta', action: () => window.pc.app.copy(doc.path) },
        doc.path && { label: 'Mostrar en el explorador', icon: 'external', action: () => window.pc.files.reveal(doc.path) }
      ].filter(Boolean));
    }
  });

  explorer.init({
    openFile: (path) => documents.openPath(path).then(() => explorer.markActiveFile(path)),
    runFile: (path) => runCurrent(path),
    openFolder,
    openRecent,
    newProject: () => projects.nuevoProyecto(),
    onRenamed: (oldPath, newPath, name) => documents.renamed(oldPath, newPath, name),
    onRemoved: () => { /* la pestaña queda abierta con el contenido en memoria */ },
    onRootChange: (root) => { updateTitle(); if (root) terminal.setCwd(root.path); }
  });

  consoleView.init({
    getSettings: () => settings,
    onRunStateChange: (state, ev) => {
      if (state === 'running') setRunState('running', 'Ejecutando…');
      else if (state === 'ok') setRunState('ok', 'Terminado');
      else setRunState('error', ev && ev.timedOut ? 'Tiempo agotado' : 'Con errores');
    }
  });

  await terminal.init();

  packages.init({
    insertText: (text) => editor.commands.insert(text),
    onInstalledChange: () => clearModuleCache()
  });

  settingsPanel.init(settings, async (next) => {
    const prev = settings;
    settings = next;
    applyVisualSettings();
    if (editor.needsRebuild(prev, next)) documents.rebuildStates(next);
    else documents.applySettings(next);
    documents.updateSettings(next);
  });

  runtimePanel.init({ onRuntime: () => clearModuleCache() });

  /* ---- capa academica (fase 3) ---- */
  router.init({ onIDE: () => { const v = editor.getView(); if (v) requestAnimationFrame(() => v.requestMeasure()); } });
  dashboard.init(pageHooks());
  exercises.init(pageHooks());
  projects.init(pageHooks());

  review.init(pageHooks());
  rankings.init(pageHooks());
  estadisticas.init(pageHooks());
  badges.init(pageHooks());
  sesionEjercicio.init({
    abrirArchivo: async (carpeta, archivo) => {
      const ws = await window.pc.files.openWorkspace(carpeta);
      await explorer.setRoot(ws);
      terminal.setCwd(ws.path);
      await documents.openPath(archivo);
      irIDE();
      showPanelTab('console');
    },
    leerCodigo: () => editor.getValue(),
    guardarArchivo: () => documents.save(),
    bloquearEditor: (on) => editor.setReadOnly(on),
    // Al traer una carpeta nueva al ejercicio, el arbol de archivos la muestra.
    refrescarExplorador: () => explorer.refresh(),
    onEntregado: async () => {
      sync.notificarCambioLocal();
      await irPagina('inicio');
    }
  });

  router.register('inicio', dashboard.renderInicio);
  router.register('ejercicios', exercises.renderEjercicios);
  router.register('entregas', async (host) => {
    const yo = await window.pc.session.me();
    if (yo && yo.rol === 'profesor') return review.renderEntregas(host);
    return misEntregas(host);
  });
  router.register('revision', review.renderRevision);
  router.register('proyectos', projects.renderProyectos);
  router.register('curso', dashboard.renderCurso);
  router.register('rankings', rankings.renderRankings);
  router.register('estadisticas', estadisticas.renderEstadisticas);

  window.pc.data.onChanged(() => { if (router.enPagina()) router.refresh(); });
  sync.onEstado(updateSyncChip);

  /*
   * Calificacion recien llegada. Aparece sola, sin recargar ni volver a entrar:
   * la senal del profesor dispara la descarga y esto lo anuncia.
   */
  sync.onCalificacion((c) => {
    toast(c.nota + ' / ' + c.maxScore + (c.xp ? '  ·  +' + c.xp + ' XP' : ''), {
      title: '🎉 Nueva calificación · ' + c.ejercicio,
      type: 'ok',
      timeout: 9000
    });
    if (router.enPagina()) router.refresh();
  });

  /*
   * Aviso de recuperacion. Se fija en la conexion de verdad, no solo en lo que
   * diga el sistema: en el colegio pasa a menudo que el wifi sigue «conectado»
   * pero no llega nada. Cuando se recupera, se dice UNA vez que ya esta todo.
   */
  let estabaSinRed = !navigator.onLine;
  window.addEventListener('online', () => { estabaSinRed = true; });
  sync.onEstado((s) => {
    const c = s.conexion || {};
    const sinRed = !navigator.onLine || !c.conectado || !c.disponible || !c.habilitado;
    if (sinRed) { estabaSinRed = true; return; }
    if (estabaSinRed && !s.trabajando && !s.pendientes) {
      estabaSinRed = false;
      toast('Todo actualizado', { type: 'ok', timeout: 3000 });
    }
  });

  renderHelp();

  /* ---- interfaz ---- */
  wireMenubar();
  wireWindowControls();
  wireResizers();
  wireGlobalKeys();

  for (const btn of $$('.act-btn[data-view]')) {
    btn.addEventListener('click', () => showSideView(btn.dataset.view));
  }
  for (const btn of $$('.act-btn[data-page]')) {
    btn.addEventListener('click', () => irPagina(btn.dataset.page));
  }
  $('#act-user').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.right + 6, r.top - 40, MENUS.cuenta());
  });
  $('#sb-user').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left, r.top - 200, MENUS.cuenta());
  });

  for (const tab of $$('.ptab')) {
    tab.addEventListener('click', () => showPanelTab(tab.dataset.tab));
  }

  $('#btn-run').addEventListener('click', () => runCurrent());
  $('#btn-stop').addEventListener('click', stopRun);
  $('#btn-save').addEventListener('click', () => documents.save());
  $('#btn-newfile').addEventListener('click', () => { irIDE(); documents.newFile(); });
  $('#btn-openfolder').addEventListener('click', openFolder);
  $('#btn-find').addEventListener('click', () => editor.commands.find());
  $('#btn-theme').addEventListener('click', toggleTheme);
  $('#btn-panel').addEventListener('click', () => togglePanel());
  $('#btn-zoom-in').addEventListener('click', () => zoom(1));
  $('#btn-zoom-out').addEventListener('click', () => zoom(-1));
  $('#btn-wrap').addEventListener('click', async () => {
    await saveSettings({ wordWrap: !settings.wordWrap });
    documents.applySettings(settings);
    $('#btn-wrap').classList.toggle('active', settings.wordWrap);
    settingsPanel.update(settings);
  });
  $('#btn-wrap').classList.toggle('active', !!settings.wordWrap);

  $('#panel-clear').addEventListener('click', clearActivePanel);
  $('#panel-collapse').addEventListener('click', () => togglePanel());
  $('#sb-toggle-side').addEventListener('click', toggleSidebar);
  $('#sb-python').addEventListener('click', () => showSideView('python'));
  $('#sb-sync').addEventListener('click', mostrarDiagnostico);
  $('#sb-cursor').addEventListener('click', gotoLineDialog);
  $('#sb-indent').addEventListener('click', () => showSideView('settings'));

  $('#es-new').addEventListener('click', () => documents.newFile());
  $('#es-open').addEventListener('click', openFolder);
  $('#es-project').addEventListener('click', () => projects.nuevoProyecto());

  window.pc.app.onError((err) => toast(err.message, { title: 'Error interno', type: 'err', timeout: 9000 }));

  const lastTab = await meta.get('panelTab', 'console');
  showPanelTab(lastTab || 'console');
  documents.renderTabs();
  setRunState('', 'Listo');
  updateCursor();

  window.addEventListener('beforeunload', (e) => {
    if (!allowClose && documents.hasUnsaved()) {
      e.preventDefault();
      e.returnValue = false;
      setTimeout(requestClose, 0);
    }
  });

  /* ---- sesion: configuracion inicial, acceso o entrar directo ---- */
  /*
   * Primer arranque (fase 6): comprueba las piezas y copia el runtime de Python
   * a la carpeta del usuario si la de instalacion es de solo lectura. En las
   * pruebas automatizadas no se muestra: taparia la interfaz que conducen.
   */
  if (!window.pc.e2e) {
    try {
      await primerArranque.ejecutar();
    } catch (err) {
      console.warn('[arranque] preparación:', err);
    }
  }

  await auth.init({
    onLogin,
    onLogout,
    onUserUpdated: (u) => {
      usuario = u;
      updateUserChip();
      refrescarCursoActivo();
      if (router.enPagina()) router.refresh();
    },
    onReplayTutorial: verTutorial
  });

  if (window.pc.dev) {
    window.__pc = {
      editor, documents, explorer, consoleView, terminal, packages,
      settingsPanel, runtimePanel, auth, router, dashboard, exercises, projects, tutorial,
      review, sesionEjercicio, sync, rankings, badges, estadisticas, primerArranque,
      getSettings: () => settings,
      getUsuario: () => usuario,
      runCurrent, stopRun, showPanelTab, showSideView, togglePanel, irPagina, irIDE,
      abrirProyecto, verTutorial, onLogin, onLogout, sincronizarAhora,
      abrirEjercicio: (id) => sesionEjercicio.abrir(id),
      renderProblems: () => lastDiagnostics,
      syntaxCheckNow: () => runSyntaxCheck.flush(),
      entregarCarpeta: entregarLoQueEstoyHaciendo,
    ready: true
    };
  }
}

boot().catch((err) => {
  document.body.innerHTML =
    '<div style="padding:40px;font-family:system-ui;color:#ff6b6b">' +
    '<h2>Python Classroom no pudo iniciar</h2><pre style="white-space:pre-wrap">' +
    String(err && err.stack || err) + '</pre></div>';
});

/* ============================================ mis entregas (estudiante) */

/** Lista de entregas propias con su estado y su resultado. */
async function misEntregas(host) {
  const lista = await window.pc.submissions.mine();
  const page = el('div', { class: 'page' });

  page.append(el('div', { class: 'page-head' },
    el('div', { class: 'ph-text' },
      el('h1', null, 'Mis entregas'),
      el('p', null, 'Cada intento se guarda por separado: nunca se pierde lo que hiciste antes.'))));

  if (!lista.length) {
    page.append(el('div', { class: 'empty-page' },
      icon('check-circle', 34),
      el('b', null, 'Todavía no has entregado nada'),
      el('p', null, 'Empieza un ejercicio y, cuando lo tengas, pulsa Entregar.'),
      el('button', { class: 'btn primary', onclick: () => irPagina('ejercicios') }, 'Ver ejercicios')));
  } else {
    const card = el('div', { class: 'card' });
    for (const s of lista) {
      const calificado = s.status === 'graded' || s.status === 'returned';
      card.append(el('div', {
        class: 'list-row', style: { cursor: 'pointer' },
        onclick: () => review.mostrarResultado(s.id)
      },
        icon(calificado ? 'check-circle' : 'clock', 16),
        el('div', { class: 'lr-main' },
          el('b', null, (s.ejercicio ? s.ejercicio.title : 'Ejercicio') + '  ·  intento ' + s.attemptNumber),
          el('span', null, (s.ejercicio ? s.ejercicio.tema : '') + '  ·  ' +
            dashboard.formatoFecha(s.submittedAt || s.updatedAt))),
        dashboard.chipEstado(s.status),
        calificado
          ? el('div', { class: 'lr-num' }, (s.grade == null ? '—' : s.grade) + ' / ' + s.maxScore)
          : null,
        el('button', { class: 'btn sm outline' }, 'Ver')));
    }
    page.append(card);
  }

  clear(host).append(page);
}
