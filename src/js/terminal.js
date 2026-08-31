/*
 * Terminal integrada.
 *
 * Escribe comandos y se ejecutan con el PATH de Python Classroom por delante,
 * asi que "python" y "pip" son siempre los internos. Mientras un proceso esta
 * vivo, lo que escribes va a su entrada estandar (por ejemplo, al REPL de
 * Python o a un programa que use input()).
 */

import { $, toast } from './ui.js';
import { StreamView } from './stream.js';
import { history } from './storage.js';

let view = null;
let inputEl = null;
let promptEl = null;
let sessionId = null;
let cwd = '';
let busy = false;
let interactive = false;
let histItems = [];
let histIndex = -1;
let started = false;

export async function init() {
  view = new StreamView($('#term-out'), { maxLines: 8000 });
  inputEl = $('#term-input');
  promptEl = $('#term-prompt');

  inputEl.addEventListener('keydown', onKey);
  $('#term-out').addEventListener('mouseup', () => {
    if (!window.getSelection().toString()) inputEl.focus();
  });

  histItems = await history.get('terminal').catch(() => []);
  window.pc.terminal.onEvent(onEvent);
}

export async function ensureStarted(startCwd) {
  if (started) {
    if (startCwd && startCwd !== cwd) await setCwd(startCwd);
    return;
  }
  started = true;
  const info = await window.pc.terminal.create(startCwd);
  sessionId = info.id;
  cwd = info.cwd;
  updatePrompt();

  view.header('Terminal de Python Classroom');
  if (info.python) {
    view.writeLine('Python ' + info.python.version + (info.python.embedded ? ' (runtime interno)' : ' (Python del sistema)'), 'sys');
    view.writeLine('Escribe "ayuda" para ver los comandos disponibles.', 'sys');
  } else {
    view.writeLine('No hay ningún intérprete de Python disponible todavía.', 'err');
  }
  view.newLine();
}

export function isReady() { return !!sessionId; }
export function isBusy() { return busy; }

export async function setCwd(dir) {
  if (!sessionId || !dir) return;
  const res = await window.pc.terminal.setCwd(sessionId, dir);
  if (res && res.cwd) { cwd = res.cwd; updatePrompt(); }
}

function shortCwd() {
  const parts = String(cwd || '').split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return cwd;
  return '…' + '\\' + parts.slice(-2).join('\\');
}

function updatePrompt() {
  if (!promptEl) return;
  promptEl.textContent = interactive ? '>>>' : (shortCwd() + '>');
  promptEl.title = cwd;
  inputEl.placeholder = busy
    ? (interactive ? 'Escribe una instrucción de Python…' : 'El proceso está en marcha: lo que escribas va a su entrada')
    : 'python  ·  pip list  ·  cd carpeta  ·  ayuda';
}

/* ------------------------------------------------------------- teclado */

function onKey(event) {
  if (event.key === 'c' && event.ctrlKey && !inputEl.value) {
    event.preventDefault();
    interrupt();
    return;
  }
  if (event.key === 'l' && event.ctrlKey) {
    event.preventDefault();
    clear();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    submit();
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
  }
}

async function submit() {
  const line = inputEl.value;
  inputEl.value = '';
  histIndex = -1;
  if (!sessionId) { await ensureStarted(); }

  if (busy) {
    // Hay un proceso vivo: la linea va a su entrada estandar.
    view.write(line + '\n', 'prompt-echo');
    await window.pc.terminal.input(sessionId, line + '\n');
    return;
  }

  view.write(shortCwd() + '> ', 'sys');
  view.write(line + '\n', 'cmd');
  if (line.trim()) {
    histItems = await history.push('terminal', line.trim()).catch(() => histItems);
  }

  busy = true;
  updatePrompt();
  const res = await window.pc.terminal.exec(sessionId, line);
  if (res && !res.ok && res.error) {
    view.writeLine(res.error, 'err');
    busy = false;
    updatePrompt();
  } else if (res && res.builtin) {
    // los comandos internos emiten 'done' igualmente
  }
}

export async function interrupt() {
  if (!sessionId || !busy) return;
  const res = await window.pc.terminal.interrupt(sessionId);
  if (res && res.ok) view.writeLine('^C', 'warn');
}

export function clear() {
  view.clear();
  view.header('Terminal de Python Classroom');
  view.newLine();
}

export function focus() { if (inputEl) inputEl.focus(); }

/* -------------------------------------------------------------- eventos */

function onEvent(ev) {
  if (!ev || ev.id !== sessionId) return;
  switch (ev.type) {
    case 'started':
      interactive = !!ev.interactive;
      updatePrompt();
      break;
    case 'data':
      view.write(ev.data, ev.stream === 'stderr' ? 'err' : 'out');
      break;
    case 'clear':
      view.clear();
      break;
    case 'done':
      busy = false;
      interactive = false;
      if (ev.cwd) cwd = ev.cwd;
      if (ev.code != null && ev.code !== 0 && ev.code !== undefined) {
        view.writeLine('[código de salida ' + ev.code + ']', 'warn');
      }
      updatePrompt();
      break;
    default:
      break;
  }
}

/** Cierra la sesion actual (al cambiar de usuario) y deja la vista limpia. */
export async function reset() {
  if (sessionId) {
    try { await window.pc.terminal.dispose(sessionId); } catch (err) { /* ya no existe */ }
  }
  sessionId = null;
  started = false;
  busy = false;
  interactive = false;
  cwd = '';
  histIndex = -1;
  if (view) view.clear();
  if (promptEl) promptEl.textContent = '>';
}

/** Ejecuta un comando desde fuera (por ejemplo desde el gestor de librerias). */
export async function runCommand(line, options = {}) {
  await ensureStarted(options.cwd);
  if (busy) {
    toast('La terminal está ocupada. Detén el proceso actual con Ctrl+C.', { type: 'warn' });
    return false;
  }
  inputEl.value = line;
  await submit();
  return true;
}
