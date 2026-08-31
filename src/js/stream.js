/*
 * Vista de salida en streaming para la consola y la terminal.
 *
 * - Interpreta los codigos ANSI de color mas habituales (los que usan rich,
 *   colorama o pip) y los traduce a clases CSS.
 * - Entiende el retorno de carro (\r) para que las barras de progreso se
 *   sobrescriban en la misma linea en vez de llenar la pantalla.
 * - Limita el numero de lineas para que la interfaz no se degrade.
 */

const ANSI_RE = /\x1b\[([0-9;?]*)([A-Za-z])/g;

const SGR_CLASS = {
  1: 'abold', 2: 'adim', 4: 'aunder',
  30: 'a30', 31: 'a31', 32: 'a32', 33: 'a33', 34: 'a34', 35: 'a35', 36: 'a36', 37: 'a37',
  90: 'a90', 91: 'a91', 92: 'a92', 93: 'a93', 94: 'a94', 95: 'a95', 96: 'a96'
};

export class StreamView {
  constructor(host, options = {}) {
    this.host = host;
    this.maxLines = options.maxLines || 5000;
    this.line = null;
    this.classes = [];
    this.baseClass = 'out';
    this.stick = true;

    host.addEventListener('scroll', () => {
      const gap = host.scrollHeight - host.scrollTop - host.clientHeight;
      this.stick = gap < 40;
    });
  }

  /* -------------------------------------------------------- internos */

  newLine() {
    const div = document.createElement('div');
    div.className = 'ln';
    this.host.append(div);
    this.line = div;
    this.trim();
    return div;
  }

  ensureLine() {
    if (!this.line) this.newLine();
    return this.line;
  }

  trim() {
    const extra = this.host.childElementCount - this.maxLines;
    if (extra > 0) {
      for (let i = 0; i < extra; i++) {
        if (this.host.firstElementChild) this.host.firstElementChild.remove();
      }
    }
  }

  appendText(text, cls) {
    if (!text) return;
    const line = this.ensureLine();
    const span = document.createElement('span');
    const classes = [cls || this.baseClass].concat(this.classes).filter(Boolean);
    span.className = classes.join(' ');
    span.textContent = text;
    line.append(span);
  }

  applySgr(params) {
    const codes = params.split(';').filter((s) => s !== '').map(Number);
    if (!codes.length || codes.indexOf(0) !== -1) { this.classes = []; }
    for (const code of codes) {
      if (code === 0) { this.classes = []; continue; }
      const cls = SGR_CLASS[code];
      if (!cls) continue;
      // Solo un color de primer plano a la vez
      if (code >= 30) this.classes = this.classes.filter((c) => !/^a\d/.test(c));
      if (this.classes.indexOf(cls) === -1) this.classes.push(cls);
    }
  }

  /* ---------------------------------------------------------- publico */

  /** Escribe un fragmento de texto crudo (puede traer ANSI, \n y \r). */
  write(text, cls) {
    if (text == null || text === '') return;
    const chunk = String(text).replace(/\r\n/g, '\n');
    let last = 0;
    ANSI_RE.lastIndex = 0;
    let match;
    const pieces = [];
    while ((match = ANSI_RE.exec(chunk)) !== null) {
      if (match.index > last) pieces.push({ text: chunk.slice(last, match.index) });
      pieces.push({ ansi: match[1], cmd: match[2] });
      last = ANSI_RE.lastIndex;
    }
    if (last < chunk.length) pieces.push({ text: chunk.slice(last) });

    for (const piece of pieces) {
      if (piece.ansi !== undefined) {
        if (piece.cmd === 'm') this.applySgr(piece.ansi);
        else if (piece.cmd === 'K' && this.line) this.line.textContent = '';
        continue;
      }
      // Dividimos por saltos de linea manteniendo el estado
      const parts = piece.text.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) this.newLine();
        const seg = parts[i];
        if (seg.indexOf('\r') !== -1) {
          const subs = seg.split('\r');
          // Cada \r reinicia la linea actual
          for (let j = 0; j < subs.length; j++) {
            if (j > 0 && this.line) this.line.textContent = '';
            this.appendText(subs[j], cls);
          }
        } else {
          this.appendText(seg, cls);
        }
      }
    }
    this.autoScroll();
  }

  /** Escribe una linea completa con una clase concreta. */
  writeLine(text, cls) {
    this.newLine();
    this.appendText(String(text), cls);
    this.newLine();
    this.autoScroll();
  }

  /** Linea de cabecera con separador. */
  header(text) {
    const div = document.createElement('div');
    div.className = 'ln hdr';
    div.textContent = text;
    this.host.append(div);
    this.line = null;
    this.autoScroll();
  }

  clear() {
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
    this.line = null;
    this.classes = [];
    this.stick = true;
  }

  isEmpty() { return this.host.childElementCount === 0; }

  autoScroll() {
    if (!this.stick) return;
    this.host.scrollTop = this.host.scrollHeight;
  }

  scrollToBottom() {
    this.stick = true;
    this.host.scrollTop = this.host.scrollHeight;
  }

  text() { return this.host.innerText; }
}
