/*
 * parser.js — DayanakBul ortak mevzuat ayrıştırıcı modülü
 * Hem tarayıcıda (window.MevzuatParser) hem Node.js'te (require) çalışır.
 * Uygulama ve GitHub Actions (tools/*.js) AYNI kodu kullanır: tek doğruluk kaynağı.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MevzuatParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ------------------------------------------------------------------
    // 1) METİN -> JSON (önceki index.html içindeki ayrıştırıcının aynısı)
    // ------------------------------------------------------------------
    function normalizeEkNo(val) {
        const rMap = {'I':'1', 'II':'2', 'III':'3', 'IV':'4', 'V':'5', 'VI':'6', 'VII':'7', 'VIII':'8', 'IX':'9', 'X':'10'};
        let upper = val.toUpperCase();
        return rMap[upper] || upper;
    }

    function parseMevzuatText(filename, text) {
        let cleanName = filename.replace(/\.txt$/i, '').trim();
        if (cleanName.toUpperCase().includes("İŞ SAĞLIĞI VE GÜVENLİĞİ KANUNU")) cleanName = "6331 Sayılı " + cleanName;
        else if (cleanName.toUpperCase().includes("İŞ KANUNU")) cleanName = "4857 Sayılı " + cleanName;
        let type = cleanName.toLowerCase().includes("kanunu") ? "Kanun" : "Yönetmelik";

        const result = { mevzuat_adi: cleanName, mevzuat_turu: type, dayanak_kanun: type === "Yönetmelik" ? "6331 Sayılı İş Sağlığı ve Güvenliği Kanunu Madde: 30" : null, maddeler: [], ekler: [] };
        const lines = String(text).replace(/\r/g, '').replace(/\t+/g, ' ').split('\n');   // sekmeli tablo satırları düz metin gibi okunur
        let currentMadde = null, currentFikra = null, currentEk = null, isInEk = false;
        let ekAtiflari = {}; 

        const maddeRegex = /^MADDE\s+(\d+)\s*[-:–—]*\s*(.*)/i;
        const fikraRegex = /^\((\d+)\)\s*(.*)/;
        const bentRegex = /^([a-zçğıöşü]+)\)\s*(.*)/i;
        const ekRegex = /^EK\s*(?:[-:–—]|\s+)\s*([0-9]+[a-zA-Z]?|[IVX]+)(?![’'‘])(.*)/i; // "EK-1’deki örneğine…" gibi gövde cümleleri ek başlığı sayılmaz
        const ekAltMaddeRegex = /^(\d+[\.\d]*)\s*(.*)/; 

        function checkAtif(textToCheck) {
            if (!isInEk && currentMadde) {
                let safeLine = textToCheck.replace(/\(Ek\s*:[^)]+\)/gi, ''); 
                let atifRegex = /\b(?:EK|Ek|ek)\s*(?:[-:]|\s+)\s*([0-9]+[a-zA-Z]?|[IVX]+)/gi;
                let match;
                while ((match = atifRegex.exec(safeLine)) !== null) {
                    let normEkNo = normalizeEkNo(match[1]);
                    if (!ekAtiflari[normEkNo]) { ekAtiflari[normEkNo] = []; }
                    let dStr = `Madde: ${currentMadde.madde_no}`;
                    if (currentFikra) dStr += `(${currentFikra.fikra_no})`;
                    if (currentFikra && currentFikra.bentler && currentFikra.bentler.length > 0) {
                        dStr += ` ${currentFikra.bentler[currentFikra.bentler.length - 1].bent_harfi}`;
                    } else if (currentMadde.bentler && currentMadde.bentler.length > 0 && !currentFikra) {
                        dStr += ` ${currentMadde.bentler[currentMadde.bentler.length - 1].bent_harfi}`;
                    }
                    if (!ekAtiflari[normEkNo].includes(dStr)) {
                        ekAtiflari[normEkNo].push(dStr);
                    }
                }
            }
        }

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (!line) continue;

            let ekMatch = line.match(ekRegex);
            if (ekMatch) { 
                isInEk = true; 
                let rawEkNo = ekMatch[1];
                let normEkNo = normalizeEkNo(rawEkNo);
                let bagliStr = null;
                if(ekAtiflari[normEkNo] && ekAtiflari[normEkNo].length > 0) {
                    bagliStr = ekAtiflari[normEkNo][0]; 
                    if(ekAtiflari[normEkNo].length > 1) {
                        let altAtiflar = ekAtiflari[normEkNo].slice(1).join(', ');
                        bagliStr += ` (Alt Atıflar: ${altAtiflar})`;
                    }
                }
                currentEk = { 
                    ek_no: "EK-" + rawEkNo.toUpperCase(), 
                    baslik: ekMatch[2] ? ekMatch[2].trim() : "", 
                    bagli_oldugu_madde: bagliStr, 
                    maddeler: [], metin: "" 
                }; 
                result.ekler.push(currentEk); 
                currentMadde = null; currentFikra = null; 
                continue; 
            }

            let maddeMatch = line.match(maddeRegex);
            if (maddeMatch) { 
                let baslikMetni = maddeMatch[2] ? maddeMatch[2].trim() : "";
                baslikMetni = baslikMetni.replace(/^[\s\-–—:]+/g, '').trim(); 
                let yeniMadde = { madde_no: maddeMatch[1], baslik: baslikMetni, fikralar: [], bentler: [], metin: "" }; 
                if (isInEk && currentEk) currentEk.maddeler.push(yeniMadde); else result.maddeler.push(yeniMadde); 
                currentMadde = yeniMadde; currentFikra = null; 
                let gizliFikraMatch = baslikMetni.match(/^\((\d+)\)\s*(.*)/);
                if (gizliFikraMatch) {
                    let yeniFikra = { fikra_no: gizliFikraMatch[1], metin: gizliFikraMatch[2] ? gizliFikraMatch[2].trim() : "", bentler: [] };
                    currentMadde.fikralar.push(yeniFikra);
                    currentFikra = yeniFikra;
                }
                checkAtif(baslikMetni);
                continue; 
            }
            if (isInEk && currentEk) { 
                let ekAltMaddeMatch = line.match(ekAltMaddeRegex); 
                if (ekAltMaddeMatch) { 
                    let yeniMadde = { madde_no: ekAltMaddeMatch[1].replace(/\.$/, ''), baslik: "", fikralar: [], bentler: [], metin: ekAltMaddeMatch[2] ? ekAltMaddeMatch[2].trim() : "" }; 
                    currentEk.maddeler.push(yeniMadde); currentMadde = yeniMadde; currentFikra = null; 
                    continue; 
                } 
            }
            let fikraMatch = line.match(fikraRegex);
            if (fikraMatch && currentMadde) { 
                let yeniFikra = { fikra_no: fikraMatch[1], metin: fikraMatch[2] ? fikraMatch[2].trim() : "", bentler: [] }; 
                currentMadde.fikralar.push(yeniFikra); currentFikra = yeniFikra; 
                checkAtif(yeniFikra.metin);
                continue; 
            }
            let bentMatch = line.match(bentRegex);
            if (bentMatch && bentMatch[1].length <= 2) { 
                let yeniBent = { bent_harfi: bentMatch[1].toLowerCase(), metin: bentMatch[2] ? bentMatch[2].trim() : "" }; 
                if (currentFikra) currentFikra.bentler.push(yeniBent); 
                else if (currentMadde) { 
                    if (!currentMadde.bentler) currentMadde.bentler = []; 
                    currentMadde.bentler.push(yeniBent); 
                } 
                checkAtif(yeniBent.metin);
                continue; 
            }
            
            if (currentFikra && currentFikra.bentler && currentFikra.bentler.length > 0) currentFikra.bentler[currentFikra.bentler.length - 1].metin += " " + line;
            else if (currentFikra) currentFikra.metin += " " + line;
            else if (currentMadde) { if (currentMadde.bentler && currentMadde.bentler.length > 0) currentMadde.bentler[currentMadde.bentler.length - 1].metin += " " + line; else currentMadde.metin += " " + line; }
            else if (currentEk) { currentEk.metin += " " + line + "\n"; }

            checkAtif(line);
        }
        return result;
    }

    // ------------------------------------------------------------------
    // 2) YARDIMCILAR
    // ------------------------------------------------------------------
    function escHtml(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function trLower(s) { return String(s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase(); }
    // Mevzuat adlarını karşılaştırmak için: küçük harf, aksansız, noktalamasız
    function normName(s) {
        return trLower(s)
            .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
            .replace(/^\d+\s*sayili\s*/, '')
            .replace(/[^a-z0-9]+/g, ' ').trim();
    }
    function findRegulationIndex(db, name) {
        const n = normName(name);
        let i = db.findIndex(m => m && normName(m.mevzuat_adi) === n);
        if (i >= 0) return i;
        return db.findIndex(m => { if (!m) return false; const x = normName(m.mevzuat_adi); return x.length > 12 && n.length > 12 && (x.includes(n) || n.includes(x)); });
    }
    function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

    // ------------------------------------------------------------------
    // 3) HTML -> METİN (mevzuat.gov.tr sayfaları için)
    //    Tablo hücreleri, mevcut .txt biçimindeki gibi "boş satırla ayrılmış paragraf" olur.
    // ------------------------------------------------------------------
    function decodeEntities(s) {
        const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…' };
        return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
            if (e[0] === '#') {
                const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
                try { return String.fromCodePoint(code); } catch (x) { return m; }
            }
            const k = e.toLowerCase();
            return Object.prototype.hasOwnProperty.call(named, k) ? named[k] : m;
        });
    }
    function htmlToText(html) {
        let t = String(html || '');
        t = t.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '');
        t = t.replace(/<!--[\s\S]*?-->/g, '');
        t = t.replace(/\s*\n\s*/g, ' ');   // HTML kaynağındaki satır kıvırmaları boşluktur (Word'den dışa aktarılan sayfalar sözcük ortasında satır böler)
        t = t.replace(/<br\s*\/?>/gi, '\n');
        t = t.replace(/<\/(td|th)\s*>/gi, '\n\n');
        t = t.replace(/<\/tr\s*>/gi, '\n\n');
        t = t.replace(/<\/(p|div|li|h[1-6]|table|ul|ol|section|article)\s*>/gi, '\n');
        t = t.replace(/<[^>]+>/g, '');
        t = decodeEntities(t);
        t = t.replace(/[ \t ]+/g, ' ');
        t = t.split('\n').map(l => l.trim()).join('\n');
        t = t.replace(/\n{3,}/g, '\n\n');
        return t.trim() + '\n';
    }

    // ------------------------------------------------------------------
    // 4) PERİYODİK KONTROL TABLOLARI (İş Ekipmanları Yönetmeliği EK-III)
    //    Kaynak metinde tablo hücreleri "boş satırla ayrılmış paragraf"lar olarak durur.
    //    Satır tespiti "periyot hücresi" (ör. "Standartlarda süre belirtilmemişse 1 Yıl") çapasıyla yapılır:
    //    [ekipman adı] [periyot] [kriter ...]   ->   bir satır
    // ------------------------------------------------------------------
    const PERIYOT_RE = /^(?:standartlarda\s+süre\s+belirtilmemişse(?:\s+\d+\s*(?:yıl|ay|gün|hafta))?|\d+\s*(?:yıl|ay|gün|hafta)\b.{0,40})$/i;
    const PERIYOT_EKSIK_RE = /belirtilmemişse\s*$/i;
    const SAYI_PERIYOT_RE = /^\d+\s*(?:yıl|ay|gün|hafta)\b/i;

    function extractTables(text) {
        const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/ /g, ' ').trim());
        const titleRe = /^Tablo\s*[-–]\s*(\d+)\s*[:：]\s*(.*)$/i;
        const headingRe = /^\d+\.\d+\.?\s+\S/;
        const clauseRe = /^(\d+)\.(\d+)((?:\.\d+)*)\.?\s+/;
        const tablolar = [];

        for (let i = 0; i < lines.length; i++) {
            const tm = lines[i].match(titleRe);
            if (!tm) continue;
            const no = parseInt(tm[1], 10);

            // bölge sonu: sonraki başlık, sonraki tablo ya da ayırıcı çizgi
            let end = lines.length;
            for (let j = i + 1; j < lines.length; j++) {
                if (titleRe.test(lines[j]) || headingRe.test(lines[j]) || /^_{3,}$/.test(lines[j])) { end = j; break; }
            }

            let cells = [], dipnotlar = [], kolonlar = [], notlar = [], satirlar = [];

            // --- SEKMELİ BİÇİM: siteden / Word'den / Excel'den kopyalanan tablo (her satır: ad <TAB> periyot <TAB> kriter) ---
            const bolge = lines.slice(i + 1, end);
            const sekmeli = bolge.some(l => l.indexOf('\t') >= 0);
            if (sekmeli) {
                const donemOk = c => c.length > 0 && c.length < 140 && (/\d+\s*(?:yıl|ay|gün|hafta)/i.test(c) || /süre/i.test(c));
                let son = null, bosVar = false, grup = [];
                // Sekmesiz ardışık satırlar: ya önceki satırın çok satırlı kriter hücresinin devamıdır, ya da (kopyalama sekmeleri kaybettiğinde)
                // yeni bir satırdır: [ad] [periyot satırları...] [... uygun olarak yapılır.]  (örn. LPG tankları, Kriyojenik tanklar)
                const grubuBosalt = () => {
                    if (!grup.length) return;
                    const oncekiTam = son && /yapılır\.?\s*$/i.test(son.kriter);
                    const k = grup.findIndex((x, idx) => idx >= 2 && /uygun\s+olarak\s+yapılır\.?\s*$/i.test(x));
                    if (oncekiTam && k >= 2) satirlar.push(son = { ad: grup[0], periyot: grup.slice(1, k).join(' '), kriter: grup.slice(k).join('\n') });
                    else if (son) son.kriter += '\n' + grup.join('\n');
                    grup = [];
                };
                for (const l of bolge) {
                    if (!l) { grubuBosalt(); bosVar = true; continue; }
                    if (l.indexOf('\t') < 0 && /^\(\d+\)\s+\S/.test(l)) { grubuBosalt(); dipnotlar.push(l); continue; }
                    if (l.indexOf('\t') >= 0) grubuBosalt();
                    const c = l.split('\t').map(x => x.trim());
                    const kalan = c.slice(2).filter(Boolean).join(' ');
                    if (c.length >= 3 && c[0] && donemOk(c[1]) && kalan && !/^EKİPMAN\s+ADI/i.test(c[0]) && !/PERİYODİK\s+KONTROL\s+DÖNEMİ/i.test(c[1])) {
                        son = { ad: c[0], periyot: c[1], kriter: kalan }; satirlar.push(son); bosVar = false; continue;
                    }
                    if (son && c.length === 2 && c[0] && c[1]) {
                        // birleştirilmiş hücre (rowspan): eksik olan hücre bir önceki satırdan devralınır
                        if (donemOk(c[1])) satirlar.push(son = { ad: c[0], periyot: c[1], kriter: son.kriter });
                        else satirlar.push(son = { ad: c[0], periyot: son.periyot, kriter: c[1] });
                        bosVar = false; continue;
                    }
                    if (son && !bosVar && l.indexOf('\t') < 0) grup.push(l); // çok satırlı kriter hücresi ya da sekmesi kaybolmuş yeni satır
                }
                grubuBosalt();
            }

            if (!sekmeli) {
            // hücreler: ardışık dolu satırlar = bir hücre
            let cur = [];
            for (let j = i + 1; j < end; j++) {
                if (!lines[j]) { if (cur.length) { cells.push(cur.join('\n')); cur = []; } }
                else cur.push(lines[j]);
            }
            if (cur.length) cells.push(cur.join('\n'));

            // dipnotlar: "(1) ...." ile başlayan hücreler
            cells = cells.filter(c => { if (/^\(\d+\)\s+\S/.test(c)) { dipnotlar.push(c.replace(/\n/g, ' ')); return false; } return true; });

            // bölünmüş periyot hücresi: "Standartlarda süre belirtilmemişse" + "1 Yıl"
            const merged = [];
            for (let k = 0; k < cells.length; k++) {
                if (PERIYOT_EKSIK_RE.test(cells[k]) && !/\d/.test(cells[k]) && cells[k + 1] && SAYI_PERIYOT_RE.test(cells[k + 1]) && cells[k + 1].length < 40) {
                    merged.push(cells[k] + ' ' + cells[k + 1]); k++;
                } else merged.push(cells[k]);
            }
            cells = merged;

            const P = [];
            cells.forEach((c, k) => { if (c.length < 90 && !c.includes('\n') && PERIYOT_RE.test(c) && k >= 1) P.push(k); });

            if (P.length) {
                // başlık: ilk satırın ekipman adından önceki hücreler
                cells.slice(0, P[0] - 1).forEach(h => {
                    const hh = h.replace(/\n/g, ' ');
                    if (hh.startsWith('(') && kolonlar.length) {
                        if (!/\(/.test(kolonlar[kolonlar.length - 1])) kolonlar[kolonlar.length - 1] += ' ' + hh; else notlar.push(hh);
                    } else kolonlar.push(hh);
                });
                // Birleşik hücreli (periyodu çok satırlı ya da standart adı olan) satırlar: [ad][periyot...][... uygun olarak yapılır.]
                // önceki satırın kriter hücrelerine karışmasın (örn. LPG tankları, Kriyojenik tanklar)
                const kriterTam = c => /uygun\s+olarak\s+yapılır\.?\s*$/i.test(c);
                P.forEach((p, idx) => {
                    const sonraki = idx + 1 < P.length ? P[idx + 1] - 1 : cells.length;
                    let ad = cells[p - 1].replace(/\n/g, ' '), periyot = cells[p].replace(/\n/g, ' ');
                    let rest = cells.slice(p + 1, sonraki);
                    for (;;) {
                        const ilk = rest.findIndex(kriterTam);
                        const kalan = ilk >= 0 ? rest.slice(ilk + 1) : [];
                        const k = kalan.findIndex((x, q) => q >= 2 && kriterTam(x));
                        if (ilk < 0 || kalan.length < 3 || k < 0 || kalan[0].length > 160 || /[.;:]\s*$/.test(kalan[0])) {
                            satirlar.push({ ad: ad, periyot: periyot, kriter: rest.join('\n') }); break;
                        }
                        satirlar.push({ ad: ad, periyot: periyot, kriter: rest.slice(0, ilk + 1).join('\n') });
                        ad = kalan[0].replace(/\n/g, ' '); periyot = kalan.slice(1, k).join(' ').replace(/\n/g, ' '); rest = kalan.slice(k);
                    }
                });
            }
            }

            // bağlı olduğu bölüm: bu tabloya atıf yapan en yakın önceki "2.N.M." maddesi
            let bolum = null, madde = null;
            const refRe = new RegExp('Tablo\\s*-?\\s*' + no + '(?!\\d)', 'i');
            for (let j = i - 1; j >= 0; j--) {
                const cm = lines[j].match(clauseRe);
                if (cm && refRe.test(lines[j])) { bolum = cm[1] + '.' + cm[2]; madde = cm[1] + '.' + cm[2] + (cm[3] || ''); break; }
            }
            if (!bolum) {
                for (let j = i - 1; j >= 0; j--) { const cm = lines[j].match(clauseRe); if (cm) { bolum = cm[1] + '.' + cm[2]; break; } }
            }

            if (!bolum) bolum = '2.' + no;   // EK-III düzeni: Tablo-n  ->  2.n bölümü (yalnız tek tablo yapıştırılsa da eşleşsin)
            const guvenilir = satirlar.length > 0 && satirlar.every(s => s.ad && s.periyot && s.kriter);
            tablolar.push({
                no: no,
                baslik: tm[2].trim() ? ('Tablo-' + no + ': ' + tm[2].trim()) : ('Tablo-' + no),
                bolum: bolum, madde: madde,
                kolonlar: kolonlar.length >= 3 ? kolonlar.slice(0, 3).map(k => k.replace(/\s*\(İlgili standartlar[^)]*\)/i, '')) : ['EKİPMAN ADI', 'PERİYODİK KONTROL DÖNEMİ (Azami Süre)', 'PERİYODİK KONTROL KRİTERLERİ'],
                satirlar: satirlar, dipnotlar: dipnotlar, notlar: notlar,
                guvenilir: guvenilir,
                ham: guvenilir ? undefined : cells
            });
        }
        return tablolar;
    }

    // ------------------------------------------------------------------
    // 5) FARK (DIFF) ve BİRLEŞTİRME
    // ------------------------------------------------------------------
    // Karşılaştırma için: dipnot/değişiklik işaretleri ve boşluk-noktalama farkları yok sayılır (gösterim etkilenmez)
    function karsilastirmaAnahtari(t) {
        return String(t || '')
            .replace(/\((?:Değişik|Ek|Mülga|İptal|Yürürlükten|Ek fıkra|Değişik fıkra|Değişik ibare|Ek ibare|Değişik cümle|Ek cümle|Değişik birinci|Değişik ikinci|Değişik üçüncü|Mülga fıkra|Ek bent|Değişik bent)[^)]*\)/gi, '')
            .replace(/\[\d+\]/g, '').replace(/\(…\)/g, '')
            .replace(/[^\p{L}\p{N}]+/gu, '').toLocaleLowerCase('tr');
    }
    function ws(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
    // Kayıtlı bir yönetmeliği, arşiv araması için satır satır düz metne çevirir (madde başlığı, fıkra ve bent satırları, ekler)
    function duzMetin(reg) {
        const out = [reg.mevzuat_adi || ''];
        const maddeSatirlari = (m, onek) => {
            out.push(`${onek}MADDE ${m.madde_no} – ${[m.baslik, m.metin].filter(Boolean).join(' ')}`.trim());
            (m.fikralar || []).forEach(f => {
                if (f.metin) out.push(`(${f.fikra_no}) ${f.metin}`);
                (f.bentler || []).forEach(b => out.push(`${b.bent_harfi}) ${b.metin}`));
            });
            (m.bentler || []).forEach(b => out.push(`${b.bent_harfi}) ${b.metin}`));
        };
        (reg.maddeler || []).forEach(m => maddeSatirlari(m, ''));
        (reg.ekler || []).forEach(e => {
            out.push('', `${e.ek_no}${e.baslik ? ' – ' + e.baslik : ''}${e.bagli_oldugu_madde ? ' (' + e.bagli_oldugu_madde + ')' : ''}`);
            if (e.metin) out.push(e.metin);
            (e.maddeler || []).forEach(m => maddeSatirlari(m, e.ek_no + ' '));
        });
        return out.join('\n');
    }
    function maddeFlat(m) {
        const p = [m.baslik, m.metin];
        (m.fikralar || []).forEach(f => { p.push('(' + f.fikra_no + ')', f.metin); (f.bentler || []).forEach(b => p.push(b.bent_harfi + ')', b.metin)); });
        (m.bentler || []).forEach(b => p.push(b.bent_harfi + ')', b.metin));
        return ws(p.filter(Boolean).join(' '));
    }
    function ekFlat(e) {
        const p = [e.baslik, e.metin];
        (e.maddeler || []).forEach(m => p.push(m.madde_no, maddeFlat(m)));
        return ws(p.filter(Boolean).join(' '));
    }
    // Aynı madde numarası birden çok kez geçebilir (ör. "Dayanak" bölümü, geçici maddeler):
    // anahtar = numara + kaçıncı kez geçtiği ("3", "3#2", ...)
    function maddeAnahtarlari(list) {
        const sayac = {}, out = [];
        (list || []).forEach(m => {
            const no = String(m.madde_no);
            sayac[no] = (sayac[no] || 0) + 1;
            out.push({ key: sayac[no] === 1 ? no : no + '#' + sayac[no], etiket: sayac[no] === 1 ? no : no + ' (' + sayac[no] + '. kayıt)', m: m });
        });
        return out;
    }
    // EK-III ile EK-3 aynı ektir; aynı numaralı birden çok kayıt tek grupta toplanır
    function ekAnahtar(e) { return 'EK-' + normalizeEkNo(String(e.ek_no || '').replace(/^EK[\s\-:]*/i, '').trim()); }
    function ekGrupla(list) {
        const m = new Map();
        (list || []).forEach(e => { const k = ekAnahtar(e); if (!m.has(k)) m.set(k, []); m.get(k).push(e); });
        return m;
    }
    function ekGrupFlat(g) { return ws(g.map(ekFlat).join(' ')); }
    function ekSirala(a, b) {
        const n = x => { const v = parseInt(String(ekAnahtar(x)).replace(/^EK-/, ''), 10); return isNaN(v) ? 1e9 : v; };
        return n(a) - n(b);
    }
    // Yönetmeliğin yalnızca verilen eklerini değiştirir/ekler; diğer eklere dokunmaz.
    function mergeEkler(reg, yeniEkler) {
        const out = deepCopy(reg);
        out.ekler = out.ekler || [];
        const gruplar = ekGrupla(yeniEkler);
        gruplar.forEach((g, key) => {
            const eskiler = out.ekler.filter(e => ekAnahtar(e) === key);
            const bagli = eskiler.map(e => e.bagli_oldugu_madde).find(Boolean) || null;
            const kopya = g.map(e => { const c = deepCopy(e); if (!c.bagli_oldugu_madde && bagli) c.bagli_oldugu_madde = bagli; return c; });
            const i = out.ekler.findIndex(e => ekAnahtar(e) === key);
            if (i >= 0) { out.ekler = out.ekler.filter(e => ekAnahtar(e) !== key); out.ekler.splice(i, 0, ...kopya); }
            else out.ekler.push(...kopya);
        });
        out.ekler = out.ekler.map((e, k) => ({ e, k })).sort((a, b) => ekSirala(a.e, b.e) || a.k - b.k).map(x => x.e);
        return out;
    }
    function diffRegulations(eski, yeni) {
        const r = { eklenen: [], silinen: [], degisen: [], ekDegisen: [], eskiSayi: 0, yeniSayi: 0 };
        const ea = maddeAnahtarlari(eski && eski.maddeler), ya = maddeAnahtarlari(yeni && yeni.maddeler);
        const em = new Map(ea.map(x => [x.key, x])), ym = new Map(ya.map(x => [x.key, x]));
        r.eskiSayi = ea.length; r.yeniSayi = ya.length;
        ym.forEach((x, key) => {
            if (!em.has(key)) r.eklenen.push(x.etiket);
            else if (karsilastirmaAnahtari(maddeFlat(em.get(key).m)) !== karsilastirmaAnahtari(maddeFlat(x.m))) r.degisen.push({ no: x.etiket, eski: maddeFlat(em.get(key).m), yeni: maddeFlat(x.m) });
        });
        em.forEach((x, key) => { if (!ym.has(key)) r.silinen.push(x.etiket); });
        const ee = ekGrupla(eski && eski.ekler), ye = ekGrupla(yeni && yeni.ekler);
        ye.forEach((g, no) => { if (!ee.has(no)) r.ekDegisen.push({ no: no, durum: 'eklendi' }); else if (karsilastirmaAnahtari(ekGrupFlat(ee.get(no))) !== karsilastirmaAnahtari(ekGrupFlat(g))) r.ekDegisen.push({ no: no, durum: 'değişti' }); });
        ee.forEach((g, no) => { if (!ye.has(no)) r.ekDegisen.push({ no: no, durum: 'silindi' }); });
        r.degisiklikVar = !!(r.eklenen.length || r.silinen.length || r.degisen.length || r.ekDegisen.length);
        return r;
    }
    function diffOzet(d) {
        const p = [];
        if (d.eklenen.length) p.push(d.eklenen.length + ' madde eklendi');
        if (d.silinen.length) p.push(d.silinen.length + ' madde silindi');
        if (d.degisen.length) p.push(d.degisen.length + ' madde değişti');
        if (d.ekDegisen.length) p.push(d.ekDegisen.length + ' ek değişti');
        return p.length ? p.join(', ') : 'Fark yok';
    }
    // Kelime düzeyinde fark (HTML): silinen kırmızı üstü çizili, eklenen yeşil
    function wordDiffHtml(a, b) {
        const x = ws(a).split(' ').filter(Boolean), y = ws(b).split(' ').filter(Boolean);
        if (x.length * y.length > 2500000) return '<del style="background:#fee2e2;color:#991b1b">' + escHtml(a) + '</del> <ins style="background:#dcfce7;color:#166534;text-decoration:none">' + escHtml(b) + '</ins>';
        const n = x.length, m = y.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
        let i = 0, j = 0; const out = [];
        const D = w => '<del style="background:#fee2e2;color:#991b1b">' + escHtml(w) + '</del>';
        const I = w => '<ins style="background:#dcfce7;color:#166534;text-decoration:none">' + escHtml(w) + '</ins>';
        while (i < n && j < m) {
            if (x[i] === y[j]) { out.push(escHtml(x[i])); i++; j++; }
            else if (L[i + 1][j] >= L[i][j + 1]) { out.push(D(x[i])); i++; }
            else { out.push(I(y[j])); j++; }
        }
        while (i < n) out.push(D(x[i++]));
        while (j < m) out.push(I(y[j++]));
        return out.join(' ');
    }
    function maddeSirala(a, b) {
        const pa = String(a.madde_no).split('.').map(Number), pb = String(b.madde_no).split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
        return 0;
    }
    // Yönetmelikte yalnızca verilen maddeleri değiştirir/ekler (başkalarına dokunmaz).
    // Yapıştırılan metinde aynı numaralı birden çok madde varsa, kaydın sırasıyla eşleşir (1.si 1.sini, 2.si 2.sini).
    function mergeMaddeler(reg, yeniMaddeler) {
        const out = deepCopy(reg);
        out.maddeler = out.maddeler || [];
        const sayac = {};
        yeniMaddeler.forEach(nm => {
            const no = String(nm.madde_no);
            sayac[no] = (sayac[no] || 0) + 1;
            let n = 0, i = -1;
            out.maddeler.forEach((m, k) => { if (String(m.madde_no) === no && ++n === sayac[no] && i < 0) i = k; });
            if (i >= 0) out.maddeler[i] = deepCopy(nm); else out.maddeler.push(deepCopy(nm));
        });
        // yalnızca yeni eklenenler sıraya girsin: kararlı sıralama
        out.maddeler = out.maddeler.map((m, k) => ({ m, k })).sort((a, b) => maddeSirala(a.m, b.m) || a.k - b.k).map(x => x.m);
        return out;
    }

    return {
        normalizeEkNo: normalizeEkNo, parseMevzuatText: parseMevzuatText,
        htmlToText: htmlToText, extractTables: extractTables,
        diffRegulations: diffRegulations, diffOzet: diffOzet, wordDiffHtml: wordDiffHtml,
        mergeMaddeler: mergeMaddeler, duzMetin: duzMetin, mergeEkler: mergeEkler, ekAnahtar: ekAnahtar, normName: normName, findRegulationIndex: findRegulationIndex,
        maddeFlat: maddeFlat, deepCopy: deepCopy, escHtml: escHtml
    };
});
