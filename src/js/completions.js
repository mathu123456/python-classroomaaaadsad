/*
 * Autocompletado de Python.
 *
 * Capas (de mas generica a mas contextual):
 *   1. Palabras reservadas y plantillas (snippets) del lenguaje.
 *   2. Funciones integradas con su firma.
 *   3. Simbolos del propio documento: variables, funciones, clases, parametros,
 *      importaciones y alias, detectados al vuelo.
 *   4. Miembros tras un punto: modulos importados (consultando al interprete
 *      real) y metodos de str/list/dict/set/int cuando se puede inferir el tipo.
 *   5. Contexto de "import ..." y "from x import ...".
 */

import { syntaxTree } from './vendor/cm6.js';
import { snippetCompletion } from './vendor/cm6.js';

/* ------------------------------------------------------ datos estaticos */

const KEYWORDS = [
  ['def', 'define una función'], ['class', 'define una clase'], ['return', 'devuelve un valor'],
  ['if', 'condicional'], ['elif', 'condición alternativa'], ['else', 'caso contrario'],
  ['for', 'bucle sobre una secuencia'], ['while', 'bucle mientras'], ['break', 'sale del bucle'],
  ['continue', 'salta a la siguiente vuelta'], ['pass', 'no hace nada'],
  ['import', 'importa un módulo'], ['from', 'importa desde un módulo'], ['as', 'asigna un alias'],
  ['try', 'bloque protegido'], ['except', 'captura excepciones'], ['finally', 'siempre se ejecuta'],
  ['raise', 'lanza una excepción'], ['with', 'gestor de contexto'], ['in', 'pertenencia'],
  ['is', 'identidad'], ['not', 'negación'], ['and', 'y lógico'], ['or', 'o lógico'],
  ['True', 'verdadero'], ['False', 'falso'], ['None', 'valor nulo'],
  ['lambda', 'función anónima'], ['global', 'variable global'], ['nonlocal', 'variable del ámbito externo'],
  ['assert', 'comprueba una condición'], ['del', 'elimina una referencia'], ['yield', 'genera un valor'],
  ['async', 'define código asíncrono'], ['await', 'espera una corrutina'], ['match', 'coincidencia estructural'],
  ['case', 'caso de match']
];

const BUILTINS = [
  ['print', 'print(*valores, sep=" ", end="\\n")', 'Muestra texto en la consola.'],
  ['input', 'input(mensaje="")', 'Lee una línea escrita por el usuario. Devuelve str.'],
  ['len', 'len(objeto)', 'Cantidad de elementos.'],
  ['range', 'range(inicio, fin, paso)', 'Secuencia de números enteros.'],
  ['int', 'int(x)', 'Convierte a número entero.'],
  ['float', 'float(x)', 'Convierte a número decimal.'],
  ['str', 'str(x)', 'Convierte a cadena de texto.'],
  ['bool', 'bool(x)', 'Convierte a booleano.'],
  ['list', 'list(iterable)', 'Crea una lista.'],
  ['dict', 'dict(**pares)', 'Crea un diccionario.'],
  ['tuple', 'tuple(iterable)', 'Crea una tupla.'],
  ['set', 'set(iterable)', 'Crea un conjunto sin repetidos.'],
  ['frozenset', 'frozenset(iterable)', 'Conjunto inmutable.'],
  ['sum', 'sum(iterable, inicio=0)', 'Suma los elementos.'],
  ['min', 'min(iterable)', 'Valor mínimo.'],
  ['max', 'max(iterable)', 'Valor máximo.'],
  ['abs', 'abs(x)', 'Valor absoluto.'],
  ['round', 'round(x, decimales=0)', 'Redondea un número.'],
  ['pow', 'pow(base, exponente)', 'Potencia.'],
  ['divmod', 'divmod(a, b)', 'Cociente y resto.'],
  ['enumerate', 'enumerate(iterable, start=0)', 'Pares (índice, valor).'],
  ['zip', 'zip(*iterables)', 'Combina varias secuencias.'],
  ['sorted', 'sorted(iterable, key=None, reverse=False)', 'Devuelve una lista ordenada.'],
  ['reversed', 'reversed(secuencia)', 'Recorre al revés.'],
  ['map', 'map(función, iterable)', 'Aplica una función a cada elemento.'],
  ['filter', 'filter(función, iterable)', 'Filtra elementos.'],
  ['any', 'any(iterable)', 'True si algún elemento es verdadero.'],
  ['all', 'all(iterable)', 'True si todos son verdaderos.'],
  ['type', 'type(objeto)', 'Tipo del objeto.'],
  ['isinstance', 'isinstance(objeto, tipo)', 'Comprueba el tipo.'],
  ['open', 'open(ruta, modo="r", encoding="utf-8")', 'Abre un archivo.'],
  ['format', 'format(valor, formato)', 'Formatea un valor.'],
  ['id', 'id(objeto)', 'Identificador interno.'],
  ['hash', 'hash(objeto)', 'Valor hash.'],
  ['repr', 'repr(objeto)', 'Representación para depurar.'],
  ['ord', 'ord(caracter)', 'Código Unicode de un carácter.'],
  ['chr', 'chr(numero)', 'Carácter de un código Unicode.'],
  ['bin', 'bin(n)', 'Representación binaria.'],
  ['hex', 'hex(n)', 'Representación hexadecimal.'],
  ['oct', 'oct(n)', 'Representación octal.'],
  ['help', 'help(objeto)', 'Ayuda interactiva.'],
  ['dir', 'dir(objeto)', 'Atributos disponibles.'],
  ['getattr', 'getattr(objeto, nombre, defecto)', 'Obtiene un atributo.'],
  ['setattr', 'setattr(objeto, nombre, valor)', 'Asigna un atributo.'],
  ['hasattr', 'hasattr(objeto, nombre)', 'Comprueba si existe un atributo.'],
  ['super', 'super()', 'Acceso a la clase base.'],
  ['iter', 'iter(objeto)', 'Obtiene un iterador.'],
  ['next', 'next(iterador, defecto)', 'Siguiente elemento.'],
  ['exit', 'exit()', 'Termina el programa.']
];

