/*
 * Editor de codigo (CodeMirror 6).
 *
 * Este modulo solo sabe de codigo: edicion, resaltado, autocompletado,
 * diagnosticos y atajos. No conoce archivos, ejercicios ni calificaciones.
 * Cada documento abierto tiene su propio EditorState (mantiene su historial de
 * deshacer, su seleccion y su desplazamiento).
 */

import {
  EditorState, EditorView, Compartment, Prec,
  keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor,
  highlightActiveLine, placeholder as cmPlaceholder, tooltips,
  defaultKeymap, history, historyKeymap, indentWithTab, toggleComment,
  indentMore, indentLess, undo, redo, selectAll, deleteLine,
  copyLineDown, copyLineUp, moveLineDown, moveLineUp, insertNewlineAndIndent, selectLine,
  foldGutter, foldKeymap, indentOnInput, indentUnit, bracketMatching,
  closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap, acceptCompletion,
  startCompletion,
  searchKeymap, highlightSelectionMatches, search, openSearchPanel,
  selectNextOccurrence, selectSelectionMatches,
  lintGutter, setDiagnostics,
  python
} from './vendor/cm6.js';

import { syntaxExtension, darkFlag } from './theme.js';
import { pythonCompletionSource } from './completions.js';

/* --------------------------------------------------------- compartimentos */

const cWrap = new Compartment();
const cTab = new Compartment();
const cDark = new Compartment();
const cReadOnly = new Compartment();

let view = null;
let callbacks = {};

/* ------------------------------------------------------------- extensiones */

function wrapExt(on) { return on ? EditorView.lineWrapping : []; }
function tabExt(n) { return [indentUnit.of(' '.repeat(n)), EditorState.tabSize.of(n)]; }
function lineNumExt(on) { return on ? [lineNumbers(), highlightActiveLineGutter()] : []; }
function activeLineExt(on) { return on ? highlightActiveLine() : []; }

function autocompleteExt(settings) {
  if (!settings.autocomplete) return [];
  return autocompletion({
    override: [pythonCompletionSource],
    activateOnTyping: settings.autocompleteOnType !== false,
    closeOnBlur: true,
    maxRenderedOptions: 60,
    defaultKeymap: true,
    icons: true,
    tooltipClass: () => 'pc-complete',
    optionClass: (c) => 'pc-opt-' + (c.type || 'text')
  });
}

/** Atajos propios de Python Classroom, por encima de los de CodeMirror. */
function appKeymap() {
  return Prec.highest(keymap.of([
    { key: 'Tab', run: acceptCompletion },
    { key: 'Ctrl-Space', run: startCompletion, preventDefault: true },
    { key: 'Mod-s', run: () => { fire('save'); return true; }, preventDefault: true },
    { key: 'Mod-Shift-s', run: () => { fire('saveAs'); return true; }, preventDefault: true },
    { key: 'Mod-Enter', run: () => { fire('run'); return true; }, preventDefault: true },
    { key: 'Mod-Shift-c', run: () => { fire('stop'); return true; }, preventDefault: true },
    { key: 'Mod-y', run: redo, preventDefault: true },
    { key: 'Mod-h', run: (v) => { openSearchPanel(v); v.focus(); return true; }, preventDefault: true },
    { key: 'Mod-/', run: toggleComment, preventDefault: true },
    { key: 'Mod-a', run: selectAll, preventDefault: true },
    { key: 'Mod-w', run: () => { fire('closeTab'); return true; }, preventDefault: true },
    { key: 'Mod-l', run: () => { fire('clearConsole'); return true; }, preventDefault: true },
    { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
    { key: 'Mod-Shift-l', run: selectSelectionMatches, preventDefault: true },
    { key: 'Mod-Alt-l', run: selectLine, preventDefault: true },
    { key: 'Shift-Alt-ArrowDown', run: copyLineDown },
    { key: 'Shift-Alt-ArrowUp', run: copyLineUp },
    { key: 'Alt-ArrowUp', run: moveLineUp },
    { key: 'Alt-ArrowDown', run: moveLineDown },
    { key: 'Mod-Shift-k', run: deleteLine },
    { key: 'Shift-Tab', run: indentLess },
    { key: 'Mod-]', run: indentMore },
    { key: 'Mod-[', run: indentLess }
  ]));
}

function fire(name, arg) {
  if (callbacks[name]) callbacks[name](arg);
}

function baseExtensions(settings) {
  return [
    appKeymap(),
    lineNumExt(settings.lineNumbers !== false),
    foldGutter({
      markerDOM(open) {
        const span = document.createElement('span');
        span.style.cssText = 'display:inline-block;width:11px;text-align:center;cursor:pointer;line-height:1';
        span.textContent = open ? '▾' : '▸';
        return span;
      }
    }),
    lintGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    settings.bracketPairs !== false ? closeBrackets() : [],
    autocompleteExt(settings),
    rectangularSelection(),
    crosshairCursor(),
    activeLineExt(settings.highlightActiveLine !== false),
    highlightSelectionMatches(),
    search({ top: true }),
    tooltips({ position: 'absolute' }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      { key: 'Enter', run: insertNewlineAndIndent },
      indentWithTab
    ]),
    python(),
    syntaxExtension(),
    cWrap.of(wrapExt(!!settings.wordWrap)),
    cTab.of(tabExt(settings.tabSize || 4)),
    cDark.of(darkFlag(settings.theme !== 'light')),
    cReadOnly.of(EditorState.readOnly.of(false)),
    cmPlaceholder('# Escribe tu código Python aquí…\nprint("Hola, mundo")'),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) fire('change', update);
      if (update.selectionSet || update.docChanged) fire('cursor', cursorInfo(update.state));
    })
  ];
}

