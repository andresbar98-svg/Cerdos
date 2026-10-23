/* Service Worker · Control Ceba Cerdos
   - CACHE: súbele el número en cada despliegue (v8 → v9 …); al activarse borra TODAS las cachés anteriores.
   - Archivos propios (index.html, imágenes…): NETWORK FIRST → siempre intenta bajar la última versión del servidor;
     la caché solo se usa si no hay red (o si la red tarda más de 6 s).
   - Librerías externas (Firebase SDK, fuentes, cdnjs): se sirven de caché y se refrescan en segundo plano.
   - Firestore, WhatsApp y cualquier otra petición no se tocan. */
const CACHE = "ceba-cerdos-v8";
const PRECACHE = ["./", "./index.html"];                 /* mínimo para abrir sin conexión (se cachea tolerando fallos) */
const HOSTS_EXTERNOS = ["www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com"];
const ESPERA_RED_MS = 6000;
const INDEX_URL = new URL("./index.html", self.registration.scope).href;

/* INSTALL: skipWaiting → la versión nueva no espera a que cierren la app (clave en iPadOS) */
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(PRECACHE.map(u =>
    fetch(new Request(u, { cache: "reload" })).then(r => { if (r && r.ok) return c.put(u === "./" ? INDEX_URL : new URL(u, self.registration.scope).href, r); }).catch(() => {})
  ))));
});

/* ACTIVATE: borra todas las cachés viejas (caches.delete), toma el control y recarga las pestañas abiertas con la versión anterior */
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const claves = await caches.keys();
    const viejas = claves.filter(k => k !== CACHE);
    await Promise.all(viejas.map(k => caches.delete(k)));
    await self.clients.claim();
    if (viejas.length) {                                 /* había una versión anterior: refresca lo que el usuario tenga abierto */
      const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      ventanas.forEach(v => { try { v.navigate(v.url); } catch (_) {} });
    }
  })());
});

self.addEventListener("message", e => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });

/* clave de caché: toda navegación (/, /index.html?x, #hash) usa el mismo index.html */
const clave = req => req.mode === "navigate" ? INDEX_URL : req.url;

async function redPrimero(req) {
  const k = clave(req), cache = await caches.open(CACHE);
  const red = fetch(req.url, { cache: "no-store", credentials: "same-origin" }).then(res => {
    if (res && res.status === 200) cache.put(k, res.clone());          /* guarda la última versión para el modo sin conexión */
    return res;
  });
  try {
    const guardada = await cache.match(k);
    if (!guardada) return await red;                                   /* sin copia: espera a la red */
    return await Promise.race([red, new Promise((_, no) => setTimeout(no, ESPERA_RED_MS))]);   /* red lenta: usa la copia */
  } catch (_) {
    return (await cache.match(k)) || (req.mode === "navigate" ? await cache.match(INDEX_URL) : null) || Response.error();
  }
}

async function cacheYRefrescar(req) {
  const cache = await caches.open(CACHE), hit = await cache.match(req);
  const red = fetch(req).then(res => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await red) || Response.error();
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith("/sw.js")) return;                       /* el propio sw.js siempre va directo a la red */
    e.respondWith(redPrimero(req));
  } else if (HOSTS_EXTERNOS.includes(url.hostname)) {
    e.respondWith(cacheYRefrescar(req));
  }
});
