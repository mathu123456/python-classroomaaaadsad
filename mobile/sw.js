/*
 * Service worker de la app móvil.
 *
 * Hace dos cosas y ninguna más:
 *   1. Guarda el "caparazón" de la aplicación (HTML, CSS y JS) para que abra sin
 *      conexión y se pueda instalar en la pantalla de inicio.
 *   2. Deja pasar TODO lo demás a la red sin tocarlo.
 *
 * Lo que NO cachea, a propósito:
 *   - Firebase: los datos tienen que ser los de verdad, no una copia vieja. La
 *     copia para trabajar sin conexión la guarda la aplicación (localStorage),
 *     que sabe distinguir lo suyo y avisa de que es antigua.
 *   - Pyodide (los ~10 MB de Python): lo cachea el navegador por su cuenta con
 *     las cabeceras del CDN; meterlo aquí llenaría el almacenamiento del
 *     teléfono sin control.
 */

const VERSION = 'pc-movil-v1';

const CAPARAZON = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/mobile.css',
  './js/app.js',
  './js/acceso.js',
  './js/pantallas.js',
  './js/data.js',
  './js/fb.js',
  './js/editor.js',
  './js/python.js',
  '../src/css/variables.css',
  '../src/css/reset.css',
  '../src/css/components.css',
  '../src/css/dashboard.css',
  '../src/js/ui.js',
  '../src/js/vendor/firebase.js',
  '../src/js/vendor/cm6.js'
];

self.addEventListener('install', (evento) => {
  evento.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Uno a uno: si un archivo falla, el resto igual queda guardado.
    await Promise.all(CAPARAZON.map(async (ruta) => {
      try {
        await cache.add(new Request(ruta, { cache: 'reload' }));
      } catch (err) {
        console.warn('[sw] no se pudo guardar', ruta, err);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    for (const nombre of await caches.keys()) {
      if (nombre !== VERSION) await caches.delete(nombre);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);

  // Solo se atiende lo propio y con GET: nada de interferir con Firebase.
  if (evento.request.method !== 'GET' || url.origin !== self.location.origin) return;

  evento.respondWith((async () => {
    const cache = await caches.open(VERSION);

    /*
     * Red primero y, si responde, se refresca la copia. Así una actualización
     * de la aplicación llega sin tener que borrar nada a mano; sin conexión se
     * usa lo guardado.
     */
    try {
      const respuesta = await fetch(evento.request);
      if (respuesta && respuesta.ok) cache.put(evento.request, respuesta.clone());
      return respuesta;
    } catch (err) {
      const guardada = await cache.match(evento.request, { ignoreSearch: true });
      if (guardada) return guardada;
      if (evento.request.mode === 'navigate') {
        const inicio = await cache.match('./index.html');
        if (inicio) return inicio;
      }
      throw err;
    }
  })());
});
