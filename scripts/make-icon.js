#!/usr/bin/env node
/*
 * Genera el icono de la aplicacion:
 *   assets/icon.png        256x256, el que usa electron-builder y la ventana
 *   assets/icons/icon.png  copia para la ventana en desarrollo
 *   assets/icon.ico        multi-tamano, el que necesitan NSIS y el .exe
 *
 *   node scripts/make-icon.js
 *
 * Se dibuja por codigo (sin dependencias ni editores de imagen): un cuadrado
 * redondeado oscuro con el simbolo del interprete -el chevron y el guion bajo
 * del prompt- en los colores de la aplicacion. electron-builder convierte este
 * PNG a .ico y a .icns al empaquetar.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TAM = 256;
const ROOT = path.resolve(__dirname, '..');

const FONDO = [18, 21, 28, 255];        // --bg
const BORDE = [42, 49, 64, 255];        // --border
const AZUL = [75, 139, 245, 255];       // --py-blue
const AMARILLO = [255, 212, 59, 255];   // --py-yellow

function crearLienzo() {
  const px = new Uint8Array(TAM * TAM * 4);
  return px;
}

function poner(px, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= TAM || y >= TAM) return;
  const i = (y * TAM + x) * 4;
  const a = alpha == null ? color[3] / 255 : alpha;
  for (let c = 0; c < 3; c++) {
    px[i + c] = Math.round(px[i + c] * (1 - a) + color[c] * a);
  }
  px[i + 3] = Math.max(px[i + 3], Math.round(255 * a));
}

/** Cuadrado con esquinas redondeadas. */
function rectRedondeado(px, x0, y0, x1, y1, radio, color) {
  for (let y = Math.floor(y0); y < y1; y++) {
    for (let x = Math.floor(x0); x < x1; x++) {
      const dx = Math.max(x0 + radio - x, 0, x - (x1 - radio));
      const dy = Math.max(y0 + radio - y, 0, y - (y1 - radio));
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= radio) poner(px, x, y, color, Math.min(1, radio - d + 0.5));
    }
  }
}

/** Trazo grueso entre dos puntos, con extremos redondeados. */
function trazo(px, x0, y0, x1, y1, grosor, color) {
  const r = grosor / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const largo2 = dx * dx + dy * dy;
  const minX = Math.floor(Math.min(x0, x1) - r - 1);
  const maxX = Math.ceil(Math.max(x0, x1) + r + 1);
  const minY = Math.floor(Math.min(y0, y1) - r - 1);
  const maxY = Math.ceil(Math.max(y0, y1) + r + 1);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let t = largo2 ? ((x - x0) * dx + (y - y0) * dy) / largo2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px0 = x0 + t * dx;
      const py0 = y0 + t * dy;
      const d = Math.sqrt((x - px0) * (x - px0) + (y - py0) * (y - py0));
      if (d <= r) poner(px, x, y, color, Math.min(1, r - d + 0.5));
    }
  }
}

/** Circulo relleno. */
function circulo(px, cx, cy, radio, color) {
  for (let y = Math.floor(cy - radio - 1); y <= cy + radio + 1; y++) {
    for (let x = Math.floor(cx - radio - 1); x <= cx + radio + 1; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (d <= radio) poner(px, x, y, color, Math.min(1, radio - d + 0.5));
    }
  }
}

function png(px) { return pngDe(px, TAM); }

function pngDe(px, tam) {
  const filas = Buffer.alloc((tam * 4 + 1) * tam);
  for (let y = 0; y < tam; y++) {
    filas[y * (tam * 4 + 1)] = 0;   // filtro "none"
    Buffer.from(px.buffer, px.byteOffset + y * tam * 4, tam * 4).copy(filas, y * (tam * 4 + 1) + 1);
  }

  const trozo = (tipo, datos) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo) >>> 0);
    return Buffer.concat([largo, cuerpo, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0);
  ihdr.writeUInt32BE(tam, 4);
  ihdr[8] = 8;      // profundidad
  ihdr[9] = 6;      // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', zlib.deflateSync(filas, { level: 9 })),
    trozo('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------ ICO -------- */

/*
 * Escala el lienzo a otro tamano con media de area (suficiente y sin
 * dependencias: el dibujo es geometrico y plano).
 */
function escalar(px, destino) {
  const salida = new Uint8Array(destino * destino * 4);
  const factor = TAM / destino;
  for (let y = 0; y < destino; y++) {
    for (let x = 0; x < destino; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const y0 = Math.floor(y * factor);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * factor));
      const x0 = Math.floor(x * factor);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * factor));
      for (let sy = y0; sy < y1 && sy < TAM; sy++) {
        for (let sx = x0; sx < x1 && sx < TAM; sx++) {
          const i = (sy * TAM + sx) * 4;
          r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3];
          n++;
        }
      }
      const j = (y * destino + x) * 4;
      salida[j] = Math.round(r / n);
      salida[j + 1] = Math.round(g / n);
      salida[j + 2] = Math.round(b / n);
      salida[j + 3] = Math.round(a / n);
    }
  }
  return salida;
}

