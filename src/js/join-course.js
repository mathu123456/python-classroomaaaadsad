/*
 * «Únete a tu curso» — el estudiante escribe el código que le dio su
 * profesor y queda matriculado en ese curso, con su propio ritmo y sus
 * propios ejercicios.
 *
 * Se usa en dos momentos: justo después de crear una cuenta nueva (el alta
 * pide el código, pero si falla no se pierde la cuenta: se vuelve a intentar
 * aquí) y desde el menú de la cuenta para quien todavía no tiene curso.
 */

import { el, toast, modal } from './ui.js';
import * as fb from './firebase.js';

/*
 * Resuelve un código contra Firebase antes de intentar unirse.
 *
 * El curso puede haberse creado en OTRO computador (lo normal: el profesor lo
 * crea en el suyo, el estudiante entra en el del salón o en el propio) — este
 * equipo puede no conocerlo todavía. Si el código resuelve, se trae el curso a
 * la base local antes de intentar la unión; si no hay conexión o el código no
 * existe en Firebase, se sigue con lo que ya hubiera en este equipo (puede que
 * ya se conociera de una sincronización anterior).
 */
export async function traerCursoSiHaceFalta(codigo) {
  try {
    const cursoId = await fb.leer('courseCodes/' + codigo);
    if (!cursoId) return;
    const curso = await fb.leer('courses/' + cursoId);
    if (!curso) return;
    await window.pc.sync.applyRemote('courses', [Object.assign({ id: cursoId }, curso)]);
  } catch (err) { /* sin conexión: se sigue con lo que haya en este equipo */ }
}

/**
 * Muestra el diálogo. Devuelve el curso al que se unió, o null si se
 * canceló o falló (el error ya se avisó con un toast).
 */
export async function unirseACurso(opciones) {
  const o = opciones || {};
  const input = el('input', {
    class: 'input', spellcheck: 'false', autocomplete: 'off', maxlength: '10',
    placeholder: 'Por ejemplo 7ZAX7D', style: { textTransform: 'uppercase', letterSpacing: '1px' }
  });

  const body = el('div', { class: 'form-grid' },
    el('p', null, o.motivo || 'Pídele a tu profesor el código de tu clase y escríbelo aquí.'),
    el('div', { class: 'form-field' }, el('label', null, 'Código de tu clase'), input));

  const res = await modal({
    title: 'Únete a tu curso',
    body,
    buttons: [
      o.puedeCancelar === false ? null : { label: 'Ahora no', value: null },
      { label: 'Unirme', value: 'ok', primary: true }
    ].filter(Boolean)
  });
  if (res !== 'ok') return null;

  const codigo = input.value.trim().toUpperCase();
  if (!codigo) { toast('Escribe el código de tu clase.', { type: 'warn' }); return null; }

  await traerCursoSiHaceFalta(codigo);
  const salida = await window.pc.courses.joinByCode(codigo);
  if (!salida.ok) {
    toast(salida.error || 'No se pudo unir al curso.', { type: 'err', timeout: 7000 });
    return null;
  }
  toast('Te uniste a «' + salida.curso.nombre + '»', { type: 'ok' });
  return salida.curso;
}

/**
 * Un profesor se une como COPROFESOR a otro curso: ve todo su contenido
 * (estudiantes, ejercicios, entregas) sin ser su dueño, y sin dejar de tener
 * los suyos propios. Usa el mismo código de acceso que un estudiante -no hay
 * un código aparte para profesores-, así que también hay que traerlo de
 * Firebase primero si este equipo todavía no lo conoce.
 *
 * Devuelve el curso al que se unió, o null si se canceló o falló (el error
 * ya se avisó con un toast).
 */
export async function unirseComoCoprofesor() {
  const input = el('input', {
    class: 'input', spellcheck: 'false', autocomplete: 'off', maxlength: '10',
    placeholder: 'Por ejemplo 7ZAX7D', style: { textTransform: 'uppercase', letterSpacing: '1px' }
  });

  const body = el('div', { class: 'form-grid' },
    el('p', null, 'Escribe el código de acceso del curso de tu compañero para ver su contenido como coprofesor.'),
    el('div', { class: 'form-field' }, el('label', null, 'Código del curso'), input));

  const res = await modal({
    title: 'Ser coprofesor de otro curso',
    body,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Unirme', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return null;

  const codigo = input.value.trim().toUpperCase();
  if (!codigo) { toast('Escribe el código del curso.', { type: 'warn' }); return null; }

  await traerCursoSiHaceFalta(codigo);
  const salida = await window.pc.courses.joinCoTeacher(codigo);
  if (!salida.ok) {
    toast(salida.error || 'No se pudo unir.', { type: 'err', timeout: 7000 });
    return null;
  }
  toast('Ahora eres coprofesor de «' + salida.curso.nombre + '»', { type: 'ok' });
  return salida.curso;
}
