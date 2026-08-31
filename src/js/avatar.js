/*
 * Avatares y fotos de perfil.
 *
 * Un solo sitio decide cómo se ve una persona en toda la aplicación: con su
 * fotografía si la tiene, y con sus iniciales sobre su color si no. Nunca se
 * muestra una URL, ni un hueco roto, ni «null».
 *
 * La foto se pide a Cloudinary ya recortada al tamaño que hace falta (la
 * transformación va en la propia dirección), así que el navegador la guarda en
 * su caché y no se vuelve a descargar en cada pantalla.
 */

import { el } from './ui.js';

/** Iniciales a partir de un nombre; si no hay nada, dos puntos discretos. */
export function iniciales(persona) {
  const p = persona || {};
  if (p.iniciales) return String(p.iniciales).slice(0, 2).toUpperCase();
  const texto = String(p.nombreCompleto || p.nombre || p.name || p.correo || p.email || '').trim();
  if (!texto) return '··';
  const partes = texto.split(/[\s.@_-]+/).filter(Boolean);
  return (partes.length > 1
    ? partes[0].charAt(0) + partes[1].charAt(0)
    : texto.slice(0, 2)).toUpperCase();
}

/** La URL de la foto, con el recorte y el tamaño pedidos. */
export function urlFoto(persona, lado) {
  const url = (persona && (persona.foto || persona.photoURL)) || '';
  if (!/^https:\/\/res\.cloudinary\.com\//.test(url)) return url ? url : null;
  if (/\/upload\/(c_|f_|q_|w_|h_)/.test(url)) return url;
  const px = Math.max(32, Math.min(512, Math.round((lado || 40) * 2)));   // x2 para pantallas densas
  return url.replace('/upload/', '/upload/c_fill,g_face,w_' + px + ',h_' + px + ',f_auto,q_auto/');
}

/**
 * Avatar listo para colgar.
 *
 * avatar(persona, 52)                  tamaño en píxeles
 * avatar(persona, 30, { clase: 'av' }) clases extra
 *
 * Si la imagen no carga (sin conexión, foto borrada), se cae a las iniciales
 * sin dejar el hueco roto.
 */
export function avatar(persona, lado, opciones) {
  const o = opciones || {};
  const px = Math.max(18, Math.round(lado || 40));
  const p = persona || {};
  const letras = iniciales(p);
  const fondo = p.color || 'var(--accent)';

  const caja = el('div', {
    class: 'h-avatar' + (o.clase ? ' ' + o.clase : ''),
    style: Object.assign({
      width: px + 'px',
      height: px + 'px',
      fontSize: Math.max(9, Math.round(px / 2.7)) + 'px',
      background: fondo
    }, o.style || {}),
    title: o.title || undefined
  }, letras);

  const url = urlFoto(p, px);
  if (url) {
    const img = el('img', {
      class: 'h-avatar-img',
      src: url,
      alt: '',                       // decorativa: el nombre va al lado
      loading: 'lazy',
      decoding: 'async',
      width: px,
      height: px
    });
    img.addEventListener('load', () => { caja.classList.add('con-foto'); });
    img.addEventListener('error', () => { img.remove(); caja.classList.remove('con-foto'); });
    caja.append(img);
  }

  return caja;
}

/* =============================================== elegir y preparar la foto */

const LADO = 256;                 // suficiente para un avatar; nada de fotos gigantes
const OBJETIVO_BYTES = 90 * 1024; // se comprime hasta bajar de aquí

function leerArchivo(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    lector.readAsDataURL(archivo);
  });
}

function cargarImagen(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Ese archivo no parece una imagen.'));
    img.src = dataUrl;
  });
}

/** ¿Soporta WebP este equipo? Se comprueba una vez. */
let soportaWebp = null;
function hayWebp(canvas) {
  if (soportaWebp === null) {
    soportaWebp = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  }
  return soportaWebp;
}

/**
 * Recorta al cuadrado central, reduce a 256x256 y comprime hasta un tamaño
 * razonable. Devuelve { dataUrl, kb, formato }.
 */
export async function prepararFoto(archivo) {
  if (!archivo) throw new Error('No se eligió ninguna imagen.');
  if (!/^image\//.test(archivo.type || '')) throw new Error('Elige un archivo de imagen (JPG, PNG o WebP).');
  if (archivo.size > 12 * 1024 * 1024) throw new Error('Esa imagen es demasiado grande. Elige una más pequeña.');

  const img = await cargarImagen(await leerArchivo(archivo));

  const lienzo = document.createElement('canvas');
  lienzo.width = LADO;
  lienzo.height = LADO;
  const ctx = lienzo.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  // Recorte cuadrado centrado: la foto se ve completa, sin deformarse.
  const lado = Math.min(img.naturalWidth, img.naturalHeight);
  const x = Math.round((img.naturalWidth - lado) / 2);
  const y = Math.round((img.naturalHeight - lado) / 2);
  ctx.drawImage(img, x, y, lado, lado, 0, 0, LADO, LADO);

  const tipo = hayWebp(lienzo) ? 'image/webp' : 'image/jpeg';
  let calidad = 0.85;
  let dataUrl = lienzo.toDataURL(tipo, calidad);

  // Se baja la calidad hasta entrar en el objetivo; nunca por debajo de 0,5.
  while (dataUrl.length * 0.75 > OBJETIVO_BYTES && calidad > 0.5) {
    calidad = Math.round((calidad - 0.1) * 100) / 100;
    dataUrl = lienzo.toDataURL(tipo, calidad);
  }

  return {
    dataUrl: dataUrl,
    kb: Math.round((dataUrl.length * 0.75) / 1024),
    formato: tipo === 'image/webp' ? 'WebP' : 'JPG',
    lado: LADO
  };
}

/** Abre el selector de archivos del sistema y devuelve el archivo elegido. */
export function elegirImagen() {
  return new Promise((resolve) => {
    const input = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp',
      style: { display: 'none' }
    });
    input.addEventListener('change', () => {
      const archivo = input.files && input.files[0] ? input.files[0] : null;
      input.remove();
      resolve(archivo);
    });
    // Si se cancela, el evento change no llega: se limpia al perder el foco.
    window.addEventListener('focus', () => {
      setTimeout(() => {
        if (document.body.contains(input)) { input.remove(); resolve(null); }
      }, 400);
    }, { once: true });
    document.body.append(input);
    input.click();
  });
}
