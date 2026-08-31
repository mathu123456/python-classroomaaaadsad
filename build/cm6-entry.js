/*
 * Punto de entrada del bundle de CodeMirror 6.
 * esbuild empaqueta este archivo en src/js/vendor/cm6.js (ESM) para que el
 * renderer pueda importar el editor sin necesitar un bundler en tiempo de ejecucion.
 */

export {
  EditorState, StateField, StateEffect, Compartment, Facet, Prec,
  RangeSet, RangeSetBuilder, Transaction, EditorSelection, Text
} from '@codemirror/state';

export {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine,
  placeholder, tooltips, showPanel, ViewPlugin, Decoration, WidgetType, gutter,
  GutterMarker, hoverTooltip, scrollPastEnd, highlightWhitespace, highlightTrailingWhitespace
} from '@codemirror/view';

export {
  defaultKeymap, history, historyKeymap, indentWithTab, toggleComment, toggleLineComment,
  toggleBlockComment, indentMore, indentLess, undo, redo, undoDepth, redoDepth,
  selectAll, deleteLine, copyLineDown, copyLineUp, moveLineDown, moveLineUp,
  cursorLineStart, cursorLineEnd, insertNewlineAndIndent, selectLine, simplifySelection
} from '@codemirror/commands';

export {
  foldGutter, foldKeymap, foldAll, unfoldAll, codeFolding, indentOnInput, indentUnit,
  bracketMatching, syntaxHighlighting, HighlightStyle, defaultHighlightStyle,
  LanguageSupport, syntaxTree, ensureSyntaxTree, StreamLanguage, getIndentUnit,
  indentString, foldEffect, unfoldEffect
} from '@codemirror/language';

export {
  closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap,
  acceptCompletion, startCompletion, closeCompletion, completionStatus,
  currentCompletions, snippetCompletion, insertCompletionText, pickedCompletion,
  selectedCompletion
} from '@codemirror/autocomplete';

export {
  searchKeymap, highlightSelectionMatches, search, openSearchPanel, closeSearchPanel,
  findNext, findPrevious, replaceNext, replaceAll, selectMatches, SearchQuery,
  setSearchQuery, getSearchQuery, searchPanelOpen, selectNextOccurrence,
  selectSelectionMatches
} from '@codemirror/search';

export {
  linter, lintGutter, setDiagnostics, forceLinting, diagnosticCount,
  openLintPanel, closeLintPanel, nextDiagnostic
} from '@codemirror/lint';

export { python, pythonLanguage } from '@codemirror/lang-python';

export { tags } from '@lezer/highlight';
