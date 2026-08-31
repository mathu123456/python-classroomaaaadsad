/*
 * Entregas de varios archivos.
 *
 * Un ejercicio puede pedir que el trabajo se reparta en módulos (un `main.py`
 * que importa `utils.py`, una carpeta con funciones, datos de ejemplo…). Lo que
 * se entrega, entonces, no es «el código» sino **la carpeta**.
 *
 * Aquí vive lo común a los dos caminos por los que se entrega una carpeta:
 *
 *   - el ejercicio abierto en la sesión (su carpeta de trabajo)
 *   - un proyecto que el estudiante ya venía haciendo por su cuenta
 *
 * Reglas de lo que se recoge (las aplica el proceso principal, aquí solo se
 * cuentan y se explican): archivos de texto, hasta 200 KB cada uno, hasta 60
 * archivos y 1,5 MB en total. Lo que queda fuera se le dice al estudiante con su
 * motivo; nunca se descarta nada en silencio.
 */

/** Nombres que nunca se entregan: son de la aplicación, no del trabajo. */
export const NO_SE_ENTREGAN = ['enunciado.txt'];

/**
 * Recoge una carpeta entera para entregarla.
 *
 * Devuelve { archivos, omitidos, bytes, entrada } donde `entrada` es el archivo
 * que se ejecuta (el que manda), y `archivos` es [{name, content}] con las rutas
 * relativas a la carpeta.
 */
export async function recoger(carpeta, opciones) {
  const o = opciones || {};
  const res = await window.pc.files.collect(carpeta, {
    excluir: NO_SE_ENTREGAN.concat(o.excluir || [])
  });
  const archivos = (res.archivos || []).map((f) => ({ name: f.name, content: f.content, bytes: f.bytes }));
  return {
    archivos: archivos,
    omitidos: res.omitidos || [],
    bytes: res.bytes || 0,
    entrada: elegirEntrada(archivos, o.preferido)
  };
}

/**
 * Cuál es el archivo que se ejecuta.
 *
 * Manda el que pida quien llama (el archivo abierto en el editor, por ejemplo);
 * si no, `main.py`, luego `solucion.py`, y si no hay ninguno de esos, el primer
 * archivo de Python que esté en la raíz de la carpeta.
 */
export function elegirEntrada(archivos, preferido) {
  const nombres = (archivos || []).map((f) => f.name);
  const buscar = (n) => nombres.find((x) => x === n);

  if (preferido && buscar(preferido)) return preferido;
  const principal = buscar('main.py') || buscar('solucion.py');
  if (principal) return principal;

  const raiz = nombres.filter((n) => n.indexOf('/') === -1 && /\.py$/i.test(n));
  if (raiz.length) return raiz[0];

  const cualquiera = nombres.find((n) => /\.py$/i.test(n));
  return cualquiera || nombres[0] || null;
}

/** «3 archivos · 12 KB», para decirlo en pantalla sin tecnicismos. */
export function describir(recogida) {
  const n = (recogida.archivos || []).length;
  const kb = Math.max(1, Math.round((recogida.bytes || 0) / 1024));
  if (!n) return 'sin archivos';
  return n + (n === 1 ? ' archivo' : ' archivos') + '  ·  ' + kb + ' KB';
}

/**
 * Lo que se dejó fuera, en una frase. Devuelve null si no se dejó nada, para
 * poder escribir `if (aviso) …` sin más comprobaciones.
 */
export function avisoOmitidos(recogida) {
  const fuera = recogida.omitidos || [];
  if (!fuera.length) return null;
  const ejemplos = fuera.slice(0, 3).map((f) => f.name + ' (' + f.motivo + ')').join(', ');
  return fuera.length === 1
    ? 'No se envía ' + ejemplos + '.'
    : 'No se envían ' + fuera.length + ' archivos: ' + ejemplos +
      (fuera.length > 3 ? ' y ' + (fuera.length - 3) + ' más.' : '.');
}

/** El árbol de una entrega, ordenado para pintarlo: carpetas primero. */
export function ordenarArchivos(archivos) {
  return (archivos || []).slice().sort((a, b) => {
    const ca = (a.name.match(/\//g) || []).length;
    const cb = (b.name.match(/\//g) || []).length;
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name, 'es', { numeric: true });
  });
}

/** Cuenta las líneas de un texto sin hacer un array enorme. */
export function lineas(texto) {
  const t = String(texto || '');
  if (!t) return 0;
  let n = 1;
  for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) n++;
  return n;
}
