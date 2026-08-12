/*
 * Service Worker del Cotizador Urbiola Llantas.
 *
 * Objetivo: que la app abra SIEMPRE (con o sin datos/señal), sin que el vendedor tenga
 * que hacer nada ni enterarse de nada. Estrategia "cache primero, actualiza en silencio":
 *
 *  1) La primera vez que se abre (con internet), se guarda una copia local de la app.
 *  2) Cada vez que se abre después, se muestra ESA copia guardada al instante, haya o
 *     no haya señal — nunca se queda con pantalla en blanco ni "sin conexión".
 *  3) Si en ese momento SÍ hay internet (aunque sea señal débil), por detrás se descarga
 *     la versión más nueva y se guarda para la PRÓXIMA vez que abra la app. El vendedor
 *     nunca ve un aviso ni tiene que decidir nada — simplemente, la próxima vez que
 *     entre, ya está actualizado solo.
 *
 * Para forzar que todos los dispositivos tomen la app más nueva de inmediato (en vez de
 * esperar a la "próxima vez"), sube un archivo nuevo y sube también este sw.js con el
 * número de CACHE_VERSION incrementado en 1 — eso invalida la copia vieja.
 */
const CACHE_VERSION = 'utl-v1';
const APP_SHELL = [
  './',
  './consulta-precios-llantas.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(APP_SHELL).catch(function () {
        // Si algún ícono no carga la primera vez no debe tronar la instalación completa.
      });
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_VERSION; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return; // los POST a Google Sheets nunca pasan por aquí

  // Las llamadas a la API de Google Sheets (script.google.com) SIEMPRE van directo a la
  // red — nunca se deben cachear (son datos en vivo: folios, pendientes, disponibilidad).
  if (req.url.indexOf('script.google.com') !== -1) {
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      var networkFetch = fetch(req).then(function (resp) {
        if (resp && resp.status === 200) {
          var copy = resp.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, copy); });
        }
        return resp;
      }).catch(function () {
        // Sin internet: si no hay nada en cache tampoco, no hay nada más que devolver.
        return cached;
      });
      // Cache primero (instantáneo); si no hay nada guardado, se espera a la red.
      return cached || networkFetch;
    })
  );
});
