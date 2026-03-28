// Temel PWA Service Worker (Ağ odaklı - Cache Bypass)
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Mevzuat JSON ve ZIP dosyalarını çekerken önbelleğe takılmasını engelle
  if (e.request.url.includes('mevzuat_veritabani.json') || e.request.url.includes('MevzuatText.zip')) {
    e.respondWith(fetch(e.request, { cache: "no-store" }));
  } else {
    e.respondWith(fetch(e.request));
  }
});
