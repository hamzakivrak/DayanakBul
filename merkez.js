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

    // Bir kaydın sonucunu üretir (hem uygulama anında hem yeniden yüklemede aynı kod çalışır)
    function kayitSonucu(eski, rec) {
        let yeni;
        if (rec.mod === 'madde' && eski) yeni = MP.mergeMaddeler(eski, rec.yeniMaddeler || []);
        else if (rec.mod === 'ek' && eski) yeni = MP.mergeEkler(eski, rec.yeniEkler || []);
        else if (rec.sonraki) yeni = MP.deepCopy(rec.sonraki);
        else return null;
        if (eski && eski.mevzuat_no && !yeni.mevzuat_no) yeni.mevzuat_no = eski.mevzuat_no;
        if (rec.mevzuat_no) yeni.mevzuat_no = rec.mevzuat_no;
        yeni.guncelleme = rec.ts;
        if (rec.not) yeni.guncelleme_notu = rec.not;
        return yeni;
    }

    // Kayıtları ana veritabanının üstüne uygular. Bulut sürümü daha yeniyse (guncelleme tarihi) dokunmaz.
    window.yerelDegisiklikleriUygula = function (list) {
        let n = 0;
        (list || []).forEach(rec => {
            if (rec.mod === 'tablo') return;
            const idx = MP.findRegulationIndex(mevzuatDB, rec.mevzuat_adi);
            if (idx >= 0 && mevzuatDB[idx].guncelleme && mevzuatDB[idx].guncelleme >= rec.ts) return;
            const yeni = kayitSonucu(idx >= 0 ? mevzuatDB[idx] : null, rec);
            if (!yeni) return;
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
    // İhlaldeki ekipman sözcüğü, tablo satırında farklı adla geçiyorsa (örn. kompresör -> "Basınçlı hava ve gaz tankları")
    const SATIR_ESANLAM = [
        [/kompres/, /hava ve gaz tank/], [/hava tank|hava depo/, /hava ve gaz tank/], [/hidrofor|genlesme/, /genlesme|boyler/],
        [/lpg|akaryakit tank|depolama tank/, /atmosferik/], [/kazan/, /kazan/], [/forklift|istif|transpalet/, /endustriyel arac/],
        [/vinc|kren|caraskal/, /kren|vinc/], [/asansor/, /asansor/], [/kaldirma platform|sepetli|man lift/, /platform/],
        [/iskele/, /iskele/], [/konveyor|tasima bant/, /konveyor|surekli tasima/], [/pres/, /pres/], [/torna/, /torna/], [/freze/, /freze/],
        [/matkap|delme/, /delme/], [/testere/, /testere/], [/giyotin|makas/, /giyotin/], [/taslama|spiral/, /taslama/], [/jenerator/, /jenerator/],
        [/trafo|transformator/, /transformator/], [/topraklama|elektrik tesisat/, /elektrik tesisat/], [/yildirim|paratoner/, /yildirim/],
        [/sondurucu|yangin tup/, /sondurucu/], [/yangin sondur|sprinkler|yagmurlama/, /yangin sondur/], [/yangin alg|yangin uyar/, /yangin alg/]
    ];
    const _nrm = t => String(t || '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/â/g, 'a').replace(/î/g, 'i').replace(/\s+/g, ' ');
    function satirSkorlari(tablo, ihlal) {
        const vt = new Set(ipcTokens(ihlal || ''));
        const ni = _nrm(ihlal);
        return tablo.satirlar.map(s => {
            let sk = ipcTokens(s.ad).filter(t => vt.has(t)).length;
            const na = _nrm(s.ad);
            SATIR_ESANLAM.forEach(([a, b]) => { if (a.test(ni) && b.test(na)) sk += 2; });
            return sk;
        });
    }
    // Kullanıcının yazdığı filtre sözcükleri (virgül/boşlukla ayrılmış): hepsi satır adında geçmeli (önek eşleşir)
    function satirFiltrele(tablo, f) {
        const ks = _nrm(f).split(/[,;\s]+/).filter(x => x.length > 1);
        if (!ks.length) return null;
        return tablo.satirlar.map(s => { const na = _nrm(s.ad); return ks.every(k => na.includes(k.length > 5 ? k.slice(0, 5) : k) || SATIR_ESANLAM.some(([x, y]) => x.test(k) && y.test(na))); });
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
        const filtre = fr.tabloFiltre || '';
        const fm = satirFiltrele(tablo, filtre);
        const mode = fr.tabloMode || (mx > 0 ? 'eslesen' : 'tum');
        const btn = (m, label) => `<button type="button" class="btn btn-sm" style="padding:3px 9px;font-size:0.75rem;border:1px solid var(--primary);${mode === m ? 'background:var(--primary);color:#fff;' : 'background:transparent;color:var(--primary);'}" onclick="setTabloMode(${k},'${m}')">${label}</button>`;
        const kontrol = `<div class="no-export" style="margin:4px 0 8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:0.8rem;"><span style="color:var(--text-muted)">📊 ${esc(tablo.baslik.split(':')[0])}:</span>${btn('eslesen', 'Yalnız eşleşen satır')}${btn('tum', 'Tüm tablo')}${btn('kapali', 'Gizle')}<input type="text" value="${esc(filtre)}" placeholder="satır filtresi (örn. kompresör)" title="Yazıp Enter'a basın: yalnız adında bu sözcükler geçen satırlar gösterilir; boşaltınca kalkar" style="padding:3px 8px;font-size:0.75rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-main);width:190px;" onchange="setTabloFiltre(${k}, this.value)"></div>`;
        if (mode === 'kapali') return `<div class="periyodik-tablo-kontrol">${kontrol}</div>`;

        let satirlar = tablo.satirlar;
        if (fm) { const f = tablo.satirlar.filter((s, i) => fm[i]); satirlar = f.length ? f : tablo.satirlar; }
        else if (mode === 'eslesen' && mx > 0) satirlar = tablo.satirlar.filter((s, i) => sk[i] === mx);
        const gorunenNo = new Set();
        satirlar.forEach(s => { const re = /\((\d+)\)/g; let m; while ((m = re.exec(s.ad))) gorunenNo.add(m[1]); });
        const dipnot = tablo.dipnotlar.filter(d => { const m = d.match(/^\((\d+)\)/); return (mode === 'tum' && !fm) || (m && gorunenNo.has(m[1])); });
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
    window.setTabloMode = function (k, m) { if (finalReportData[k]) { finalReportData[k].tabloMode = m; finalReportData[k].tabloFiltre = ''; renderFinalReport(); } };
    window.setTabloFiltre = function (k, f) { if (finalReportData[k]) { finalReportData[k].tabloFiltre = String(f || '').trim(); if (finalReportData[k].tabloFiltre && finalReportData[k].tabloMode === 'kapali') finalReportData[k].tabloMode = 'eslesen'; renderFinalReport(); } };

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

          <h3>📂 Dosyalardan toplu güncelleme (Word / txt)</h3>
          <div class="gm-help">mevzuat.gov.tr'den indirdiğiniz <b>.doc / .docx / .txt</b> dosyalarını <b>birden çok seçerek</b> yükleyin. Her dosya <b>yönetmelik gövdesi + içindeki ekler</b> olarak ele alınır ve hangi mevzuata ait olduğu otomatik tahmin edilir (yanlışsa kutudan değiştirin). Ekler ayrı bir Word'deyse, ilgili dosyanın altındaki <b>➕ Ayrı ek dosyası ekle</b> düğmesini kullanın.</div>
          <input type="file" id="gmCokluDosya" multiple accept=".txt,.doc,.docx,.htm,.html" onchange="gmDosyalariEkle(this)">
          <div id="gmDosyaListe"></div>
          <div class="gm-actions" id="gmTopluEylem" style="display:none;">
            <button class="btn btn-success" id="gmTopluBtn" onclick="gmTopluUygula()" disabled>✅ Hepsini uygula ve kaydet</button>
            <button class="btn btn-secondary" onclick="gmDosyalariTemizle()">Listeyi temizle</button>
          </div>
          <div id="gmTopluSonuc"></div>

          <h3>✍ Ya da metni yapıştırarak güncelle</h3>

          <label class="gm-l">1 · Hangi mevzuat?</label>
          <select id="gmMevzuat" onchange="gmSecimDegisti()"></select>
          <div id="gmYeniAdSatir" style="display:none;margin-top:8px;"><input type="text" id="gmYeniAd" placeholder="Yeni mevzuatın tam adı (örn. ... Yönetmeliği)"></div>
          <div id="gmKaynakSatir" class="gm-box-fark" style="display:none;margin-top:8px;">
            <div id="gmKaynakBaslik" style="font-weight:700;margin-bottom:6px;"></div>
            <div class="gm-actions" style="margin-top:0;">
              <a class="btn btn-secondary btn-sm" id="gmKaynakAc" href="#" target="_blank" rel="noopener">🌐 Yeni sekmede aç</a>
              <button class="btn btn-secondary btn-sm" onclick="gmKaynakPencere()">🪟 Uygulama içinde göster</button>
              <button class="btn btn-primary btn-sm" onclick="gmKaynakGetir(-1)">⬇ Güncel metni metin kutusuna getir</button>
            </div>
            <div id="gmKaynakEkler"></div>
            <div id="gmKaynakDurum" style="font-size:0.82rem;color:var(--text-muted);margin-top:6px;"></div>
            <details><summary style="font-size:0.82rem;">⚙ Doğrudan çekme ayarı (isteğe bağlı)</summary>
              <div class="gm-help" style="margin:6px 0;">Tarayıcılar mevzuat.gov.tr'den doğrudan metin çekemez. Kendi <b>Cloudflare Worker</b> adresinizi yazarsanız (kod: depodaki <code>tools/cloudflare-worker.js</code>) metin anında çekilir. Yazmazsanız, GitHub Actions'ın son çektiği metin kullanılır.</div>
              <input type="text" id="gmProxy" placeholder="https://mevzuat-proxy.KULLANICI.workers.dev" onchange="gmProxyKaydet(this.value)">
            </details>
          </div>
          <div class="modal-overlay" id="gmKaynakOverlay" style="display:none;z-index:1300;">
            <div class="modal-box" style="max-width:900px;width:96vw;height:90vh;display:flex;flex-direction:column;padding:12px;">
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px;">
                <b id="gmKaynakPBaslik" style="flex:1 1 100%;font-size:0.9rem;"></b>
                <button class="btn btn-secondary btn-sm" onclick="gmKaynakPSekme('sayfa')">🌐 Resmî sayfa</button>
                <button class="btn btn-secondary btn-sm" onclick="gmKaynakPSekme('metin')">📄 Metin</button>
                <button class="btn btn-primary btn-sm" onclick="gmKaynakGetir(-1,true)">⬇ Metin kutusuna al</button>
                <button class="btn btn-secondary btn-sm" onclick="gmKaynakPKapat()">✕ Kapat</button>
              </div>
              <div id="gmKaynakPNot" style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;"></div>
              <iframe id="gmKaynakFrame" style="flex:1;width:100%;border:1px solid var(--border);border-radius:8px;background:#fff;" referrerpolicy="no-referrer"></iframe>
              <pre id="gmKaynakMetin" style="display:none;flex:1;overflow:auto;white-space:pre-wrap;border:1px solid var(--border);border-radius:8px;padding:10px;margin:0;font-size:0.82rem;"></pre>
            </div>
          </div>


          <label class="gm-l">2 · Ne değişecek?</label>
          <div class="gm-radios">
            <label><input type="radio" name="gmMod" value="tam" checked onchange="gmSecimDegisti()"> Tamamı — mevzuatın tüm güncel metnini yapıştıracağım</label>
            <label id="gmMaddeSecenek"><input type="radio" name="gmMod" value="madde" onchange="gmSecimDegisti()"> Yalnızca belirli madde(ler) — sadece değişen maddeleri yapıştıracağım</label>
            <label id="gmEkSecenek"><input type="radio" name="gmMod" value="ek" onchange="gmSecimDegisti()"> Yalnızca ek(ler) — ekleri yapıştıracağım (EK-1, EK-2 … başlıklı)</label>
            <label id="gmTabloSecenek" style="display:none;"><input type="radio" name="gmMod" value="tablo" onchange="gmSecimDegisti()"> Yalnızca periyodik kontrol tabloları (EK-III) — metni yapıştırıp tabloları yenile</label>
          </div>
          <div id="gmMaddeNoSatir" style="display:none;"><input type="text" id="gmMaddeNo" placeholder="Yapıştırdığınız metinde 'MADDE 7 –' başlığı yoksa madde numarasını yazın (örn. 7)"></div>

          <label class="gm-l">3 · Güncel metin</label>
          <textarea id="gmMetin" placeholder="Güncel metni buraya yapıştırın. Madde başlıkları 'MADDE 1 –' biçiminde olmalıdır (mevzuat.gov.tr'den kopyalanan metin genelde böyledir)."></textarea>
          <div style="margin-top:6px;font-size:0.85rem;">veya dosya: <input type="file" id="gmDosya" accept=".txt,.doc,.docx,.html,.htm" onchange="gmDosyaOku(this)"></div>

          <label class="gm-l">Kaynak notu (isteğe bağlı)</label>
          <input type="text" id="gmNot" placeholder="Örn: Resmî Gazete 23.12.2025 / 33116">

          <div class="gm-actions">
            <button class="btn btn-primary" onclick="gmFarkGoster()">🔍 Farkları Göster</button>
            <button class="btn btn-success" id="gmUygulaBtn" onclick="gmUygula()" disabled>✅ Uygula ve Kaydet</button>
          </div>
          <div id="gmFark"></div>

          <h3>🕘 Değişiklik geçmişi (tümü)</h3>
          <div class="gm-help">Otomatik çekimle (GitHub) ve bu cihazda yapılan tüm mevzuat değişiklikleri, en yeni en üstte. Her kaydın <b>Ayrıntıyı göster</b> bölümünde eski ve yeni metin arasındaki fark (silinen kırmızı, eklenen yeşil) görünür.</div>
          <select id="gmTarihceFiltre" onchange="gmBulutGunluguCiz()"><option value="">Tüm mevzuatlar</option></select>
          <div id="gmBulutGunluk" style="font-size:0.85rem;">Yükleniyor…</div>

          <h3>📜 Bu cihazdaki değişiklikler</h3>
          <div id="gmGecmis"></div>

          <h3>☁ GitHub'a gönder (tüm cihazlarda geçerli olsun)</h3>
          <div class="gm-help">Bu cihazda yaptığınız değişiklikleri <b>doğrudan depoya yazar</b>; birkaç dakika sonra uygulamayı açan her cihaz yeni veriyi görür ve değişiklik geçmişinde de görünür. İlk kullanımda bir <b>GitHub token</b> girmeniz gerekir: GitHub → Settings → Developer settings → <i>Fine-grained tokens</i> → yalnızca bu depo, izin: <b>Contents: Read and write</b>. Token yalnızca bu cihazın tarayıcısında saklanır, depoya ya da başka yere gönderilmez.</div>
          <input type="text" id="gmGhRepo" placeholder="kullanıcı/depo  (örn. hamzakivrak/DayanakBul)" style="margin-bottom:6px;">
          <input type="password" id="gmGhToken" placeholder="github_pat_… (kayıtlıysa boş bırakabilirsiniz)" autocomplete="off">
          <div id="gmGhBekleyen" style="margin:8px 0;font-size:0.88rem;"></div>
          <div class="gm-actions">
            <button class="btn btn-success" id="gmGhBtn" onclick="gmGitHubGonder()">☁ Değişiklikleri GitHub'a gönder</button>
            <button class="btn btn-secondary" onclick="gmGhTokenSil()">Token'ı bu cihazdan sil</button>
          </div>
          <div id="gmGhSonuc"></div>

          <h3>📥 Dışa aktar (elle yüklemek isterseniz)</h3>
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
        gmSecimDegisti(); gmGecmisCiz(); gmListeCiz(); gmBulutGunluguCiz(); gmTopluYenile(); gmKaynakSatiriCiz(); gmGhDurum();
    };

    // ---- mevzuat.gov.tr kaynağı: seçili mevzuatın bağlantısı + (Worker varsa canlı, yoksa Actions'ın çektiği) metin
    let _kaynak = { liste: [], ayna: null, gr: null, yuklendi: false };
    function ghRepo() {
        try { const o = localStorage.getItem('gh_repo'); if (o && o.includes('/')) { const [a, b] = o.split('/'); return { owner: a.trim(), repo: b.trim() }; } } catch (e) { /* */ }
        const h = location.hostname;
        if (/\.github\.io$/.test(h)) return { owner: h.split('.')[0], repo: location.pathname.split('/')[1] || '' };
        return null;
    }
    window.ghRepo = ghRepo;
    const proxyAdresi = () => { try { return (localStorage.getItem('mevzuat_proxy') || '').trim().replace(/\/$/, ''); } catch (e) { return ''; } };
    window.gmProxyKaydet = function (v) { try { localStorage.setItem('mevzuat_proxy', (v || '').trim()); } catch (e) { /* */ } document.getElementById('gmKaynakDurum').textContent = v ? '✅ Doğrudan çekme adresi kaydedildi.' : 'Doğrudan çekme adresi silindi.'; };
    async function kaynakMetniGetir(slug) {
        const gr = _kaynak.gr; if (!gr || !slug) throw new Error('GitHub deposu belirlenemedi');
        const r = await fetch(`https://raw.githubusercontent.com/${gr.owner}/${gr.repo}/kaynak-metinler/${slug}.txt?v=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) throw new Error('metin alınamadı (' + r.status + ')');
        return r.text();
    }
    async function proxyIstek(url) {
        const px = proxyAdresi(); if (!px) throw new Error('proxy yok');
        const r = await fetch(px + (px.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url), { cache: 'no-store' });
        if (!r.ok) throw new Error('proxy yanıtı ' + r.status);
        return r;
    }
    function iframeAdresi(url) {
        try { const u = new URL(url), no = u.searchParams.get('MevzuatNo'), tur = u.searchParams.get('MevzuatTur'), t = u.searchParams.get('MevzuatTertip'); if (no && tur && t) return `${u.origin}/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=${tur}&MevzuatNo=${no}&MevzuatTertip=${t}`; } catch (e) { /* */ }
        return url;
    }
    async function panoyaKopyala(t) {
        try { await navigator.clipboard.writeText(t); return true; } catch (e) {
            const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
            let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* */ } ta.remove(); return ok;
        }
    }
    async function kaynakYukle() {
        if (_kaynak.yuklendi) return;
        let liste = [];
        try {
            const t = await (await fetch('./kaynaklar.txt?v=' + Date.now(), { cache: 'no-store' })).text();
            liste = t.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('|'))
                .map(l => { const i = l.lastIndexOf('|'); return { ad: l.slice(0, i).trim(), url: l.slice(i + 1).trim() }; }).filter(k => /^https?:\/\//i.test(k.url));
        } catch (e) { /* liste boş kalır */ }
        _kaynak.gr = ghRepo(); let ayna = null;
        if (_kaynak.gr) { try { const r = await fetch(`https://raw.githubusercontent.com/${_kaynak.gr.owner}/${_kaynak.gr.repo}/kaynak-metinler/index.json?v=${Date.now()}`, { cache: 'no-store' }); if (r.ok) ayna = await r.json(); } catch (e) { /* */ } }
        liste.forEach(k => { k.ayna = ayna ? (ayna.kaynaklar || []).find(a => a.ad === k.ad) || null : null; });
        _kaynak.liste = liste; _kaynak.ayna = ayna; _kaynak.yuklendi = true;
    }
    function seciliKaynak() {
        const ad = document.getElementById('gmMevzuat').value; if (!ad || ad === '__yeni__') return null;
        const n = MP.normName(ad);
        return _kaynak.liste.find(k => MP.normName(k.ad) === n) || null;
    }
    // Seçili mevzuatın bağlantısı ve ek dosyaları "1 · Hangi mevzuat?" altında görünür
    window.gmKaynakSatiriCiz = async function () {
        await kaynakYukle();
        const satir = document.getElementById('gmKaynakSatir'), kay = seciliKaynak();
        if (!kay) { satir.style.display = 'none'; return; }
        satir.style.display = 'block';
        document.getElementById('gmKaynakBaslik').textContent = '🌐 ' + kay.ad + ' — resmî kaynak';
        document.getElementById('gmKaynakAc').href = kay.url;
        document.getElementById('gmProxy').value = proxyAdresi();
        const ek = document.getElementById('gmKaynakEkler');
        const ekler = (kay.ayna && kay.ayna.ekler) || kay.canliEkler || [];
        ek.innerHTML = ekler.length ? ekler.map((e, j) => e.slug || e.href
            ? `<div style="margin-top:6px;font-size:0.82rem;">📎 ${esc(e.dosya || e.href)} <button class="btn btn-primary btn-sm" onclick="gmKaynakGetir(${j})">⬇ Ek olarak metin kutusuna getir</button></div>`
            : `<div style="margin-top:6px;font-size:0.8rem;color:var(--text-muted);">📎 ${esc(e.dosya)} — ${esc(e.durum || 'alınamadı')}; resmî sayfadaki "eklerini görmek için tıklayınız" bağlantısından indirip aşağıdan yükleyin.</div>`).join('') : '';
        document.getElementById('gmKaynakDurum').textContent = proxyAdresi() ? 'Metin, doğrudan çekme adresiniz üzerinden anında alınır.'
            : _kaynak.ayna ? `Metin, GitHub Actions'ın son çekiminden alınır (${new Date(_kaynak.ayna.tarih).toLocaleString('tr-TR')}).` : "Henüz otomatik çekilmiş metin yok (GitHub → Actions → Mevzuat Güncelle → Run workflow) ve doğrudan çekme adresi yazılmamış; yine de bağlantıyı açıp metni kopyalayabilirsiniz.";
    };
    // Metni al: önce Worker (canlı), olmazsa Actions'ın çektiği kopya. k: -1 gövde, >=0 ek sırası
    async function kaynakMetniAl(kay, k) {
        const hatalar = [];
        if (proxyAdresi()) {
            try {
                if (k < 0) {
                    const html = await (await proxyIstek(iframeAdresi(kay.url))).text();
                    const metin = MP.htmlToText(html);
                    if (!/MADDE\s+\d+/i.test(metin)) throw new Error('sayfadan madde metni çıkarılamadı');
                    const hr = []; const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+\.(?:docx?|zip))["']/gi; let m; while ((m = re.exec(html))) if (!hr.includes(m[1])) hr.push(m[1]);
                    kay.canliEkler = hr.map(h => ({ href: h, dosya: decodeURIComponent(h) }));
                    return { metin, kaynak: 'canlı (doğrudan çekme)' };
                }
                const e = (kay.canliEkler || [])[k];
                if (e) return { metin: await canliEkMetni(kay, e.href), kaynak: 'canlı (doğrudan çekme)' };
            } catch (err) { hatalar.push('doğrudan çekme: ' + err.message); }
        }
        const ay = kay.ayna;
        const slug = ay ? (k < 0 ? ay.slug : (ay.ekler[k] || {}).slug) : null;
        if (slug) { try { return { metin: await kaynakMetniGetir(slug), kaynak: 'GitHub Actions kopyası' + (_kaynak.ayna ? ' (' + new Date(_kaynak.ayna.tarih).toLocaleString('tr-TR') + ')' : '') }; } catch (err) { hatalar.push(err.message); } }
        throw new Error(hatalar.join(' · ') || "Metin alınamadı: doğrudan çekme adresi yok ve Actions henüz çalışmamış. Resmî sayfayı açıp metni kopyalayın.");
    }
    async function canliEkMetni(kay, href) {
        const u = new URL(kay.url), tur = u.searchParams.get('MevzuatTur'), o = u.origin, klasor = { 7: 'yonetmelik', 1: 'kanun' }[tur] || 'yonetmelik';
        const adaylar = [new URL(href, iframeAdresi(kay.url)).href, `${o}/MevzuatMetin/${klasor}/${href}`, `${o}/MevzuatMetin/${href}`, `${o}/${href}`];
        for (const a of [...new Set(adaylar)]) {
            try {
                const r = await proxyIstek(a); if (/text\/html/i.test(r.headers.get('content-type') || '')) continue;
                const ab = await r.arrayBuffer(); if (ab.byteLength < 500) continue;
                if (/\.zip$/i.test(href)) {
                    const z = await window.JSZip.loadAsync(ab), p = [];
                    for (const f of Object.values(z.files)) { if (!f.dir && /\.(docx?|txt)$/i.test(f.name)) p.push((await window.BelgeOkuyucu.oku(await f.async('arraybuffer'), f.name, window.JSZip, MP.htmlToText)).metin); }
                    return p.join('\n\n');
                }
                return (await window.BelgeOkuyucu.oku(ab, href, window.JSZip, MP.htmlToText)).metin;
            } catch (e) { /* sonraki aday */ }
        }
        throw new Error('ek dosyası indirilemedi');
    }
    // Metin kutusuna getir (ve önizle)
    window.gmKaynakGetir = async function (k, pencereden) {
        const kay = seciliKaynak(), d = document.getElementById('gmKaynakDurum'); if (!kay) return;
        try {
            d.textContent = 'Metin getiriliyor…';
            const { metin, kaynak } = await kaynakMetniAl(kay, k);
            document.querySelector(`#gmModal input[name=gmMod][value=${k < 0 ? 'tam' : 'ek'}]`).checked = true;
            gmSecimDegisti();
            document.getElementById('gmMetin').value = metin;
            gmFarkGoster();
            if (pencereden) gmKaynakPKapat();
            await gmKaynakSatiriCiz();
            d.textContent = `✅ ${k < 0 ? 'Güncel metin' : 'Ek metni'} metin kutusuna alındı — kaynak: ${kaynak}. Aşağıdaki farkı inceleyip uygulayın.`;
            document.getElementById('gmFark').scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) { d.textContent = '⚠ ' + e.message; }
    };
    // Uygulama içi pencere: resmî sayfa (çerçeve) ya da metin görünümü
    window.gmKaynakPencere = function () {
        const kay = seciliKaynak(); if (!kay) return;
        document.getElementById('gmKaynakPBaslik').textContent = kay.ad;
        document.getElementById('gmKaynakOverlay').style.display = 'flex';
        gmKaynakPSekme(proxyAdresi() || kay.ayna ? 'metin' : 'sayfa');
    };
    window.gmKaynakPKapat = function () { document.getElementById('gmKaynakOverlay').style.display = 'none'; document.getElementById('gmKaynakFrame').src = 'about:blank'; };
    window.gmKaynakPSekme = async function (t) {
        const kay = seciliKaynak(); if (!kay) return;
        const fr = document.getElementById('gmKaynakFrame'), pre = document.getElementById('gmKaynakMetin'), nt = document.getElementById('gmKaynakPNot');
        if (t === 'sayfa') {
            pre.style.display = 'none'; fr.style.display = 'block'; fr.src = iframeAdresi(kay.url);
            nt.textContent = "Resmî sayfa burada açılmazsa (site çerçevelemeye izin vermeyebilir) «Yeni sekmede aç»ı ya da «Metin» sekmesini kullanın.";
        } else {
            fr.style.display = 'none'; pre.style.display = 'block'; pre.textContent = 'Metin getiriliyor…';
            try { const r = await kaynakMetniAl(kay, -1); pre.textContent = r.metin; nt.textContent = 'Kaynak: ' + r.kaynak; } catch (e) { pre.textContent = '⚠ ' + e.message; nt.textContent = ''; }
        }
    };
    // ---- Tam değişiklik geçmişi: bulut (otomatik çekim) + bu cihazdaki kayıtlar, tek zaman çizelgesinde
    let _bulutGunluk = [];
    function gecmisDetayHtml(d) {
        if (!d) return '<div style="color:var(--text-muted)">Bu kayıt için ayrıntı saklanmamış.</div>';
        let h = '';
        if (d.eklenen && d.eklenen.length) h += `<div><b>Eklenen maddeler:</b> ${d.eklenen.map(esc).join(', ')}</div>`;
        if (d.silinen && d.silinen.length) h += `<div><b>Silinen maddeler:</b> ${d.silinen.map(esc).join(', ')}</div>`;
        if (d.ekDegisen && d.ekDegisen.length) h += `<div><b>Ekler:</b> ${d.ekDegisen.map(e => esc(e.no + ' ' + e.durum)).join(', ')}</div>`;
        (d.degisen || []).forEach(x => { h += `<details><summary>Madde ${esc(x.no)}</summary><div style="margin-top:6px;">${MP.wordDiffHtml(x.eski, x.yeni)}</div></details>`; });
        return h || '<div style="color:var(--text-muted)">Madde düzeyinde fark yok.</div>';
    }
    async function gmBulutGunluguCiz() {
        const el = document.getElementById('gmBulutGunluk');
        try {
            const r = await fetch('./guncelleme_gunlugu.json?v=' + Date.now(), { cache: 'no-store' });
            _bulutGunluk = r.ok ? await r.json() : [];
        } catch (e) { _bulutGunluk = []; }
        const yerel = await yerelDegisiklikleriYukle();
        // mevzuat filtresi
        const sel = document.getElementById('gmTarihceFiltre');
        const adlar = [...new Set([..._bulutGunluk.map(x => x.mevzuat), ...yerel.map(x => x.mevzuat_adi)])].sort((a, b) => a.localeCompare(b, 'tr'));
        const onceki = sel.value;
        sel.innerHTML = '<option value="">Tüm mevzuatlar</option>' + adlar.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
        if (onceki && adlar.includes(onceki)) sel.value = onceki;
        const filtre = sel.value;
        const kayitlar = [];
        _bulutGunluk.forEach(x => kayitlar.push({ ts: x.tarih, mevzuat: x.mevzuat, ozet: x.ozet, kaynak: '☁ ' + (x.kaynak || 'GitHub otomatik çekim'), detay: x.detay || null, var: !!x.detay }));
        const bulutAnahtar = new Set(_bulutGunluk.map(x => x.tarih + '|' + x.mevzuat));
        yerel.forEach(rec => {
            if (bulutAnahtar.has(rec.ts + '|' + rec.mevzuat_adi)) return; // GitHub'a gönderilmiş; bulut kaydı zaten gösteriliyor
            let detay = null;
            try { if (rec.mod !== 'tablo' && rec.onceki) { const yeni = kayitSonucu(rec.onceki, rec); if (yeni) detay = MP.diffRegulations(rec.onceki, yeni); } } catch (e) { /* özet yeter */ }
            const tur = rec.mod === 'tam' ? 'tamamı' : rec.mod === 'madde' ? 'madde ' + (rec.maddeNos || []).join(', ') : rec.mod === 'ek' ? 'ek ' + (rec.ekNos || []).join(', ') : 'tablolar';
            kayitlar.push({ ts: rec.ts, mevzuat: rec.mevzuat_adi, ozet: rec.ozet + ' (' + tur + ')' + (rec.not ? ' · ' + rec.not : ''), kaynak: '💻 Bu cihaz', detay, var: !!detay });
        });
        const liste = kayitlar.filter(k => !filtre || k.mevzuat === filtre).sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
        el.innerHTML = liste.length ? liste.map(k => `<div class="gm-box-fark" style="margin-top:8px;">
                <div><b>${esc(k.mevzuat)}</b></div>
                <div style="color:var(--text-muted);font-size:0.8rem;">${esc(new Date(k.ts).toLocaleString('tr-TR'))} · ${esc(k.kaynak)}</div>
                <div style="margin:4px 0;">${esc(k.ozet)}</div>
                ${k.var ? `<details><summary>Ayrıntıyı göster</summary><div style="margin-top:6px;">${gecmisDetayHtml(k.detay)}</div></details>` : ''}
            </div>`).join('')
            : 'Henüz kayıtlı değişiklik yok. (Otomatik güncelleme ya da elle yaptığınız her değişiklik burada tarih sırasıyla birikir.)';
    }
    window.gmBulutGunluguCiz = gmBulutGunluguCiz;
    window.gmKapat = function () { document.getElementById('gmModal').style.display = 'none'; };

    window.gmSecimDegisti = function () {
        const yeni = document.getElementById('gmMevzuat').value === '__yeni__';
        document.getElementById('gmYeniAdSatir').style.display = yeni ? 'block' : 'none';
        document.getElementById('gmMaddeSecenek').style.display = yeni ? 'none' : 'block';
        document.getElementById('gmEkSecenek').style.display = yeni ? 'none' : 'block';
        const ie = !yeni && isEkipmanlariMi(document.getElementById('gmMevzuat').value);
        document.getElementById('gmTabloSecenek').style.display = ie ? 'block' : 'none';
        if (yeni) document.querySelector('#gmModal input[name=gmMod][value=tam]').checked = true;
        if (!ie && gmMod() === 'tablo') document.querySelector('#gmModal input[name=gmMod][value=tam]').checked = true;
        document.getElementById('gmMaddeNoSatir').style.display = (gmMod() === 'madde' || gmMod() === 'ek') ? 'block' : 'none';
        document.getElementById('gmMaddeNo').placeholder = gmMod() === 'ek' ? "Yapıştırdığınız metinde 'EK-1' başlığı yoksa ek numarasını yazın (örn. 1)" : "Yapıştırdığınız metinde 'MADDE 7 –' başlığı yoksa madde numarasını yazın (örn. 7)";
        _onizleme = null; document.getElementById('gmUygulaBtn').disabled = true; document.getElementById('gmFark').innerHTML = '';
        if (typeof gmKaynakSatiriCiz === 'function' && _kaynak) gmKaynakSatiriCiz();
    };

    async function dosyaMetni(f) {
        const buf = await f.arrayBuffer();
        return window.BelgeOkuyucu.oku(buf, f.name, window.JSZip, MP.htmlToText);
    }
    const DOC_UYARI = "'.doc' dosyalarında Word'ün otomatik numaralı liste işaretleri (1-, 2- …) okunamaz. Numaralar önemliyse dosyayı Word'de «Farklı kaydet → .docx» yapıp onu yükleyin.";

    window.gmDosyaOku = async function (inp) {
        const f = inp.files && inp.files[0]; if (!f) return;
        try {
            const r = await dosyaMetni(f);
            document.getElementById('gmMetin').value = r.metin;
            if (r.tur === 'doc') document.getElementById('gmFark').innerHTML = `<div class="gm-box-fark"><div class="gm-uyari">⚠ ${esc(DOC_UYARI)}</div></div>`;
        } catch (e) { alert('Dosya okunamadı: ' + e.message); }
        inp.value = '';
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

    // Saf önizleme: girdi {rol:'ana'|'madde'|'ek'|'tablo', ad, metin, no, mevzuatNo}; eskiBul(ad) mevcut (ya da toplu işlemde
    // önceki dosyalarla güncellenmiş) kaydı verir. DB'yi değiştirmez. Dönen: {hata} ya da {o, html, uyarilar}
    function onizlemeUret(g, eskiBul) {
        const hata = m => ({ hata: m });
        const rol = g.rol, metin = g.metin || '', ad = g.ad;
        if (!ad) return hata('Hangi mevzuata ait olduğunu seçin.');
        if (!metin.trim()) return hata('Dosya/metin boş.');
        const eski = eskiBul(ad);
        const uyarilar = [];
        let html = '', o;
        try {
            if (rol === 'tablo') {
                const tb = MP.extractTables(metin), ok = tb.filter(t => t.guvenilir);
                if (!ok.length) return hata("Metinde tablo bulunamadı. 'Tablo-1: …' başlıklı EK-III bölümünü de eklediğinizden emin olun.");
                if (ok.length < tb.length) uyarilar.push(`Güvenilir ayrıştırılamayan tablo(lar): ${tb.filter(t => !t.guvenilir).map(t => 'Tablo-' + t.no).join(', ')} — bunlar kaydedilmez.`);
                html = `<div class="gm-ok">${ok.length} tablo çıkarıldı: ${ok.map(t => esc(t.baslik.split(':')[0]) + ' (' + t.satirlar.length + ' satır)').join(', ')}. Dosyada olmayan tablolar olduğu gibi korunur.</div>`;
                o = { mod: 'tablo', ad, tablolar: ok, degisiklikVar: true };
            } else if (rol === 'madde') {
                if (!eski) return hata('Madde bazlı güncelleme için mevzuat kayıtlı olmalı.');
                let t = metin;
                if (!/^\s*MADDE\s+\d+/im.test(t)) {
                    if (!/^\d+$/.test(String(g.no || '').trim())) return hata("Metinde 'MADDE n –' başlığı yok. Madde numarasını yazın.");
                    t = `MADDE ${String(g.no).trim()} – ` + t.trim();
                }
                const parsed = MP.parseMevzuatText('gecici.txt', t);
                if (!parsed.maddeler.length) return hata("Madde ayrıştırılamadı. Başlık 'MADDE 7 –' biçiminde olmalı.");
                const sonuc = MP.mergeMaddeler(eski, parsed.maddeler), d = MP.diffRegulations(eski, sonuc);
                html = farkHtml(d);
                if (!d.degisiklikVar) uyarilar.push('Maddeler mevcut metinle aynı; kaydedilecek bir değişiklik yok.');
                o = { mod: 'madde', ad: eski.mevzuat_adi, yeniMaddeler: parsed.maddeler, maddeNos: parsed.maddeler.map(m => m.madde_no), diff: d, degisiklikVar: d.degisiklikVar, sonuc };
            } else if (rol === 'ek') {
                if (!eski) return hata('Ek eklemek için mevzuatın kayıtlı olması gerekir. Önce yönetmelik gövdesini ekleyin.');
                let t = metin, parsed = MP.parseMevzuatText('gecici.txt', t);
                if (!parsed.ekler.length) {
                    const no = String(g.no || '').trim();
                    if (!/^([0-9]+[a-zA-Z]?|[IVXivx]+)$/.test(no)) return hata("Dosyada 'EK-1' gibi bir ek başlığı yok. Ek numarasını yazın (örn. 1).");
                    parsed = MP.parseMevzuatText('gecici.txt', 'EK-' + no + '\n' + t.trim());
                }
                if (!parsed.ekler.length) return hata('Ek ayrıştırılamadı.');
                if (parsed.maddeler.length) uyarilar.push(`Ek başlığından önce ${parsed.maddeler.length} madde bulundu; bu dosya ek değil yönetmelik gövdesi olabilir (rolü «Ana metin» yapın). Bu maddeler yok sayılır.`);
                const sonuc = MP.mergeEkler(eski, parsed.ekler), d = MP.diffRegulations(eski, sonuc);
                html = `<div class="gm-ok">${parsed.ekler.length} ek okundu: ${parsed.ekler.map(e => esc(e.ek_no)).join(', ')}</div><div>${d.ekDegisen.length ? d.ekDegisen.map(e => esc(e.no + ' ' + e.durum)).join(', ') : ''}</div>`;
                if (!d.degisiklikVar) uyarilar.push('Ekler mevcut kayıtla aynı; kaydedilecek bir değişiklik yok.');
                o = { mod: 'ek', ad: eski.mevzuat_adi, yeniEkler: parsed.ekler, ekNos: parsed.ekler.map(e => e.ek_no), diff: d, degisiklikVar: d.degisiklikVar, sonuc };
            } else {
                const parsed = MP.parseMevzuatText(ad + '.txt', metin);
                if (!parsed.maddeler.length) return hata("Metinde 'MADDE 1 –' biçiminde madde başlığı bulunamadı. Bu dosya yönetmelik gövdesi değilse rolü «Ek» ya da «Tablolar» yapın.");
                if (eski) { parsed.mevzuat_adi = eski.mevzuat_adi; parsed.mevzuat_turu = eski.mevzuat_turu; parsed.dayanak_kanun = eski.dayanak_kanun; }
                else parsed.mevzuat_adi = ad;
                if (eski && !parsed.ekler.length && (eski.ekler || []).length) {
                    parsed.ekler = MP.deepCopy(eski.ekler);
                    uyarilar.push(`Bu dosyada ek yok; mevcut ${parsed.ekler.length} ek korundu (ekler ayrı belge olarak geliyorsa onları da yükleyin).`);
                }
                if (eski) {
                    const d = MP.diffRegulations(eski, parsed);
                    html = farkHtml(d);
                    if (parsed.maddeler.length < eski.maddeler.length * 0.7) uyarilar.push(`Madde sayısı belirgin azaldı (${eski.maddeler.length} → ${parsed.maddeler.length}). Metin eksik olabilir.`);
                    if (!d.degisiklikVar) uyarilar.push('Metin mevcut kayıtla aynı; kaydedilecek bir değişiklik yok.');
                    o = { mod: 'tam', ad: eski.mevzuat_adi, sonraki: parsed, diff: d, degisiklikVar: d.degisiklikVar, sonuc: parsed };
                } else {
                    html = `<div class="gm-ok">Yeni mevzuat eklenecek: ${parsed.maddeler.length} madde, ${parsed.ekler.length} ek.</div>`;
                    o = { mod: 'tam', ad: parsed.mevzuat_adi, sonraki: parsed, degisiklikVar: true, sonuc: parsed };
                }
                if (isEkipmanlariMi(parsed.mevzuat_adi)) {
                    const ok = MP.extractTables(metin).filter(t => t.guvenilir);
                    if (ok.length) { o.tablolar = ok; html += `<div class="gm-ok">EK-III periyodik kontrol tabloları da yenilenecek (${ok.length} tablo).</div>`; }
                    else uyarilar.push('Bu metinden EK-III tabloları çıkarılamadı; tablolar eski kalır (tabloları ayrıca ekleyebilirsiniz).');
                }
            }
        } catch (e) { return hata('Ayrıştırma hatası: ' + esc(e.message)); }
        if (g.mevzuatNo && o.mod !== 'tablo') o.mevzuat_no = g.mevzuatNo;
        return { o, html, uyarilar };
    }

    const gorsel = (r) => r.hata
        ? `<div class="gm-hata">${r.hata}</div>`
        : r.uyarilar.map(u => `<div class="gm-uyari">⚠ ${esc(u)}</div>`).join('') + r.html;
    const canli = (o) => o && (o.degisiklikVar !== false || o.tablolar);

    // --- Tek metin yapıştırma akışı ---
    window.gmFarkGoster = function () {
        const out = document.getElementById('gmFark'), btn = document.getElementById('gmUygulaBtn');
        btn.disabled = true; _onizleme = null;
        const mod = gmMod(), ad = secilenAd(), metin = metinHazirla();
        if (!ad) { out.innerHTML = '<div class="gm-box-fark"><div class="gm-hata">Mevzuat adını seçin veya yazın.</div></div>'; return; }
        if (!metin.trim()) { out.innerHTML = '<div class="gm-box-fark"><div class="gm-hata">Güncel metni yapıştırın.</div></div>'; return; }
        const r = onizlemeUret({ rol: mod === 'tam' ? 'ana' : mod, ad, metin, no: document.getElementById('gmMaddeNo').value }, a => { const i = MP.findRegulationIndex(mevzuatDB, a); return i >= 0 ? mevzuatDB[i] : null; });
        out.innerHTML = `<div class="gm-box-fark">${gorsel(r)}</div>`;
        if (!r.hata && canli(r.o)) { _onizleme = [r.o]; btn.disabled = false; }
    };
    window.gmUygula = async function () {
        if (!_onizleme) return;
        const sonuc = await uygulaToplu(_onizleme, document.getElementById('gmNot').value.trim());
        _onizleme = null;
        document.getElementById('gmUygulaBtn').disabled = true;
        document.getElementById('gmMetin').value = '';
        document.getElementById('gmFark').innerHTML = `<div class="gm-box-fark"><div class="gm-ok">✅ Kaydedildi: ${esc(sonuc)}. Arama dizini yeniden oluşturuluyor…</div></div>`;
    };

    // Önizlenmiş işlemleri sırayla kaydeder. Her kaydın zamanı bir öncekinden büyüktür (yeniden yüklemede sıra korunur);
    // "onceki" her kayıt için kendinden önceki duruma göre alınır, böylece geri alma doğru çalışır.
    async function uygulaToplu(liste, not) {
        const taban = Date.now();
        const kayitlar = await yerelDegisiklikleriYukle();
        const calisma = new Map();
        let tabloIdb = (await idbKV('readonly', s => s.get(KEY_TABLO))) || null;
        let tabloDoc = window.periyodikTablolar;
        const ozetler = [];
        for (let i = 0; i < liste.length; i++) {
            const o = liste[i];
            const ts = new Date(taban + i).toISOString();
            const key = MP.normName(o.ad);
            const idx = MP.findRegulationIndex(mevzuatDB, o.ad);
            const onceki = calisma.has(key) ? calisma.get(key) : (idx >= 0 ? MP.deepCopy(mevzuatDB[idx]) : null);
            const rec = { id: ts + '_' + Math.random().toString(36).slice(2, 7), ts, mevzuat_adi: o.ad, mod: o.mod, not,
                ozet: o.mod === 'tablo' ? `${o.tablolar.length} tablo yenilendi` : (o.diff ? MP.diffOzet(o.diff) : 'Yeni mevzuat eklendi') };
            if (o.mod === 'madde') { rec.yeniMaddeler = o.yeniMaddeler; rec.maddeNos = o.maddeNos; }
            if (o.mod === 'ek') { rec.yeniEkler = o.yeniEkler; rec.ekNos = o.ekNos; }
            if (o.mod === 'tam') rec.sonraki = o.sonraki;
            if (o.mevzuat_no) rec.mevzuat_no = o.mevzuat_no;
            if (o.mod !== 'tablo') {
                rec.onceki = onceki;
                calisma.set(key, kayitSonucu(onceki, rec));
            }
            if (o.tablolar) {
                rec.oncekiTablolarYerel = tabloIdb;
                const harita = new Map(((tabloDoc && tabloDoc.tablolar) || []).map(t => [t.no, t]));
                o.tablolar.forEach(t => harita.set(t.no, t));
                tabloDoc = { mevzuat: 'İş Ekipmanlarının Kullanımında Sağlık ve Güvenlik Şartları Yönetmeliği', ek: 'EK-III',
                    kaynak: 'Mevzuat Güncelleme Merkezi' + (not ? ' — ' + not : ''), guncelleme: ts, tablolar: [...harita.values()].sort((a, b) => a.no - b.no) };
                tabloIdb = tabloDoc;
                await idbKV('readwrite', s => s.put(tabloDoc, KEY_TABLO));
                window.periyodikTablolar = tabloDoc;
            }
            kayitlar.push(rec);
            ozetler.push(`${rec.mevzuat_adi} — ${rec.ozet}`);
        }
        await yerelKaydet(kayitlar);
        precomputeTfIdf('Mevzuat güncellendi');
        setTimeout(() => { gmGecmisCiz(); gmListeCiz(); gmBulutGunluguCiz(); try { renderFinalReport(); } catch (e) { /* */ } }, 600);
        return ozetler.join(' | ');
    }

    // --- Çoklu dosya akışı ---
    let _dosyalar = [], _dosyaSayac = 0, _topluO = null;
    const ROLLER = { ana: 'Ana metin (yönetmelik gövdesi)', madde: 'Yalnız madde(ler)', ek: 'Ek (ayrı belge)', tablo: 'Yalnız periyodik tablolar' };
    const ROL_SIRA = { ana: 0, madde: 1, ek: 2, tablo: 3 };

    function dosyaNo(ad) { const m = String(ad).match(/(?:^|[^0-9])\d\.\d+\.(\d{3,6})(?!\d)/); return m ? m[1] : ''; }
    function ilkSatirlar(metin, n) { return metin.split('\n').map(s => s.trim()).filter(Boolean).slice(0, n); }
    function rolTahmin(metin) {
        const p = MP.parseMevzuatText('x.txt', metin);
        if (p.maddeler.length >= 3) return 'ana';
        if (p.ekler.length) return 'ek';
        if (MP.extractTables(metin).some(t => t.guvenilir)) return 'tablo';
        return p.maddeler.length ? 'madde' : 'ek';
    }
    function mevzuatTahmin(f) {
        const no = dosyaNo(f.ad);
        if (no) { const m = mevzuatDB.find(x => x && String(x.mevzuat_no) === no); if (m) return m.mevzuat_adi; }
        const ilk = ' ' + MP.normName(ilkSatirlar(f.metin, 8).join(' ')) + ' ';
        let en = null, enSkor = 0;
        mevzuatDB.forEach(m => {
            if (!m) return;
            const tok = MP.normName(m.mevzuat_adi).split(' ').filter(t => t.length > 2 && !/^(yonetmeligi|kanunu|tuzugu|hakkinda)$/.test(t));
            if (tok.length < 2) return;
            const skor = tok.filter(t => ilk.includes(' ' + t)).length / tok.length;
            if (skor > enSkor) { enSkor = skor; en = m.mevzuat_adi; }
        });
        return enSkor >= 0.85 ? en : '';
    }
    function baslikAdi(metin) {
        const b = ilkSatirlar(metin, 1)[0] || '';
        const k = b.toLocaleLowerCase('tr').split(' ').map((w, i) => (i && w === 've') ? w : w.charAt(0).toLocaleUpperCase('tr') + w.slice(1)).join(' ');
        return k;
    }

    window.gmDosyalariEkle = async function (inp) {
        const dosyalar = [...(inp.files || [])];
        for (const file of dosyalar) {
            try {
                const r = await dosyaMetni(file);
                const f = { id: ++_dosyaSayac, ad: file.name, tur: r.tur, metin: r.metin, mevzuatNo: dosyaNo(file.name) };
                f.rol = rolTahmin(f.metin);
                f.mevzuat = mevzuatTahmin(f);
                f.baslik = baslikAdi(f.metin);
                f.no = '';
                _dosyalar.push(f);
            } catch (e) { _dosyalar.push({ id: ++_dosyaSayac, ad: file.name, tur: '?', metin: '', rol: 'ana', mevzuat: '', okuHata: e.message, no: '' }); }
        }
        inp.value = '';
        // aynı mevzuat numaralı ana dosya varsa ek/tablo dosyaları ona bağlanır
        _dosyalar.forEach(f => {
            if (f.mevzuat || !f.mevzuatNo) return;
            const ana = _dosyalar.find(x => x !== f && x.rol === 'ana' && x.mevzuat && x.mevzuatNo === f.mevzuatNo);
            if (ana) f.mevzuat = ana.mevzuat;
        });
        _dosyalar.forEach(f => { if (!f.mevzuat && f.rol === 'tablo') { const ie = mevzuatDB.find(m => m && isEkipmanlariMi(m.mevzuat_adi)); if (ie) f.mevzuat = ie.mevzuat_adi; } });
        gmTopluYenile();
    };
    // Ana dosyanın içinde olmayan ekleri ayrı Word/txt olarak, o mevzuata bağlı biçimde ekler
    window.gmEkDosyasiEkle = async function (ebeveynId, inp) {
        for (const file of [...(inp.files || [])]) {
            try {
                const r = await dosyaMetni(file);
                _dosyalar.push({ id: ++_dosyaSayac, ad: file.name, tur: r.tur, metin: r.metin, mevzuatNo: '', rol: 'ek', ebeveyn: ebeveynId, mevzuat: '', baslik: '', no: '' });
            } catch (e) { _dosyalar.push({ id: ++_dosyaSayac, ad: file.name, tur: '?', metin: '', rol: 'ek', ebeveyn: ebeveynId, mevzuat: '', okuHata: e.message, no: '' }); }
        }
        inp.value = '';
        gmTopluYenile();
    };
    window.gmDosyaDeger = function (id, alan, v) {
        const f = _dosyalar.find(x => x.id === id); if (!f) return;
        f[alan] = v;
        if (alan === 'mevzuat' && f.mevzuatNo) _dosyalar.forEach(x => { if (x !== f && x.mevzuatNo === f.mevzuatNo && !x.mevzuat) x.mevzuat = v; });
        gmTopluYenile();
    };
    window.gmDosyaSil = function (id) { _dosyalar = _dosyalar.filter(x => x.id !== id && x.ebeveyn !== id); gmTopluYenile(); };
    window.gmDosyalariTemizle = function () { _dosyalar = []; gmTopluYenile(); };

    function gmTopluYenile() {
        const liste = document.getElementById('gmDosyaListe'), eylem = document.getElementById('gmTopluEylem'), btn = document.getElementById('gmTopluBtn');
        document.getElementById('gmTopluSonuc').innerHTML = '';
        eylem.style.display = _dosyalar.length ? 'flex' : 'none';
        _dosyalar.forEach(f => { if (f.ebeveyn) { const e = _dosyalar.find(x => x.id === f.ebeveyn); f.mevzuat = e ? e.mevzuat : ''; f.baslik = e ? e.baslik : ''; } });
        // Önizleme sırası: ana → madde → ek → tablo (aynı mevzuata ait dosyalar birbirinin sonucu üzerine uygulanır)
        const calisma = new Map();
        const eskiBul = a => { const k = MP.normName(a); if (calisma.has(k)) return calisma.get(k); const i = MP.findRegulationIndex(mevzuatDB, a); return i >= 0 ? mevzuatDB[i] : null; };
        const sonuclar = new Map();
        [..._dosyalar].sort((a, b) => ROL_SIRA[a.rol] - ROL_SIRA[b.rol] || a.id - b.id).forEach(f => {
            if (f.okuHata) { sonuclar.set(f.id, { hata: 'Dosya okunamadı: ' + esc(f.okuHata) }); return; }
            const ad = f.mevzuat === '__yeni__' ? f.baslik : f.mevzuat;
            const r = onizlemeUret({ rol: f.rol, ad, metin: f.metin, no: f.no, mevzuatNo: f.mevzuatNo }, eskiBul);
            sonuclar.set(f.id, r);
            if (!r.hata && r.o.sonuc) calisma.set(MP.normName(r.o.ad), r.o.sonuc);
        });
        const secenekler = f => '<option value="">— mevzuat seçin —</option>' + mevzuatDB.map(m => m ? `<option value="${esc(m.mevzuat_adi)}"${m.mevzuat_adi === f.mevzuat ? ' selected' : ''}>${esc(m.mevzuat_adi)}</option>` : '').join('')
            + `<option value="__yeni__"${f.mevzuat === '__yeni__' ? ' selected' : ''}>➕ Yeni mevzuat: ${esc(f.baslik || 'dosyadaki başlık')}</option>`;
        const kartIci = f => {
            const r = sonuclar.get(f.id);
            const noGoster = f.rol === 'ek' || f.rol === 'madde';
            const rolNotu = { ana: '📘 Yönetmelik gövdesi + dosyadaki ekler', ek: '📎 Ek dosyası', madde: '📄 Madde(ler)', tablo: '📊 Periyodik kontrol tabloları' }[f.rol];
            return `<div style="display:flex;justify-content:space-between;gap:8px;"><b>${f.ebeveyn ? '📎' : '📄'} ${esc(f.ad)}</b><button class="btn btn-secondary btn-sm" onclick="gmDosyaSil(${f.id})">✕</button></div>
                <div style="color:var(--text-muted);font-size:0.78rem;">${esc(f.tur)}${f.mevzuatNo ? ' · mevzuat no ' + esc(f.mevzuatNo) : ''} · ${rolNotu}</div>
                ${f.tur === 'doc' ? `<div class="gm-uyari" style="font-weight:400;font-size:0.8rem;">⚠ ${esc(DOC_UYARI)}</div>` : ''}
                ${f.ebeveyn ? '' : `<label class="gm-l" style="margin:8px 0 3px;">Hangi mevzuata ait?</label>
                <select onchange="gmDosyaDeger(${f.id},'mevzuat',this.value)">${secenekler(f)}</select>`}
                ${noGoster ? `<input type="text" style="margin-top:6px;" value="${esc(f.no)}" placeholder="${f.rol === 'ek' ? "Ek numarası (yalnızca dosyada 'EK-1' başlığı yoksa gerekir)" : "Madde numarası (yalnızca dosyada 'MADDE n' başlığı yoksa gerekir)"}" onchange="gmDosyaDeger(${f.id},'no',this.value)">` : ''}
                <div style="margin-top:8px;">${gorsel(r)}</div>
                ${f.ebeveyn ? '' : `<details style="margin-top:6px;"><summary style="font-size:0.8rem;color:var(--text-muted);cursor:pointer;">Gelişmiş: dosya türü yanlış tahmin edildiyse</summary>
                    <select onchange="gmDosyaDeger(${f.id},'rol',this.value)">${Object.keys(ROLLER).map(k => `<option value="${k}"${f.rol === k ? ' selected' : ''}>${ROLLER[k]}</option>`).join('')}</select></details>`}`;
        };
        liste.innerHTML = _dosyalar.filter(f => !f.ebeveyn).map(f => {
            const cocuklar = _dosyalar.filter(c => c.ebeveyn === f.id);
            return `<div class="gm-box-fark">${kartIci(f)}
                ${cocuklar.map(c => `<div style="margin:8px 0 0 12px;padding:8px;border-left:3px solid var(--secondary);">${kartIci(c)}</div>`).join('')}
                ${f.rol === 'ek' ? '' : `<label class="btn btn-secondary btn-sm" style="display:inline-block;margin-top:8px;cursor:pointer;">➕ Ayrı ek dosyası ekle<input type="file" multiple accept=".txt,.doc,.docx,.htm,.html" style="display:none;" onchange="gmEkDosyasiEkle(${f.id}, this)"></label>
                <div style="color:var(--text-muted);font-size:0.75rem;margin-top:4px;">Ekler yönetmelikle aynı dosyadaysa bir şey yapmanız gerekmez. Ekler ayrı Word'lerde geliyorsa buradan ekleyin; bu mevzuata bağlanırlar.</div>`}
            </div>`;
        }).join('');
        const sirali = [..._dosyalar].sort((a, b) => ROL_SIRA[a.rol] - ROL_SIRA[b.rol] || a.id - b.id);
        _topluO = sirali.map(f => sonuclar.get(f.id)).filter(r => r && !r.hata && canli(r.o)).map(r => r.o);
        const hataSayisi = [...sonuclar.values()].filter(r => r.hata).length;
        btn.disabled = !_topluO.length;
        btn.textContent = `✅ Hepsini uygula ve kaydet (${_topluO.length} işlem${hataSayisi ? ', ' + hataSayisi + ' dosya atlanacak' : ''})`;
    }

    window.gmTopluUygula = async function () {
        if (!_topluO || !_topluO.length) return;
        if (!confirm(`${_topluO.length} işlem kaydedilecek. Devam edilsin mi?`)) return;
        const sonuc = await uygulaToplu(_topluO, document.getElementById('gmNot').value.trim());
        _dosyalar = []; _topluO = null;
        gmTopluYenile();
        document.getElementById('gmTopluSonuc').innerHTML = `<div class="gm-box-fark"><div class="gm-ok">✅ Kaydedildi: ${esc(sonuc)}. Arama dizini yeniden oluşturuluyor…</div></div>`;
    };

    async function gmGecmisCiz() {
        const list = await yerelDegisiklikleriYukle();
        const el = document.getElementById('gmGecmis');
        if (!list.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">Bu cihazda kayıtlı yerel değişiklik yok.</div>'; return; }
        const sonId = {}; list.forEach(r => { sonId[MP.normName(r.mevzuat_adi) + '|' + (r.mod === 'tablo' ? 't' : 'm')] = r.id; });
        el.innerHTML = list.slice().reverse().map(r => {
            const geriAlinabilir = sonId[MP.normName(r.mevzuat_adi) + '|' + (r.mod === 'tablo' ? 't' : 'm')] === r.id && !r.gonderildi;
            return `<div class="gm-satir"><div><b>${esc(r.mevzuat_adi)}</b><br><span style="color:var(--text-muted)">${esc(new Date(r.ts).toLocaleString('tr-TR'))} · ${esc(r.mod === 'tam' ? 'tamamı' : r.mod === 'madde' ? 'madde ' + (r.maddeNos || []).join(', ') : r.mod === 'ek' ? 'ek ' + (r.ekNos || []).join(', ') : 'tablolar')} · ${esc(r.ozet)}${r.not ? ' · ' + esc(r.not) : ''}</span></div>
            <button class="btn btn-secondary btn-sm" ${geriAlinabilir ? '' : 'disabled title="' + (r.gonderildi ? 'GitHub gönderilmiş değişiklik buradan geri alınamaz; önceki metinle yeni bir güncelleme yapın' : 'Yalnızca en son değişiklik geri alınabilir') + '"'} onclick="gmGeriAl('${esc(r.id)}')">↩ Geri al</button></div>`;
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
    // C2) GitHub'a gönder: bu cihazdaki kayıtları depodaki güncel veritabanının üstüne uygulayıp yazar
    // =====================================================================
    function b64(str) {
        const bytes = new TextEncoder().encode(str); let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(bin);
    }
    function ghAyar() {
        let repo = (document.getElementById('gmGhRepo').value || '').trim(), tok = (document.getElementById('gmGhToken').value || '').trim();
        try { if (!tok) tok = localStorage.getItem('gh_token') || ''; if (!repo) repo = localStorage.getItem('gh_repo') || ''; } catch (e) { /* */ }
        if (!repo) { const g = ghRepo(); if (g) repo = g.owner + '/' + g.repo; }
        return { repo, tok };
    }
    window.gmGhTokenSil = function () { try { localStorage.removeItem('gh_token'); } catch (e) { /* */ } document.getElementById('gmGhToken').value = ''; document.getElementById('gmGhSonuc').innerHTML = '<div class="gm-ok">Token bu cihazdan silindi.</div>'; };
    async function gmGhDurum() {
        const el = document.getElementById('gmGhBekleyen'); if (!el) return;
        const l = (await yerelDegisiklikleriYukle()).filter(r => !r.gonderildi);
        el.innerHTML = l.length ? `📤 GitHub'a gönderilmeyi bekleyen <b>${l.length}</b> değişiklik var.` : '✅ Bu cihazdaki tüm değişiklikler GitHub\'a gönderilmiş (ya da hiç değişiklik yok).';
        try { const r = localStorage.getItem('gh_repo'); const g = ghRepo(); document.getElementById('gmGhRepo').value = r || (g ? g.owner + '/' + g.repo : ''); document.getElementById('gmGhToken').placeholder = localStorage.getItem('gh_token') ? '(token kayıtlı — değiştirmek için yenisini yazın)' : 'github_pat_…'; } catch (e) { /* */ }
    }
    window.gmGitHubGonder = async function () {
        const out = document.getElementById('gmGhSonuc'), btn = document.getElementById('gmGhBtn');
        const { repo, tok } = ghAyar();
        if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) { out.innerHTML = '<div class="gm-hata">Depo adını "kullanıcı/depo" biçiminde yazın.</div>'; return; }
        if (!tok) { out.innerHTML = '<div class="gm-hata">GitHub token girin (yukarıdaki açıklamaya bakın).</div>'; return; }
        const tumu = await yerelDegisiklikleriYukle();
        const bekleyen = tumu.filter(r => !r.gonderildi).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
        if (!bekleyen.length) { out.innerHTML = '<div class="gm-ok">Gönderilecek yeni değişiklik yok.</div>'; return; }
        if (!confirm(`${bekleyen.length} değişiklik ${repo} deposuna yazılacak (doğrudan ana dala). Devam edilsin mi?`)) return;
        btn.disabled = true; out.innerHTML = '<div class="gm-box-fark">Gönderiliyor…</div>';
        const url = yol => `https://api.github.com/repos/${repo}/contents/${yol}`;
        const bas = (ek) => Object.assign({ Authorization: 'Bearer ' + tok, 'X-GitHub-Api-Version': '2022-11-28' }, ek || {});
        async function oku(yol) {
            const m = await fetch(url(yol), { headers: bas({ Accept: 'application/vnd.github+json' }), cache: 'no-store' });
            if (m.status === 404) return null;
            if (m.status === 401 || m.status === 403) throw new Error('GitHub token reddedildi (' + m.status + '). Token geçerli mi, bu depo için "Contents: Read and write" izni var mı?');
            if (!m.ok) throw new Error(yol + ' okunamadı (' + m.status + ')');
            const j = await m.json();
            const r = await fetch(url(yol), { headers: bas({ Accept: 'application/vnd.github.raw+json' }), cache: 'no-store' });
            if (!r.ok) throw new Error(yol + ' içeriği okunamadı (' + r.status + ')');
            return { sha: j.sha, text: await r.text() };
        }
        async function yaz(yol, icerik, sha, mesaj) {
            const r = await fetch(url(yol), { method: 'PUT', headers: bas({ Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }), body: JSON.stringify({ message: mesaj, content: b64(icerik), ...(sha ? { sha } : {}) }) });
            if (r.status === 409 || r.status === 422) throw new Error(yol + ' bu arada değişmiş (çakışma). Birkaç saniye sonra tekrar deneyin.');
            if (!r.ok) throw new Error(yol + ' yazılamadı (' + r.status + ')');
        }
        try {
            // 1) veritabanı: depodaki güncel sürümün üstüne kayıtlar
            const dbDosya = await oku('mevzuat_veritabani.json');
            if (!dbDosya) throw new Error('mevzuat_veritabani.json depoda bulunamadı.');
            const db = JSON.parse(dbDosya.text);
            const uygulanan = [];
            bekleyen.forEach(rec => {
                if (rec.mod === 'tablo') return;
                const idx = MP.findRegulationIndex(db, rec.mevzuat_adi);
                if (idx >= 0 && db[idx].guncelleme && db[idx].guncelleme >= rec.ts) return; // depo zaten daha yeni / aynı
                const yeni = kayitSonucu(idx >= 0 ? db[idx] : null, rec);
                if (!yeni) return;
                if (idx >= 0) db[idx] = yeni; else db.push(yeni);
                uygulanan.push(rec);
            });
            const ozetler = [...new Set(bekleyen.map(r => r.mevzuat_adi))];
            const mesaj = 'Güncelleme Merkezi: ' + (ozetler.length > 3 ? ozetler.length + ' mevzuat' : ozetler.join(', '));
            if (uygulanan.length) await yaz('mevzuat_veritabani.json', JSON.stringify(db, null, 2), dbDosya.sha, mesaj);
            // 2) periyodik tablolar
            let tabloYazildi = false;
            if (bekleyen.some(r => r.mod === 'tablo' || r.oncekiTablolarYerel !== undefined) && window.periyodikTablolar) {
                const td = await oku('periyodik_tablolar.json');
                let depoTarih = ''; try { depoTarih = td ? (JSON.parse(td.text).guncelleme || '') : ''; } catch (e) { /* */ }
                if (!depoTarih || depoTarih < (window.periyodikTablolar.guncelleme || '')) { await yaz('periyodik_tablolar.json', JSON.stringify(window.periyodikTablolar, null, 2) + '\n', td && td.sha, mesaj + ' (tablolar)'); tabloYazildi = true; }
            }
            // 3) değişiklik günlüğü (geçmiş ekranı için ayrıntılı)
            if (uygulanan.length || tabloYazildi) {
                const gd = await oku('guncelleme_gunlugu.json'); let g = []; try { g = gd ? JSON.parse(gd.text) : []; } catch (e) { g = []; }
                const kes = t => String(t || '').length > 6000 ? String(t).slice(0, 6000) + ' …' : t;
                bekleyen.forEach(rec => {
                    let detay = null;
                    try { if (rec.mod !== 'tablo' && rec.onceki) { const yeni = kayitSonucu(rec.onceki, rec); if (yeni) { const d = MP.diffRegulations(rec.onceki, yeni); detay = { eklenen: d.eklenen, silinen: d.silinen, degisen: d.degisen.map(x => ({ no: x.no, eski: kes(x.eski), yeni: kes(x.yeni) })), ekDegisen: d.ekDegisen }; } } } catch (e) { /* */ }
                    g.push({ tarih: rec.ts, mevzuat: rec.mevzuat_adi, ozet: rec.ozet + (rec.not ? ' · ' + rec.not : ''), kaynak: 'Güncelleme Merkezi (elle)', detay });
                });
                await yaz('guncelleme_gunlugu.json', JSON.stringify(g.slice(-400), null, 2) + '\n', gd && gd.sha, mesaj + ' (günlük)');
            }
            // 4) gönderildi işareti
            const simdi = new Date().toISOString(), ids = new Set(bekleyen.map(r => r.id));
            await yerelKaydet(tumu.map(r => ids.has(r.id) ? Object.assign({}, r, { gonderildi: simdi }) : r));
            try { localStorage.setItem('gh_repo', repo); localStorage.setItem('gh_token', tok); } catch (e) { /* */ }
            document.getElementById('gmGhToken').value = '';
            out.innerHTML = `<div class="gm-ok">✅ GitHub'a gönderildi: ${uygulanan.length} mevzuat kaydı${tabloYazildi ? ', periyodik tablolar' : ''}. Sayfa yayını birkaç dakika içinde yenilenir; diğer cihazlarda uygulamayı kapatıp açın.</div>`;
            gmGhDurum(); gmBulutGunluguCiz(); gmGecmisCiz();
        } catch (e) { out.innerHTML = `<div class="gm-hata">${esc(e.message)}</div>`; }
        finally { btn.disabled = false; }
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
                        <div><h3>Mevzuat Güncelleme Merkezi</h3><p>Bir kanun ya da yönetmelik değişti mi? Word/txt dosyalarını (birden çok) yükleyin ya da metni yapıştırın; farkları görün, kaydedin.</p></div>
                    </div><button class="btn btn-primary">🔄 Güncelle</button>
                </div>`);
            const hedef = [...document.querySelectorAll('#settingsSidebar button')].find(b => /Buluttan Zorla/.test(b.textContent));
            if (hedef) hedef.insertAdjacentHTML('beforebegin', `<button class="btn btn-primary btn-sm" style="width:100%;margin-bottom:8px;" onclick="gmAc()">🔄 Mevzuat Güncelleme Merkezi</button>`);
        }
        tablolariYukle();
    };
})();
