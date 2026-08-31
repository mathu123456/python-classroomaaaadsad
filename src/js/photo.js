/*
 * Diálogo de «Cambiar foto».
 *
 * El recorrido completo, sin que el estudiante tenga que entender nada:
 *
 *   elegir imagen → recorte cuadrado y compresión aquí mismo → subida →
 *   se guarda la dirección → todas las pantallas la muestran.
 *
 * La imagen se reduce a 256x256 antes de salir del equipo, así que lo que viaja
 * son unas decenas de kilobytes.
 */

import { el, clear, toast, modal, confirmDialog } from './ui.js';
import { avatar, prepararFoto, elegirImagen } from './avatar.js';

/** Muestra el diálogo. Devuelve true si la foto cambió. */
export async function cambiarFoto(usuario, onCambio) {
  const cfg = await window.pc.photo.config();

  const previsualizacion = el('div', { class: 'foto-previa' }, avatar(usuario, 96));
  const detalle = el('div', { class: 'form-note' }, usuario.foto
    ? 'Tienes una foto puesta. Puedes cambiarla o quitarla.'
    : 'Ahora se muestran tus iniciales. Puedes poner una foto.');

  let elegida = null;      // { dataUrl, kb, formato }

  const btnElegir = el('button', { class: 'btn primary block', type: 'button' }, 'Elegir una imagen');
  const btnQuitar = el('button', { class: 'btn outline block', type: 'button' }, 'Quitar la foto');

  const cuerpo = el('div', { class: 'foto-dialogo' },
    previsualizacion,
    detalle,
    el('div', { class: 'foto-acciones' }, btnElegir, usuario.foto ? btnQuitar : null),
    cfg.listo
      ? el('div', { style: { fontSize: '10.5px', color: 'var(--text-faint)', marginTop: '8px' } },
        'La imagen se recorta a un cuadrado de 256 píxeles y se comprime antes de enviarse.')
      : el('div', { class: 'form-note warn' },
        'Las fotos de perfil todavía no están configuradas en este equipo. ' +
        'Pídele al profesor que las active en Configuración.'));

  btnElegir.disabled = !cfg.listo;

  btnElegir.addEventListener('click', async () => {
    const archivo = await elegirImagen();
    if (!archivo) return;
    btnElegir.disabled = true;
    btnElegir.textContent = 'Preparando…';
    try {
      elegida = await prepararFoto(archivo);
      clear(previsualizacion).append(
        avatar({ foto: elegida.dataUrl, color: usuario.color, iniciales: usuario.iniciales }, 96));
      detalle.textContent = 'Vista previa · ' + elegida.kb + ' KB en ' + elegida.formato +
        '. Pulsa Guardar para ponerla.';
      detalle.className = 'form-note';
      btnElegir.textContent = 'Elegir otra imagen';
    } catch (err) {
      elegida = null;
      detalle.textContent = err && err.message ? err.message : 'No se pudo preparar la imagen.';
      detalle.className = 'form-note warn';
      btnElegir.textContent = 'Elegir una imagen';
    } finally {
      btnElegir.disabled = false;
    }
  });

  let quitar = false;
  btnQuitar.addEventListener('click', async () => {
    const ok = await confirmDialog('Se quitará tu foto y volverán a verse tus iniciales. ¿Continuar?',
      { title: 'Quitar la foto', okLabel: 'Quitar' });
    if (!ok) return;
    quitar = true;
    elegida = null;
    clear(previsualizacion).append(avatar({ color: usuario.color, iniciales: usuario.iniciales }, 96));
    detalle.textContent = 'Se quitará al guardar.';
    detalle.className = 'form-note';
  });

  const res = await modal({
    title: 'Tu foto de perfil',
    body: cuerpo,
    buttons: [
      { label: 'Cancelar', value: null },
      { label: 'Guardar', value: 'ok', primary: true }
    ]
  });
  if (res !== 'ok') return false;

  if (quitar) {
    const out = await window.pc.photo.remove();
    if (!out.ok) { toast('No se pudo quitar la foto.', { type: 'err' }); return false; }
    toast('Foto quitada', { type: 'ok' });
    if (onCambio) await onCambio(out.usuario);
    return true;
  }

  if (!elegida) return false;

  const aviso = toast('Subiendo tu foto…', { type: 'info', timeout: 0 });
  const out = await window.pc.photo.upload(elegida.dataUrl);
  aviso();
  if (!out.ok) {
    toast(out.error || 'No se pudo subir la foto.', { type: 'err', timeout: 8000 });
    if (out.detalle) console.warn('[foto]', out.detalle);
    // Al profesor se le dice qué revisar; al estudiante, no le sirve de nada.
    if (out.configuracion && usuario.rol === 'profesor') {
      toast(out.detalle, { title: 'Detalle para el profesor', type: 'warn', timeout: 10000 });
    }
    return false;
  }
  toast('Foto actualizada (' + out.kb + ' KB)', { type: 'ok' });
  if (onCambio) await onCambio(out.usuario);
  return true;
}

/**
 * Ajustes de las fotos de perfil (solo profesor): nombre de la cuenta de
 * Cloudinary y preset de subida. No hay ninguna clave secreta que escribir: la
 * aplicación sube con un preset «sin firmar», precisamente para no tener que
 * guardar secretos en el equipo de nadie.
 */
export async function ajustesFotos() {
  const cfg = await window.pc.photo.config();

  const cuenta = el('input', { class: 'input', value: cfg.cloudName || '', spellcheck: 'false' });
  const preset = el('input', { class: 'input', value: cfg.uploadPreset || '', spellcheck: 'false' });
  const carpeta = el('input', { class: 'input', value: cfg.carpeta || '', spellcheck: 'false' });

  const cuerpo = el('div', { class: 'form-grid' },
    el('div', { class: 'form-field' }, el('label', null, 'Cuenta de imágenes'), cuenta),
    el('div', { class: 'form-field' }, el('label', null, 'Preset de subida (sin firmar)'), preset),
    el('div', { class: 'form-field' }, el('label', null, 'Carpeta'), carpeta),
    el('div', { class: 'form-note' },
      'El preset se crea una sola vez en el panel de imágenes y debe quedar como «unsigned». ' +
      'Así la aplicación puede subir fotos sin guardar ninguna clave secreta en los computadores ' +
      'del colegio: si la guardara, cualquiera podría sacarla del programa.'),
    el('div', { class: 'form-note' }, cfg.archivo));

  const res = await modal({
    title: 'Fotos de perfil',
    body: cuerpo,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;

  const out = await window.pc.photo.setConfig({
    cloudName: cuenta.value,
    uploadPreset: preset.value,
    carpeta: carpeta.value
  });
  toast(out.listo ? 'Fotos de perfil configuradas' : 'Falta la cuenta o el preset',
    { type: out.listo ? 'ok' : 'warn' });
}
