const CACHE_NAME = "isg-cache-v7";
// Göreli adresler: uygulama hangi depo/klasör adıyla yayınlanırsa yayınlansın çalışır
const urlsToCache = [
  "./",
  "./index.html",
  "./parser.js",
  "./belge.js",
  "./merkez.js",
  "./manifest.json"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache)).catch(err => console.log("Cache hatası:", err))
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const u = e.request.url;
  // Veri dosyaları HER ZAMAN buluttan (güncel mevzuat için önbelleğe alınmaz)
  if (/mevzuat_veritabani\.json|periyodik_tablolar\.json|ipc_tablosu\.json|guncelleme_gunlugu\.json|MevzuatText\.zip/.test(u)) {
    e.respondWith(fetch(e.request, { cache: "no-store" }));
  } else {
    // Önce internet, yoksa önbellek (çevrimdışı açılış)
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
  }
});
