# Backup, restore ve geri dönüş runbook'u — Komut 3C

## Kanıt sınırı

Hostinger'da kullanıcı onaylı plan-geneli manuel backup oluşturulmuş; dosya ve DB listelerinde panel gösterimiyle `2026-08-30 22:51 (Özel)` kaydı görülmüş ve Portal Pusula readiness spike DB'sinin kapsamda olduğu doğrulanmıştır. Panel saat dilimi ayrıca doğrulanmamıştır. `2026-08-31` tarihinde aynı boş readiness kaynağı, ikinci ve ayrı disposable hedefte restore edilerek dar kapsamlı `PASS` sonucu vermiştir. Bu sonuç güncel Komut 3C şemasının, migration journal'ının veya kontrollü verisinin restore edildiğini kanıtlamaz.

| Kapı | Durum |
| --- | --- |
| Hostinger backup UI/yetenek görünürlüğü | PANEL PASS |
| Portal Pusula readiness DB'sini kapsayan plan-geneli manuel yedek | PANEL PASS |
| Boş readiness kaynağının ayrı disposable hedefte restore'u | PASS |
| Komut 3C şema/journal/veri restore doğrulaması | UNKNOWN |
| Şifreli yerel recovery kopyası ve ciphertext checksum | PASS — aynı makine/kullanıcı sınırıyla |
| Güncel ZIP deploy ve migration | UNKNOWN |
| Secret-safe uygulama rollback'i | BLOCKED |
| RPO, RTO ve doğrulanmış retention | UNKNOWN |

Manuel backup plan genelini etkileyebildiği ve aynı hesaptaki tüm siteler ile tüm DB'leri kapsayabildiği için açık kullanıcı onayı olmadan başlatılmaz. `2026-08-30` işleminde onay alındı ve manuel backup tamamlandı; yeniden başlatılmadı. Secret gösteren rollback ekranı kullanılmaz. Sonraki restore tatbikatları yalnız yeni disposable DB/kullanıcı hedeflerinde yapıldı; production write/restore başlatılmadı, hPanel environment, cron, migration veya deploy değiştirilmedi.

### Canlı backup ve readiness restore kanıtı

- Dosya yedeği: panel listesinde `2026-08-30 22:51 (Özel)`.
- DB yedeği: aynı panel zamanında özel yedek; 14 DB seçeneği ve Portal Pusula spike DB kapsamı doğrulandı.
- Gerçek site, DB, kullanıcı ve hesap tanımlayıcıları kanıt belgesine alınmadı.
- Doğru readiness DB girdisi birebir seçildi; sağlayıcı gzip çıktısı 550 byte, `CREATE TABLE` sayısı 0, migration journal'ı yok ve yasak SQL directive sayısı 0 olarak doğrulandı.
- İkinci disposable hedefe import hata vermeden tamamlandı; sonrasında boş veritabanı işareti görüldü, tablo yapısı bağlantısı sayısı 0 ve migration journal'ı yoktu.
- Production write/restore başlatılmadı.
- Kanıt referansı: `EV-PANEL-BACKUP-03`, `EV-PANEL-DBBACKUP-03`, `EV-RST-READINESS-01`.

### Restore tatbikatı olay kaydı

İlk girişim `FAIL/BLOCKED — wrong source` olarak kapatıldı (`EV-RST-WRONG-SOURCE-01`). Beklenen imza 0 tablo ve migration journal'ı olmamasıydı; seçilen yanlış dump 34 CMS-benzeri tablo gösterdi. Sapma import sonrasında yalnız disposable hedefte fark edildi; işlem derhal durduruldu, plaintext kopyalar temizlendi ve yanlış disposable DB ile kullanıcının exact-target cleanup'ı `PASS` oldu. Yanlış kaynaktan oluşan şifreli artefakt silinmeden mantıksal karantinaya alındı; anahtar artık artefakttan ayrı, erişimi kısıtlı anahtar dizinindedir. Bu başarısız deneme recovery kanıtı sayılmaz.

Doğru tekrar `PASS — readiness-only empty-source restore` olarak kapatıldı (`EV-RST-READINESS-01`). Kaynak birebir seçildikten sonra 550 byte gzip SQL'in 0 `CREATE TABLE`, journal yok ve 0 yasak directive içerdiği doğrulandı. İkinci disposable hedef import'u hatasız tamamlandı; restore sonrası boş veritabanı işareti, 0 tablo yapısı bağlantısı ve journal yokluğu yeniden doğrulandı. Bu, boş spike veritabanının sağlayıcı backup/download/import zincirini doğrular; Komut 3C'nin toplam yedi tablolu güncel şemasının (altı teknik tablo + migration journal), dört satırlık journal'ının ve kontrollü verisinin restore'u `UNKNOWN` kalır.

