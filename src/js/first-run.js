/*
 * Pantalla de primer arranque (fase 6).
 *
 * Comprueba, una a una y de verdad, las piezas que la aplicacion necesita, y
 * copia el runtime de Python a la carpeta del usuario cuando la carpeta de
 * instalacion es de solo lectura (el caso de "C:\\Program Files").
 *
 * Cada linea se marca con lo que realmente ocurrio: si algo falla se dice, no
 * se pinta un tick de adorno.
 */

import { el } from './ui.js';

const PASOS = [
  { id: 'app', texto: 'Aplicación' },
  { id: 'runtime', texto: 'Python Runtime' },
  { id: 'pip', texto: 'pip' },
  { id: 'entorno', texto: 'Entorno de Python' },
  { id: 'editor', texto: 'Editor' },
  { id: 'paquetes', texto: 'Paquetes educativos' },
  { id: 'config', texto: 'Configuración' }
];

function fila(paso) {
  return el('div', { class: 'prep-row', dataset: { paso: paso.id } },
    el('span', { class: 'prep-mark' }, '·'),
    el('span', { class: 'prep-text' }, paso.texto),
    el('span', { class: 'prep-note' }, ''));
}

function marcar(raiz, id, estado, nota) {
  const row = raiz.querySelector('.prep-row[data-paso="' + id + '"]');
  if (!row) return;
  row.classList.remove('ok', 'err', 'curso');
  row.classList.add(estado);
  row.querySelector('.prep-mark').textContent =
    estado === 'ok' ? '✓' : estado === 'err' ? '✕' : '…';
  row.querySelector('.prep-note').textContent = nota || '';
}

/**
 * Ejecuta la preparacion. Devuelve un resumen con lo que paso en cada paso.
 * `opciones.forzar` la muestra aunque ya se hubiera hecho antes.
 */
export async function ejecutar(opciones) {
  const o = opciones || {};
  const estado = await window.pc.runtime.prepareState();
  const settings = await window.pc.config.get();
  const yaPreparado = !!settings.preparadoEn;

  if (!o.forzar && yaPreparado && !estado.necesitaCopia) {
    return { mostrada: false, estado: estado };
  }

  const lista = el('div', { class: 'prep-list' }, PASOS.map(fila));
  const barra = el('div', { class: 'bar', style: { display: 'none' } }, el('i', { style: { width: '0%' } }));
  const detalle = el('div', { class: 'prep-detalle' }, estado.necesitaCopia
    ? 'La carpeta de instalación es de solo lectura, así que el runtime de Python se copia a tu carpeta ' +
      'personal. Solo pasa la primera vez.'
    : 'Comprobando que todo esté en su sitio…');

  const boton = el('button', { class: 'btn primary', disabled: true }, 'ABRIR');
  const caja = el('div', { class: 'prep-card' },
    el('h2', null, 'Preparando Python Classroom'),
    detalle, lista, barra,
    el('div', { class: 'prep-foot' }, boton));
  const pantalla = el('div', { class: 'prep-screen' }, caja);
  document.body.append(pantalla);

  const quitarOyente = window.pc.runtime.onEvent((ev) => {
    if (ev.type === 'prepare-progress') {
      barra.style.display = '';
      barra.firstChild.style.width = (ev.porcentaje || 0) + '%';
      marcar(lista, 'runtime', 'curso', 'copiando ' + ev.hechos + ' / ' + ev.total + ' archivos');
    }
  });

  const resumen = {};
  const paso = async (id, fn) => {
    marcar(lista, id, 'curso', '');
    try {
      const nota = await fn();
      marcar(lista, id, 'ok', nota || '');
      resumen[id] = { ok: true, nota: nota || '' };
    } catch (err) {
      const mensaje = err && err.message ? err.message : String(err);
      marcar(lista, id, 'err', mensaje);
      resumen[id] = { ok: false, error: mensaje };
    }
  };

  await paso('app', async () => {
    const info = await window.pc.app.info();
    return 'versión ' + info.version + (info.packaged ? '' : ' (desarrollo)');
  });

  await paso('runtime', async () => {
    const res = await window.pc.runtime.prepare();
    barra.style.display = 'none';
    if (!res.ok) throw new Error(res.error || 'No se encontró ningún intérprete de Python.');
    const rt = await window.pc.python.runtime(true);
    return (res.copiado ? 'copiado a tu carpeta · ' : '') + 'Python ' + (rt.version || '?');
  });

  // pip se consulta una sola vez: la respuesta sirve para este paso y para el
  // de los paquetes educativos (cada llamada lanza un proceso de verdad).
  let librerias = null;
  await paso('pip', async () => {
    librerias = await window.pc.packages.list();
    if (librerias && librerias.error) throw new Error(librerias.error);
    return 'disponible';
  });

  await paso('entorno', async () => {
    const salida = await window.pc.python.check('print("ok")', 'preparacion');
    if (salida && salida.error) throw new Error(salida.error);
    if (salida && salida.diagnostics && salida.diagnostics.length) {
      throw new Error(salida.diagnostics[0].message || 'el intérprete devolvió avisos');
    }
    return 'listo para ejecutar código';
  });

  await paso('editor', async () => {
    const host = document.getElementById('editor-host');
    if (!host || !host.querySelector('.cm-editor')) throw new Error('El editor no se pudo montar.');
    return 'CodeMirror cargado';
  });

  await paso('paquetes', async () => {
    const instalados = librerias || await window.pc.packages.list();
    const n = Array.isArray(instalados) ? instalados.length : (instalados.items || []).length;
    if (!n) throw new Error('pip no devolvió ninguna librería instalada.');
    return n + ' librería(s) instaladas';
  });

  await paso('config', async () => {
    const rutas = await window.pc.config.paths();
    await window.pc.config.set({ preparadoEn: new Date().toISOString() });
    return rutas.userData;
  });

  quitarOyente();

  const fallos = Object.entries(resumen).filter(([, v]) => !v.ok).map(([k]) => k);
  detalle.textContent = fallos.length
    ? 'Terminó con avisos en: ' + fallos.join(', ') + '. Puedes entrar igualmente y arreglarlo desde ' +
      'el panel «Runtime de Python».'
    : 'Todo listo.';

  boton.disabled = false;
  await new Promise((resolve) => { boton.addEventListener('click', resolve, { once: true }); });
  pantalla.remove();

  return { mostrada: true, resumen: resumen, estado: estado };
}

export { PASOS };
