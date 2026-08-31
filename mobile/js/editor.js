/*
 * Editor de código para el teléfono.
 *
 * Se reutiliza el mismo CodeMirror 6 que ya empaqueta la aplicación de
 * escritorio (src/js/vendor/cm6.js), con una configuración más sobria: en una
 * pantalla de 390 px no caben minimapas ni adornos, y el teclado del móvil ya
 * ocupa media pantalla.
 *
 * Si por lo que sea el bundle no carga, se cae a un <textarea> monoespaciado.
 * Es peor -no colorea- pero permite trabajar, y eso es lo que importa.
 */

let CM = null;

async function cargarCM() {
  if (CM) return CM;
  CM = await import('../../src/js/vendor/cm6.js');
  return CM;
}

/**
 * Monta un editor dentro de `host`.
 * Devuelve { valor(), poner(texto), enfocar(), esRespaldo }.
 */
export async function crear(host, opciones) {
  const o = opciones || {};
  const inicial = String(o.valor || '');

  try {
    const cm = await cargarCM();
    const extensiones = [
      cm.lineNumbers(),
      cm.history(),
      cm.python(),
      cm.syntaxHighlighting(cm.defaultHighlightStyle, { fallback: true }),
      cm.closeBrackets(),
      cm.highlightActiveLine(),
      cm.indentUnit.of('    '),
      cm.EditorState.tabSize.of(4),
      cm.EditorView.lineWrapping,
      cm.keymap.of([
        ...cm.defaultKeymap,
        ...cm.historyKeymap,
        ...cm.closeBracketsKeymap,
        cm.indentWithTab
      ]),
      cm.EditorView.theme({
        '&': { fontSize: '13px', height: '100%' },
        '.cm-content': { fontFamily: 'var(--font-code)', padding: '10px 0' },
        '.cm-gutters': { background: 'transparent', border: 'none' },
        '.cm-activeLine': { background: 'rgba(255,255,255,.03)' }
      }, { dark: document.documentElement.dataset.theme !== 'light' })
    ];
    if (o.onCambio) {
      extensiones.push(cm.EditorView.updateListener.of((v) => {
        if (v.docChanged) o.onCambio(v.state.doc.toString());
      }));
    }

    const vista = new cm.EditorView({
      state: cm.EditorState.create({ doc: inicial, extensions: extensiones }),
      parent: host
    });

    return {
      esRespaldo: false,
      valor: () => vista.state.doc.toString(),
      poner: (texto) => vista.dispatch({
        changes: { from: 0, to: vista.state.doc.length, insert: String(texto || '') }
      }),
      enfocar: () => vista.focus(),
      destruir: () => vista.destroy()
    };
  } catch (err) {
    console.warn('[movil] CodeMirror no cargó, se usa un área de texto:', err);

    const area = document.createElement('textarea');
    area.className = 'm-editor-respaldo';
    area.value = inicial;
    area.spellcheck = false;
    area.autocapitalize = 'off';
    area.autocomplete = 'off';
    area.setAttribute('autocorrect', 'off');
    area.style.cssText =
      'width:100%;min-height:240px;border:0;background:transparent;color:var(--text);' +
      'font-family:var(--font-code);font-size:13px;padding:10px;resize:vertical;outline:none;';

    // Tab dentro del área inserta cuatro espacios en vez de salir del campo.
    area.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const ini = area.selectionStart;
      const fin = area.selectionEnd;
      area.value = area.value.slice(0, ini) + '    ' + area.value.slice(fin);
      area.selectionStart = area.selectionEnd = ini + 4;
      if (o.onCambio) o.onCambio(area.value);
    });
    if (o.onCambio) area.addEventListener('input', () => o.onCambio(area.value));

    host.append(area);
    return {
      esRespaldo: true,
      valor: () => area.value,
      poner: (texto) => { area.value = String(texto || ''); },
      enfocar: () => area.focus(),
      destruir: () => area.remove()
    };
  }
}