### Recovery artefaktı ve custody

- Sağlayıcı indirmesi kısa süre kullanıcı `Downloads` alanına düştü. Bu, tercih edilen erişimi kısıtlı geçici alan kuralından sapmadır; exact dosya hash doğrulamasından sonra indirme kopyası silindi.
- Doğru kaynak, `PPBK1` envelope kullanan AES-256-GCM ile şifrelendi. Nihai ciphertext 583 byte ve SHA-256 değeri `83df1d5353615b339274f8f17910a8b0a3569709bd2f2a61cb4bb241fa5d15c1`'dir.
- Şifreleme anahtarı recovery artefaktından ayrı, ACL ile kısıtlanmış anahtar dizininde saklanır. Anahtar Windows DPAPI `LocalMachine` kapsamıyla korunur; ACL yalnız hedef Windows kullanıcı SID'si ve `SYSTEM` erişimine izin verir. Bu kayıt `CurrentUser` DPAPI olarak yorumlanmamalıdır.
- AES-GCM authentication, kaynak hash eşleşmesi, DPAPI açma ve tam decrypt roundtrip kontrolleri `PASS` olmuştur.
- Bu custody modeli taşınabilir bir off-site recovery garantisi değildir: DPAPI ve ACL nedeniyle çözme işlemi aynı Windows makinesi ve yetkili hedef kullanıcı bağlamına bağımlıdır. Makine kaybında ayrı taşınabilir anahtar/escrow olmadan recovery mümkün olmayabilir.
- Restore için açılan geçici plaintext ve restore temp dizini exact-target cleanup ile silindi; şifreli recovery artefaktı ile ayrı korumalı anahtar kaydı korunuyor.

## Terimler ve ayrım

- **Backup:** Belirli bir zamanda uygulama/DB durumunun geri yüklenebilir kopyasıdır. Panelde görünmesi, restore edilebilir olduğunun kanıtı değildir.
- **Restore drill:** Yedeğin production olmayan ayrı hedefe yüklenmesi ve doğruluk kontrollerinden geçmesidir.
- **Application rollback:** Önceki uygulama ZIP/commit'ine dönmektir. DB şeması/data geri alınmaz; eski uygulamanın yeni şemayla uyumu ayrıca kanıtlanmalıdır.
- **DB recovery:** Onaylı yedeğin hedef DB'ye geri yüklenmesidir. MariaDB DDL implicit commit yapabildiği için otomatik down migration yerine geçer.

Bu dört kavram tek bir “rollback geçti” maddesinde birleştirilemez.

## Production öncesi zorunlu hazırlık

1. Değişiklik sahibi, uygulayıcı, gözlemci ve durdurma yetkisini belirle.
2. `PP-BKP-<UTC-tarih-saat>-<rastgele-kısa-ek>` biçiminde secretsız bir backup kanıt kimliği üret. Provider backup referansıyla eşlemesini yalnız erişimi kısıtlı operasyon kaydında tut; repoya hesap/site/DB tanımlayıcısı yazma.
3. Manuel yedeğin kapsamı plan-geneliyse işlemden **önce** hesaptaki tüm siteler ve tüm DB'ler için redakte bir kaynak envanteri çıkar: her kaynağa nötr `site-01`, `db-01` gibi kanıt etiketi, tür, backup kapsamına girip girmediği ve Portal Pusula kaynağı olup olmadığı kaydedilir. Gerçek ad/credential belgeye alınmaz.
4. Hedef uygulama artefaktının SHA-256 değerini, migration listesini ve mevcut journal özetini secret içermeden kaydet.
5. Yeni migration SQL'ini ve destructive DDL olmadığını bağımsız incele. Mevcut satırların yeni constraint'lere uyumunu read-only sorgularla kanıtla; canlı veriyi otomatik düzeltme.
6. Hostinger yedeğinin envanterdeki kapsamını ve özellikle Portal Pusula DB'yi gerçekten içerdiğini doğrula. Yedek zamanı, kapsamı, `PP-BKP-*` kimliği ve paneldeki redakte referansı kaydet.
7. Kaynak Portal Pusula DB'den ve hesaptaki diğer tüm DB/site hedeflerinden ayrı, yeni ve disposable bir restore DB'si ile yalnız tatbikata ayrılmış DB kullanıcısını hazırla. Production DB adını, kullanıcı/parolayı veya connection string'i belgeye/komuta koyma.
8. Provider restore seçicisinin yalnız Portal Pusula DB yedeğini seçip yeni geçici DB'yi hedefleyebildiğini, dosya/site restore'u başlatmadığını ve diğer sitelere/DB'lere yazmayacağını işlem öncesi kanıtla. Bu seçicilik kanıtlanamazsa restore'u başlatma ve durumu `BLOCKED` yap.
9. RPO/RTO, bakım penceresi, kabul ölçütü ve abort koşulu kullanıcı tarafından onaylanmadan canlı değişikliğe başlama.

