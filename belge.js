/*
 * belge.js — Word/metin dosyası okuyucu (tarayıcıda ve Node.js'te çalışır)
 *   .docx  : zip + XML (paragraf, tablo, birleşik hücre, otomatik numaralı listeler)
 *   .doc   : eski ikili Word biçimi (mevzuat.gov.tr'nin verdiği biçim) — metin + tablolar
 *   .txt/.htm/.html : metin
 * Çıktı hep aynı: parser.js'in anladığı düz metin. Tablo satırları SEKMEYLE ayrılır (hücre1<TAB>hücre2<TAB>hücre3).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.BelgeOkuyucu = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const u16 = (b, o) => b[o] | (b[o + 1] << 8);
    const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

    // ------------------------------------------------------------------
    // Ortak: bloklar -> metin
    //   blok: { t:'p', text }  |  { t:'tbl', rows:[ [ [paragraf,...], ... ], ... ] }
    // ------------------------------------------------------------------
    function temizle(s) {
        return String(s == null ? '' : s).replace(/[   ]/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
    }
    function blokTablo(rows) {
        const out = [];
        rows.forEach(cells => {
            let c = cells.map(paras => paras.map(temizle).filter(Boolean));
            while (c.length && !c[c.length - 1].length) c.pop();   // sondaki boş hücreler
            if (!c.length) return;
            if (c.length === 1) { out.push(c[0].join('\n')); return; } // tek hücreli satır = düz paragraf
            out.push(c.map((p, i) => i === c.length - 1 ? p.join('\n') : p.join(' ').replace(/\s*\n\s*/g, ' ')).join('\t'));
        });
        return out.join('\n');
    }
    function bloklarMetne(bloklar) {
        const satirlar = [];
        let bosArdarda = 0;
        const ekle = s => { s.split('\n').forEach(l => { const t = l.replace(/[  ]+$/g, ''); if (!t.trim()) { if (++bosArdarda <= 1) satirlar.push(''); } else { bosArdarda = 0; satirlar.push(t); } }); };
        bloklar.forEach(b => {
            if (b.t === 'p') ekle(temizle(b.text).replace(/\t+/g, ' '));
            else { const t = blokTablo(b.rows); if (t) { ekle(t); bosArdarda = 0; satirlar.push(''); bosArdarda = 1; } }
        });
        return satirlar.join('\n').trim() + '\n';
    }

    // ------------------------------------------------------------------
    // .docx
    // ------------------------------------------------------------------
    function xmlDecode(s) {
        return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e) => {
            if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch (x) { return m; } }
            return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
        });
    }
    function romen(n) { const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; t.forEach(([v, r]) => { while (n >= v) { s += r; n -= v; } }); return s; }
    function harfli(n) { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; } return s; }
    function numFormat(fmt, n) {
        switch (fmt) {
            case 'decimal': return String(n);
            case 'decimalZero': return (n < 10 ? '0' : '') + n;
            case 'lowerLetter': return harfli(n);
            case 'upperLetter': return harfli(n).toUpperCase();
            case 'lowerRoman': return romen(n);
            case 'upperRoman': return romen(n).toUpperCase();
            case 'bullet': case 'none': return '';
            default: return String(n);
        }
    }

    function numaralamaCoz(xml) {
        // abstractNum -> seviyeler ; num -> abstractNum (+ başlangıç geçersiz kılmaları)
        const absMap = {}, numMap = {};
        (xml.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g) || []).forEach(a => {
            const id = (a.match(/w:abstractNumId="(\d+)"/) || [])[1];
            const lv = {};
            (a.match(/<w:lvl\b[\s\S]*?<\/w:lvl>/g) || []).forEach(l => {
                const il = +(l.match(/w:ilvl="(\d+)"/) || [0, 0])[1];
                lv[il] = {
                    start: +((l.match(/<w:start w:val="(-?\d+)"/) || [0, 1])[1]),
                    fmt: (l.match(/<w:numFmt w:val="(\w+)"/) || [0, 'decimal'])[1],
                    text: xmlDecode((l.match(/<w:lvlText w:val="([^"]*)"/) || [0, ''])[1])
                };
            });
            absMap[id] = lv;
        });
        (xml.match(/<w:num\b[\s\S]*?<\/w:num>/g) || []).forEach(n => {
            const id = (n.match(/w:numId="(\d+)"/) || [])[1];
            const abs = (n.match(/<w:abstractNumId w:val="(\d+)"/) || [])[1];
            const ov = {};
            (n.match(/<w:lvlOverride\b[\s\S]*?<\/w:lvlOverride>/g) || []).forEach(o => {
                const il = +(o.match(/w:ilvl="(\d+)"/) || [0, 0])[1];
                const st = o.match(/<w:startOverride w:val="(-?\d+)"/);
                if (st) ov[il] = +st[1];
            });
            numMap[id] = { abs, ov };
        });
        return { absMap, numMap, sayac: {} };
    }
    function numEtiket(N, numId, ilvl) {
        const n = N.numMap[numId]; if (!n) return '';
        const lv = N.absMap[n.abs]; if (!lv || !lv[ilvl]) return '';
        const key = numId;
        const c = N.sayac[key] || (N.sayac[key] = {});
        // bu seviye ilerler, daha derin seviyeler sıfırlanır
        const baslangic = l => (n.ov[l] !== undefined ? n.ov[l] : (lv[l] ? lv[l].start : 1));
        c[ilvl] = (c[ilvl] === undefined ? baslangic(ilvl) : c[ilvl] + 1);
        Object.keys(c).forEach(k => { if (+k > ilvl) delete c[k]; });
        const L = lv[ilvl];
        if (L.fmt === 'bullet' || L.fmt === 'none') return '';
        return L.text.replace(/%(\d)/g, (m, d) => { const l = +d - 1; const fmt = lv[l] ? lv[l].fmt : 'decimal'; const val = c[l] === undefined ? baslangic(l) : c[l]; return numFormat(fmt, val); });
    }

    function paragrafMetni(p, N) {
        let s = '';
        const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<w:noBreakHyphen\/>/g;
        let m;
        while ((m = re.exec(p))) {
            if (m[1] !== undefined) s += xmlDecode(m[1]);
            else if (m[0] === '<w:tab/>') s += ' ';
            else if (m[0] === '<w:noBreakHyphen/>') s += '-';
            else s += '\n';
        }
        if (N) {
            const np = p.match(/<w:numPr>([\s\S]*?)<\/w:numPr>/);
            if (np) {
                const numId = (np[1].match(/<w:numId w:val="(\d+)"/) || [])[1];
                const il = +((np[1].match(/<w:ilvl w:val="(\d+)"/) || [0, 0])[1]);
                if (numId && numId !== '0') { const e = numEtiket(N, numId, il); if (e && s.trim()) s = e + ' ' + s; }
            }
        }
        return s;
    }
    function tabloCoz(t, N) {
        const rows = [];
        const kolonlar = {}; // dikey birleşik hücreler için: grid sütunu -> son hücre
        (t.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []).forEach(tr => {
            const cells = []; let g = 0;
            (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).forEach(tc => {
                const span = +((tc.match(/<w:gridSpan w:val="(\d+)"/) || [0, 1])[1]);
                const vm = tc.match(/<w:vMerge(?: w:val="(\w+)")?\s*\/>/);
                let paras;
                if (vm && vm[1] !== 'restart') paras = kolonlar[g] || [];           // devam hücresi: üsttekini kopyala
                else paras = (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(p => paragrafMetni(p, N));
                kolonlar[g] = paras;
                cells.push(paras); g += span;
            });
            rows.push(cells);
        });
        return rows;
    }
    function docxBloklari(xml, numXml) {
        const N = numXml ? numaralamaCoz(numXml) : null;
        const govde = xml.slice(Math.max(0, xml.indexOf('<w:body')));
        const bloklar = [];
        // üst düzey tablolar (iç içe tabloları sayarak)
        const re = /<w:tbl>|<\/w:tbl>/g; let derin = 0, bas = 0, son = 0, m;
        const segmentler = [];
        while ((m = re.exec(govde))) {
            if (m[0] === '<w:tbl>') { if (derin === 0) { segmentler.push({ t: 'p', x: govde.slice(son, m.index) }); bas = m.index; } derin++; }
            else { derin--; if (derin === 0) { segmentler.push({ t: 'tbl', x: govde.slice(bas, m.index + 8) }); son = m.index + 8; } }
        }
        segmentler.push({ t: 'p', x: govde.slice(son) });
        segmentler.forEach(s => {
            if (s.t === 'tbl') bloklar.push({ t: 'tbl', rows: tabloCoz(s.x, N) });
            else (s.x.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).forEach(p => bloklar.push({ t: 'p', text: paragrafMetni(p, N) }));
        });
        return bloklar;
    }
    async function docxOku(buf, JSZip) {
        const zip = await JSZip.loadAsync(buf);
        const f = zip.file('word/document.xml'); if (!f) throw new Error('Geçerli bir .docx değil (document.xml yok).');
        const xml = await f.async('string');
        const nf = zip.file('word/numbering.xml');
        const numXml = nf ? await nf.async('string') : null;
        return bloklarMetne(docxBloklari(xml, numXml));
    }

    // ------------------------------------------------------------------
    // .doc  (OLE2/CFB + Word ikili biçimi): yalnızca ana metin; tablolar hücre işaretlerinden kurulur
    // ------------------------------------------------------------------
    function cfbOku(b) {
        const imza = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        if (imza.some((v, i) => b[i] !== v)) throw new Error('Eski Word (.doc) biçimi değil.');
        const ss = 1 << u16(b, 0x1E), mss = 1 << u16(b, 0x20);
        const dirStart = u32(b, 0x30), cutoff = u32(b, 0x38), miniStart = u32(b, 0x3C), nMini = u32(b, 0x40), difStart = u32(b, 0x44), nDif = u32(b, 0x48);
        const SON = 0xFFFFFFFA;
        const sec = n => { const o = (n + 1) * ss; return b.subarray(o, o + ss); };
        const fatSecs = [];
        for (let i = 0; i < 109; i++) { const v = u32(b, 0x4C + 4 * i); if (v < SON) fatSecs.push(v); }
        for (let d = difStart, k = 0; k < nDif && d < SON; k++) { const s = sec(d); for (let j = 0; j < ss / 4 - 1; j++) { const v = u32(s, 4 * j); if (v < SON) fatSecs.push(v); } d = u32(s, ss - 4); }
        const fat = [];
        fatSecs.forEach(s => { const x = sec(s); for (let j = 0; j < ss / 4; j++) fat.push(u32(x, 4 * j)); });
        const zincir = (start, tablo) => { const o = []; let n = start, g = 0; while (n < SON && g++ < 5000000) { o.push(n); n = tablo[n]; if (n === undefined) break; } return o; };
        const oku = (start, boyut) => { const z = zincir(start, fat), out = new Uint8Array(z.length * ss); z.forEach((s, i) => out.set(sec(s), i * ss)); return boyut === undefined ? out : out.subarray(0, boyut); };
        const dir = oku(dirStart);
        const girdiler = [];
        for (let o = 0; o + 128 <= dir.length; o += 128) {
            const nl = u16(dir, o + 64); let ad = '';
            for (let i = 0; i < Math.max(0, nl / 2 - 1); i++) ad += String.fromCharCode(u16(dir, o + 2 * i));
            girdiler.push({ ad, tur: dir[o + 66], start: u32(dir, o + 116), boyut: u32(dir, o + 120) });
        }
        const kok = girdiler.find(g => g.tur === 5);
        const miniAkis = kok ? oku(kok.start, kok.boyut) : new Uint8Array(0);
        const miniFat = []; { const mf = oku(miniStart, nMini * ss); for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(u32(mf, i)); }
        function akis(ad) {
            const g = girdiler.find(x => x.ad === ad && x.tur === 2); if (!g) return null;
            if (g.boyut < cutoff) { const z = zincir(g.start, miniFat), out = new Uint8Array(z.length * mss); z.forEach((s, i) => out.set(miniAkis.subarray(s * mss, s * mss + mss), i * mss)); return out.subarray(0, g.boyut); }
            return oku(g.start, g.boyut);
        }
        return { akis };
    }
    const CP1252 = [0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F, 0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178];

    function docMetniCikar(wd, tb) {
        if (u16(wd, 0) !== 0xA5EC) throw new Error('Word belge başlığı (FIB) tanınmadı.');
        const bayrak = u16(wd, 0x0A);
        if (bayrak & 0x0100) throw new Error('Dosya şifreli; okunamıyor.');
        let pos = 32; const csw = u16(wd, pos); pos += 2 + csw * 2;
        const cslw = u16(wd, pos); const lwPos = pos + 2; pos += 2 + cslw * 4;
        const ccpText = u32(wd, lwPos + 3 * 4);
        const cbRg = u16(wd, pos); pos += 2;
        if (cbRg < 34) throw new Error('Çok eski Word sürümü; desteklenmiyor.');
        const fcClx = u32(wd, pos + 33 * 8), lcbClx = u32(wd, pos + 33 * 8 + 4);
        const clx = tb.subarray(fcClx, fcClx + lcbClx);
        let p = 0;
        while (clx[p] === 1) p += 3 + u16(clx, p + 1);
        if (clx[p] !== 2) throw new Error('Metin tablosu (CLX) bulunamadı.');
        const lcb = u32(clx, p + 1), basla = p + 5, n = Math.floor((lcb - 4) / 12);
        let metin = '';
        for (let i = 0; i < n; i++) {
            const cpS = u32(clx, basla + 4 * i), cpE = Math.min(u32(clx, basla + 4 * (i + 1)), ccpText);
            if (cpS >= ccpText) break;
            const pcd = basla + 4 * (n + 1) + 8 * i, fcRaw = u32(clx, pcd + 2);
            const sikis = (fcRaw & 0x40000000) !== 0, fc = fcRaw & 0x3FFFFFFF, len = cpE - cpS;
            if (sikis) { const o = Math.floor(fc / 2); for (let k = 0; k < len; k++) { const c = wd[o + k]; metin += String.fromCharCode(c >= 0x80 && c <= 0x9F ? CP1252[c - 0x80] : c); } }
            else { for (let k = 0; k < len; k++) metin += String.fromCharCode(u16(wd, fc + 2 * k)); }
        }
        return metin;
    }
    function docBloklari(metin) {
        const bloklar = [];
        // alanlar: 0x13 komut 0x14 sonuç 0x15 — komutu at, sonucu tut
        let temiz = '', yigin = [];
        for (const ch of metin) {
            const c = ch.charCodeAt(0);
            if (c === 0x13) { yigin.push({ komut: true }); continue; }
            if (c === 0x14) { if (yigin.length) yigin[yigin.length - 1].komut = false; continue; }
            if (c === 0x15) { yigin.pop(); continue; }
            if (yigin.some(f => f.komut)) continue;
            temiz += ch;
        }
        // Kurallar: 0x07 = hücre sonu; 0x07'nin hemen ardından gelen 0x07 = satır sonu (üst üste gelenlerin ilki satırı kapatır, kalanı yok sayılır)
        //           0x0D = paragraf sonu (satır içindeyse hücre içi paragraf, değilse düz paragraf)
        let cur = '', hucre = [], satir = [], tablo = null, ardarda = false;
        const tabloKapat = () => { if (tablo && tablo.length) bloklar.push({ t: 'tbl', rows: tablo }); tablo = null; };
        for (const ch of temiz) {
            const c = ch.charCodeAt(0);
            if (c === 7) {
                if (ardarda) {
                    if (satir.length) { if (satir.some(h => h.some(x => x.trim()))) (tablo || (tablo = [])).push(satir); satir = []; }
                    continue;
                }
                hucre.push(cur); satir.push(hucre); hucre = []; cur = ''; ardarda = true;
                continue;
            }
            ardarda = false;
            if (c === 13) {
                if (satir.length || hucre.length) { hucre.push(cur); cur = ''; continue; }    // satır içi: hücre içi paragraf
                tabloKapat();
                bloklar.push({ t: 'p', text: cur }); cur = ''; continue;
            }
            if (c === 0x0B || c === 0x0C) { cur += '\n'; continue; }
            if (c === 0x1E) { cur += '-'; continue; }
            if (c === 0x1F) continue;
            if (c < 0x20 && c !== 9) continue;
            cur += ch;
        }
        if (satir.length && satir.some(h => h.some(x => x.trim()))) (tablo || (tablo = [])).push(satir);
        tabloKapat();
        if (cur.trim()) bloklar.push({ t: 'p', text: cur });
        return bloklar;
    }
    function docOku(buf) {
        const cfb = cfbOku(buf);
        const wd = cfb.akis('WordDocument'); if (!wd) throw new Error('WordDocument akışı bulunamadı.');
        const tb = cfb.akis((u16(wd, 0x0A) & 0x0200) ? '1Table' : '0Table'); if (!tb) throw new Error('Tablo akışı bulunamadı.');
        return bloklarMetne(docBloklari(docMetniCikar(wd, tb)));
    }

    // ------------------------------------------------------------------
    // Giriş noktası
    // ------------------------------------------------------------------
    function metinCoz(buf) {
        let t = new TextDecoder('utf-8').decode(buf);
        if (t.indexOf('�') >= 0) { try { t = new TextDecoder('windows-1254').decode(buf); } catch (e) { /* utf-8 kalsın */ } }
        return t.replace(/^﻿/, '');
    }
    // buf: ArrayBuffer | Uint8Array
    async function oku(buf, dosyaAdi, JSZip, htmlToText) {
        const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        const ad = String(dosyaAdi || '');
        if (b[0] === 0x50 && b[1] === 0x4B) {
            if (!JSZip) throw new Error('JSZip yüklü değil.');
            return { tur: 'docx', metin: await docxOku(b, JSZip) };
        }
        if (b[0] === 0xD0 && b[1] === 0xCF) return { tur: 'doc', metin: docOku(b) };
        let t = metinCoz(b);
        if ((/\.html?$/i.test(ad) || /<\s*(html|body|p|div|table)\b/i.test(t.slice(0, 2000))) && htmlToText) return { tur: 'html', metin: htmlToText(t) };
        return { tur: 'txt', metin: t.replace(/\r/g, '') };
    }

    return { oku, docxOku, docOku, bloklarMetne, docxBloklari, docBloklari };
});
