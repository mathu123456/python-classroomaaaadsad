'use strict';
/*
 * Cloudinary: fotografias de perfil.
 *
 * POR QUE NO ESTA EL api_secret AQUI
 * ----------------------------------
 * Una aplicacion de escritorio es un archivo que el usuario tiene en su
 * computador. Cualquier cosa que se meta dentro -incluida una clave secreta- se
 * puede sacar de ahi en dos minutos. Con el api_secret de Cloudinary, quien lo
 * saque puede subir, transformar y BORRAR todo lo de la cuenta.
 *
 * Por eso se sube con un "upload preset" SIN FIRMAR (unsigned), que es el
 * mecanismo que Cloudinary tiene justo para clientes: el preset decide en el
 * servidor de Cloudinary que se permite (carpeta, tamano maximo, formatos), y la
 * aplicacion solo manda la imagen y el nombre del preset. No hay secreto que
 * filtrar.
 *
 * Lo que hay que hacer una vez en la consola de Cloudinary esta en
 * firebase/CONFIGURACION.md (seccion de fotografias).
 *
 * En Firebase se guarda SOLO la URL. Las imagenes nunca entran en la Realtime
 * Database.
 */

const fs = require('fs');
const https = require('https');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  cloudName: '678127365853228',
  uploadPreset: 'python_classroom_perfiles',   // hay que crearlo en Cloudinary
  carpeta: 'python-classroom/perfiles',
  maxBytes: 300 * 1024                          // 300 KB: una foto de perfil no necesita mas
};

const LIMITE_SUBIDA = 2 * 1024 * 1024;          // lo que se acepta recibir del renderer

function archivoConfig() {
  return path.join(app.getPath('userData'), 'cloudinary.json');
}

