/*
 * merkez.js — DayanakBul eklentisi
 *   1) EK-III periyodik kontrol tablolarını nihai raporda maddenin altında gösterir
 *   2) "Mevzuat Güncelleme Merkezi": kanun/yönetmeliğin tamamını ya da yalnızca belirli maddelerini
 *      uygulama içinden değiştirme, farkları görme, geri alma ve dışa aktarma
 * index.html'deki ana betikten SONRA yüklenir; onun genel değişkenlerini (mevzuatDB, finalReportData,
 * precomputeTfIdf, idbKV ...) kullanır. parser.js (window.MevzuatParser) gerekir.
 */
(function () {
    'use strict';
    const MP = window.MevzuatParser;
    const KEY_YEREL = 'YerelDegisiklikler';
    const KEY_TABLO = 'PeriyodikTablolar';
    const esc = MP.escHtml;
    const log = (m, t) => { try { logDebug(m, t || 'info'); } catch (e) { /* günlük yoksa sessiz */ } };

    // =====================================================================
    // A) YEREL DEĞİŞİKLİK KATMANI (IndexedDB) — bulut veritabanı yenilense de silinmez
    // =====================================================================
    window.yerelDegisiklikleriYukle = async function () {
        const v = await idbKV('readonly', s => s.get(KEY_YEREL));
        return Array.isArray(v) ? v : [];
    };
    async function yerelKaydet(list) { await idbKV('readwrite', s => s.put(list, KEY_YEREL)); }

    // Kayıtları ana veritabanının üstüne uygular. Bulut sürümü daha yeniyse (guncelleme tarihi) dokunmaz.
    window.yerelDegisiklikleriUygula = function (list) {
        let n = 0;
        (list || []).forEach(rec => {
            if (rec.mod === 'tablo') return;
            const idx = MP.findRegulationIndex(mevzuatDB, rec.mevzuat_adi);
            if (idx >= 0 && mevzuatDB[idx].guncelleme && mevzuatDB[idx].guncelleme >= rec.ts) return;
            let yeni;
            if (rec.mod === 'madde' && idx >= 0) yeni = MP.mergeMaddeler(mevzuatDB[idx], rec.yeniMaddeler || []);
            else if (rec.sonraki) yeni = MP.deepCopy(rec.sonraki);
            else return;
            yeni.guncelleme = rec.ts;
            if (rec.not) yeni.guncelleme_notu = rec.not;
            if (idx >= 0) mevzuatDB[idx] = yeni; else mevzuatDB.push(yeni);
            n++;
        });
        if (n) log(`Yerel mevzuat değişikliği uygulandı: ${n} kayıt.`, 'success');
    };

    // =====================================================================
    // B) PERİYODİK KONTROL TABLOLARI
    // =====================================================================
    window.periyodikTablolar = null;
    async function tablolariYukle() {
        let bulut = null, yerel = null;
        try { const r = await fetch('./periyodik_tablolar.json?v=' + Date.now(), { cache: 'no-store' }); if (r.ok) bulut = await r.json(); } catch (e) { /* çevrimdışı */ }
        try { yerel = await idbKV('readonly', s => s.get(KEY_TABLO)); } catch (e) { /* yok */ }
        const yerelYeni = yerel && yerel.tablolar && (!bulut || !bulut.guncelleme || String(yerel.guncelleme) > String(bulut.guncelleme));
        window.periyodikTablolar = yerelYeni ? yerel : bulut;
        if (window.periyodikTablolar) log(`Periyodik kontrol tabloları hazır (${window.periyodikTablolar.tablolar.length} tablo, kaynak tarihi: ${window.periyodikTablolar.guncelleme}).`, 'success');
        try { if (Object.keys(finalReportData || {}).length) renderFinalReport(); } catch (e) { /* rapor boş */ }
    }

    function tabloBul(dayanak) {
        const pt = window.periyodikTablolar;
        if (!pt || !pt.tablolar) return null;
        const d = String(dayanak || '');
        if (!/İş Ekipmanlarının Kullanımında/i.test(d)) return null;
        const m = d.match(/EK-(?:III|3),\s*Madde:\s*(\d+)\.(\d+)/);
        if (!m) return null;
        return pt.tablolar.find(t => t.guvenilir && t.bolum === m[1] + '.' + m[2]) || null;
    }
    function satirSkorlari(tablo, ihlal) {
        const vt = new Set(ipcTokens(ihlal || ''));
        return tablo.satirlar.map(s => ipcTokens(s.ad).filter(t => vt.has(t)).length);
    }
    const TD = 'border:1px solid #475569;padding:4px 6px;vertical-align:top;font-size:0.85em;color:#0f172a;background:#ffffff;';
    const TH = 'border:1px solid #475569;padding:4px 6px;font-size:0.85em;color:#0f172a;background:#e2e8f0;text-align:left;';

    window.renderPeriyodikTablo = function (k) {
        const fr = finalReportData[k];
        if (!fr || !fr.selectedData) return '';
        const tablo = tabloBul(fr.selectedData.dayanak);
        if (!tablo) return '';
        const sk = satirSkorlari(tablo, fr.violation && fr.violation.text);
        const mx = Math.max(0, ...sk);
        const mode = fr.tabloMode || (mx > 0 ? 'eslesen' : 'tum');
        const btn = (m, label) => `<button type="button" class="btn btn-sm" style="padding:3px 9px;font-size:0.75rem;border:1px solid var(--primary);${mode === m ? 'background:var(--primary);color:#fff;' : 'background:transparent;color:var(--primary);'}" onclick="setTabloMode(${k},'${m}')">${label}</button>`;
        const kontrol = `<div class="no-export" style="margin:4px 0 8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:0.8rem;"><span style="color:var(--text-muted)">📊 ${esc(tablo.baslik.split(':')[0])}:</span>${mx > 0 ? btn('eslesen', 'Yalnız eşleşen satır') : ''}${btn('tum', 'Tüm tablo')}${btn('kapali', 'Gizle')}</div>`;
        if (mode === 'kapali') return `<div class="periyodik-tablo-kontrol">${kontrol}</div>`;

        const satirlar = (mode === 'eslesen' && mx > 0) ? tablo.satirlar.filter((s, i) => sk[i] === mx) : tablo.satirlar;
        const gorunenNo = new Set();
        satirlar.forEach(s => { const re = /\((\d+)\)/g; let m; while ((m = re.exec(s.ad))) gorunenNo.add(m[1]); });
        const dipnot = tablo.dipnotlar.filter(d => { const m = d.match(/^\((\d+)\)/); return mode === 'tum' || (m && gorunenNo.has(m[1])); });
        const html = `<div class="periyodik-tablo" style="margin:0 0 8px 0;">
            <div style="font-weight:bold;margin-bottom:4px;">${esc(tablo.baslik)}</div>
            <div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;">
                <tr>${tablo.kolonlar.map(c => `<th style="${TH}">${esc(c)}</th>`).join('')}</tr>
                ${satirlar.map(s => `<tr><td style="${TD}">${esc(s.ad)}</td><td style="${TD}">${esc(s.periyot)}</td><td style="${TD}">${esc(s.kriter).replace(/\n/g, '<br>')}</td></tr>`).join('')}
            </table></div>
            ${dipnot.map(d => `<div style="font-size:0.8em;margin-top:2px;">${esc(d)}</div>`).join('')}
        </div>`;
        const pt = window.periyodikTablolar;
        const kaynak = `<div class="no-export" style="font-size:0.72rem;color:var(--text-muted);margin:-4px 0 8px;">Tablo kaynağı: ${esc(pt.kaynak || '')} (${esc(pt.guncelleme || '')}). Güncel değilse Mevzuat Güncelleme Merkezi'nden yenileyin.</div>`;
        return kontrol + html + kaynak;
    };
    window.setTabloMode = function (k, m) { if (finalReportData[k]) { finalReportData[k].tabloMode = m; renderFinalReport(); } };

    // =====================================================================
    // C) MEVZUAT GÜNCELLEME MERKEZİ
    // =====================================================================
    const CSS = `
    #gmModal .gm-box { max-width: 760px; height: 92vh; padding: 20px; }
    #gmModal .gm-scroll { overflow-y: auto; padding-right: 4px; flex: 1; }
    #gmModal h2 { border: none; margin: 0 0 8px; color: var(--primary); font-size: 1.2rem; }
    #gmModal h3 { margin: 18px 0 6px; font-size: 1rem; color: var(--text-main); }
    #gmModal label.gm-l { display: block; font-weight: 700; margin: 14px 0 5px; font-size: 0.9rem; }
    #gmModal select, #gmModal input[type=text], #gmModal textarea { width: 100%; padding: 9px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text-main); font-family: inherit; font-size: 0.9rem; box-sizing: border-box; }
    #gmModal textarea { min-height: 150px; resize: vertical; }
    #gmModal .gm-help { font-size: 0.85rem; color: var(--text-muted); background: rgba(79,70,229,0.06); border-left: 4px solid var(--primary); padding: 10px 12px; border-radius: 6px; margin: 6px 0 10px; line-height: 1.55; }
    #gmModal .gm-radios label { display: block; padding: 6px 0; font-size: 0.9rem; cursor: pointer; }
    #gmModal .gm-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    #gmModal .gm-actions .btn { flex: 1; min-width: 150px; }
    #gmModal .gm-box-fark { margin-top: 12px; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-size: 0.88rem; line-height: 1.6; }
    #gmModal .gm-uyari { background: rgba(202,138,4,0.12); color: #a16207; border: 1px solid #a16207; padding: 8px 10px; border-radius: 6px; margin: 8px 0; font-weight: 600; }
    #gmModal .gm-hata { background: rgba(239,68,68,0.1); color: var(--danger); border: 1px solid var(--danger); padding: 8px 10px; border-radius: 6px; margin: 8px 0; font-weight: 600; }
    #gmModal .gm-ok { background: rgba(16,185,129,0.1); color: #047857; border: 1px solid var(--success); padding: 8px 10px; border-radius: 6px; margin: 8px 0; font-weight: 600; }
    #gmModal details { margin: 6px 0; border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; }
    #gmModal summary { cursor: pointer; font-weight: 700; }
    #gmModal .gm-satir { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
    #gmModal table.gm-tablo { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    #gmModal table.gm-tablo td, #gmModal table.gm-tablo th { border-bottom: 1px solid var(--border); padding: 5px 6px; text-align: left; }
    `;

    const MODAL_HTML = `
    <div class="modal-overlay" id="gmModal" style="z-index:1200;">
      <div class="modal-content gm-box">
        <span class="close-modal" onclick="gmKapat()">&times;</span>
        <h2>🔄 Mevzuat Güncelleme Merkezi</h2>
        <div class="gm-scroll">
          <div class="gm-help"><b>Bir kanun/yönetmelik değiştiğinde:</b><br>
            1) mevzuat.gov.tr'de güncel metni açıp kopyalayın &nbsp; 2) aşağıya yapıştırın &nbsp; 3) farkları inceleyin &nbsp; 4) kaydedin.<br>
            Değişiklik bu cihazda hemen geçerli olur ve bulut veritabanı yenilense bile silinmez. Tüm cihazlarda geçerli olması için aşağıdaki "Dışa aktar" bölümüne bakın.</div>
          <a class="btn btn-secondary btn-sm" href="https://www.mevzuat.gov.tr/" target="_blank" rel="noopener">🌐 mevzuat.gov.tr'yi aç</a>

          <label class="gm-l">1 · Hangi mevzuat?</label>
          <select id="gmMevzuat" onchange="gmSecimDegisti()"></select>
          <div id="gmYeniAdSatir" style="display:none;margin-top:8px;"><input type="text" id="gmYeniAd" placeholder="Yeni mevzuatın tam adı (örn. ... Yönetmeliği)"></div>

          <label class="gm-l">2 · Ne değişecek?</label>
          <div class="gm-radios">
            <label><input type="radio" name="gmMod" value="tam" checked onchange="gmSecimDegisti()"> Tamamı — mevzuatın tüm güncel metnini yapıştıracağım</label>
            <label id="gmMaddeSecenek"><input type="radio" name="gmMod" value="madde" onchange="gmSecimDegisti()"> Yalnızca belirli madde(ler) — sadece değişen maddeleri yapıştıracağım</label>
            <label id="gmTabloSecenek" style="display:none;"><input type="radio" name="gmMod" value="tablo" onchange="gmSecimDegisti()"> Yalnızca periyodik kontrol tabloları (EK-III) — metni yapıştırıp tabloları yenile</label>
          </div>
          <div id="gmMaddeNoSatir" style="display:none;"><input type="text" id="gmMaddeNo" placeholder="Yapıştırdığınız metinde 'MADDE 7 –' başlığı yoksa madde numarasını yazın (örn. 7)"></div>

          <label class="gm-l">3 · Güncel metin</label>
          <textarea id="gmMetin" placeholder="Güncel metni buraya yapıştırın. Madde başlıkları 'MADDE 1 –' biçiminde olmalıdır (mevzuat.gov.tr'den kopyalanan metin genelde böyledir)."></textarea>
          <div style="margin-top:6px;font-size:0.85rem;">veya dosya: <input type="file" id="gmDosya" accept=".txt,.html,.htm" onchange="gmDosyaOku(this)"></div>

          <label class="gm-l">Kaynak notu (isteğe bağlı)</label>
          <input type="text" id="gmNot" placeholder="Örn: Resmî Gazete 23.12.2025 / 33116">

          <div class="gm-actions">
            <button class="btn btn-primary" onclick="gmFarkGoster()">🔍 Farkları Göster</button>
            <button class="btn btn-success" id="gmUygulaBtn" onclick="gmUygula()" disabled>✅ Uygula ve Kaydet</button>
          </div>
          <div id="gmFark"></div>

          <h3>☁ Son otomatik güncellemeler (GitHub)</h3>
          <div id="gmBulutGunluk" style="font-size:0.85rem;color:var(--text-muted);">Yükleniyor…</div>

          <h3>📜 Bu cihazdaki değişiklikler</h3>
          <div id="gmGecmis"></div>

          <h3>📥 Dışa aktar (tüm cihazlarda geçerli kılmak için)</h3>
          <div class="gm-help">Dosyaları indirip GitHub deponuza yükleyin: depo sayfası → <b>Add file → Upload files</b> → dosyaları sürükleyin → <b>Commit changes</b>. Uygulama bir sonraki açılışta yeni sürümü kendiliğinden alır.</div>
          <div class="gm-actions">
            <button class="btn btn-secondary" onclick="gmDisaAktar('db')">mevzuat_veritabani.json</button>
            <button class="btn btn-secondary" onclick="gmDisaAktar('tablo')">periyodik_tablolar.json</button>
            <button class="btn btn-secondary" onclick="gmDisaAktar('gunluk')">Değişiklik günlüğü</button>
          </div>

          <h3>📚 Kayıtlı mevzuatlar</h3>
          <div id="gmListe"></div>
        </div>
      </div>
    </div>`;

    let _onizleme = null; // "Farkları Göster" sonucu; "Uygula" bunu kullanır

    function gmMod() { const r = document.querySelector('#gmModal input[name=gmMod]:checked'); return r ? r.value : 'tam'; }
    function isEkipmanlariMi(ad) { return MP.normName(ad || '').includes('is ekipmanlarinin kullaniminda'); }
    function secilenAd() {
        const v = document.getElementById('gmMevzuat').value;
        return v === '__yeni__' ? document.getElementById('gmYeniAd').value.trim() : v;
    }

    window.gmAc = function () {
        if (!Array.isArray(mevzuatDB) || !mevzuatDB.length) { alert('Önce mevzuat veritabanı yüklenmeli. Birkaç saniye bekleyip tekrar deneyin.'); return; }
        if (typeof toggleSidebar === 'function') { const sb = document.getElementById('settingsSidebar'); if (sb && sb.classList.contains('open')) toggleSidebar(); }
        const sel = document.getElementById('gmMevzuat');
        const onceki = sel.value;
        sel.innerHTML = mevzuatDB.map((m, i) => m ? `<option value="${esc(m.mevzuat_adi)}">${esc(m.mevzuat_adi)}</option>` : '').join('') + '<option value="__yeni__">➕ Yeni mevzuat ekle…</option>';
        if (onceki && [...sel.options].some(o => o.value === onceki)) sel.value = onceki;
        document.getElementById('gmModal').style.display = 'flex';
        gmSecimDegisti(); gmGecmisCiz(); gmListeCiz(); gmBulutGunluguCiz();
    };
    async function gmBulutGunluguCiz() {
        const el = document.getElementById('gmBulutGunluk');
        try {
            const r = await fetch('./guncelleme_gunlugu.json?v=' + Date.now(), { cache: 'no-store' });
            const g = r.ok ? await r.json() : [];
            el.innerHTML = g.length
                ? g.slice(-6).reverse().map(x => `<div class="gm-satir"><div><b>${esc(x.mevzuat)}</b><br>${esc(new Date(x.tarih).toLocaleDateString('tr-TR'))} · ${esc(x.ozet)}</div></div>`).join('')
                : 'Henüz otomatik güncelleme yapılmadı. (GitHub\'daki otomatik görev değişiklik bulursa buraya düşer.)';
        } catch (e) { el.textContent = 'Günlük okunamadı (çevrimdışı olabilirsiniz).'; }
    }
    window.gmKapat = function () { document.getElementById('gmModal').style.display = 'none'; };

    window.gmSecimDegisti = function () {
        const yeni = document.getElementById('gmMevzuat').value === '__yeni__';
        document.getElementById('gmYeniAdSatir').style.display = yeni ? 'block' : 'none';
        document.getElementById('gmMaddeSecenek').style.display = yeni ? 'none' : 'block';
        const ie = !yeni && isEkipmanlariMi(document.getElementById('gmMevzuat').value);
        document.getElementById('gmTabloSecenek').style.display = ie ? 'block' : 'none';
        if (yeni) document.querySelector('#gmModal input[name=gmMod][value=tam]').checked = true;
        if (!ie && gmMod() === 'tablo') document.querySelector('#gmModal input[name=gmMod][value=tam]').checked = true;
        document.getElementById('gmMaddeNoSatir').style.display = gmMod() === 'madde' ? 'block' : 'none';
        _onizleme = null; document.getElementById('gmUygulaBtn').disabled = true; document.getElementById('gmFark').innerHTML = '';
    };

    window.gmDosyaOku = function (inp) {
        const f = inp.files && inp.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => { document.getElementById('gmMetin').value = rd.result; };
        rd.readAsText(f, 'utf-8');
    };

    function metinHazirla() {
        let t = document.getElementById('gmMetin').value;
        if (/<\s*(p|div|table|br|span|td)\b/i.test(t)) t = MP.htmlToText(t); // HTML yapıştırıldıysa metne çevir
        return t.replace(/\r/g, '');
    }

    function farkHtml(d) {
        let h = `<div class="gm-ok">${esc(MP.diffOzet(d))}</div>`;
        if (d.eklenen.length) h += `<div><b>Eklenen maddeler:</b> ${d.eklenen.map(esc).join(', ')}</div>`;
        if (d.silinen.length) h += `<div><b>Silinen maddeler:</b> ${d.silinen.map(esc).join(', ')}</div>`;
        if (d.ekDegisen.length) h += `<div><b>Ekler:</b> ${d.ekDegisen.map(e => esc(e.no + ' ' + e.durum)).join(', ')}</div>`;
        d.degisen.slice(0, 40).forEach(x => {
            h += `<details><summary>Madde ${esc(x.no)} değişti</summary><div style="margin-top:6px;">${MP.wordDiffHtml(x.eski, x.yeni)}</div></details>`;
        });
        if (d.degisen.length > 40) h += `<div style="color:var(--text-muted);">… ve ${d.degisen.length - 40} değişen madde daha (hepsi kaydedilir).</div>`;
        return h;
    }

    window.gmFarkGoster = function () {
        const out = document.getElementById('gmFark');
        const btn = document.getElementById('gmUygulaBtn');
        btn.disabled = true; _onizleme = null;
        const mod = gmMod(), ad = secilenAd();
        const metin = metinHazirla();
        const hata = m => { out.innerHTML = `<div class="gm-box-fark"><div class="gm-hata">${m}</div></div>`; };
        if (!ad) return hata('Mevzuat adını seçin veya yazın.');
        if (!metin.trim()) return hata('Güncel metni yapıştırın.');
        const idx = MP.findRegulationIndex(mevzuatDB, ad);
        const eski = idx >= 0 ? mevzuatDB[idx] : null;
        const uyarilar = [];
        let html = '';

        try {
            if (mod === 'tablo') {
                const tb = MP.extractTables(metin);
                const ok = tb.filter(t => t.guvenilir);
                if (!ok.length) return hata("Metinde tablo bulunamadı. 'Tablo-1: …' başlıklı EK-III bölümünü de yapıştırdığınızdan emin olun.");
                if (ok.length < tb.length) uyarilar.push(`${tb.length - ok.length} tablo güvenilir ayrıştırılamadı, bunlar kaydedilmez.`);
                html = `<div class="gm-ok">${ok.length} tablo çıkarıldı: ${ok.map(t => esc(t.baslik.split(':')[0]) + ' (' + t.satirlar.length + ' satır)').join(', ')}</div>`;
                _onizleme = { mod, ad, tablolar: ok };
            } else if (mod === 'madde') {
                if (!eski) return hata('Madde bazlı güncelleme için mevzuat kayıtlı olmalı.');
                let t = metin;
                if (!/^\s*MADDE\s+\d+/im.test(t)) {
                    const no = document.getElementById('gmMaddeNo').value.trim();
                    if (!/^\d+$/.test(no)) return hata("Metinde 'MADDE n –' başlığı yok. Madde numarasını yukarıdaki kutuya yazın.");
                    t = `MADDE ${no} – ` + t.trim();
                }
                const parsed = MP.parseMevzuatText('gecici.txt', t);
                if (!parsed.maddeler.length) return hata("Madde ayrıştırılamadı. Başlık 'MADDE 7 –' biçiminde olmalı.");
                const birlesik = MP.mergeMaddeler(eski, parsed.maddeler);
                const d = MP.diffRegulations(eski, birlesik);
                html = farkHtml(d);
                if (!d.degisiklikVar) uyarilar.push('Yapıştırılan maddeler mevcut metinle aynı; kaydedilecek bir değişiklik yok.');
                _onizleme = { mod, ad: eski.mevzuat_adi, yeniMaddeler: parsed.maddeler, diff: d, degisiklikVar: d.degisiklikVar, maddeNos: parsed.maddeler.map(m => m.madde_no) };
            } else {
                const parsed = MP.parseMevzuatText(ad + '.txt', metin);
                if (!parsed.maddeler.length) return hata("Metinde 'MADDE 1 –' biçiminde madde başlığı bulunamadı. Metnin tamamını yapıştırdığınızdan emin olun.");
                if (eski) { parsed.mevzuat_adi = eski.mevzuat_adi; parsed.mevzuat_turu = eski.mevzuat_turu; parsed.dayanak_kanun = eski.dayanak_kanun; }
                else parsed.mevzuat_adi = ad;
                if (eski) {
                    const d = MP.diffRegulations(eski, parsed);
                    html = farkHtml(d);
                    if (parsed.maddeler.length < eski.maddeler.length * 0.7) uyarilar.push(`Madde sayısı belirgin azaldı (${eski.maddeler.length} → ${parsed.maddeler.length}). Metin eksik yapıştırılmış olabilir.`);
                    if (!d.degisiklikVar) uyarilar.push('Metin mevcut kayıtla aynı; kaydedilecek bir değişiklik yok.');
                    _onizleme = { mod, ad: eski.mevzuat_adi, sonraki: parsed, diff: d, degisiklikVar: d.degisiklikVar };
                } else {
                    html = `<div class="gm-ok">Yeni mevzuat eklenecek: ${parsed.maddeler.length} madde, ${parsed.ekler.length} ek.</div>`;
                    _onizleme = { mod, ad: parsed.mevzuat_adi, sonraki: parsed, degisiklikVar: true };
                }
                // İş Ekipmanları ise tabloları da yenile
                if (isEkipmanlariMi(parsed.mevzuat_adi)) {
                    const ok = MP.extractTables(metin).filter(t => t.guvenilir);
                    if (ok.length) { _onizleme.tablolar = ok; html += `<div class="gm-ok">EK-III periyodik kontrol tabloları da yenilenecek (${ok.length} tablo).</div>`; }
                    else uyarilar.push('Bu metinden EK-III tabloları çıkarılamadı; tablolar eski kalır (EK-III tablolarını ayrıca yapıştırabilirsiniz).');
                }
            }
        } catch (e) { return hata('Ayrıştırma hatası: ' + esc(e.message)); }

        out.innerHTML = `<div class="gm-box-fark">${uyarilar.map(u => `<div class="gm-uyari">⚠ ${esc(u)}</div>`).join('')}${html}</div>`;
        btn.disabled = !(_onizleme && (_onizleme.degisiklikVar !== false || _onizleme.tablolar));
    };

    window.gmUygula = async function () {
        if (!_onizleme) return;
        const o = _onizleme;
        const ts = new Date().toISOString();
        const not = document.getElementById('gmNot').value.trim();
        const idx = MP.findRegulationIndex(mevzuatDB, o.ad);
        const rec = { id: ts + '_' + Math.random().toString(36).slice(2, 7), ts, mevzuat_adi: o.ad, mod: o.mod, not,
            ozet: o.mod === 'tablo' ? `${o.tablolar.length} tablo yenilendi` : (o.diff ? MP.diffOzet(o.diff) : 'Yeni mevzuat eklendi') };
        if (o.mod === 'madde') { rec.yeniMaddeler = o.yeniMaddeler; rec.maddeNos = o.maddeNos; }
        if (o.mod === 'tam') rec.sonraki = o.sonraki;
        if (o.mod !== 'tablo') rec.onceki = idx >= 0 ? MP.deepCopy(mevzuatDB[idx]) : null;

        if (o.tablolar) {
            rec.oncekiTablolarYerel = (await idbKV('readonly', s => s.get(KEY_TABLO))) || null;
            const doc = { mevzuat: 'İş Ekipmanlarının Kullanımında Sağlık ve Güvenlik Şartları Yönetmeliği', ek: 'EK-III',
                kaynak: 'Mevzuat Güncelleme Merkezi' + (not ? ' — ' + not : ''), guncelleme: ts, tablolar: o.tablolar };
            await idbKV('readwrite', s => s.put(doc, KEY_TABLO));
            window.periyodikTablolar = doc;
        }
        const list = await yerelDegisiklikleriYukle();
        list.push(rec);
        await yerelKaydet(list);

        _onizleme = null;
        document.getElementById('gmUygulaBtn').disabled = true;
        document.getElementById('gmMetin').value = '';
        document.getElementById('gmFark').innerHTML = `<div class="gm-box-fark"><div class="gm-ok">✅ Kaydedildi: ${esc(rec.mevzuat_adi)} — ${esc(rec.ozet)}. Arama dizini yeniden oluşturuluyor…</div></div>`;
        precomputeTfIdf('Mevzuat güncellendi');
        setTimeout(() => { gmGecmisCiz(); gmListeCiz(); try { renderFinalReport(); } catch (e) { /* */ } }, 600);
    };

    async function gmGecmisCiz() {
        const list = await yerelDegisiklikleriYukle();
        const el = document.getElementById('gmGecmis');
        if (!list.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">Bu cihazda kayıtlı yerel değişiklik yok.</div>'; return; }
        const sonId = {}; list.forEach(r => { sonId[MP.normName(r.mevzuat_adi) + '|' + (r.mod === 'tablo' ? 't' : 'm')] = r.id; });
        el.innerHTML = list.slice().reverse().map(r => {
            const geriAlinabilir = sonId[MP.normName(r.mevzuat_adi) + '|' + (r.mod === 'tablo' ? 't' : 'm')] === r.id;
            return `<div class="gm-satir"><div><b>${esc(r.mevzuat_adi)}</b><br><span style="color:var(--text-muted)">${esc(new Date(r.ts).toLocaleString('tr-TR'))} · ${esc(r.mod === 'tam' ? 'tamamı' : r.mod === 'madde' ? 'madde ' + (r.maddeNos || []).join(', ') : 'tablolar')} · ${esc(r.ozet)}${r.not ? ' · ' + esc(r.not) : ''}</span></div>
            <button class="btn btn-secondary btn-sm" ${geriAlinabilir ? '' : 'disabled title="Yalnızca en son değişiklik geri alınabilir"'} onclick="gmGeriAl('${esc(r.id)}')">↩ Geri al</button></div>`;
        }).join('');
    }

    window.gmGeriAl = async function (id) {
        if (!confirm('Bu değişiklik geri alınsın mı?')) return;
        const list = await yerelDegisiklikleriYukle();
        const i = list.findIndex(r => r.id === id); if (i < 0) return;
        const rec = list[i];
        if (rec.mod !== 'tablo') {
            const idx = MP.findRegulationIndex(mevzuatDB, rec.mevzuat_adi);
            if (rec.onceki && idx >= 0) mevzuatDB[idx] = MP.deepCopy(rec.onceki);
            else if (!rec.onceki && idx >= 0) mevzuatDB.splice(idx, 1);
        }
        if (rec.mod === 'tablo' || rec.oncekiTablolarYerel !== undefined) {
            if (rec.oncekiTablolarYerel) await idbKV('readwrite', s => s.put(rec.oncekiTablolarYerel, KEY_TABLO));
            else await idbKV('readwrite', s => s.delete(KEY_TABLO));
            await tablolariYukle();
        }
        list.splice(i, 1);
        await yerelKaydet(list);
        precomputeTfIdf('Değişiklik geri alındı');
        setTimeout(() => { gmGecmisCiz(); gmListeCiz(); }, 600);
    };

    function gmListeCiz() {
        const el = document.getElementById('gmListe');
        el.innerHTML = '<table class="gm-tablo"><tr><th>Mevzuat</th><th>Madde</th><th>Son güncelleme</th></tr>' +
            mevzuatDB.filter(Boolean).map(m => `<tr><td>${esc(m.mevzuat_adi)}</td><td>${(m.maddeler || []).length}</td><td>${m.guncelleme ? esc(String(m.guncelleme).slice(0, 10)) : '<span style="color:var(--text-muted)">kaynak sürüm</span>'}</td></tr>`).join('') + '</table>';
    }

    window.gmDisaAktar = async function (tur) {
        const kaydet = (veri, ad) => saveAs(new Blob([JSON.stringify(veri, null, 2)], { type: 'application/json' }), ad);
        if (tur === 'db') kaydet(mevzuatDB, 'mevzuat_veritabani.json');
        else if (tur === 'tablo') { if (!window.periyodikTablolar) return alert('Tablo verisi yok.'); kaydet(window.periyodikTablolar, 'periyodik_tablolar.json'); }
        else {
            const list = await yerelDegisiklikleriYukle();
            kaydet(list.map(r => ({ ts: r.ts, mevzuat_adi: r.mevzuat_adi, mod: r.mod, maddeNos: r.maddeNos, ozet: r.ozet, not: r.not })), 'guncelleme_gunlugu.json');
        }
    };

    // =====================================================================
    // D) BAŞLATMA: arayüze düğmeleri yerleştir
    // =====================================================================
    window.merkezBaslat = function () {
        if (!document.getElementById('gmModal')) {
            document.head.insertAdjacentHTML('beforeend', '<style>' + CSS + '</style>');
            document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
            const kart = document.querySelector('#tab1 .independent-search-card');
            if (kart) kart.insertAdjacentHTML('afterend', `
                <div class="card independent-search-card" onclick="gmAc()">
                    <div style="display:flex;align-items:center;gap:15px;"><span style="font-size:2.5rem;">🔄</span>
                        <div><h3>Mevzuat Güncelleme Merkezi</h3><p>Bir kanun ya da yönetmelik değişti mi? Güncel metni yapıştırın, farkları görün; tamamını ya da yalnızca değişen maddeleri güncelleyin.</p></div>
                    </div><button class="btn btn-primary">🔄 Güncelle</button>
                </div>`);
            const hedef = [...document.querySelectorAll('#settingsSidebar button')].find(b => /Buluttan Zorla/.test(b.textContent));
            if (hedef) hedef.insertAdjacentHTML('beforebegin', `<button class="btn btn-primary btn-sm" style="width:100%;margin-bottom:8px;" onclick="gmAc()">🔄 Mevzuat Güncelleme Merkezi</button>`);
        }
        tablolariYukle();
    };
})();
