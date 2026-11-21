#!/usr/bin/env node
/*
 * tools/guncelle.js — mevzuat.gov.tr'den güncel metinleri çekip veritabanıyla karşılaştırır.
 *
 *   node tools/guncelle.js           -> değişenleri mevzuat_veritabani.json'a yazar (GitHub Actions bunu PR yapar)
 *   node tools/guncelle.js --test    -> hiçbir dosyayı değiştirmez; yalnızca erişim ve ayrıştırma teşhisi yazdırır
 *
 * Kaynak listesi: kaynaklar.txt  (satır biçimi:  Mevzuat Adı | https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=...&MevzuatTur=...&MevzuatTertip=...)
 * Adresi boş satırlar atlanır.
 */
const fs = require('fs');
const path = require('path');
const P = require('../parser.js');
const B = require('../belge.js');
let JSZip = null; try { JSZip = require('jszip'); } catch (e) { /* docx/zip ekleri için gerekir; iş akışı kurar */ }

const ROOT = path.join(__dirname, '..');
const TEST = process.argv.includes('--test');
const DB_PATH = path.join(ROOT, 'mevzuat_veritabani.json');
const TABLO_PATH = path.join(ROOT, 'periyodik_tablolar.json');
const GUNLUK_PATH = path.join(ROOT, 'guncelleme_gunlugu.json');
const RAPOR_PATH = path.join(ROOT, 'guncelleme_raporu.md');
const SIMDI = new Date().toISOString();

const rows = [];            // rapor satırları
let uygulananSayi = 0;
let ulasilanSayi = 0;
let denenenSayi = 0;
const gunlukEkle = [];
const log = (...a) => console.log(...a);

function kaynaklariOku() {
    const f = path.join(ROOT, 'kaynaklar.txt');
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, 'utf8').split('\n').map(l => l.trim())
        .filter(l => l && !l.startsWith('#') && l.includes('|'))
        .map(l => { const i = l.lastIndexOf('|'); return { ad: l.slice(0, i).trim(), url: l.slice(i + 1).trim() }; })
        .filter(k => /^https?:\/\//i.test(k.url));
}

async function indir(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 45000);
    try {
        const r = await fetch(url, {
            signal: ctl.signal, redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9'
            }
        });
        const buf = Buffer.from(await r.arrayBuffer());
        return { ok: r.ok, status: r.status, tip: r.headers.get('content-type') || '', text: buf.toString('utf8'), bayt: buf.length, buf };
    } catch (e) {
        return { ok: false, status: 0, tip: '', text: '', bayt: 0, buf: Buffer.alloc(0), hata: (e.cause && e.cause.code) || e.message };
    } finally { clearTimeout(to); }
}

function adayAdresler(url) {
    const u = new URL(url);
    const no = u.searchParams.get('MevzuatNo'), tur = u.searchParams.get('MevzuatTur'), tertip = u.searchParams.get('MevzuatTertip');
    const liste = [];
    if (no && tur && tertip) liste.push(`${u.origin}/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=${tur}&MevzuatNo=${no}&MevzuatTertip=${tertip}`);
    liste.push(url);
    return liste;
}

function engelMi(r) {
    if ([401, 403, 407, 429, 503].includes(r.status)) return true;
    const kisa = r.text.length < 6000 ? r.text : '';
    return /captcha|access denied|just a moment|enable javascript|erişim engel|cloudflare/i.test(kisa);
}

function adBenzerMi(ad, metin) {
    const kelimeler = P.normName(ad).split(' ').filter(w => w.length > 3);
    if (!kelimeler.length) return true;
    const bas = P.normName(metin.slice(0, 4000));
    const bulunan = kelimeler.filter(w => bas.includes(w)).length;
    return bulunan / kelimeler.length >= 0.6;
}


// ---- Yerel "ayna": uygulamanın (tarayıcıda CORS yüzünden mevzuat.gov.tr'ye erişemediği için) okuyacağı metinler
const AYNA_DIR = path.join(ROOT, 'kaynak_metinler');
const aynalar = [];
const slugla = ad => P.normName(ad).replace(/ /g, '_').slice(0, 50);

function ekBaglantilari(html) {
    const out = []; const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+\.(?:docx?|zip|pdf))["']/gi; let m;
    while ((m = re.exec(html))) if (!out.includes(m[1])) out.push(m[1]);
    return out;
}