function leerArchivo() {
  try {
    const raw = JSON.parse(fs.readFileSync(archivoConfig(), 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (err) {
    return {};
  }
}

function get() {
  const propio = leerArchivo();
  const cfg = Object.assign({}, DEFAULTS, propio);
  return {
    cloudName: String(cfg.cloudName || '').trim(),
    uploadPreset: String(cfg.uploadPreset || '').trim(),
    carpeta: String(cfg.carpeta || '').trim(),
    maxBytes: Number(cfg.maxBytes) || DEFAULTS.maxBytes,
    archivo: archivoConfig(),
    personalizado: Object.keys(propio).length > 0,
    // Nunca hay secretos aqui: si alguien los pone en el archivo, se ignoran.
    listo: !!(cfg.cloudName && cfg.uploadPreset)
  };
}

function set(patch) {
  const actual = leerArchivo();
  const siguiente = Object.assign({}, actual);
  for (const clave of ['cloudName', 'uploadPreset', 'carpeta']) {
    if (patch && typeof patch[clave] === 'string') siguiente[clave] = patch[clave].trim().slice(0, 120);
  }
  if (patch && patch.maxBytes) siguiente.maxBytes = Math.max(20 * 1024, Math.min(1024 * 1024, Number(patch.maxBytes)));
  fs.mkdirSync(path.dirname(archivoConfig()), { recursive: true });
  const tmp = archivoConfig() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(siguiente, null, 2), 'utf8');
  fs.renameSync(tmp, archivoConfig());
  return get();
}

/* ------------------------------------------------------------- utiles */

/** Interpreta un data URL ("data:image/webp;base64,...") del renderer. */
function desdeDataUrl(dataUrl) {
  const texto = String(dataUrl || '');
  const m = texto.match(/^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) return { ok: false, error: 'La imagen no llegó en un formato que se pueda subir.' };
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length) return { ok: false, error: 'La imagen llegó vacía.' };
  if (buffer.length > LIMITE_SUBIDA) return { ok: false, error: 'La imagen es demasiado grande.' };
  return { ok: true, tipo: m[1], buffer: buffer };
}

/** Cuerpo multipart/form-data hecho a mano (sin dependencias). */
function multipart(campos, archivo) {
  const frontera = '----PythonClassroom' + Date.now().toString(36);
  const trozos = [];
  for (const [clave, valor] of Object.entries(campos)) {
    if (valor == null || valor === '') continue;
    trozos.push(Buffer.from(
      '--' + frontera + '\r\n' +
      'Content-Disposition: form-data; name="' + clave + '"\r\n\r\n' +
      String(valor) + '\r\n', 'utf8'));
  }
  trozos.push(Buffer.from(
    '--' + frontera + '\r\n' +
    'Content-Disposition: form-data; name="file"; filename="' + archivo.nombre + '"\r\n' +
    'Content-Type: ' + archivo.tipo + '\r\n\r\n', 'utf8'));
  trozos.push(archivo.buffer);
  trozos.push(Buffer.from('\r\n--' + frontera + '--\r\n', 'utf8'));
  return { cuerpo: Buffer.concat(trozos), frontera: frontera };
}

/* ------------------------------------------------------------- subida */

/**
 * Sube una imagen y devuelve { ok, url, bytes, formato, ancho, alto }.
 *
 * `publicId` fija el nombre en Cloudinary: usando el identificador de la persona,
 * cambiar de foto reemplaza la anterior en vez de acumular archivos.
 */
function subir(dataUrl, opciones) {
  const o = opciones || {};
  const cfg = get();
  if (!cfg.listo) {
    return Promise.resolve({
      ok: false,
      error: 'Las fotos de perfil todavía no están activadas en este equipo.',
      detalle: 'Falta el nombre de la cuenta o el preset de subida.',
      configuracion: true
    });
  }

  const imagen = desdeDataUrl(dataUrl);
  if (!imagen.ok) return Promise.resolve(imagen);
  if (imagen.buffer.length > cfg.maxBytes) {
    return Promise.resolve({
      ok: false,
      error: 'La foto pesa ' + Math.round(imagen.buffer.length / 1024) + ' KB y el máximo es ' +
        Math.round(cfg.maxBytes / 1024) + ' KB.'
    });
  }

  const extension = (imagen.tipo.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const { cuerpo, frontera } = multipart({
    upload_preset: cfg.uploadPreset,
    folder: cfg.carpeta || undefined,
    public_id: o.publicId ? String(o.publicId).slice(0, 80) : undefined
  }, { nombre: 'perfil.' + extension, tipo: imagen.tipo, buffer: imagen.buffer });

  return new Promise((resolve) => {
    const req = https.request({
      method: 'POST',
      hostname: 'api.cloudinary.com',
      path: '/v1_1/' + encodeURIComponent(cfg.cloudName) + '/image/upload',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + frontera,
        'Content-Length': cuerpo.length
      }
    }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { texto += c; });
      res.on('end', () => {
        let datos = null;
        try { datos = JSON.parse(texto); } catch (err) { datos = null; }

        if (res.statusCode === 200 && datos && datos.secure_url) {
          resolve({
            ok: true,
            url: datos.secure_url,
            publicId: datos.public_id || null,
            bytes: datos.bytes || imagen.buffer.length,
            formato: datos.format || extension,
            ancho: datos.width || null,
            alto: datos.height || null
          });
          return;
        }

        const motivo = datos && datos.error && datos.error.message ? datos.error.message : ('respuesta ' + res.statusCode);
        /*
         * Lo que ve la persona es llano; el motivo tecnico va aparte, para el
         * registro y para el dialogo de configuracion del profesor.
         */
        const amable = /preset/i.test(motivo)
          ? 'Las fotos de perfil no están bien configuradas en este equipo. Avísale a tu profesor.'
          : 'No se pudo subir la foto. Inténtalo otra vez.';
        resolve({ ok: false, error: amable, detalle: motivo, configuracion: /preset/i.test(motivo) });
      });
    });

    req.setTimeout(20000, () => { req.destroy(new Error('Cloudinary no respondió a tiempo.')); });
    req.on('error', (err) => {
      resolve({
        ok: false,
        error: 'No hay conexión para subir la foto. Inténtalo más tarde.',
        detalle: err && err.message ? err.message : String(err)
      });
    });
    req.write(cuerpo);
    req.end();
  });
}

/**
 * URL de entrega optimizada: recorta a cuadrado centrado en la cara cuando se
 * puede, ajusta el tamano y deja que Cloudinary elija formato y calidad.
 *
 * Se usa una transformacion en la propia URL -no una llamada a la API- para que
 * no haga falta ninguna clave y para que el navegador la pueda cachear.
 */
function urlOptimizada(url, lado) {
  const texto = String(url || '');
  if (!/^https:\/\/res\.cloudinary\.com\//.test(texto)) return texto || null;
  if (/\/upload\/(c_|f_|q_|w_|h_)/.test(texto)) return texto;   // ya viene transformada
  const px = Math.max(32, Math.min(512, Math.round(lado || 128)));
  return texto.replace('/upload/',
    '/upload/c_fill,g_face,w_' + px + ',h_' + px + ',f_auto,q_auto/');
}

module.exports = { DEFAULTS, get, set, subir, urlOptimizada, archivoConfig };
