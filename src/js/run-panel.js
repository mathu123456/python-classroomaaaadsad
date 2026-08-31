/*
 * Consola de ejecución que se puede colgar en cualquier pantalla.
 *
 * La consola grande del editor es única y vive en el panel de abajo. Esta es
 * pequeña y se monta donde haga falta: hoy, dentro de la pantalla de revisión,
 * para que el profesor ejecute la entrega **ahí mismo**, sin salir de la
 * revisión, sin copiar el código a ningún sitio y sin perder de vista los
 * comentarios que estaba escribiendo.
 *
 * Muestra lo mismo que la consola grande: lo que imprime el programa, lo que
 * escribe en errores —explicado en castellano— y cómo terminó. Y deja responder
 * a `input()`, porque muchos ejercicios lo piden.
 */

import { el, clear, formatDuration } from './ui.js';
import { StreamView } from './stream.js';
import * as pyErrores from './py-errors.js';

export class PanelEjecucion {
  /**
   * host: el elemento donde se pinta.
   * opciones.titulo: qué se está ejecutando (se muestra al empezar).
   */
  constructor(host, opciones) {
    const o = opciones || {};
    this.host = host;
    this.titulo = o.titulo || 'Programa';
    this.runId = null;
    this.erroresCrudos = '';
    this.huboSalida = false;
    this.empezadoEn = 0;
    this.onEstado = o.onEstado || null;

    this.salida = el('div', { class: 'stream mini-stream' });
    this.entrada = el('input', {
      class: 'mini-stdin',
      placeholder: 'El programa no está pidiendo datos',
      spellcheck: 'false',
      autocomplete: 'off',
      disabled: true
    });
    this.filaEntrada = el('div', { class: 'input-row disabled' },
      el('span', { class: 'caret' }, '>>>'),
      this.entrada,
      el('span', { class: 'hint' }, 'Enter envía'));

    this.entrada.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || !this.runId) return;
      ev.preventDefault();
      const texto = this.entrada.value;
      this.entrada.value = '';
      this.vista.writeLine(texto, 'in');
      window.pc.python.stdin(this.runId, texto + '\n');
    });

    clear(host).append(this.salida, this.filaEntrada);
    this.vista = new StreamView(this.salida, { maxLines: 3000 });
    this.vista.writeLine('Aquí sale lo que imprima el programa cuando lo ejecutes.', 'sys');

    this.quitarOyente = window.pc.python.onEvent((ev) => this.evento(ev));
  }

  /**
   * Se vuelve a colgar en otro sitio conservando lo ya escrito.
   *
   * Las pantallas se repintan enteras cuando llegan novedades; sin esto, la
   * consola seguiria escribiendo en unos nodos que ya no estan en la pagina y
   * daria la sensacion de que la ejecucion no hace nada.
   */
  montarEn(host) {
    if (!host || host === this.host) return;
    this.host = host;
    clear(host).append(this.salida, this.filaEntrada);
  }

  /** Deja de escuchar. Se llama al salir de la pantalla. */
  destruir() {
    if (this.quitarOyente) { this.quitarOyente(); this.quitarOyente = null; }
    if (this.runId) window.pc.python.stop(this.runId).catch(() => {});
    this.runId = null;
  }

  estaEjecutando() { return !!this.runId; }

  /**
   * Ejecuta un archivo que ya está en el disco. La carpeta del archivo es el
   * directorio de trabajo, así que los módulos de al lado se importan solos.
   */
  async ejecutar(rutaArchivo, etiqueta) {
    if (this.runId) await window.pc.python.stop(this.runId);
    this.vista.clear();
    this.titulo = etiqueta || this.titulo;
    this.erroresCrudos = '';
    this.huboSalida = false;

    const res = await window.pc.python.run({ filePath: rutaArchivo });
    if (!res || !res.ok) {
      this.vista.writeLine('No se pudo ejecutar: ' + ((res && res.error) || 'no se sabe por qué'), 'err');
      if (this.onEstado) this.onEstado('error');
      return null;
    }
    this.esperado = res.runId || null;
    return res;
  }

  async detener() {
    if (!this.runId) return false;
    const res = await window.pc.python.stop(this.runId);
    return !!(res && res.ok);
  }

  /* ------------------------------------------------------------ eventos */

  evento(ev) {
    if (!ev) return;

    /*
     * Solo interesa la ejecución que lanzó este panel. Como Python Classroom
     * ejecuta de una en una, con quedarse con la primera que llegue después de
     * pulsar Ejecutar es suficiente y no hace falta coordinar nada más.
     */
    if (ev.type === 'start') {
      if (this.esperado && ev.runId !== this.esperado) return;
      this.runId = ev.runId;
      this.esperado = null;
      this.empezadoEn = Date.now();
      this.vista.header('▶ ' + (ev.label || this.titulo) + '   ·   Python ' + (ev.pythonVersion || ''));
      this.filaEntrada.classList.remove('disabled');
      this.entrada.disabled = false;
      this.entrada.placeholder = 'Escribe aquí si el programa pide datos';
      if (this.onEstado) this.onEstado('ejecutando');
      return;
    }

    if (!this.runId || ev.runId !== this.runId) return;

    if (ev.type === 'stdout') { this.huboSalida = true; this.vista.write(ev.data, 'out'); return; }
    if (ev.type === 'stderr') {
      this.huboSalida = true;
      this.erroresCrudos += ev.data || '';
      this.vista.write(ev.data, 'err');
      return;
    }
    if (ev.type === 'timeout') {
      this.vista.newLine();
      this.vista.writeLine('⏱ Se detuvo: llevaba más de ' + Math.round(ev.timeoutMs / 1000) + ' segundos.', 'warn');
      return;
    }
    if (ev.type === 'exit') this.fin(ev);
  }

  fin(ev) {
    const duracion = formatDuration(ev.durationMs != null ? ev.durationMs : Date.now() - this.empezadoEn);
    this.runId = null;
    this.filaEntrada.classList.add('disabled');
    this.entrada.disabled = true;
    this.entrada.placeholder = 'El programa no está pidiendo datos';

    if (!this.huboSalida && ev.code === 0 && !ev.stopped && !ev.timedOut) {
      this.vista.writeLine('(terminó sin imprimir nada)', 'sys');
    }
    this.vista.newLine();
    if (ev.stopped) {
      this.vista.writeLine('■ Detenido   ·   ' + duracion, 'warn');
    } else if (ev.timedOut) {
      this.vista.writeLine('■ Interrumpido por tiempo máximo   ·   ' + duracion, 'warn');
    } else if (ev.code === 0) {
      this.vista.writeLine('✔ Terminó correctamente   ·   ' + duracion, 'exit-ok');
    } else {
      this.vista.writeLine('✖ Terminó con errores   ·   ' + duracion, 'exit-bad');
      this.explicar();
    }
    this.vista.scrollToBottom();
    if (this.onEstado) this.onEstado(ev.code === 0 && !ev.timedOut && !ev.stopped ? 'ok' : 'error');
  }

  /* El mismo idioma que en la consola del estudiante: castellano y con la línea. */
  explicar() {
    const error = pyErrores.interpretar(this.erroresCrudos);
    if (!error) return;
    this.vista.newLine();
    this.vista.writeLine('❌ ' + error.tipo, 'exit-bad');
    if (error.linea) this.vista.writeLine('Línea ' + error.linea, 'warn');
    this.vista.writeLine(error.explicacion, 'sys');
  }
}
