/*
 * Ejecución de Python en el teléfono.
 *
 * En un móvil no se puede instalar CPython, así que se usa Pyodide: el propio
 * CPython compilado a WebAssembly, ejecutándose dentro del navegador. Ventajas:
 * funciona en iPhone y en Android, sin servidor y sin enviar el código de nadie
 * a ninguna parte.
 *
 * Límites, dichos claro porque el estudiante los va a notar:
 *   - La primera carga descarga unos 10 MB. Después queda en la caché.
 *   - No hay `pip install` de verdad ni terminal; sí la biblioteca estándar.
 *   - `input()` se pide con un diálogo del navegador, no con una consola.
 *   - Es más lento que el Python de escritorio.
 */

const CDN = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';

let cargando = null;
let pyodide = null;

export function estaListo() { return !!pyodide; }

/** Carga Pyodide una sola vez. `onProgreso` recibe textos para la interfaz. */
export function cargar(onProgreso) {
  if (pyodide) return Promise.resolve(pyodide);
  if (cargando) return cargando;

  const avisar = (t) => { if (onProgreso) onProgreso(t); };

  cargando = (async () => {
    avisar('Descargando Python (solo la primera vez)…');
    if (!window.loadPyodide) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = CDN + 'pyodide.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('No se pudo descargar Python. Conéctate a internet e inténtalo otra vez.'));
        document.head.append(s);
      });
    }
    avisar('Preparando el intérprete…');
    pyodide = await window.loadPyodide({ indexURL: CDN });
    avisar('Listo');
    return pyodide;
  })().catch((err) => {
    cargando = null;
    throw err;
  });

  return cargando;
}

/**
 * Ejecuta el código y devuelve { ok, salida, error, ms }.
 *
 * La salida se captura redirigiendo stdout y stderr, e `input()` se sustituye
 * por un prompt del navegador para que los ejercicios que piden datos
 * funcionen igual.
 */
export async function ejecutar(codigo, opciones) {
  const o = opciones || {};
  const py = await cargar(o.onProgreso);
  const t0 = performance.now();

  let salida = '';
  const escribir = (texto) => { salida += texto; if (o.onSalida) o.onSalida(salida); };

  py.setStdout({ batched: (t) => escribir(t + '\n') });
  py.setStderr({ batched: (t) => escribir(t + '\n') });

  // input() del navegador: sin consola interactiva, pero funcional.
  py.globals.set('__pc_input', (mensaje) => {
    const texto = window.prompt(String(mensaje || 'Escribe un valor:'));
    return texto == null ? '' : texto;
  });

  const preparado =
    'import builtins as __b\n' +
    'def __pc_input_wrapper(prompt=""):\n' +
    '    print(prompt, end="")\n' +
    '    valor = __pc_input(prompt)\n' +
    '    print(valor)\n' +
    '    return valor\n' +
    '__b.input = __pc_input_wrapper\n';

  try {
    await py.runPythonAsync(preparado);
    await py.runPythonAsync(String(codigo || ''));
    return { ok: true, salida: salida, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    // El mensaje de Pyodide trae saltos de linea al final: sin recortar, la caja
    // de error se veria vacia.
    const mensaje = String((err && err.message) || err).trim() || 'Error al ejecutar.';
    return { ok: false, salida: salida, error: mensaje, ms: Math.round(performance.now() - t0) };
  }
}

/** Comprobación de sintaxis sin ejecutar nada (para marcar errores antes). */
export async function comprobar(codigo) {
  const py = await cargar();
  py.globals.set('__pc_codigo', String(codigo || ''));
  const salida = await py.runPythonAsync(
    'import json\n' +
    'try:\n' +
    '    compile(__pc_codigo, "<movil>", "exec")\n' +
    '    __pc_res = json.dumps({"ok": True})\n' +
    'except SyntaxError as e:\n' +
    '    __pc_res = json.dumps({"ok": False, "linea": e.lineno or 1, "mensaje": e.msg or "error de sintaxis"})\n' +
    '__pc_res\n');
  try {
    return JSON.parse(salida);
  } catch (err) {
    return { ok: true };
  }
}
