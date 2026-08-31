#!/usr/bin/env node
/*
 * Servidor estático para probar la app móvil.
 *
 *   npm run movil            -> http://localhost:5173/mobile/
 *   npm run movil -- --port 8080
 *
 * Sirve la raíz del proyecto (la app móvil reutiliza src/css y src/js), sin
 * dependencias: solo el http de Node. Es para desarrollo y para probar desde el
 * teléfono en la misma red; no es un servidor de producción.
 *
 * Para abrirlo desde un móvil, en la misma wifi: http://<ip-del-pc>:5173/mobile/
 * Aviso honesto: el service worker y "añadir a la pantalla de inicio" solo
 * funcionan del todo en https o en localhost. Desde el teléfono por IP la app
 * carga, pero no se instala.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const puerto = Number((args[args.indexOf('--port') + 1] || '').trim()) || 5173;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

function dentroDelProyecto(objetivo) {
  const rel = path.relative(RAIZ, objetivo);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const servidor = http.createServer((req, res) => {
  let ruta = decodeURIComponent(String(req.url || '/').split('?')[0]);
  if (ruta === '/') ruta = '/mobile/index.html';
  if (ruta.endsWith('/')) ruta += 'index.html';

  const archivo = path.join(RAIZ, ruta);
  if (!dentroDelProyecto(archivo)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Fuera del proyecto.');
    return;
  }

  fs.readFile(archivo, (err, datos) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No existe: ' + ruta);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(archivo).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      // El service worker necesita poder controlar toda la carpeta.
      'Service-Worker-Allowed': '/'
    });
    res.end(datos);
  });
});

servidor.listen(puerto, () => {
  const ips = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }
  }
  console.log('App móvil servida en:');
  console.log('  http://localhost:' + puerto + '/mobile/');
  for (const ip of ips) console.log('  http://' + ip + ':' + puerto + '/mobile/   (desde el teléfono, misma wifi)');
  console.log('\nCtrl+C para parar.');
});
