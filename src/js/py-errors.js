/*
 * Errores de Python explicados.
 *
 * Un traceback es correcto pero no enseña nada a quien está aprendiendo. Este
 * módulo lee lo que Python imprimió y saca tres cosas: en qué línea pasó, qué
 * tipo de error fue y qué significa en castellano.
 *
 * Importante y deliberado: esto es SOLO presentación. Un error de ejecución no
 * toca los intentos, no marca nada como abandonado y no cambia ninguna nota.
 */

/* Los errores que de verdad se ven en un curso de introducción. */
const EXPLICACIONES = {
  NameError: (detalle) => {
    const m = detalle.match(/name '([^']+)'/);
    return m
      ? 'La variable «' + m[1] + '» no está definida. Comprueba si la escribiste distinto ' +
        'o si le das valor más abajo de donde la usas.'
      : 'Estás usando un nombre que Python no conoce todavía.';
  },
  TypeError: (detalle) => {
    if (/unsupported operand type\(s\) for \+: 'int' and 'str'|can only concatenate str/.test(detalle)) {
      return 'Estás mezclando un número con un texto. Convierte antes con int(), float() o str().';
    }
    if (/argument/.test(detalle)) return 'Una función recibió más o menos datos de los que esperaba.';
    return 'Estás usando un tipo de dato donde hacía falta otro.';
  },
  ValueError: (detalle) => (
    /invalid literal for int/.test(detalle)
      ? 'Intentaste convertir en número algo que no lo es. Revisa lo que escribió el usuario.'
      : 'El valor tiene el tipo correcto pero no sirve para esa operación.'),
  ZeroDivisionError: () => 'Estás dividiendo entre cero. Comprueba el divisor antes de dividir.',
  IndexError: () => 'Pediste una posición que no existe en la lista. Recuerda que empiezan en 0.',
  KeyError: (detalle) => {
    const m = detalle.match(/'([^']+)'/);
    return (m ? 'La clave «' + m[1] + '» no existe en el diccionario. ' : 'Esa clave no existe en el diccionario. ') +
      'Puedes comprobarlo con «in» antes de usarla.';
  },
  AttributeError: (detalle) => {
    const m = detalle.match(/'([^']+)' object has no attribute '([^']+)'/);
    return m
      ? 'Un valor de tipo ' + m[1] + ' no tiene «' + m[2] + '». Revisa si es el dato que crees.'
      : 'Estás pidiéndole a un valor algo que ese tipo de dato no tiene.';
  },
  IndentationError: () => 'La sangría no cuadra. Dentro de un if, un for o una función, ' +
    'todas las líneas llevan la misma cantidad de espacios (cuatro por nivel).',
  TabError: () => 'Estás mezclando tabulaciones y espacios. Usa solo espacios.',
  SyntaxError: () => 'Hay algo mal escrito: suele faltar un paréntesis, una comilla o los dos puntos ' +
    'al final de un if, un for o un def.',
  ModuleNotFoundError: (detalle) => {
    const m = detalle.match(/No module named '([^']+)'/);
    return (m ? 'La librería «' + m[1] + '» no está instalada. ' : 'Esa librería no está instalada. ') +
      'Puedes instalarla desde el panel de librerías.';
  },
  ImportError: () => 'No se pudo importar eso. Comprueba el nombre o instala la librería.',
  FileNotFoundError: (detalle) => {
    const m = detalle.match(/'([^']+)'/);
    return 'No se encontró el archivo' + (m ? ' «' + m[1] + '»' : '') +
      '. Comprueba el nombre y que esté en la misma carpeta.';
  },
  RecursionError: () => 'Una función se llama a sí misma sin parar. Falta el caso en el que debe detenerse.',
  KeyboardInterrupt: () => 'La ejecución se interrumpió.',
  OverflowError: () => 'El número creció demasiado para poder calcularlo.',
  UnboundLocalError: (detalle) => {
    const m = detalle.match(/'([^']+)'/);
    return 'Dentro de la función usas' + (m ? ' «' + m[1] + '»' : ' una variable') +
      ' antes de darle valor.';
  }
};

/**
 * Lee la salida de error de Python.
 *
 * Devuelve null si ahí no hay un error de Python (por ejemplo, un programa que
 * escribe avisos en stderr por su cuenta).
 */
export function interpretar(textoError) {
  const bruto = String(textoError || '');
  if (!bruto.trim()) return null;

  const lineas = bruto.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  if (!lineas.length) return null;

  /*
   * La última línea con forma de "TipoDeError: detalle" es la que importa: si
   * hubo excepciones encadenadas, esta es la que paró el programa.
   */
  let tipo = null;
  let detalle = '';
  for (let i = lineas.length - 1; i >= 0; i--) {
    const m = lineas[i].match(/^([A-Za-z_][A-Za-z0-9_.]*Error|KeyboardInterrupt|SystemExit|StopIteration)\s*:?\s*(.*)$/);
    if (m) { tipo = m[1].split('.').pop(); detalle = m[2] || ''; break; }
  }
  if (!tipo) return null;

  /*
   * Línea del error: se busca la última referencia al archivo del estudiante y,
   * si no la hay (SyntaxError apunta al archivo temporal), la última de todas.
   */
  let linea = null;
  const refs = bruto.match(/line (\d+)/g) || [];
  if (refs.length) {
    const ultima = refs[refs.length - 1].match(/(\d+)/);
    if (ultima) linea = Number(ultima[1]);
  }

  const explicar = EXPLICACIONES[tipo];
  return {
    tipo: tipo,
    detalle: detalle.trim(),
    linea: linea,
    explicacion: explicar ? explicar(detalle) : 'Python no pudo terminar el programa por este error.',
    // El traceback completo sigue disponible: a veces hace falta verlo entero.
    traceback: bruto.trim()
  };
}

/** Resumen corto para la barra de estado o un aviso. */
export function resumen(error) {
  if (!error) return '';
  return (error.linea ? 'Línea ' + error.linea + ' · ' : '') + error.tipo;
}
