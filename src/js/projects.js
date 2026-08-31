/*
 * Pagina de Proyectos.
 *
 * Cada usuario tiene su propia carpeta de trabajo dentro de los datos de la
 * aplicacion. Esta pagina lee el disco directamente: no necesita base de datos
 * porque los proyectos SON carpetas.
 */

import { el, icon, clear, toast, confirmDialog, promptDialog } from './ui.js';
import { formatoFecha } from './dashboard.js';
import { entregarCarpeta } from './entregar-carpeta.js';

let hooks = {};

export function init(appHooks) { hooks = appHooks || {}; }

function sep(ruta) { return ruta.indexOf('\\') !== -1 ? '\\' : '/'; }

export async function renderProyectos(host) {
  const usuario = await window.pc.session.me();
  if (!usuario) { clear(host); return; }

  const base = await window.pc.files.defaultWorkspacesDir();
  const sesion = await window.pc.config.session();

  let entradas = [];
  try {
    entradas = (await window.pc.files.list(base)).filter((e) => e.type === 'dir');
  } catch (err) {
    entradas = [];
  }

  const esEstudiante = usuario.rol !== 'profesor';

  const page = el('div', { class: 'page' });
  page.append(el('div', { class: 'page-head' },
    el('div', { class: 'ph-text' },
      el('h1', null, 'Mis proyectos'),
      el('p', null, 'Cada proyecto es una carpeta con todos los archivos que quieras. ' +
        'Se guardan en ' + base)),
    el('div', { class: 'ph-actions' },
      el('button', { class: 'btn outline', onclick: abrirCarpeta }, icon('folder-open', 14), 'Abrir carpeta…'),
      el('button', { class: 'btn primary', onclick: nuevoProyecto }, icon('plus', 14), 'Nuevo proyecto'))));

  if (!entradas.length) {
    page.append(el('div', { class: 'empty-page' },
      icon('graduation', 34),
      el('b', null, 'Todavía no tienes proyectos'),
      el('p', null, 'Un proyecto es una carpeta con tus archivos .py. Los ejercicios que empieces ' +
        'también crean su carpeta aquí.'),
      el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center' } },
        el('button', { class: 'btn primary', onclick: nuevoProyecto }, 'Crear mi primer proyecto'),
        el('button', { class: 'btn outline', onclick: abrirCarpeta }, 'Abrir una carpeta existente'))));
  } else {
    page.append(el('div', { class: 'section-head' },
      el('h2', null, 'En tu carpeta de trabajo'), el('span', { class: 'count' }, entradas.length)));
    /*
     * Un proyecto es una carpeta con varios archivos, no un archivo suelto: se
     * dice cuantos tiene para que se entienda a la primera. Solo se cuentan los
     * de las carpetas que se van a mostrar.
     */
    const cuantosArchivos = async (ruta) => {
      try {
        const dentro = await window.pc.files.list(ruta);
        const py = dentro.filter((f) => f.type === 'file' && /\.py$/i.test(f.name)).length;
        const otros = dentro.filter((f) => f.type === 'file' && !/\.py$/i.test(f.name)).length;
        if (!py && !otros) return 'carpeta vacía';
        return (py ? py + (py === 1 ? ' archivo de Python' : ' archivos de Python') : '') +
          (py && otros ? ' y ' : '') +
          (otros ? otros + (otros === 1 ? ' archivo más' : ' archivos más') : '');
      } catch (err) {
        return 'no se pudo leer la carpeta';
      }
    };

    const card = el('div', { class: 'card' });
    for (const e of entradas.sort((a, b) => b.mtime - a.mtime)) {
      const detalle = await cuantosArchivos(e.path);
      card.append(el('div', { class: 'list-row' },
        icon('folder', 17),
        el('div', { class: 'lr-main' },
          el('b', null, e.name),
          el('span', null, detalle + '  ·  modificado ' +
            formatoFecha(new Date(e.mtime).toISOString()))),
        el('div', { class: 'lr-actions' },
          el('button', {
            class: 'icon-btn', title: 'Mostrar en el explorador del sistema',
            onclick: () => window.pc.files.reveal(e.path).catch(() => toast('No se pudo abrir', { type: 'err' }))
          }, icon('external', 15)),
          /*
           * Entregar lo que ya esta hecho: el trabajo no siempre empieza en la
           * lista de ejercicios, y esta carpeta con sus modulos puede ser la
           * entrega de un ejercicio o de un reto.
           */
          esEstudiante
            ? el('button', {
              class: 'btn sm outline',
              title: 'Enviar esta carpeta completa como entrega de un ejercicio.',
              onclick: () => entregarCarpeta(e.path, null, () => hooks.refrescar && hooks.refrescar())
            }, 'Entregar…')
            : null,
          el('button', { class: 'btn sm primary', onclick: () => abrir(e.path, e.name) }, 'Abrir'))));
    }
    page.append(card);
  }

  const recientes = (sesion.recent || []).filter((r) => r.indexOf(base) !== 0);
  if (recientes.length) {
    page.append(el('div', { class: 'section-head' },
      el('h2', null, 'Otras carpetas recientes'), el('span', { class: 'count' }, recientes.length)));
    const card = el('div', { class: 'card' });
    for (const r of recientes.slice(0, 8)) {
      card.append(el('div', { class: 'list-row' },
        icon('folder', 17),
        el('div', { class: 'lr-main' }, el('b', null, r.split(/[\\/]/).pop()), el('span', null, r)),
        el('button', { class: 'btn sm outline', onclick: () => abrir(r, null) }, 'Abrir')));
    }
    page.append(card);
  }

  clear(host).append(page);
}

async function nuevoProyecto() {
  const nombre = await promptDialog({
    title: 'Nuevo proyecto',
    label: 'Se creará una carpeta con main.py, funciones.py, datos.json y README.txt.',
    value: 'MiProyecto',
    okLabel: 'Crear'
  });
  if (!nombre) return;
  try {
    const proyecto = await window.pc.files.createProject(null, nombre);
    toast('Proyecto "' + proyecto.name + '" creado', { type: 'ok' });
    await abrir(proyecto.path, proyecto.name);
  } catch (err) {
    toast(err.message, { title: 'No se pudo crear', type: 'err' });
  }
}

async function abrirCarpeta() {
  const carpeta = await window.pc.files.openFolderDialog();
  if (!carpeta) return;
  await abrir(carpeta.path, carpeta.name);
}

async function abrir(ruta, nombre) {
  if (hooks.abrirProyecto) await hooks.abrirProyecto(ruta, nombre);
}

export { nuevoProyecto, abrirCarpeta };
