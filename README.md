# DayanakBul (geliştirilmiş sürüm)

İSG denetim bulgularına mevzuat dayanağı bulan uygulama. Bu sürümde üç yenilik var:

1. **Periyodik kontrol tabloları:** İş Ekipmanları Yönetmeliği EK-III (2.1.1 … 2.6.1) maddesiyle eşleşen bulgularda ilgili tablo maddenin altında görünür. "Yalnız eşleşen satır / Tüm tablo / Gizle" düğmeleri vardır; rapora kopyalanırken gerçek Word tablosu olur.
2. **Mevzuat Güncelleme Merkezi** (uygulamada 🔄 kartı ve ayarlar menüsü): bir kanun/yönetmeliğin tamamını ya da yalnızca değişen maddelerini yapıştırıp farkı görür, kaydedersiniz. Değişiklik cihazda kalıcıdır, geri alınabilir.
3. **Otomatik güncelleme (GitHub Actions):** mevzuat.gov.tr'den güncel metni çeker, veritabanıyla karşılaştırır, değişiklik varsa **Pull Request** açar. Siz inceleyip *Merge* dersiniz.

## Kurulum (bir kez)

1. **Pages'i açın:** depo → *Settings* → *Pages* → *Branch: main* / *(root)* → *Save*. Birkaç dakika sonra uygulama `https://KULLANICI.github.io/DEPO-ADI/` adresinde açılır.
2. **Actions izni:** *Settings* → *Actions* → *General* → en altta *Workflow permissions*: **Read and write permissions** seçin ve **Allow GitHub Actions to create and approve pull requests** kutusunu işaretleyin → *Save*.
3. **Kaynak adresi girin:** `kaynaklar.txt` dosyasını açın (kalem simgesi), güncellemek istediğiniz mevzuatın satırında `|` işaretinden sonra mevzuat.gov.tr adresini yapıştırın. Adres: mevzuat.gov.tr'de mevzuatı açın, adres çubuğundaki adresin tamamını kopyalayın (`...mevzuat?MevzuatNo=...&MevzuatTur=...&MevzuatTertip=...` biçiminde). Şimdilik yalnızca İş Ekipmanları satırını doldurmanız yeterli.
4. **Deneme:** *Actions* sekmesi → *Mevzuat Güncelle* → *Run workflow* (**sadece_test** işaretli kalsın) → çalışınca sonuç sayfasındaki özet tabloyu okuyun.
   - ✅ / 🔎 görürseniz site erişilebilir. *sadece_test* işaretini kaldırıp tekrar çalıştırın; değişiklik varsa *Pull Requests* sekmesinde bir PR açılır.
   - ❌ *Erişilemedi* görürseniz özet tablodaki durum kodunu (403, 404 vb.) paylaşın.

Görev ayrıca her Pazartesi 08:00'de (Türkiye saati) kendiliğinden çalışır.

## Elle güncelleme (otomasyon çalışmasa da kullanılabilir)

Uygulama → 🔄 *Mevzuat Güncelleme Merkezi* → mevzuatı seçin → *Tamamı* / *Yalnızca belirli madde(ler)* / *Yalnızca periyodik kontrol tabloları* → metni yapıştırın → *Farkları Göster* → *Uygula ve Kaydet*. Tüm cihazlarda geçerli olması için aynı ekrandaki *Dışa aktar* düğmeleriyle `mevzuat_veritabani.json` ve `periyodik_tablolar.json` dosyalarını indirip depoya yükleyin (*Add file → Upload files*).

## Word / txt dosyalarından toplu güncelleme

Güncelleme Merkezi → **📂 Dosyalardan toplu güncelleme**: mevzuat.gov.tr'den indirdiğiniz `.doc`, `.docx` veya `.txt` dosyalarını birden çok seçerek yükleyin. Her dosya için *ne olduğu* (ana metin / yalnız madde / ayrı ek / tablolar) ve *hangi mevzuata ait olduğu* otomatik tahmin edilir (başlıktan ya da `7.5.18318.doc` gibi dosya adındaki mevzuat numarasından); yanlışsa kutudan değiştirirsiniz. Yönetmelik gövdesinden ayrı gelen ek dosyalarını (örn. `7.5.18615_ek_1.doc`) ilgili mevzuata siz bağlarsınız; bir kez bağlanan mevzuatın numarası hatırlanır. Her dosyanın farkı ayrı görünür, *Hepsini uygula* tek seferde kaydeder; her kayıt ayrı geri alınabilir.