const EXCEPTIONS = [
  'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError', 'NameError',
  'ZeroDivisionError', 'AttributeError', 'FileNotFoundError', 'IOError', 'OSError',
  'ImportError', 'ModuleNotFoundError', 'StopIteration', 'RuntimeError',
  'NotImplementedError', 'KeyboardInterrupt', 'ArithmeticError', 'OverflowError',
  'RecursionError', 'AssertionError', 'PermissionError'
];

const STDLIB = [
  'math', 'random', 'os', 'sys', 'time', 'datetime', 'json', 'csv', 're', 'string',
  'collections', 'itertools', 'functools', 'statistics', 'pathlib', 'shutil',
  'sqlite3', 'urllib', 'http', 'socket', 'threading', 'subprocess', 'argparse',
  'unittest', 'typing', 'dataclasses', 'enum', 'decimal', 'fractions', 'copy',
  'pickle', 'hashlib', 'base64', 'uuid', 'textwrap', 'pprint', 'turtle', 'tkinter',
  'calendar', 'zoneinfo', 'secrets', 'glob', 'io', 'abc', 'traceback', 'logging'
];

const METHODS = {
  str: [
    ['upper', 'upper()', 'Todo en mayúsculas.'], ['lower', 'lower()', 'Todo en minúsculas.'],
    ['title', 'title()', 'Primera letra de cada palabra en mayúscula.'],
    ['capitalize', 'capitalize()', 'Primera letra en mayúscula.'],
    ['strip', 'strip(chars=None)', 'Quita espacios al inicio y al final.'],
    ['lstrip', 'lstrip()', 'Quita espacios a la izquierda.'], ['rstrip', 'rstrip()', 'Quita espacios a la derecha.'],
    ['split', 'split(sep=None)', 'Divide en una lista.'], ['rsplit', 'rsplit(sep=None)', 'Divide desde la derecha.'],
    ['join', 'join(iterable)', 'Une una lista de textos.'],
    ['replace', 'replace(viejo, nuevo)', 'Sustituye texto.'],
    ['find', 'find(sub)', 'Posición o -1.'], ['index', 'index(sub)', 'Posición o error.'],
    ['count', 'count(sub)', 'Cuántas veces aparece.'],
    ['startswith', 'startswith(prefijo)', '¿Empieza por…?'], ['endswith', 'endswith(sufijo)', '¿Termina en…?'],
    ['isdigit', 'isdigit()', '¿Solo dígitos?'], ['isalpha', 'isalpha()', '¿Solo letras?'],
    ['isalnum', 'isalnum()', '¿Letras o números?'], ['isspace', 'isspace()', '¿Solo espacios?'],
    ['format', 'format(*args, **kwargs)', 'Formatea la cadena.'],
    ['zfill', 'zfill(ancho)', 'Rellena con ceros.'], ['center', 'center(ancho)', 'Centra el texto.'],
    ['encode', 'encode("utf-8")', 'Convierte a bytes.']
  ],
  list: [
    ['append', 'append(elemento)', 'Añade al final.'], ['extend', 'extend(iterable)', 'Añade varios.'],
    ['insert', 'insert(indice, elemento)', 'Inserta en una posición.'],
    ['remove', 'remove(valor)', 'Elimina la primera aparición.'],
    ['pop', 'pop(indice=-1)', 'Saca y devuelve un elemento.'],
    ['clear', 'clear()', 'Vacía la lista.'], ['index', 'index(valor)', 'Posición del valor.'],
    ['count', 'count(valor)', 'Cuántas veces aparece.'],
    ['sort', 'sort(key=None, reverse=False)', 'Ordena en el sitio.'],
    ['reverse', 'reverse()', 'Invierte el orden.'], ['copy', 'copy()', 'Copia superficial.']
  ],
  dict: [
    ['keys', 'keys()', 'Las claves.'], ['values', 'values()', 'Los valores.'],
    ['items', 'items()', 'Pares (clave, valor).'],
    ['get', 'get(clave, defecto=None)', 'Valor o defecto si no existe.'],
    ['pop', 'pop(clave, defecto)', 'Saca una clave.'],
    ['update', 'update(otro)', 'Mezcla otro diccionario.'],
    ['setdefault', 'setdefault(clave, valor)', 'Devuelve o crea.'],
    ['clear', 'clear()', 'Vacía el diccionario.'], ['copy', 'copy()', 'Copia superficial.']
  ],
  set: [
    ['add', 'add(elemento)', 'Añade un elemento.'], ['discard', 'discard(elemento)', 'Quita si existe.'],
    ['remove', 'remove(elemento)', 'Quita o error.'], ['pop', 'pop()', 'Saca un elemento cualquiera.'],
    ['union', 'union(otro)', 'Unión.'], ['intersection', 'intersection(otro)', 'Intersección.'],
    ['difference', 'difference(otro)', 'Diferencia.'], ['clear', 'clear()', 'Vacía el conjunto.']
  ],
  int: [['bit_length', 'bit_length()', 'Bits necesarios.'], ['to_bytes', 'to_bytes(n, "big")', 'Convierte a bytes.']],
  float: [['is_integer', 'is_integer()', '¿Es un entero exacto?'], ['hex', 'hex()', 'Representación hexadecimal.']],
  file: [
    ['read', 'read()', 'Lee todo el contenido.'], ['readline', 'readline()', 'Lee una línea.'],
    ['readlines', 'readlines()', 'Lista de líneas.'], ['write', 'write(texto)', 'Escribe texto.'],
    ['writelines', 'writelines(lineas)', 'Escribe varias líneas.'], ['close', 'close()', 'Cierra el archivo.']
  ]
};

