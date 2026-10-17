/* Service Worker · Control Ceba Cerdos
   Súbelo a GitHub en la MISMA carpeta que index.html (con el nombre exacto: sw.js).
   - Guarda la app y sus librerías para abrir y trabajar SIN señal.
   - Los datos (Firebase) se guardan en el teléfono y se sincronizan solos al volver la señal.
   - index.html registra este archivo como "sw.js?v=N": para forzar actualización en todos los teléfonos,
     sube el número SW_VERSION en index.html (o cambia VERSION aquí). */

const VERSION = new URL(self.location.href).searchParams.get("v") || "2";
const CACHE = "cerdos-v" + VERSION;

/* Archivos propios (obligatorios) */
const APP = ["./", "./index.html"];

/* Librerías externas que usa la app (se guardan si hay señal; si alguna falla no se bloquea la instalación) */
const EXTRAS = [
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js",
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&display=swap"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(APP.map(u => new Request(u, { cache: "reload" })));
    await Promise.all(EXTRAS.map(u =>
      fetch(new Request(u, { mode: "no-cors" })).then(r => c.put(u, r)).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter(k => k.startsWith("cerdos-") && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* Con señal: baja la versión nueva. Sin señal (o muy lenta): usa la guardada. */
async function redPrimero(req, esperaMs) {
  const c = await caches.open(CACHE);
  try {
    const r = await Promise.race([
      fetch(req),
      new Promise((_, no) => setTimeout(() => no(new Error("lento")), esperaMs))
    ]);
    if (r && r.ok) c.put(req, r.clone());
    return r;
  } catch (err) {
    const g = await c.match(req, { ignoreSearch: true });
    if (g) return g;
    if (req.mode === "navigate") {
      const idx = await c.match("./index.html") || await c.match("./");
      if (idx) return idx;
    }
    return Response.error();
  }
}

/* Librerías y fuentes: usa lo guardado al instante y lo actualiza por detrás */
async function guardadoPrimero(req) {
  const c = await caches.open(CACHE);
  const g = await c.match(req);
  const red = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone()); return r; }).catch(() => null);
  return g || (await red) || Response.error();
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  /* Firestore y autenticación: los maneja el SDK de Firebase (persistencia local); no se interceptan */
  if (/(^|\.)googleapis\.com$/.test(url.hostname) && !/^fonts\./.test(url.hostname)) return;
  if (url.hostname.endsWith("firebaseio.com") || url.hostname.endsWith("firebaseapp.com")) return;

  /* Páginas y archivos de la propia app */
  if (url.origin === self.location.origin) {
    e.respondWith(redPrimero(req, 4000));
    return;
  }

  /* Librerías y fuentes externas */
  if (/gstatic\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/.test(url.hostname)) {
    e.respondWith(guardadoPrimero(req));
  }
});
