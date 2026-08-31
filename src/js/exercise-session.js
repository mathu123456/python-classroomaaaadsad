/*
 * Sesion de trabajo del estudiante sobre un ejercicio.
 *
 * Reune lo que el pliego pide en las secciones 7, 15, 16 y 17:
 *   - autoguardado periodico en SQLite (nunca a Firebase mientras escribe)
 *   - cronometro local que no depende de Internet
 *   - registro de abandono (perder el foco, minimizar, salir)
 *   - entrega, que es el momento en que el trabajo entra en la cola de sync
 *
 * Aviso honesto: el control de abandono es un mecanismo academico, no un
 * sistema anti-trampas. Deja constancia de lo ocurrido; no impide nada.
 */

import { $, el, icon, clear, toast, modal, confirmDialog } from './ui.js';
import * as sync from './sync.js';
import { recoger, describir, avisoOmitidos } from './entrega-archivos.js';

const AUTOGUARDADO_MS = 7000;

let activa = null;          // { submissionId, exercise, submission, archivo, carpeta }
let timerTic = null;
let timerAuto = null;
let segundosDesdeGuardado = 0;
let restanteSeg = null;     // null = sin limite
let bloqueado = false;
let hooks = {};
let avisosAbandono = 0;

export function init(appHooks) {
  hooks = appHooks || {};
  cablearControlDeAbandono();
}

export function sesionActiva() { return activa; }
export function estaBloqueada() { return bloqueado; }

/* ------------------------------------------------------------ utilidades */

function slug(texto) {
  return String(texto || 'ejercicio')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 40).toLowerCase() || 'ejercicio';
}

function sep(ruta) { return ruta.indexOf('\\') !== -1 ? '\\' : '/'; }