// Sayfadaki göreli ek bağlantısının gerçek adresi belgelenmediği için birkaç olası yol denenir; denemeler indekse yazılır.
async function ekMetni(href, adres, tur) {
    const o = new URL(adres).origin, klasor = { 7: 'yonetmelik', 1: 'kanun' }[tur] || 'yonetmelik';
    const adaylar = [];
    [() => new URL(href, adres).href, () => `${o}/MevzuatMetin/${klasor}/${href}`, () => `${o}/MevzuatMetin/${href}`, () => `${o}/${href}`]
        .forEach(f => { try { const u = f(); if (!adaylar.includes(u)) adaylar.push(u); } catch (e) { /* */ } });
    const denemeler = [];
    for (const u of adaylar) {
        const r = await indir(u);
        denemeler.push(`${u.replace(/^https?:\/\//, '')} → ${r.status || 'hata'}${r.hata ? '(' + r.hata + ')' : ''} ${r.bayt}B ${(r.tip || '').split(';')[0]}`);
        if (!(r.ok && r.bayt > 500 && !/text\/html/i.test(r.tip))) continue;
        try {
            const ab = r.buf.buffer.slice(r.buf.byteOffset, r.buf.byteOffset + r.buf.length);
            if (/\.zip$/i.test(href)) {
                if (!JSZip) return { denemeler, hata: 'zip için jszip kurulu değil' };
                const z = await JSZip.loadAsync(ab), parca = [];
                for (const f of Object.values(z.files)) {
                    if (f.dir || !/\.(docx?|txt)$/i.test(f.name)) continue;
                    const o2 = await B.oku(await f.async('arraybuffer'), f.name, JSZip, P.htmlToText);
                    parca.push(o2.metin);
                }
                return { denemeler, metin: parca.join('\n\n'), adres: u };
            }
            const o2 = await B.oku(ab, href, JSZip, P.htmlToText);
            return { denemeler, metin: o2.metin, adres: u };
        } catch (e) { denemeler.push('okuma hatası: ' + e.message); }
    }
    return { denemeler, hata: 'indirilemedi' };
}

async function aynaYaz(k, sonuc, metin) {
    fs.mkdirSync(AYNA_DIR, { recursive: true });
    const slug = slugla(k.ad);
    fs.writeFileSync(path.join(AYNA_DIR, slug + '.txt'), metin);
    const u = new URL(sonuc.adres), tur = u.searchParams.get('MevzuatTur');
    const ekler = [], hariciMetinler = [];
    for (const href of ekBaglantilari(sonuc.r.text)) {
        const dosya = decodeURIComponent(href);
        if (/\.pdf$/i.test(href)) { ekler.push({ dosya, slug: null, durum: 'pdf (metne çevrilemez)' }); continue; }
        const e = await ekMetni(href, sonuc.adres, tur);
        const eslug = `${slug}.ek${ekler.length + 1}`;
        if (e.metin) { fs.writeFileSync(path.join(AYNA_DIR, eslug + '.txt'), e.metin); hariciMetinler.push(e.metin); }
        ekler.push({ dosya, slug: e.metin ? eslug : null, durum: e.metin ? 'ok' : e.hata, adres: e.adres || null, denemeler: e.denemeler });
        log(`    ek: ${dosya} → ${e.metin ? 'metne çevrildi' : e.hata}`);
    }
    aynalar.push({ ad: k.ad, slug, url: k.url, tarih: SIMDI, ekler });
    return hariciMetinler;
}

function dbYaz(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } // önceki biçimle aynı (sonda satır sonu yok)

