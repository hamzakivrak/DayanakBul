const CACHE_NAME = "isg-cache-v3";
// GitHub Pages için DayanakBul klasörünü hafızaya alıyoruz
const urlsToCache = [
  "/DayanakBul/",
  "/DayanakBul/index.html",
  "/DayanakBul/manifest.json"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Chrome 'internet yokken de bu site açılıyor' sansın diye ana dosyaları önbelleğe gömüyoruz
      return cache.addAll(urlsToCache);
    }).catch(err => console.log("Cache hatası:", err))
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  // Mevzuat JSON ve ZIP dosyaları ağır olduğu için HER ZAMAN buluttan (internetten) çekilsin
  if (e.request.url.includes("mevzuat_veritabani.json") || e.request.url.includes("MevzuatText.zip")) {
    e.respondWith(fetch(e.request, { cache: "no-store" }));
  } else {
    // Diğer her şey için: Önce interneti dene, internet yoksa önbellekteki dosyayı ver (Offline Testini Geç!)
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  }
});