/** Una imagen del .ico: BITMAPINFOHEADER de 32 bits + pixeles + mascara. */
function imagenIco(px, tam) {
  const cabecera = Buffer.alloc(40);
  cabecera.writeUInt32LE(40, 0);          // biSize
  cabecera.writeInt32LE(tam, 4);          // biWidth
  cabecera.writeInt32LE(tam * 2, 8);      // biHeight (imagen + mascara)
  cabecera.writeUInt16LE(1, 12);          // biPlanes
  cabecera.writeUInt16LE(32, 14);         // biBitCount
  cabecera.writeUInt32LE(0, 16);          // BI_RGB

  const pixeles = Buffer.alloc(tam * tam * 4);
  for (let y = 0; y < tam; y++) {
    for (let x = 0; x < tam; x++) {
      const origen = ((tam - 1 - y) * tam + x) * 4;   // el DIB va de abajo arriba
      const destino = (y * tam + x) * 4;
      pixeles[destino] = px[origen + 2];              // B
      pixeles[destino + 1] = px[origen + 1];          // G
      pixeles[destino + 2] = px[origen];              // R
      pixeles[destino + 3] = px[origen + 3];          // A
    }
  }

  // Mascara AND: con canal alfa no se usa, pero el formato la exige.
  const filaMascara = Math.ceil(tam / 32) * 4;
  const mascara = Buffer.alloc(filaMascara * tam);
  cabecera.writeUInt32LE(pixeles.length + mascara.length, 20);   // biSizeImage

  return Buffer.concat([cabecera, pixeles, mascara]);
}

function ico(px) {
  const tamanos = [16, 24, 32, 48, 64, 128, 256];
  const imagenes = tamanos.map((t) => ({
    tam: t,
    datos: imagenIco(t === TAM ? px : escalar(px, t), t)
  }));

  const dir = Buffer.alloc(6 + imagenes.length * 16);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);                       // tipo: icono
  dir.writeUInt16LE(imagenes.length, 4);

  let offset = dir.length;
  imagenes.forEach((img, i) => {
    const p = 6 + i * 16;
    dir[p] = img.tam >= 256 ? 0 : img.tam;       // 0 significa 256
    dir[p + 1] = img.tam >= 256 ? 0 : img.tam;
    dir[p + 2] = 0;                              // paleta
    dir[p + 3] = 0;
    dir.writeUInt16LE(1, p + 4);                 // planos
    dir.writeUInt16LE(32, p + 6);                // bits por pixel
    dir.writeUInt32LE(img.datos.length, p + 8);
    dir.writeUInt32LE(offset, p + 12);
    offset += img.datos.length;
  });

  return Buffer.concat([dir].concat(imagenes.map((i) => i.datos)));
}

let TABLA = null;
function crc32(buf) {
  if (!TABLA) {
    TABLA = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLA[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function main() {
  const px = crearLienzo();
  rectRedondeado(px, 4, 4, TAM - 4, TAM - 4, 46, BORDE);
  rectRedondeado(px, 8, 8, TAM - 8, TAM - 8, 42, FONDO);

  // Simbolo del interprete: el chevron y el guion bajo del prompt.
  trazo(px, 66, 78, 132, 128, 22, AZUL);
  trazo(px, 132, 128, 66, 178, 22, AZUL);
  trazo(px, 146, 182, 200, 182, 22, AMARILLO);

  // Punto amarillo: el "ejecutar" de Python Classroom.
  circulo(px, 186, 92, 15, AMARILLO);

  const buffer = png(px);
  const destinos = [
    path.join(ROOT, 'assets', 'icon.png'),
    path.join(ROOT, 'assets', 'icons', 'icon.png')
  ];
  for (const d of destinos) {
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.writeFileSync(d, buffer);
    console.log('[icono] escrito', path.relative(ROOT, d), Math.round(buffer.length / 1024) + ' KB');
  }

  // La app movil (PWA) necesita PNG de 192 y 512 para el manifiesto y para el
  // icono de la pantalla de inicio del telefono.
  for (const tam of [192, 512]) {
    const escalado = tam === TAM ? px : escalar(px, tam);
    const buf = pngDe(escalado, tam);
    const destino = path.join(ROOT, 'mobile', 'icono-' + tam + '.png');
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, buf);
    console.log('[icono] escrito', path.relative(ROOT, destino), Math.round(buf.length / 1024) + ' KB');
  }

  // NSIS y el ejecutable de Windows necesitan un .ico de verdad, con varios
  // tamanos dentro: con un PNG renombrado el instalador no compila.
  const icono = ico(px);
  const destinoIco = path.join(ROOT, 'assets', 'icon.ico');
  fs.writeFileSync(destinoIco, icono);
  console.log('[icono] escrito', path.relative(ROOT, destinoIco),
    Math.round(icono.length / 1024) + ' KB · 16, 24, 32, 48, 64, 128 y 256 px');
}

main();
