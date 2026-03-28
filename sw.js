const CACHE_NAME = "isg-cache-v2";
const urlsToCache = [
  "./",
  "./index.html"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Kurulum aşamasında ana HTML'yi hafızaya atıyoruz ki Chrome 'offline çalışıyor' sansın.
      return cache.addAll(urlsToCache);
    }).catch(err => console.log("Cache hatası:", err))
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  // JSON ve ZIP her zaman internetten taze çekilsin
  if (e.request.url.includes("mevzuat_veritabani.json") || e.request.url.includes("MevzuatText.zip")) {
    e.respondWith(fetch(e.request, { cache: "no-store" }));
  } else {
    // Diğer dosyalar için: Önce internetten al, internet yoksa hafızadakini (cache) ver.
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  }
});
