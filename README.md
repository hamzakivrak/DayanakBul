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

## Dosyalar

| Dosya | Görev |
|---|---|
| `index.html` | Ana uygulama |
| `merkez.js` | Güncelleme Merkezi + tablo gösterimi |
| `parser.js` | Metin → JSON ayrıştırıcı, fark, tablo çıkarımı (uygulama ve Actions ortak kullanır) |
| `mevzuat_veritabani.json` | Mevzuat veritabanı |
| `periyodik_tablolar.json` | İş Ekipmanları EK-III tabloları |
| `kaynaklar.txt` | Otomatik güncellenecek mevzuatların mevzuat.gov.tr adresleri |
| `tools/guncelle.js` | Otomatik çekme betiği (`--test` ile yalnızca deneme) |
| `.github/workflows/mevzuat-guncelle.yml` | Zamanlanmış görev |
| `MevzuatText.zip` | Önceki sürümden gelen kaynak metinler (Mart 2025) |

## Güvenlik önlemleri

Otomatik çekme; sayfa başka bir mevzuat gibi görünüyorsa, madde sayısı %30'dan fazla azalmışsa ya da maddelerin yarısından fazlası değişmiş görünüyorsa **hiçbir şey yazmaz** ve nedenini raporlar. Veritabanına yalnızca siz PR'ı birleştirdiğinizde geçer.