## Secretsız backup kanıtı

Kanıt kaydı yalnız şunları taşır:

- UTC ve `Europe/Istanbul` zamanı;
- ortam etiketi ve onay referansı;
- backup türü, kapsamı ve provider tarafından verilen redakte kimlik/referans;
- beklenen ve gerçek süre;
- tamamlandı/başarısız durumu;
- ayrı restore hedefinin adı yerine nötr kanıt etiketi;
- hash, dosya sayısı veya satır sayısı gibi secret olmayan doğrulamalar.

Panel ekran görüntüsünde secret veya hesap ayrıntısı maskesiz görünürse görüntü kaydedilmez, işlem başlatılmaz ve güvenli yöntem bulunana kadar durum `BLOCKED` kalır.

### İndirilen kopyanın korunması

Provider'dan bir backup kopyası indirilecekse aşağıdaki zincir zorunludur:

1. İndirme hedefi erişimi kısıtlı, şifreli ve backup için ayrılmış geçici çalışma alanıdır; kullanıcı Downloads/Desktop, repo, `work/`, bulut eşitleme dizini veya production ZIP/checkpoint alanı kullanılmaz.
2. Provider çıktısı zaten doğrulanabilir biçimde şifreli değilse kopya, onaylı authenticated-encryption aracıyla arşivlenir/şifrelenir. Şifreleme anahtarı veya parolası arşivden ayrı bir secret manager/ayrı güvenli kanalda tutulur; arşiv adı, yan dosya, komut geçmişi veya aynı dizine yazılmaz.
3. SHA-256 checksum **şifrelenmiş nihai artefaktın byte'ları** üzerinden alınır ve `PP-BKP-*` kaydına dosya boyutu ile birlikte bağlanır. Plaintext dump hash'i kanıt belgesine konmaz.
4. Restore öncesi şifreli artefakt checksum'u yeniden doğrulanır. Anahtar erişimi ve decrypt işlemi yalnız disposable restore ortamında, secret'ı log/argümana düşürmeyen yöntemle yapılır.
5. Doğrulama bittiğinde geçici plaintext dump/arşivler ve unpack dizinleri tam, resolve edilmiş yollar üzerinden güvenli biçimde temizlenir. SSD'de üzerine yazmanın güvenilir olduğu varsayılmaz; tercihen geçici şifreli volume/çalışma alanı kapatılır ve ephemeral anahtarı imha edilir. Cleanup sonucu `PP-RST-*` kaydında PASS olmadan tatbikat kapanmaz.
6. Şifreli saklama kopyası için retention ve silme tarihi kullanıcı tarafından onaylanır. Süre dolduğunda exact artefakt ve ayrı anahtar kaydı kontrollü olarak imha edilir; geniş dizin silme komutu kullanılmaz.

## Ayrı hedefte restore tatbikatı

1. `PP-RST-<UTC-tarih-saat>-<rastgele-kısa-ek>` biçiminde restore kanıt kimliği üret ve seçilen `PP-BKP-*` kimliğine bağla.
2. Restore hedefinin yeni, production olmayan ve yalnız tatbikat verisi taşıyan ayrı geçici DB olduğunu doğrula. Kaynak Portal Pusula DB, diğer DB'ler ve tüm siteler salt hedef envanterinde “değiştirilmeyecek” olarak işaretlenir.
3. Provider DB seçicisinde yalnız Portal Pusula backup girdisini ve yalnız yeni geçici DB hedefini seç. Site/dosya restore'u veya mevcut DB üzerine yazma seçeneği görünürse devam etme. Seçilen kaynak/hedefi secretsız `PP-RST-*` kanıtına kaydet ve ikinci göz/bağımsız kontrol al.
4. Kapsadığı kanıtlanmış yedeği provider'ın güvenli akışıyla hedefe geri yükle; gerçek credential'ı yalnız onaylı secret alanında kullan. İndirilmiş kopya kullanılıyorsa önce şifreli artefakt checksum'unu doğrula.
5. Restore tamamlanınca başlangıç envanterindeki diğer site ve DB'lerin durumunu read-only yeniden kontrol et; beklenmeyen değişiklik varsa tatbikat FAIL/BLOCKED olur.
6. MariaDB motor/sürümünü, karakter seti/collation'ı ve UTC ayarını kaydet.
7. Migration journal satırlarını sürümlü migration sıra/hash'leriyle karşılaştır; fark varsa fail-closed dur.
8. Beklenen teknik tabloları, constraint/index/FK yapılarını ve kontrollü satır sayılarını read-only sorgularla doğrula. Secret, raw payload veya kişisel veri çıktısı alma.
9. Ayrı restore hedefinde uygulama build/start ve liveness/readiness smoke kontrollerini çalıştır. Yetkisiz readiness generic 404, yetkili hazır sonucu generic 200 olmalı; tokenı komuta/loga yazma.
10. Job/outbox/audit/cron-gate için yalnız güvenli sentetik doğruluk kontrolleri uygula. Production dış adapter veya cron tetikleme açma.
11. Tatbikat sonucu, süre, seçicilik ve sapmaları `PP-RST-*` altında kaydet. Geçici plaintext'i güvenli temizle; disposable DB/kullanıcısını onaylı exact-target cleanup prosedürüyle kaldır ve diğer kaynakların değişmediğini son kez doğrula.