Not: eski `.doc` biçiminde Word'ün otomatik liste numaraları (1-, 2- …) okunamaz; numaralar önemliyse Word'de *Farklı kaydet → .docx* yapıp onu yükleyin.

## GitHub'a gönderme, kaynaklar, ek dosyaları

- **☁ GitHub'a gönder:** Güncelleme Merkezi'nde cihazınızda yaptığınız değişiklikleri doğrudan depoya yazar (token gerekir: fine-grained, yalnızca bu depo, *Contents: Read and write*; yalnızca cihazınızda saklanır). Depodaki güncel veritabanının üstüne uygulanır, geçmişe ayrıntılı işlenir.
- **Doğrudan çekme (isteğe bağlı):** `tools/cloudflare-worker.js` dosyasını Cloudflare'de bir Worker olarak yayınlayıp adresini Güncelleme Merkezi → «Doğrudan çekme ayarı» kutusuna yazarsanız, seçili mevzuatın güncel metni (ve ekleri) anında metin kutusuna gelir. Worker yalnızca mevzuat.gov.tr'ye izin verir. Yazılmazsa Actions'ın son çektiği kopya kullanılır.
- **🌐 mevzuat.gov.tr kaynağı:** «1 · Hangi mevzuat?» altında seçili mevzuatın bağlantısı çıkar (yeni sekmede aç / uygulama içinde göster / metni metin kutusuna getir).
- **(eski ad) kaynaklar:** `kaynaklar.txt`'teki her mevzuatın sayfasına bağlantı; Actions'ın çektiği güncel metni (ve sayfadaki ek dosyalarını) kopyalama / karşılaştırma alanına alma. Metinler Actions çalışınca `kaynak-metinler` dalına yazılır.
- **Ayrı ek dosyası:** Toplu yüklemede her dosya "gövde + içindeki ekler" sayılır; ekler ayrı Word'deyse dosyanın altındaki ➕ düğmesiyle eklenir.
- **Arşiv araması** artık canlı veritabanını tarar (güncellemeler görünür). **AI'sız şelale eşleştirme:** eşleştirme ekranındaki "✍️ Tüm İhlalleri Şelale ile Eşleştir" düğmesi.

## Değişiklik geçmişi

Güncelleme Merkezi → **🕘 Değişiklik geçmişi**: otomatik çekimle (GitHub) ve bu cihazda yapılan tüm değişiklikler tarih sırasıyla listelenir; mevzuata göre süzülür, her kaydın **Ayrıntıyı göster** bölümünde madde madde eski/yeni metin farkı görünür. Otomatik çekimde ayrıntı, PR birleştirildiğinde `guncelleme_gunlugu.json` içine yazılır (bu özellikten sonraki çekimler için).

## Dosyalar

| Dosya | Görev |
|---|---|
| `index.html` | Ana uygulama |
| `merkez.js` | Güncelleme Merkezi + tablo gösterimi |
| `belge.js` | .doc / .docx / .html okuyucu (tarayıcıda, sunucusuz) |
| `parser.js` | Metin → JSON ayrıştırıcı, fark, tablo çıkarımı (uygulama ve Actions ortak kullanır) |
| `mevzuat_veritabani.json` | Mevzuat veritabanı |
| `periyodik_tablolar.json` | İş Ekipmanları EK-III tabloları |
| `kaynaklar.txt` | Otomatik güncellenecek mevzuatların mevzuat.gov.tr adresleri |
| `tools/guncelle.js` | Otomatik çekme betiği (`--test` ile yalnızca deneme) |
| `.github/workflows/mevzuat-guncelle.yml` | Zamanlanmış görev |
| `MevzuatText.zip` | Önceki sürümden gelen kaynak metinler (Mart 2025) |

## Güvenlik önlemleri

Otomatik çekme; sayfa başka bir mevzuat gibi görünüyorsa, madde sayısı %30'dan fazla azalmışsa ya da maddelerin yarısından fazlası değişmiş görünüyorsa **hiçbir şey yazmaz** ve nedenini raporlar. Veritabanına yalnızca siz PR'ı birleştirdiğinizde geçer.
