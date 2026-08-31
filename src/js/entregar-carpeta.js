/*
 * «Entregar esta carpeta».
 *
 * El otro camino para entregar. El de siempre es abrir el ejercicio desde la
 * lista: la aplicación crea la carpeta, pone el enunciado y el estudiante
 * escribe ahí. Pero muchas veces el trabajo ya existe —lo empezó en su proyecto,
 * lo trae de casa, lo tiene repartido en varios módulos— y lo que necesita es
 * decir «esto que tengo aquí es mi entrega del ejercicio tal».
 *
 * Eso es lo que hace este diálogo: elegir a qué ejercicio va, elegir cuál es el
 * archivo que se ejecuta y enviar la carpeta entera.
 */

import { el, icon, toast, modal } from './ui.js';
import { recoger, describir, avisoOmitidos, ordenarArchivos } from './entrega-archivos.js';
import { textoIntentos } from './dashboard.js';

/**
 * Abre el diálogo. `carpeta` es la carpeta de trabajo abierta y `archivoActivo`
 * (opcional) el que está abierto en el editor, que es el candidato natural a ser
 * el principal.
 */
export async function entregarCarpeta(carpeta, archivoActivo, alEntregar) {
  if (!carpeta) {
    toast('Abre primero la carpeta de tu proyecto.', { type: 'warn' });
    return false;
  }

  const usuario = await window.pc.session.me();
  if (!usuario || usuario.rol === 'profesor') {
    toast('Solo los estudiantes entregan ejercicios.', { type: 'warn' });
    return false;
  }

  /* ---- qué hay en la carpeta ---- */
  const nombreActivo = archivoActivo ? relativo(carpeta, archivoActivo) : null;
  let recogida;
  try {
    recogida = await recoger(carpeta, { preferido: nombreActivo });
  } catch (err) {
    toast('No se pudo leer la carpeta.', { type: 'err' });
    return false;
  }
  if (!recogida.archivos.length) {
    await modal({
      title: 'No hay nada que entregar',
      body: el('div', null,
        el('p', null, 'Esta carpeta no tiene ningún archivo de texto que se pueda entregar.'),
        el('p', null, 'Guarda tu trabajo en archivos .py dentro de la carpeta y vuelve a intentarlo.')),
      buttons: [{ label: 'Entendido', value: null, primary: true }]
    });
    return false;
  }

  /* ---- a qué ejercicio ---- */
  const ejercicios = (await window.pc.exercises.list())
    .filter((e) => e.disponible !== false);
  if (!ejercicios.length) {
    await modal({
      title: 'No tienes ejercicios abiertos',
      body: el('div', null,
        el('p', null, 'Ahora mismo no hay ningún ejercicio al que puedas entregar.'),
        el('p', null, 'Cuando tu profesor publique uno, aparecerá en la sección Ejercicios.')),
      buttons: [{ label: 'Entendido', value: null, primary: true }]
    });
    return false;
  }

  let elegido = ejercicios[0].id;
  const listaEj = el('div', { class: 'check-lista' });
  for (const e of ejercicios) {
    const fila = el('label', { class: 'check-fila' },
      el('input', {
        type: 'radio', name: 'ej-destino', value: e.id,
        checked: e.id === elegido ? 'checked' : undefined,
        onchange: () => { elegido = e.id; }
      }),
      el('div', { class: 'lr-main' },
        el('b', null, e.title),
        el('span', null, [
          e.tema,
          e.xp + ' XP',
          textoIntentos((e.attempts || 0) + 1, e.maxAttempts || 0)
        ].filter(Boolean).join('  ·  '))));
    listaEj.append(fila);
  }

  /* ---- cuál se ejecuta ---- */
  let entrada = recogida.entrada;
  const selArchivo = el('select', { class: 'input', onchange: (ev) => { entrada = ev.target.value; } });
  for (const f of ordenarArchivos(recogida.archivos)) {
    selArchivo.append(el('option', {
      value: f.name,
      selected: f.name === entrada ? 'selected' : undefined
    }, f.name));
  }

  const aviso = avisoOmitidos(recogida);
  const cuerpo = el('div', { class: 'form-grid' },
    el('div', { class: 'form-field' },
      el('label', null, '¿A qué ejercicio la entregas?'),
      listaEj),
    el('div', { class: 'form-field' },
      el('label', null, '¿Cuál es el archivo que hay que ejecutar?'),
      selArchivo,
      el('div', { class: 'form-note' },
        'Es el archivo por el que empieza tu programa. Los demás se envían igual, ' +
        'y tus import seguirán funcionando.')),
    el('div', { class: 'form-note' },
      icon('folder', 12), ' Se enviará ' + describir(recogida) + ': ' +
      ordenarArchivos(recogida.archivos).map((f) => f.name).slice(0, 8).join(', ') +
      (recogida.archivos.length > 8 ? ' y ' + (recogida.archivos.length - 8) + ' más' : '')),
    aviso ? el('div', { class: 'form-note warn' }, aviso) : null);

  const res = await modal({
    title: 'Entregar esta carpeta',
    body: cuerpo,
    wide: true,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Entregar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return false;

  /* ---- entregar ---- */
  const inicio = await window.pc.submissions.start(elegido);
  if (!inicio.ok) {
    toast(inicio.error || 'No se pudo empezar el ejercicio.', { type: 'err', timeout: 7000 });
    return false;
  }

  /*
   * El archivo principal se envía además como «el código» de la entrega: así las
   * pantallas que enseñan una entrega de un vistazo siguen teniendo qué enseñar.
   */
  const principal = recogida.archivos.find((f) => f.name === entrada);
  const envio = await window.pc.submissions.submit(inicio.submission.id, {
    code: principal ? principal.content : '',
    files: recogida.archivos.map((f) => ({ name: f.name, content: f.content })),
    entrada: entrada
  });
  if (!envio.ok) {
    toast(envio.error || 'No se pudo entregar.', { type: 'err', timeout: 7000 });
    return false;
  }

  const ejercicio = ejercicios.find((e) => e.id === elegido);
  await modal({
    title: 'Entrega realizada',
    body: el('div', { class: 'entrega-ok' },
      el('div', { class: 'eo-icon' }, icon('check-circle', 34)),
      el('h3', null, envio.tarde ? '⏰ Entregado fuera de tiempo' : '✓ Entrega recibida'),
      el('p', null, 'Entregaste ' + describir(recogida) + ' en «' + (ejercicio ? ejercicio.title : 'el ejercicio') + '».'),
      el('p', null, 'Tu profesor podrá ejecutar tu programa tal cual, empezando por ' + entrada + '.')),
    buttons: [{ label: 'Cerrar', value: 'ok', primary: true }]
  });

  if (alEntregar) await alEntregar(envio.submission);
  return true;
}

/** Ruta de un archivo respecto de la carpeta, con barras normales. */
function relativo(carpeta, archivo) {
  const base = String(carpeta).replace(/[\\/]+$/, '');
  const full = String(archivo);
  if (full.toLowerCase().indexOf(base.toLowerCase()) !== 0) return null;
  return full.slice(base.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
}
