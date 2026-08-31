/*
 * Consola de ejecucion.
 *
 * Muestra en vivo lo que imprime el programa del alumno, permite responder a
 * input() y comunica el resultado final: codigo de salida, duracion y si se
 * detuvo por exceder el tiempo maximo.
 */

import { $, formatDuration, toast } from './ui.js';
import { StreamView } from './stream.js';
import * as pyErrores from './py-errors.js';
import { history } from './storage.js';

let view = null;
let inputRow = null;
let inputEl = null;
let caretEl = null;
let activeRun = null;
let startedAt = 0;
let sawOutput = false;
let erroresCrudos = '';        // lo que Python escribio en stderr, para explicarlo
let hooks = {};
let histIndex = -1;
let histItems = [];

export function init(appHooks) {
  hooks = appHooks || {};
  view = new StreamView($('#console-out'), { maxLines: 6000 });
  inputRow = $('#console-input-row');
  inputEl = $('#console-stdin');
  caretEl = inputRow.querySelector('.caret');

  inputEl.addEventListener('keydown', onInputKey);

  history.get('stdin').then((items) => { histItems = items || []; }).catch(() => {});

  window.pc.python.onEvent(onPythonEvent);

  welcome();
}

function welcome() {
  view.header('Consola de Python Classroom');
  view.writeLine('Pulsa Ejecutar (Ctrl+Enter) para lanzar tu programa.', 'sys');
}

export function clear() {
  view.clear();
  if (!activeRun) welcome();
}

export function isRunning() { return !!activeRun; }
export function currentRunId() { return activeRun; }

/* ------------------------------------------------------------- entrada */

function onInputKey(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    const text = inputEl.value;
    inputEl.value = '';
    if (!activeRun) return;
    view.write(text + '\n', 'prompt-echo');
    window.pc.python.stdin(activeRun, text + '\n');
    if (text.trim()) {
      history.push('stdin', text).then((items) => { histItems = items; }).catch(() => {});
    }
    histIndex = -1;
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (histIndex + 1 < histItems.length) {
      histIndex++;
      inputEl.value = histItems[histIndex];
      inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    }
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (histIndex > 0) { histIndex--; inputEl.value = histItems[histIndex]; }
    else { histIndex = -1; inputEl.value = ''; }
    return;
  }
  if (event.key === 'd' && event.ctrlKey) {
    event.preventDefault();
    if (activeRun) {
      window.pc.python.endStdin(activeRun);
      view.writeLine('[fin de la entrada]', 'sys');
    }
  }
}

function setInputEnabled(on, label) {
  inputRow.classList.toggle('disabled', !on);
  inputEl.placeholder = on ? 'Escribe aquí y pulsa Enter…' : 'El programa no está pidiendo datos';
  caretEl.textContent = label || '>>>';
  if (on) setTimeout(() => inputEl.focus(), 20);
}

/* -------------------------------------------------------------- eventos */

function onPythonEvent(ev) {
  if (!ev) return;
  switch (ev.type) {
    case 'start': return onStart(ev);
    case 'stdout': return onOut(ev.data, 'out');
    case 'stderr': return onOut(ev.data, 'err');
    case 'timeout': return onTimeout(ev);
    case 'exit': return onExit(ev);
    default: return undefined;
  }
}

function onStart(ev) {
  activeRun = ev.runId;
  startedAt = Date.now();
  sawOutput = false;
  erroresCrudos = '';
  const settings = hooks.getSettings ? hooks.getSettings() : {};
  if (settings.clearConsoleOnRun !== false) view.clear();

  const limit = ev.timeoutMs ? Math.round(ev.timeoutMs / 1000) + ' s' : 'sin límite';
  view.header('▶ ' + ev.label + '   ·   Python ' + (ev.pythonVersion || '') + '   ·   tiempo máximo: ' + limit);
  setInputEnabled(true);
  if (hooks.onRunStateChange) hooks.onRunStateChange('running', ev);
}

function onOut(data, cls) {
  if (!data) return;
  sawOutput = true;
  if (cls === 'err') erroresCrudos += data;
  view.write(data, cls);
}

/*
 * Explicacion del error, en castellano y con la linea.
 *
 * Se muestra DESPUES del traceback, no en su lugar: el traceback sigue siendo
 * util y forma parte de aprender a programar. Y no cambia nada academico: un
 * error de ejecucion no gasta intentos ni marca la entrega.
 */
function explicarError() {
  const error = pyErrores.interpretar(erroresCrudos);
  if (!error) return;

  view.newLine();
  view.writeLine('❌ Error al ejecutar', 'exit-bad');
  if (error.linea) view.writeLine('Línea ' + error.linea, 'warn');
  view.writeLine(error.tipo, 'warn');
  view.writeLine(error.explicacion, 'sys');
  view.writeLine('Corregir esto no te cuesta ningún intento.', 'sys');
}

function onTimeout(ev) {
  view.newLine();
  view.writeLine(
    '⏱ Se detuvo el programa: llevaba más de ' + Math.round(ev.timeoutMs / 1000) + ' segundos.',
    'warn'
  );
  view.writeLine('Suele pasar cuando un bucle no termina nunca. Esto no gasta intentos.', 'sys');
}

function onExit(ev) {
  const duration = formatDuration(ev.durationMs != null ? ev.durationMs : Date.now() - startedAt);
  activeRun = null;
  setInputEnabled(false);

  if (!sawOutput && ev.code === 0 && !ev.stopped && !ev.timedOut) {
    view.writeLine('(el programa terminó sin imprimir nada)', 'sys');
  }

  view.newLine();
  if (ev.stopped) {
    view.writeLine('■ Ejecución detenida por el usuario   ·   ' + duration, 'warn');
  } else if (ev.timedOut) {
    view.writeLine('■ Ejecución interrumpida por tiempo máximo   ·   ' + duration, 'warn');
  } else if (ev.code === 0) {
    view.writeLine('✔ Programa finalizado correctamente   ·   código 0   ·   ' + duration, 'exit-ok');
  } else {
    view.writeLine('✖ El programa terminó con errores   ·   ' + duration, 'exit-bad');
    explicarError();
  }
  view.scrollToBottom();

  if (hooks.onRunStateChange) {
    hooks.onRunStateChange(ev.code === 0 && !ev.timedOut && !ev.stopped ? 'ok' : 'error', ev);
  }
}

/* ------------------------------------------------------------ acciones */

export async function run(payload) {
  if (activeRun) {
    await window.pc.python.stop(activeRun);
  }
  const res = await window.pc.python.run(payload);
  if (!res || !res.ok) {
    view.newLine();
    view.writeLine('No se pudo ejecutar: ' + ((res && res.error) || 'error desconocido'), 'err');
    toast((res && res.error) || 'No se pudo iniciar Python', { title: 'Ejecución', type: 'err' });
    if (hooks.onRunStateChange) hooks.onRunStateChange('error', {});
    return null;
  }
  return res;
}

export async function stop() {
  if (!activeRun) return false;
  const res = await window.pc.python.stop(activeRun);
  return !!(res && res.ok);
}

export function focusInput() { if (!inputRow.classList.contains('disabled')) inputEl.focus(); }

export function print(text, cls) { view.write(text, cls || 'sys'); }
