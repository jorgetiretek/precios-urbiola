/*
 * Service Worker del Cotizador Urbiola Llantas.
 *
 * Objetivo: que la app abra SIEMPRE (con o sin datos/señal), sin que el vendedor tenga
 * que hacer nada, Y que en cuanto haya una versión nueva (precios/HTML actualizado en
 * GitHub) se garantice que la vean de inmediato — cerrando su sesión a la fuerza para
 * que vuelvan a entrar ya con los datos frescos, en vez de dejarlos seguir usando la
 * versión vieja hasta que se les ocurra reabrir la app.
 *
 * Cómo funciona cada vez que se abre la app (con algo de señal):
 *  1) Se muestra al instante la copia guardada en el celular (nunca pantalla en blanco).
 *  2) Por detrás, se descarga la versión real desde GitHub y se compara contra la copia
 *     guardada (por encabezados del archivo; si el servidor no los manda, se compara el
 *     contenido completo).
 *  3) Si SÍ cambió: se guarda la nueva copia y se le avisa a la página (mensaje
 *     "utl_nueva_version"). La página, al recibir ese aviso, cierra la sesión y recarga
 *     sola — el vendedor tiene que volver a poner su clave, y ya ve los datos nuevos.
 *  4) Si no cambió nada, no se avisa nada ni se interrumpe a nadie.
 *
 * Sin señal, sigue funcionando igual que antes: se queda con la última copia guardada.
 */
const CACHE_VERSION = 'utl-v2';
const APP_PAGE = 'consulta-precios-llantas.html';
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

function avisarNuevaVersion() {
  self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(function (clientList) {
    clientList.forEach(function (client) {
      client.postMessage({ type: 'utl_nueva_version' });
    });
  });
}

// Compara la copia vieja (cached) contra la nueva (resp) usando encabezados del archivo
// (rápido, sin descargar el contenido dos veces). Si el servidor no manda encabezados
// útiles para comparar, regresa null y el que llama debe comparar el contenido completo.
function comparaPorEncabezados(cachedResp, networkResp) {
  var oldTag = cachedResp.headers.get('etag') || cachedResp.headers.get('last-modified');
  var newTag = networkResp.headers.get('etag') || networkResp.headers.get('last-modified');
  if (oldTag && newTag) return oldTag !== newTag;
  return null; // sin datos suficientes
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return; // los POST a Google Sheets nunca pasan por aquí

  // Las llamadas a la API de Google Sheets (script.google.com) SIEMPRE van directo a la
  // red — nunca se deben cachear (son datos en vivo: folios, pendientes, disponibilidad).
  if (req.url.indexOf('script.google.com') !== -1) {
    return;
  }

  var esPaginaApp = req.url.indexOf(APP_PAGE) !== -1;

  event.respondWith(
    caches.match(req).then(function (cached) {
      var networkFetch = fetch(req).then(function (resp) {
        if (!resp || resp.status !== 200) return resp;

        if (esPaginaApp && cached) {
          var cachedForCompare = cached.clone();
          var respForCache = resp.clone();
          var respForCompare = resp.clone();
          var difiere = comparaPorEncabezados(cachedForCompare, resp);

          if (difiere === true) {
            caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, respForCache); });
            avisarNuevaVersion();
          } else if (difiere === false) {
            caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, respForCache); });
          } else {
            // No hubo encabezados útiles: comparamos el contenido completo como último recurso.
            Promise.all([cachedForCompare.text(), respForCompare.text()]).then(function (vals) {
              caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, respForCache); });
              if (vals[0] !== vals[1]) avisarNuevaVersion();
            });
          }
          return resp;
        }

        var copy = resp.clone();
        caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, copy); });
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
