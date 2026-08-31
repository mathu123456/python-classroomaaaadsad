/*
 * Temas de la aplicacion y del editor.
 *
 * Los colores viven en css/variables.css: el resaltado de sintaxis usa
 * var(--syn-*), de modo que cambiar de tema no obliga a reconstruir el editor.
 */

import { HighlightStyle, syntaxHighlighting, tags, EditorView } from './vendor/cm6.js';

export const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: tags.controlKeyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: tags.moduleKeyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: tags.operatorKeyword, color: 'var(--syn-keyword)' },
  { tag: tags.definitionKeyword, color: 'var(--syn-keyword)', fontWeight: '600' },

  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.special(tags.string), color: 'var(--syn-string)' },
  { tag: tags.regexp, color: 'var(--syn-string)' },
  { tag: tags.escape, color: 'var(--syn-number)' },

  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.bool, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: tags.null, color: 'var(--syn-keyword)', fontWeight: '600' },

  { tag: tags.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.lineComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.blockComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.docString, color: 'var(--syn-comment)', fontStyle: 'italic' },

  { tag: tags.definition(tags.variableName), color: 'var(--syn-def)' },
  { tag: tags.definition(tags.propertyName), color: 'var(--syn-def)' },
  { tag: tags.function(tags.variableName), color: 'var(--syn-def)' },
  { tag: tags.function(tags.propertyName), color: 'var(--syn-def)' },
  { tag: tags.variableName, color: 'var(--syn-variable)' },
  { tag: tags.propertyName, color: 'var(--syn-variable)' },

  { tag: tags.className, color: 'var(--syn-class)', fontWeight: '600' },
  { tag: tags.definition(tags.className), color: 'var(--syn-class)', fontWeight: '600' },
  { tag: tags.typeName, color: 'var(--syn-class)' },
  { tag: tags.namespace, color: 'var(--syn-decorator)' },

  { tag: tags.self, color: 'var(--syn-self)', fontStyle: 'italic' },
  { tag: tags.standard(tags.variableName), color: 'var(--syn-builtin)' },
  { tag: tags.special(tags.variableName), color: 'var(--syn-builtin)' },

  { tag: tags.operator, color: 'var(--syn-operator)' },
  { tag: tags.punctuation, color: 'var(--syn-operator)' },
  { tag: tags.bracket, color: 'var(--syn-operator)' },
  { tag: tags.paren, color: 'var(--syn-operator)' },
  { tag: tags.squareBracket, color: 'var(--syn-operator)' },
  { tag: tags.brace, color: 'var(--syn-operator)' },
  { tag: tags.separator, color: 'var(--syn-operator)' },

  { tag: tags.meta, color: 'var(--syn-decorator)' },
  { tag: tags.annotation, color: 'var(--syn-decorator)' },
  { tag: tags.processingInstruction, color: 'var(--syn-decorator)' },

  { tag: tags.invalid, color: 'var(--error)', textDecoration: 'underline wavy' },
  { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: tags.heading, color: 'var(--accent)', fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' }
]);

export function syntaxExtension() {
  return syntaxHighlighting(highlightStyle, { fallback: true });
}

/** Solo indica a CodeMirror si el fondo es oscuro (afecta a la seleccion). */
export function darkFlag(isDark) {
  return EditorView.theme({}, { dark: isDark });
}

export function applyAppTheme(name) {
  const theme = name === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