/* ------------------------------------------------------------- API publica */

export function createEditor(host, settings, handlers) {
  callbacks = handlers || {};
  view = new EditorView({
    state: EditorState.create({ doc: '', extensions: baseExtensions(settings) }),
    parent: host
  });
  return view;
}

export function makeState(text, settings) {
  return EditorState.create({ doc: text || '', extensions: baseExtensions(settings) });
}

export function setState(state) {
  if (!view) return;
  view.setState(state);
}

export function getState() { return view ? view.state : null; }
export function getView() { return view; }

export function getValue() { return view ? view.state.doc.toString() : ''; }

export function focus() { if (view) view.focus(); }

export function cursorInfo(state) {
  const s = state || (view && view.state);
  if (!s) return { line: 1, col: 1, sel: 0, lines: 1 };
  const head = s.selection.main.head;
  const line = s.doc.lineAt(head);
  let selected = 0;
  for (const r of s.selection.ranges) selected += Math.abs(r.to - r.from);
  return {
    line: line.number,
    col: head - line.from + 1,
    sel: selected,
    lines: s.doc.lines,
    chars: s.doc.length
  };
}

/** Efectos para aplicar preferencias a un estado (activo o no). */
export function settingsEffects(settings) {
  return [
    cWrap.reconfigure(wrapExt(!!settings.wordWrap)),
    cTab.reconfigure(tabExt(settings.tabSize || 4)),
    cDark.reconfigure(darkFlag(settings.theme !== 'light'))
  ];
}

/** Preferencias que exigen reconstruir el estado (numeros de linea, etc.). */
export function needsRebuild(prev, next) {
  return prev.lineNumbers !== next.lineNumbers ||
    prev.autocomplete !== next.autocomplete ||
    prev.autocompleteOnType !== next.autocompleteOnType ||
    prev.bracketPairs !== next.bracketPairs ||
    prev.highlightActiveLine !== next.highlightActiveLine;
}

export function setReadOnly(on) {
  if (!view) return;
  view.dispatch({ effects: cReadOnly.reconfigure(EditorState.readOnly.of(!!on)) });
}

export function applyDiagnostics(diagnostics) {
  if (!view) return;
  const state = view.state;
  const list = (diagnostics || []).map((d) => {
    const lineNo = Math.min(Math.max(1, d.line || 1), state.doc.lines);
    const line = state.doc.line(lineNo);
    const from = Math.min(line.from + Math.max(0, (d.col || 1) - 1), line.to);
    const endLineNo = Math.min(Math.max(lineNo, d.endLine || lineNo), state.doc.lines);
    const endLine = state.doc.line(endLineNo);
    let to = Math.min(endLine.from + Math.max(1, (d.endCol || (d.col || 1) + 1) - 1), endLine.to);
    if (to <= from) to = Math.min(line.to, from + 1);
    return {
      from,
      to,
      severity: d.severity || 'error',
      message: (d.type ? d.type + ': ' : '') + (d.message || 'Error'),
      source: 'Python'
    };
  });
  view.dispatch(setDiagnostics(state, list));
}

/* -------------------------------------------------------------- comandos */

export const commands = {
  undo: () => view && undo(view),
  redo: () => view && redo(view),
  selectAll: () => view && selectAll(view),
  comment: () => view && toggleComment(view),
  indent: () => view && indentMore(view),
  dedent: () => view && indentLess(view),
  find: () => { if (view) { openSearchPanel(view); view.focus(); } },
  cut: () => document.execCommand('cut'),
  copy: () => document.execCommand('copy'),
  paste: async () => {
    if (!view) return;
    const text = await window.pc.app.paste();
    if (text == null) return;
    view.dispatch(view.state.replaceSelection(text));
    view.focus();
  },
  gotoLine: (n) => {
    if (!view) return;
    const line = view.state.doc.line(Math.min(Math.max(1, n), view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    view.focus();
  },
  gotoPosition: (lineNo, col) => {
    if (!view) return;
    const line = view.state.doc.line(Math.min(Math.max(1, lineNo), view.state.doc.lines));
    const pos = Math.min(line.from + Math.max(0, (col || 1) - 1), line.to);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  },
  insert: (text) => {
    if (!view) return;
    view.dispatch(view.state.replaceSelection(text));
    view.focus();
  }
};
