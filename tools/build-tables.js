#!/usr/bin/env node
/*
 * Kullanım:  node tools/build-tables.js <is-ekipmanlari.txt> [cikti.json] [kaynak-aciklamasi] [tarih]
 * İş Ekipmanları Yönetmeliği metninden EK-III periyodik kontrol tablolarını çıkarıp
 * periyodik_tablolar.json üretir (uygulama bu dosyayı okur).
 */
const fs = require('fs');
const path = require('path');
const P = require('../parser.js');

const [, , girdi, cikti = path.join(__dirname, '..', 'periyodik_tablolar.json'), kaynak = '', tarih = ''] = process.argv;
if (!girdi) { console.error('Kullanım: node tools/build-tables.js <metin.txt> [cikti.json] [kaynak] [tarih]'); process.exit(1); }

const tablolar = P.extractTables(fs.readFileSync(girdi, 'utf8'));
const guvenilir = tablolar.filter(t => t.guvenilir);
if (!guvenilir.length) { console.error('Güvenilir tablo çıkarılamadı.'); process.exit(2); }
const doc = {
    mevzuat: 'İş Ekipmanlarının Kullanımında Sağlık ve Güvenlik Şartları Yönetmeliği',
    ek: 'EK-III',
    kaynak: kaynak || 'İş Ekipmanları Yönetmeliği metni',
    guncelleme: tarih || new Date().toISOString().slice(0, 10),
    tablolar: tablolar
};
fs.writeFileSync(cikti, JSON.stringify(doc, null, 2) + '\n');
console.log(`${tablolar.length} tablo yazıldı (${guvenilir.length} güvenilir): ${cikti}`);
tablolar.forEach(t => console.log(` - ${t.baslik.slice(0, 70)} | bölüm ${t.bolum} | ${t.satirlar.length} satır | güvenilir: ${t.guvenilir}`));