async function main() {
    const kaynaklar = kaynaklariOku();
    if (!kaynaklar.length) {
        const m = "kaynaklar.txt içinde adresi yazılmış hiç mevzuat yok. Bir satırı şu biçimde doldurun:\n  İş Ekipmanlarının Kullanımında Sağlık ve Güvenlik Şartları Yönetmeliği | https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=...&MevzuatTur=...&MevzuatTertip=...";
        log(m); fs.writeFileSync(RAPOR_PATH, '## Mevzuat güncelleme\n\n' + m.replace(/\n/g, '\n\n') + '\n');
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### ⚠ Kaynak adresi yok\n\n```\n' + m + '\n```\n');
        process.exit(1);
    }
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    let tablolarYenilendi = false;

    for (const k of kaynaklar) {
        denenenSayi++;
        log(`\n=== ${k.ad}\n    ${k.url}`);
        const idx = P.findRegulationIndex(db, k.ad);
        const eski = idx >= 0 ? db[idx] : null;
        if (!eski) log('    (veritabanında bu ada sahip kayıt yok: yeni mevzuat olarak değerlendirilecek)');

        let sonuc = null, deneme = [];
        for (const adres of adayAdresler(k.url)) {
            const r = await indir(adres);
            deneme.push(`${adres.replace(/^https?:\/\//, '').slice(0, 90)} → ${r.status || 'bağlantı hatası'}${r.hata ? ' (' + r.hata + ')' : ''}, ${r.bayt} bayt`);
            log(`    ${deneme[deneme.length - 1]}`);
            if (r.ok && !engelMi(r)) { const metin = P.htmlToText(r.text); if (/MADDE\s+\d+/i.test(metin)) { sonuc = { r, metin, adres }; break; } }
            if (engelMi(r)) log('    ! Site isteği engelledi gibi görünüyor (erişim reddi / doğrulama sayfası).');
        }
        if (!sonuc) {
            rows.push({ ad: k.ad, durum: '❌ Erişilemedi veya metin bulunamadı', detay: deneme.join('<br>') });
            continue;
        }
        ulasilanSayi++;
        const { metin } = sonuc;
        try { // tanılama: çekilen ham sayfa ve metne çevrilmiş hali (iş akışı bunları 'tanilama' dalına gönderir)
            fs.mkdirSync('tanilama', { recursive: true });
            const slug = P.normName(k.ad).replace(/ /g, '_').slice(0, 50);
            fs.writeFileSync(`tanilama/${slug}.ham.html`, sonuc.r.text);
            fs.writeFileSync(`tanilama/${slug}.metin.txt`, metin);
            fs.writeFileSync(`tanilama/${slug}.bilgi.txt`, `adres: ${sonuc.adres}\ntip: ${sonuc.r.tip}\nbayt: ${sonuc.r.bayt}\n`);
        } catch (e) { /* tanılama başarısız olsa da devam */ }
        let hariciEkMetinleri = [];
        try { hariciEkMetinleri = await aynaYaz(k, sonuc, metin); } catch (e) { log('    ayna yazılamadı: ' + e.message); }
        if (TEST) log(`    metnin ilk 160 karakteri: ${JSON.stringify(metin.slice(0, 160))}`);
        if (!adBenzerMi(k.ad, metin)) {
            rows.push({ ad: k.ad, durum: '⚠ Atlandı: sayfa başka bir mevzuat gibi görünüyor', detay: 'kaynaklar.txt adresini kontrol edin.' });
            continue;
        }
        const yeni = P.parseMevzuatText(k.ad + '.txt', metin);
        if (!yeni.maddeler.length) { rows.push({ ad: k.ad, durum: '⚠ Atlandı: madde ayrıştırılamadı', detay: 'Sayfa biçimi beklenenden farklı.' }); continue; }
        // Ayrı belge olarak indirilen ekler (Word/zip) numaralarına göre ayrıştırılıp eklenir; sayfadaki aynı numaralı ek önceliklidir.
        const sayfadakiEkler = yeni.ekler || [];
        const sayfaAnahtarlari = new Set(sayfadakiEkler.map(P.ekAnahtar));
        let hariciEkler = [];
        for (const t of hariciEkMetinleri) {
            const p = P.parseMevzuatText('ek.txt', t);
            if (p.ekler.length && p.ekler.length <= 40) hariciEkler = hariciEkler.concat(p.ekler.filter(e => !sayfaAnahtarlari.has(P.ekAnahtar(e))));
        }
        if (eski) {
            yeni.mevzuat_adi = eski.mevzuat_adi; yeni.mevzuat_turu = eski.mevzuat_turu; yeni.dayanak_kanun = eski.dayanak_kanun;
            if (eski.mevzuat_no && !yeni.mevzuat_no) yeni.mevzuat_no = eski.mevzuat_no;
            // Sayfada/ayrı belgede bulunmayan mevcut ekler KORUNUR; bulunanlar (aynı numaralıysa) güncellenir.
            const taban = P.deepCopy(yeni); taban.ekler = P.deepCopy(eski.ekler || []);
            yeni.ekler = P.mergeEkler(taban, sayfadakiEkler.concat(hariciEkler)).ekler;
        } else if (hariciEkler.length) {
            yeni.ekler = P.mergeEkler(yeni, hariciEkler).ekler;
        }

        let d = null;
        if (eski) {
            d = P.diffRegulations(eski, yeni);
            const toplam = Math.max(eski.maddeler.length, 1);
            if (yeni.maddeler.length < toplam * 0.7) { rows.push({ ad: k.ad, durum: '⚠ Atlandı: madde sayısı çok azaldı', detay: `${eski.maddeler.length} → ${yeni.maddeler.length}. Çekilen metin eksik olabilir.` }); continue; }
            if (d.degisen.length > toplam * 0.5) { rows.push({ ad: k.ad, durum: '⚠ Atlandı: maddelerin yarısından fazlası değişmiş görünüyor', detay: `${P.diffOzet(d)}. Büyük olasılıkla metin biçimi farklı; elle inceleyin (Güncelleme Merkezi ile yapıştırarak karşılaştırabilirsiniz).` }); continue; }
            if (!d.degisiklikVar) { rows.push({ ad: k.ad, durum: '✅ Güncel (değişiklik yok)', detay: '' }); continue; }
        }

        // tablolar (yalnızca İş Ekipmanları)
        let tabloNotu = '';
        if (P.normName(k.ad).includes('is ekipmanlarinin kullaniminda')) {
            const tb = P.extractTables(metin), ok = tb.filter(t => t.guvenilir);
            if (ok.length >= 4 && ok.length === tb.length) {
                if (!TEST) {
                    fs.writeFileSync(TABLO_PATH, JSON.stringify({ mevzuat: yeni.mevzuat_adi, ek: 'EK-III', kaynak: 'mevzuat.gov.tr (otomatik çekim)', guncelleme: SIMDI, tablolar: tb }, null, 2) + '\n');
                    tablolarYenilendi = true;
                }
                tabloNotu = `EK-III tabloları da yenilendi (${ok.length} tablo).`;
            } else tabloNotu = `⚠ EK-III tabloları güvenilir ayrıştırılamadı (${ok.length}/${tb.length}); tablolar eski kaldı — Güncelleme Merkezi'nden elle yenileyin.`;
        }

        const ozet = d ? P.diffOzet(d) : `Yeni mevzuat (${yeni.maddeler.length} madde)`;
        if (!TEST) {
            yeni.guncelleme = SIMDI; yeni.kaynak_url = k.url;
            if (idx >= 0) db[idx] = yeni; else db.push(yeni);
            const kes = t => String(t || '').length > 6000 ? String(t).slice(0, 6000) + ' …' : t;
            gunlukEkle.push({ tarih: SIMDI, mevzuat: yeni.mevzuat_adi, ozet: ozet, kaynak: 'mevzuat.gov.tr (otomatik)', adres: k.url,
                detay: d ? { eklenen: d.eklenen, silinen: d.silinen, degisen: d.degisen.map(x => ({ no: x.no, eski: kes(x.eski), yeni: kes(x.yeni) })), ekDegisen: d.ekDegisen } : null });
        }
        uygulananSayi++;
        let detay = d ? [d.eklenen.length ? 'Eklenen: ' + d.eklenen.join(', ') : '', d.silinen.length ? 'Silinen: ' + d.silinen.join(', ') : '', d.degisen.length ? 'Değişen: ' + d.degisen.map(x => x.no).join(', ') : '', d.ekDegisen.length ? 'Ekler: ' + d.ekDegisen.map(e => e.no + ' ' + e.durum).join(', ') : ''].filter(Boolean).join('<br>') : '';
        rows.push({ ad: k.ad, durum: (TEST ? '🔎 Değişiklik bulundu (test, yazılmadı): ' : '🔄 Güncellendi: ') + ozet, detay: [detay, tabloNotu].filter(Boolean).join('<br>') });
        await new Promise(r => setTimeout(r, 1500)); // siteye nazik davran
    }

    // ---- çıktılar
    try { if (aynalar.length) fs.writeFileSync(path.join(AYNA_DIR, 'index.json'), JSON.stringify({ tarih: SIMDI, kaynaklar: aynalar }, null, 1)); } catch (e) { /* */ }
    if (!TEST && uygulananSayi > 0) {
        dbYaz(db);
        let g = []; try { g = JSON.parse(fs.readFileSync(GUNLUK_PATH, 'utf8')); } catch (e) { g = []; }
        g = g.concat(gunlukEkle).slice(-400);
        fs.writeFileSync(GUNLUK_PATH, JSON.stringify(g, null, 2) + '\n');
    }
    const baslik = TEST ? '## Mevzuat güncelleme — TEST (hiçbir dosya değiştirilmedi)' : '## Mevzuat güncelleme';
    const md = `${baslik}\n\nTarih: ${SIMDI}\n\n| Mevzuat | Durum | Ayrıntı |\n|---|---|---|\n` +
        rows.map(r => `| ${r.ad} | ${r.durum} | ${r.detay || ''} |`).join('\n') +
        `\n\n**Özet:** ${denenenSayi} kaynak denendi, ${ulasilanSayi} tanesine ulaşıldı, ${uygulananSayi} tanesinde değişiklik var.\n` +
        (uygulananSayi && !TEST ? '\nBirleştirmeden (Merge) önce değişen maddeleri **Files changed** sekmesinden inceleyin.\n' : '');
    fs.writeFileSync(RAPOR_PATH, md);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `degisti=${!TEST && uygulananSayi > 0 ? 'true' : 'false'}\ntablo=${tablolarYenilendi}\n`);

    log('\n' + md);
    if (ulasilanSayi === 0) { log('\nHİÇBİR kaynağa ulaşılamadı.'); process.exit(1); }
}

main().catch(e => { console.error('BEKLENMEYEN HATA:', e); process.exit(2); });