Bir yedeği doğrudan production üzerine geri yüklemek restore tatbikatı değildir ve bu runbook'ta yetkilendirilmez.

## Deploy/migration penceresi ve abort

Backup + ayrı hedef restore PASS olmadan migration veya güncel ZIP deploy'u başlatılmaz. Onaydan sonra sıra:

1. Gelen yazma/cron trafiğini onaylı yöntemle durdur; cron zaten varsayılan kapalı kalır.
2. Backup referansını ve hedef ZIP/migration hash'lerini tekrar doğrula.
3. Migration runner'ı tek onaylı süreçle çalıştır; journal/süre/genel sonucu kaydet.
4. Güncel uygulama artefaktını dağıt; liveness/readiness, PWA header'ları, log ve minimum smoke kapılarını çalıştır.
5. Şu durumlardan birinde dur: journal/hash farkı, beklenmeyen DDL, timeout/lock bütçesi aşımı, generic olmayan hata/secret sızıntısı, şema uyumsuzluğu veya restore kanıtının geçersizliği.

Canlı Hostinger yöntemi ve change window henüz onaylanmadığı için bu sıra `UNKNOWN`dur; mevcut Komut 3C kapsamında uygulanmaz.

## Geri dönüş kararı

- Migration başlamadan uygulama deploy'u başarısızsa, secret-safe ve şema uyumlu önceki artefakta dönüş yöntemi gerekir; bu yöntem şu anda `BLOCKED`dır.
- Forward-only migration uygulandıysa eski uygulama yalnız yeni şemayla uyumu önceden kanıtlandıysa kullanılabilir.
- Veri yazılmadan yakalanan şema hatası yeni ileri yönlü migration ile düzeltilir; uygulanmış SQL düzenlenmez.
- Veri kaybı/şema uyumsuzluğu varsa yalnız restore edilmiş olduğu önceden kanıtlanan yedek, ayrı kullanıcı onayı ve bakım penceresiyle recovery adayıdır.
- RPO/RTO ve olası veri kaybı aralığı bilinmeden otomatik restore/rollback başlatılmaz.

## Kapanış kontrolü

- [x] Portal Pusula readiness DB'sini kapsayan yedek kanıtı var.
- [ ] Plan-geneli backup öncesi/sonrası tüm site ve DB'ler redakte envanterle karşılaştırıldı.
- [x] Readiness-only boş kaynak ayrı disposable hedefte restore edildi; 0 tablo/journal yok doğrulaması PASS.
- [ ] Güncel Komut 3C toplam yedi tablo (altı teknik + journal), dört journal satırı ve kontrollü veri restore doğrulamaları PASS.
- [x] Readiness restore'u birebir Portal Pusula kaynak girdisini ve ikinci disposable hedefi kullandı; production write/restore başlatılmadı.
- [x] Secretsız backup/restore kanıt referansları birbirine ve redakte provider referansına bağlı.
- [x] İndirilen doğru kopya AES-256-GCM ile şifreli; anahtar ayrı ACL-kısıtlı dizinde; checksum ciphertext'e bağlı; plaintext cleanup PASS.
- [ ] Yerel DPAPI/ACL custody'si taşınabilir escrow/off-site recovery ile tamamlandı.
- [ ] RPO/RTO/retention ve bakım penceresi onaylı.
- [ ] Eski/yeni uygulama ile şema uyumluluğu kanıtlı.
- [ ] Secret-safe rollback/recovery yöntemi kanıtlı.
- [ ] Cron, environment ve dış adapter durumu değişiklik öncesi/sonrası kayıtlı.
- [ ] Kanıt paketinde secret, connection string veya gerçek veri yok.

Bu maddeler tamamlanmadan backup/restore/rollback kapısı PASS değildir.

Komut 4 / auth için henüz HAZIR DEĞİL; Dilim 0 GO değildir.