const SNIPPETS = [
  ['def', 'def ${nombre}(${parametros}):\n\t${pass}', 'Definir una función'],
  ['defmain', 'def main():\n\t${}\n\n\nif __name__ == "__main__":\n\tmain()', 'Función main + arranque'],
  ['class', 'class ${Nombre}:\n\tdef __init__(self, ${parametros}):\n\t\t${pass}', 'Definir una clase'],
  ['if', 'if ${condicion}:\n\t${pass}', 'Condicional'],
  ['ifelse', 'if ${condicion}:\n\t${}\nelse:\n\t${pass}', 'Condicional con else'],
  ['for', 'for ${elemento} in ${secuencia}:\n\t${pass}', 'Bucle for'],
  ['forrange', 'for i in range(${10}):\n\t${pass}', 'Bucle for con range'],
  ['while', 'while ${condicion}:\n\t${pass}', 'Bucle while'],
  ['try', 'try:\n\t${}\nexcept ${Exception} as e:\n\tprint(e)', 'Bloque try/except'],
  ['with', 'with open(${"archivo.txt"}, ${"r"}, encoding="utf-8") as f:\n\t${pass}', 'Abrir archivo con with'],
  ['main', 'if __name__ == "__main__":\n\t${main()}', 'Punto de entrada'],
  ['lambda', 'lambda ${x}: ${x}', 'Función anónima'],
  ['listcomp', '[${x} for ${x} in ${secuencia}]', 'Comprensión de lista'],
  ['dictcomp', '{${clave}: ${valor} for ${clave}, ${valor} in ${items}}', 'Comprensión de diccionario'],
  ['input_int', '${numero} = int(input("${Escribe un número: }"))', 'Leer un entero'],
  ['print_f', 'print(f"${texto} {${variable}}")', 'Imprimir con f-string']
];

