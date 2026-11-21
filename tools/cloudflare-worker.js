// Cloudflare Worker — mevzuat.gov.tr için küçük CORS aracısı (yalnızca mevzuat.gov.tr'ye izin verir)
// Kurulum: dash.cloudflare.com → Workers & Pages → Create → "Hello World" Worker → Edit code → bu dosyayı yapıştırın → Deploy.
// Sonra Worker adresini (https://....workers.dev) uygulamada Güncelleme Merkezi → "Doğrudan çekme ayarı" kutusuna yazın.
const IZINLI = /^(www\.)?mevzuat\.gov\.tr$/;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*' };

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const hedef = new URL(req.url).searchParams.get('url');
    let u; try { u = new URL(hedef); } catch (e) { return new Response('url parametresi gerekli', { status: 400, headers: CORS }); }
    if (u.protocol !== 'https:' || !IZINLI.test(u.hostname)) return new Response('yalnızca mevzuat.gov.tr', { status: 403, headers: CORS });
    const r = await fetch(u.href, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'Accept-Language': 'tr-TR,tr;q=0.9' }, redirect: 'follow' });
    const h = new Headers(CORS);
    h.set('content-type', r.headers.get('content-type') || 'application/octet-stream');
    return new Response(r.body, { status: r.status, headers: h });
  },
};