function mmss(seg) {
  const s = Math.max(0, Math.round(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const dos = (n) => String(n).padStart(2, '0');
  return (h ? dos(h) + ':' : '') + dos(m) + ':' + dos(r);
}

/* ------------------------------------------------------------ apertura */

/** Abre (o retoma) un ejercicio y deja al estudiante listo para programar. */
export async function abrir(exerciseId) {
  const res = await window.pc.submissions.start(exerciseId);
  if (!res.ok) {
    toast(res.error, { title: 'No se puede abrir', type: 'err', timeout: 7000 });
    return null;
  }

  const ejercicio = res.ejercicio;
  const submission = res.submission;

  // El codigo vive en un archivo real para que el editor, la ejecucion de
  // Python y la terminal funcionen exactamente igual que siempre.
  const base = await window.pc.files.defaultWorkspacesDir();
  const s = sep(base);
  const carpeta = base + s + 'Ejercicios' + s + slug(ejercicio.tema) + s + slug(ejercicio.title);
  const enunciado = carpeta + s + 'enunciado.txt';

  /*
   * El archivo del ejercicio se llama main.py: es lo primero que ve el
   * estudiante y no tiene que administrar carpetas ni elegir nombres.
   *
   * Compatibilidad: quien ya venia trabajando en un solucion.py sigue con el
   * suyo. Cambiar el nombre a mitad de curso le haria perder de vista su
   * trabajo, y eso no vale un nombre mas bonito.
   */
  const antiguo = carpeta + s + 'solucion.py';
  const archivo = (await window.pc.files.exists(antiguo)) ? antiguo : carpeta + s + 'main.py';

  const yaExiste = await window.pc.files.exists(archivo);
  if (!yaExiste) {
    const cabecera = [
      '# ' + ejercicio.title,
      '# Tema: ' + ejercicio.tema,
      '# Intento ' + submission.attemptNumber,
      ''
    ].join('\n');
    await window.pc.files.write(archivo, cabecera + (submission.code || ejercicio.starterCode || '\n'));
    for (const file of ejercicio.files || []) {
      const nombre = String(file.name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
      if (!nombre || nombre === 'main.py' || nombre === 'solucion.py') continue;
      await window.pc.files.write(carpeta + s + nombre, file.content || '');
    }
  } else if (submission.code && submission.attemptNumber > 1) {
    await window.pc.files.write(archivo, submission.code);
  }

  await window.pc.files.write(enunciado, [
    ejercicio.title,
    '='.repeat(ejercicio.title.length),
    '',
    ejercicio.description || '',
    '',
    'Instrucciones',
    '-------------',
    ejercicio.instructions || '(sin instrucciones adicionales)',
    '',
    'Tema: ' + ejercicio.tema,
    'Dificultad: ' + ejercicio.difficulty,
    'XP: ' + ejercicio.xp,
    'Nota máxima: ' + ejercicio.maxScore,
    ejercicio.timeLimit ? 'Tiempo límite: ' + ejercicio.timeLimit + ' minutos' : 'Sin tiempo límite',
    ejercicio.maxAttempts ? 'Intentos: ' + ejercicio.maxAttempts : 'Intentos ilimitados',
    ''
  ].join('\n'));

  activa = { submissionId: submission.id, exercise: ejercicio, submission, archivo, carpeta };
  bloqueado = false;
  avisosAbandono = 0;
  segundosDesdeGuardado = 0;

  // Cronometro: descuenta lo ya consumido en intentos anteriores del mismo trabajo.
  restanteSeg = ejercicio.timeLimit
    ? Math.max(0, ejercicio.timeLimit * 60 - (submission.timeSpentSec || 0))
    : null;

  if (hooks.abrirArchivo) await hooks.abrirArchivo(carpeta, archivo);

  arrancarTemporizadores();
  pintarBarra();
  await window.pc.events.log({
    exerciseId: exerciseId, submissionId: submission.id,
    type: res.reanudado ? 'ATTEMPT_RESUMED' : 'ATTEMPT_STARTED'
  });

  if (restanteSeg === 0) aplicarTiempoAgotado(true);
  return activa;
}

/* --------------------------------------------------------- temporizador */

function arrancarTemporizadores() {
  pararTemporizadores();
  timerTic = setInterval(() => {
    if (!activa) return;
    segundosDesdeGuardado++;
    if (restanteSeg != null && !bloqueado) {
      restanteSeg = Math.max(0, restanteSeg - 1);
      if (restanteSeg === 0) aplicarTiempoAgotado(false);
    }
    pintarBarra();
  }, 1000);

  timerAuto = setInterval(() => { autoguardar().catch(() => {}); }, AUTOGUARDADO_MS);
}

function pararTemporizadores() {
  if (timerTic) { clearInterval(timerTic); timerTic = null; }
  if (timerAuto) { clearInterval(timerAuto); timerAuto = null; }
}

async function aplicarTiempoAgotado(silencioso) {
  if (bloqueado) return;
  bloqueado = true;
  await autoguardar();
  if (hooks.bloquearEditor) hooks.bloquearEditor(true);
  await window.pc.events.log({
    exerciseId: activa.exercise.id, submissionId: activa.submissionId, type: 'TIME_UP'
  });
  pintarBarra();
  if (!silencioso) {
    await modal({
      title: 'Se acabó el tiempo',
      body: el('div', null,
        el('p', null, 'El tiempo límite de «' + activa.exercise.title + '» ha terminado. ' +
          'Tu código quedó guardado y ya no se puede editar.'),
        el('p', null, 'Puedes entregarlo tal como está.')),
      buttons: [{ label: 'Entendido', value: 'ok', primary: true }]
    });
  }
}

/* --------------------------------------------------------- autoguardado */

/** Guarda el codigo del editor en el archivo y en la base local. */
export async function autoguardar(forzar) {
  if (!activa) return false;
  if (bloqueado && !forzar) return false;
  const codigo = hooks.leerCodigo ? hooks.leerCodigo() : null;
  if (codigo == null) return false;

  const segundos = segundosDesdeGuardado;
  segundosDesdeGuardado = 0;

  try {
    if (hooks.guardarArchivo) await hooks.guardarArchivo();

    /*
     * Se guarda la CARPETA entera, no solo el archivo abierto: un ejercicio
     * puede estar repartido en varios modulos y todos son parte del trabajo.
     * Esto no sube nada: el autoguardado se queda en este equipo.
     */
    const recogida = await recogerLaCarpeta();
    const res = await window.pc.submissions.saveDraft(activa.submissionId, {
      code: codigo,
      files: recogida ? recogida.archivos : undefined,
      entrada: recogida ? recogida.entrada : undefined,
      addSeconds: segundos
    });
    if (recogida) activa.archivos = recogida;
    if (res.ok) {
      activa.ultimoGuardado = res.guardadoEn;
      pintarBarra();
      return true;
    }
  } catch (err) {
    console.warn('[ejercicio] autoguardado:', err);
  }
  return false;
}

/* ------------------------------------------------ archivos del ejercicio */

/**
 * Recoge todo lo que hay en la carpeta del ejercicio.
 *
 * El archivo que manda es el que el estudiante abrio al empezar (`main.py`, o
 * `solucion.py` si venia de antes); lo demas son sus modulos y sus datos.
 */
async function recogerLaCarpeta() {
  if (!activa) return null;
  try {
    const nombreEntrada = activa.archivo.split(/[\\/]/).pop();
    return await recoger(activa.carpeta, { preferido: nombreEntrada });
  } catch (err) {
    console.warn('[ejercicio] no se pudo leer la carpeta:', err);
    return null;
  }
}

/** Cuantos archivos lleva el trabajo ahora mismo (para la barra). */
export function archivosActuales() {
  return activa && activa.archivos ? activa.archivos : null;
}

/**
 * Anade una carpeta entera al ejercicio: se elige en el disco y se copia dentro
 * de la carpeta de trabajo. Es lo que hace falta cuando el ejercicio pide
 * modulos y el estudiante ya los tenia hechos en otro sitio.
 */
export async function anadirCarpeta() {
  if (!activa) return false;
  if (bloqueado) {
    toast('Este intento ya no admite cambios.', { type: 'warn' });
    return false;
  }
  let res;
  try {
    res = await window.pc.files.importFolder(activa.carpeta);
  } catch (err) {
    toast('No se pudo añadir la carpeta.', { type: 'err' });
    return false;
  }
  if (!res) return false;

  const cuantos = res.copiados || 0;
  toast(cuantos
    ? 'Se añadió «' + res.name + '» con ' + cuantos + (cuantos === 1 ? ' archivo' : ' archivos')
    : 'La carpeta «' + res.name + '» no traía archivos que se puedan entregar',
    { type: cuantos ? 'ok' : 'warn', timeout: 6000 });

  if (res.omitidos && res.omitidos.length) {
    toast(res.omitidos.length + ' archivo(s) no se copiaron: solo se admiten archivos de texto ' +
      'de menos de 200 KB.', { type: 'warn', timeout: 8000 });
  }

  if (hooks.refrescarExplorador) await hooks.refrescarExplorador();
  await autoguardar(true);
  pintarBarra();
  return true;
}

/* -------------------------------------------------- control de abandono */

function cablearControlDeAbandono() {
  const registrar = async (tipo) => {
    if (!activa) return;
    await window.pc.events.log({
      exerciseId: activa.exercise.id, submissionId: activa.submissionId, type: tipo
    }).catch(() => {});
  };

  window.addEventListener('blur', async () => {
    if (!activa || bloqueado) return;
    await registrar('FOCUS_LOST');
    if (activa.exercise.isClassOnly || activa.exercise.timeLimit) advertirAbandono();
  });

  window.addEventListener('focus', () => { registrar('FOCUS_GAINED'); });

  document.addEventListener('visibilitychange', () => {
    if (!activa) return;
    registrar(document.hidden ? 'WINDOW_MINIMIZED' : 'FOCUS_GAINED');
  });

  window.addEventListener('beforeunload', () => {
    if (activa) registrar('APPLICATION_CLOSED');
  });
}

function advertirAbandono() {
  avisosAbandono++;
  toast(
    'Has salido del ejercicio. Queda registrado en tu actividad; si sigues fuera, ' +
    'tu profesor puede marcar el intento como abandonado.',
    { title: 'Aviso de abandono (' + avisosAbandono + ')', type: 'warn', timeout: 7000 });
  pintarBarra();
}

/* -------------------------------------------------------------- entrega */

export async function entregar() {
  if (!activa) return false;
  const ej = activa.exercise;

  const ok = await confirmDialog(
    'Vas a entregar «' + ej.title + '». Después no podrás seguir editando este intento.' +
    (ej.maxAttempts ? ' Te quedarán ' + Math.max(0, ej.maxAttempts - activa.submission.attemptNumber) + ' intento(s).' : ''),
    { title: 'Entregar ejercicio', okLabel: 'Entregar' });
  if (!ok) return false;

  await autoguardar(true);
  const codigo = hooks.leerCodigo ? hooks.leerCodigo() : activa.submission.code;
  const recogida = await recogerLaCarpeta();
  const res = await window.pc.submissions.submit(activa.submissionId, {
    code: codigo,
    files: recogida ? recogida.archivos : undefined,
    entrada: recogida ? recogida.entrada : undefined
  });
  if (!res.ok) {
    toast(res.error, { title: 'No se pudo entregar', type: 'err', timeout: 7000 });
    return false;
  }

  const conexion = sync.estadoActual().conexion;
  sync.notificarCambioLocal();

  await modal({
    title: 'Entrega realizada',
    body: el('div', { class: 'entrega-ok' },
      el('div', { class: 'eo-icon' }, icon('check-circle', 34)),
      el('h3', null, res.tarde ? '⏰ Entregado fuera de tiempo' : '✓ Entrega recibida'),
      el('p', null, res.tarde
        ? 'El tiempo permitido para este ejercicio ya terminó, así que queda marcada como fuera de tiempo.'
        : 'Queda pendiente de revisión. Tu profesor la revisará y pondrá la nota.'),
      recogida && recogida.archivos.length > 1
        ? el('p', null, 'Se envió tu carpeta completa: ' + describir(recogida) +
          '. Tu profesor podrá ejecutarla tal cual, con todos tus módulos.')
        : null,
      recogida && avisoOmitidos(recogida)
        ? el('div', { class: 'form-note warn' }, avisoOmitidos(recogida))
        : null,
      el('div', { class: 'form-note ' + (conexion.conectado ? '' : 'warn') },
        conexion.conectado
          ? 'Ya está enviada.'
          : 'Tu entrega quedó guardada y se enviará automáticamente cuando vuelva la conexión.')),
    buttons: [{ label: 'Cerrar', value: 'ok', primary: true }]
  });

  cerrar();
  if (hooks.onEntregado) await hooks.onEntregado(res.submission);
  return true;
}

export async function abandonar() {
  if (!activa) return;
  await autoguardar(true);
  await window.pc.events.log({
    exerciseId: activa.exercise.id, submissionId: activa.submissionId, type: 'EXERCISE_EXIT'
  }).catch(() => {});
  cerrar();
}

export function cerrar() {
  pararTemporizadores();
  if (hooks.bloquearEditor) hooks.bloquearEditor(false);
  activa = null;
  bloqueado = false;
  restanteSeg = null;
  pintarBarra();
}

/* ---------------------------------------------------------------- barra */

/** Barra superior con el ejercicio, el cronometro y el boton de entregar. */
function pintarBarra() {
  const barra = $('#exercise-bar');
  if (!barra) return;

  if (!activa) {
    barra.hidden = true;
    clear(barra);
    document.body.classList.remove('en-ejercicio');
    return;
  }

  const ej = activa.exercise;
  barra.hidden = false;
  document.body.classList.add('en-ejercicio');
  clear(barra);

  const critico = restanteSeg != null && restanteSeg <= 60;
  const cronometro = restanteSeg == null
    ? el('span', { class: 'eb-time' }, icon('clock', 13), ' sin límite')
    : el('span', { class: 'eb-time' + (critico ? ' critico' : '') + (bloqueado ? ' agotado' : '') },
      icon('clock', 13), ' ' + (bloqueado ? '00:00' : mmss(restanteSeg)));

  barra.append(
    el('span', { class: 'eb-badge' }, 'EJERCICIO'),
    el('div', { class: 'eb-title' },
      el('b', null, ej.title),
      el('span', { title: 'Un intento corresponde a una entrega. Ejecutar el código no consume intentos.' },
        ej.tema + '  ·  intento ' + activa.submission.attemptNumber +
        (ej.maxAttempts ? ' de ' + ej.maxAttempts : '') + '  ·  ' + ej.xp + ' XP')),
    cronometro,
    activa.ultimoGuardado
      ? el('span', { class: 'eb-saved', title: 'Tu código está guardado en este equipo.' },
        icon('check', 12), ' Guardado')
      : el('span', { class: 'eb-saved' }, 'Se guarda solo'),
    avisosAbandono ? el('span', { class: 'chip warn' }, avisosAbandono + ' salida(s)') : null,
    activa.archivos && activa.archivos.archivos.length > 1
      ? el('span', {
        class: 'chip',
        title: 'Se entrega la carpeta completa: ' + activa.archivos.archivos.map((f) => f.name).join(', ')
      }, describir(activa.archivos))
      : null,
    el('span', { style: { flex: '1' } }),
    el('button', {
      class: 'btn sm outline',
      title: 'Copia una carpeta que ya tengas hecha dentro de este ejercicio.',
      onclick: () => anadirCarpeta()
    }, icon('folder', 12), 'Añadir carpeta'),
    el('button', { class: 'btn sm outline', onclick: () => verEnunciado() }, 'Enunciado'),
    el('button', { class: 'btn sm outline', onclick: () => abandonar() }, 'Salir'),
    el('button', { class: 'btn sm success', onclick: () => entregar() }, 'Entregar')
  );
}

async function verEnunciado() {
  if (!activa) return;
  const ej = activa.exercise;
  await modal({
    title: ej.title,
    wide: true,
    body: el('div', null,
      el('div', { class: 'ex-meta', style: { marginBottom: '10px' } },
        el('span', { class: 'chip accent' }, ej.tema),
        el('span', { class: 'chip' }, ej.xp + ' XP'),
        el('span', { class: 'chip' }, 'Nota máx. ' + ej.maxScore),
        ej.timeLimit ? el('span', { class: 'chip warn' }, ej.timeLimit + ' min') : null),
      ej.description ? el('p', null, ej.description) : null,
      el('h4', { style: { fontSize: '12.5px', color: 'var(--text-strong)', margin: '12px 0 6px' } }, 'Instrucciones'),
      el('div', { class: 'enunciado' }, ej.instructions || '(sin instrucciones adicionales)'),
      ej.rubric && ej.rubric.length
        ? el('div', null,
          el('h4', { style: { fontSize: '12.5px', color: 'var(--text-strong)', margin: '12px 0 6px' } }, 'Cómo se evalúa'),
          el('div', { class: 'card' }, ej.rubric.map((c) => el('div', { class: 'list-row' },
            el('div', { class: 'lr-main' }, el('b', null, c.name)),
            el('div', { class: 'lr-num' }, c.points)))))
        : null),
    buttons: [{ label: 'Cerrar', value: null, primary: true }]
  });
}

export { pintarBarra };