/* ---------------------------------------------- analisis del documento */

const docCache = new WeakMap();
const moduleCache = new Map();

function scanDocument(doc) {
  const cached = docCache.get(doc);
  if (cached) return cached;

  const text = doc.toString();
  const result = {
    variables: new Map(),   // nombre -> tipo inferido | null
    functions: new Map(),   // nombre -> {params, line}
    classes: new Map(),     // nombre -> {methods:[], attrs:[]}
    modules: new Map(),     // alias -> modulo real
    imported: new Set()     // nombres importados con "from x import y"
  };

  const lines = text.split('\n');

  const inferType = (rhs) => {
    const v = rhs.trim();
    if (/^["'].*/.test(v) || /^f["']/.test(v)) return 'str';
    if (/^\[/.test(v) || /^list\s*\(/.test(v) || /\.split\s*\(/.test(v) || /^sorted\s*\(/.test(v)) return 'list';
    if (/^\{\s*["'\w]+\s*:/.test(v) || /^dict\s*\(/.test(v)) return 'dict';
    if (/^\{/.test(v) || /^set\s*\(/.test(v)) return 'set';
    if (/^-?\d+$/.test(v) || /^int\s*\(/.test(v) || /^len\s*\(/.test(v)) return 'int';
    if (/^-?\d*\.\d+/.test(v) || /^float\s*\(/.test(v) || /^round\s*\(/.test(v)) return 'float';
    if (/^(True|False)$/.test(v) || /^bool\s*\(/.test(v)) return 'bool';
    if (/^input\s*\(/.test(v)) return 'str';
    if (/^open\s*\(/.test(v)) return 'file';
    if (/^tuple\s*\(/.test(v) || /^\(.*,.*\)$/.test(v)) return 'tuple';
    return null;
  };

  let currentClass = null;
  let currentClassIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = line.replace(/#.*$/, '');
    if (!code.trim()) continue;
    const indent = code.length - code.trimStart().length;

    if (currentClass && indent <= currentClassIndent && code.trim()) currentClass = null;

    let m;
    if ((m = /^\s*class\s+([A-Za-z_]\w*)/.exec(code))) {
      currentClass = m[1];
      currentClassIndent = indent;
      result.classes.set(m[1], { methods: [], attrs: [], line: i + 1 });
      continue;
    }

    if ((m = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(code))) {
      const name = m[1];
      const params = m[2].split(',').map((p) => p.split(/[:=]/)[0].trim()).filter((p) => p && p !== 'self' && p !== 'cls');
      if (currentClass && indent > currentClassIndent) {
        result.classes.get(currentClass).methods.push({ name, params });
      } else {
        result.functions.set(name, { params, line: i + 1 });
      }
      for (const p of params) if (!result.variables.has(p)) result.variables.set(p, null);
      continue;
    }

    if ((m = /^\s*self\.([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(code))) {
      if (currentClass) {
        const cls = result.classes.get(currentClass);
        if (cls && !cls.attrs.some((a) => a.name === m[1])) {
          cls.attrs.push({ name: m[1], type: inferType(m[2]) });
        }
      }
      continue;
    }

    if ((m = /^\s*import\s+(.+)$/.exec(code))) {
      for (const part of m[1].split(',')) {
        const bits = part.trim().split(/\s+as\s+/);
        const mod = bits[0].trim();
        const alias = (bits[1] || mod.split('.')[0]).trim();
        if (/^[A-Za-z_][\w.]*$/.test(mod)) result.modules.set(alias, mod);
      }
      continue;
    }

    if ((m = /^\s*from\s+([\w.]+)\s+import\s+(.+)$/.exec(code))) {
      for (const part of m[2].split(',')) {
        const bits = part.trim().replace(/[()]/g, '').split(/\s+as\s+/);
        const name = (bits[1] || bits[0]).trim();
        if (/^[A-Za-z_]\w*$/.test(name)) result.imported.add(name);
      }
      continue;
    }

    if ((m = /^\s*for\s+([A-Za-z_][\w,\s]*)\s+in\s+(.+):/.exec(code))) {
      for (const name of m[1].split(',').map((s) => s.trim())) {
        if (/^[A-Za-z_]\w*$/.test(name)) {
          const src = m[2].trim();
          result.variables.set(name, /\.items\s*\(\)/.test(src) ? null : /^["']/.test(src) ? 'str' : null);
        }
      }
      continue;
    }

    if ((m = /^\s*with\s+.+\s+as\s+([A-Za-z_]\w*)/.exec(code))) {
      result.variables.set(m[1], /open\s*\(/.test(code) ? 'file' : null);
      continue;
    }

    if ((m = /^\s*except\s+.*\s+as\s+([A-Za-z_]\w*)/.exec(code))) {
      result.variables.set(m[1], null);
      continue;
    }

    // asignaciones simples y multiples: a = ...  |  a, b = ...
    if ((m = /^\s*([A-Za-z_][\w\s,]*?)\s*(?::[^=]+)?=\s*([^=].*)$/.exec(code))) {
      const targets = m[1].split(',').map((s) => s.trim());
      const type = targets.length === 1 ? inferType(m[2]) : null;
      for (const t of targets) {
        if (/^[A-Za-z_]\w*$/.test(t)) result.variables.set(t, type);
      }
    }
  }

  docCache.set(doc, result);
  return result;
}

/* ----------------------------------------------------------- opciones */

function kwOptions() {
  return KEYWORDS.map(([label, detail]) => ({ label, type: 'keyword', detail, boost: 1 }));
}

function builtinOptions() {
  return BUILTINS.map(([label, sig, info]) => ({
    label,
    type: 'function',
    detail: sig.slice(label.length),
    info,
    apply: label + '(',
    boost: 2
  })).concat(EXCEPTIONS.map((label) => ({ label, type: 'class', detail: 'excepción', boost: 0 })));
}

function snippetOptions() {
  return SNIPPETS.map(([label, template, detail]) =>
    snippetCompletion(template.replace(/\$\{\}/g, '${}'), {
      label,
      detail,
      type: 'snippet',
      boost: -1
    })
  );
}

function docOptions(scan) {
  const out = [];
  for (const [name, info] of scan.functions) {
    out.push({
      label: name,
      type: 'function',
      detail: '(' + info.params.join(', ') + ')',
      info: 'Definida en este archivo, línea ' + info.line,
      apply: name + '(',
      boost: 4
    });
  }
  for (const [name, info] of scan.classes) {
    out.push({
      label: name,
      type: 'class',
      detail: 'clase',
      info: (info.methods.length ? info.methods.length + ' método(s)' : 'Definida en este archivo'),
      apply: name + '(',
      boost: 4
    });
  }
  for (const [name, type] of scan.variables) {
    out.push({ label: name, type: 'variable', detail: type || 'variable', boost: 3 });
  }
  for (const [alias, mod] of scan.modules) {
    out.push({ label: alias, type: 'module', detail: 'módulo ' + mod, boost: 3 });
  }
  for (const name of scan.imported) {
    out.push({ label: name, type: 'variable', detail: 'importado', boost: 3 });
  }
  return out;
}

function methodOptions(kind) {
  return (METHODS[kind] || []).map(([label, sig, info]) => ({
    label,
    type: 'method',
    detail: sig.slice(label.length),
    info,
    apply: label + '(',
    boost: 5
  }));
}

async function moduleOptions(moduleName) {
  if (moduleCache.has(moduleName)) return moduleCache.get(moduleName);
  let items = [];
  try {
    items = await window.pc.python.moduleSymbols(moduleName);
  } catch (err) {
    items = [];
  }
  const options = (items || []).map((s) => ({
    label: s.label,
    type: s.type === 'function' ? 'function' : 'property',
    detail: moduleName,
    apply: s.type === 'function' ? s.label + '(' : s.label,
    boost: 5
  }));
  moduleCache.set(moduleName, options);
  return options;
}

export function clearModuleCache() { moduleCache.clear(); }

/* --------------------------------------------------- fuente principal */

function inCommentOrString(state, pos) {
  const node = syntaxTree(state).resolveInner(pos, -1);
  for (let n = node; n; n = n.parent) {
    if (n.name === 'Comment') return true;
    if (n.name === 'String' && !/FormatString/.test(node.name)) return true;
  }
  return false;
}

export function pythonCompletionSource(context) {
  const { state, pos, explicit } = context;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);

  if (!explicit && inCommentOrString(state, pos)) return null;

  const scan = scanDocument(state.doc);

  /* --- "import xxx" / "from xxx" --------------------------------------- */
  let m = /(?:^|\s)(?:import|from)\s+([\w.]*)$/.exec(before);
  if (m) {
    const word = context.matchBefore(/[\w.]*/);
    const installed = Array.from(scan.modules.values());
    const names = Array.from(new Set(STDLIB.concat(installed)));
    return {
      from: word ? word.from : pos,
      options: names.map((n) => ({ label: n, type: 'module', detail: 'módulo', boost: 2 })),
      validFor: /^[\w.]*$/
    };
  }

  /* --- "from modulo import xxx" ---------------------------------------- */
  m = /^\s*from\s+([\w.]+)\s+import\s+([\w,\s]*)$/.exec(before);
  if (m) {
    const word = context.matchBefore(/\w*/);
    const modName = m[1];
    return moduleOptions(modName).then((options) => ({
      from: word ? word.from : pos,
      options: options.length ? options : [{ label: '*', type: 'text', detail: 'todo el módulo' }],
      validFor: /^\w*$/
    }));
  }

  /* --- acceso a miembros: algo.xxx ------------------------------------- */
  m = /([A-Za-z_][\w.]*)\.(\w*)$/.exec(before);
  if (m) {
    const target = m[1];
    const word = context.matchBefore(/\w*/);
    const from = word ? word.from : pos;

    // self.<algo> dentro de una clase
    if (target === 'self') {
      const cls = findEnclosingClass(state, pos, scan);
      const options = [];
      if (cls) {
        for (const a of cls.attrs) options.push({ label: a.name, type: 'property', detail: a.type || 'atributo', boost: 5 });
        for (const me of cls.methods) {
          options.push({ label: me.name, type: 'method', detail: '(' + me.params.join(', ') + ')', apply: me.name + '(', boost: 5 });
        }
      }
      return { from, options, validFor: /^\w*$/ };
    }

    // modulo importado -> se pregunta al interprete real
    const modName = scan.modules.get(target.split('.')[0]);
    if (modName) {
      const full = target.split('.').length > 1 ? target.replace(target.split('.')[0], modName) : modName;
      return moduleOptions(full).then((options) => ({ from, options, validFor: /^\w*$/ }));
    }

    // variable con tipo inferido
    const type = scan.variables.get(target);
    if (type && METHODS[type]) {
      return { from, options: methodOptions(type), validFor: /^\w*$/ };
    }

    // ultimo recurso: metodos comunes de todos los tipos conocidos
    const generic = [];
    const seen = new Set();
    for (const kind of ['str', 'list', 'dict']) {
      for (const opt of methodOptions(kind)) {
        if (seen.has(opt.label)) continue;
        seen.add(opt.label);
        generic.push(Object.assign({}, opt, { detail: opt.detail + '  ·  ' + kind, boost: 0 }));
      }
    }
    return { from, options: generic, validFor: /^\w*$/ };
  }

  /* --- palabra normal --------------------------------------------------- */
  const word = context.matchBefore(/\w*/);
  if (!word) return null;
  if (word.from === word.to && !explicit) return null;

  const options = kwOptions()
    .concat(builtinOptions())
    .concat(docOptions(scan))
    .concat(snippetOptions());

  // Deduplicar dejando la opcion con mayor prioridad
  const best = new Map();
  for (const o of options) {
    const prev = best.get(o.label);
    if (!prev || (o.boost || 0) > (prev.boost || 0)) best.set(o.label, o);
  }

  return {
    from: word.from,
    options: Array.from(best.values()),
    validFor: /^\w*$/
  };
}

function findEnclosingClass(state, pos, scan) {
  const lineNo = state.doc.lineAt(pos).number;
  let found = null;
  for (const [, info] of scan.classes) {
    if (info.line <= lineNo && (!found || info.line > found.line)) found = info;
  }
  return found;
}

export { scanDocument };
