# ByPusula → Portal otomatik aktarım v1

Kullanıcı 2026-09-17'de dosya indirme/yükleme akışını istemediğini, iki sistem arasında otomatik veri aktarımı istediğini netleştirdi. 0.17.2-beta dosya aktarım paketi bu hedefi karşılamaz ve canlıya kurulmadı. Bu belge otomatik taşımanın ortak geliştirme sözleşmesini ve aşağıdaki canlı kurulum kaydını içerir.

**Canlı durum (2026-09-17):** Portal DB geçişleri ve uygulama dağıtımı tamamlandı; ByPusula 0.18.1-beta etkin. İki taraftaki entegrasyon ekranları açıldı. Kullanıcı test kapsamı olarak Mühendis Kafası hesabını seçti. Yeni ortak anahtar ve iki sunucunun bağlantı yapılandırması bekliyor; **otomatik veri aktarımı henüz etkin değil**.

## Akış

ByPusula, yalnız yapılandırılmış firma hesabındaki tamamlanmış Product analizlerini dayanıklı bir gönderim kuyruğuna alır. Kayıtlı snapshot'tan üretilen mevcut v1 envelope değişmeden saklanır; bağlantı kesilince tekrar gönderilir. Hem yeni hem mevcut tamamlanmış analizler sınırlı partilerle yakalanır. Başka hesaplara erişim yoktur; hesap/kullanıcı aktifliği, geçmiş izni ve tam rapor/aksiyon paketi her gönderimde tekrar denetlenir.

Portal imzalı isteği kalıcı olarak alır. İlk analiz için doğru müşteri/proje eşlemesi gerekir; firma adından tahmin yapılmaz. Kullanıcı bu eşlemeyi onaylayınca analizin tüm adımları otomatik göreve dönüşür. Aynı analiz için mevcut görevler güncellenmez. Bağımsız kararlı kaynak firma kimliği olmadığı için yeni analizler arasında otomatik isim eşlemesi yapılmaz.

Portal görev panosu, proje seçimi bekleyen analiz sayısını gösterir. `/gorevler/bypusula` ekranı bekleyen analizi açar ve **“Bu analizin adımları hangi projeye eklensin?”** diye sorar. Tek listede yalnız aktif, arşivlenmemiş ve aktif bir müşteriye aktif bağla bağlı projeler yer alır. **“Bu projeye aktarımı başlat”** seçimi kalıcı kaydeder; kaynak tekrar gönderimlerinde yeniden seçim gerekmez. Aktarım başladıktan sonra farklı projeye sessiz taşıma yapılmaz; kayıtlı bağ pasifleşirse ilerleme durur. Kullanıcı ekranında dosya indirme/yükleme adımı bulunmaz.

## HTTP sözleşmesi

- `POST /api/integrations/bypusula/sync`, query, cookie ve içerik sıkıştırması olmadan.
- Body: mevcut v1 envelope doğrudan UTF-8 JSON; en fazla 524288 byte. Dosya adı veya `action` sarmalayıcısı yok.
- `Content-Type: application/json`.
- `X-ByPusula-Key-Id`: `[A-Za-z0-9_-]{1,64}`.
- `X-ByPusula-Timestamp`: canonical ondalık Unix saniyesi; Portal saatiyle en fazla 300 saniye fark.
- `X-ByPusula-Delivery-Id`: canonical UUID; kuyruk kaydında sabit.
- `X-ByPusula-Signature`: küçük harf 64 haneli HMAC-SHA256 hex.

İmzalanan UTF-8 metin (sonunda newline yok):

```text
POST
/api/integrations/bypusula/sync
<keyId>
<timestamp>
<deliveryId>
<sha256(exact UTF-8 request body), lowercase hex>
```

HMAC anahtarı en az 43, en çok 128 karakter base64url metindir; decode edilmeden UTF-8 string olarak HMAC'e verilir. Her denemede timestamp ve imza yeniden oluşturulur. Envelope, delivery ID ve kaynak UUID değişmez. Ortak anahtar sadece iki sunucunun güvenli yapılandırmasında tutulur; repoya, ZIP'e, URL'ye, tarayıcıya, loga veya sohbete yazılmaz. Diğer cron/oturum anahtarları tekrar kullanılmaz.

Portal yapılandırması: `BYPUSULA_SYNC_ENABLED`, `BYPUSULA_SYNC_KEY_ID`, `BYPUSULA_SYNC_SECRET`, `BYPUSULA_SYNC_INSTANCE_ID`, `BYPUSULA_SYNC_ACCOUNT_ID`, `BYPUSULA_SYNC_ACTOR_ID`. Varsayılan kapalı; kaynak UUID ve hesap ID'si imza doğrulandıktan sonra exact eşleşmelidir. Aktör aktif bir Portal DB hesabıdır; gereken görev/müşteri/proje izinleri her istekte denetlenir. Cookie oturumu bu sınırda kullanılmaz.

Yanıtlar yalnız allowlist durum ve sayıları taşır; hepsi no-store:

| HTTP | `status` | Gönderici davranışı |
| --- | --- | --- |
| 200 | `synced` | Gönderimi tamamlandı say. |
| 202 | `pending_mapping` | Veri alındı; eşleme bekliyor. 300 saniye sonra yeniden dene. |
| 202 | `processing` | Veri alındı; kalan adımlar var. 60 saniye sonra yeniden dene. |
| 409 | `snapshot_conflict` | İlk snapshot korunur. Otomatik içerik/kimlik değiştirme; inceleme gerekli. |
| 400/413/415 | `invalid_request` | Kuyruk kaydını koru ve düzeltme gerekli göster. |
| 404 | `not_found` | Bağlantı kapalı/yetkisiz; içerik sızdırma, artan aralıkla yeniden dene ve görünür uyarı tut. |
| 503 | `unavailable` | Artan aralıkla yeniden dene. |

200/202 gövdeleri `analysisId` (Portal UUID), `completed`, `total`; 202 ayrıca `retryAfterSeconds` içerir. Portal her istekte en fazla 25 eksik adımı işler; tümü bitmeden `synced` dönmez. 401/403 dahil beklenmeyen HTTP cevapları teslim edildi kabul edilmez. Başarılı adımların tekilliği mevcut transaction/unique kaynak bağıyla korunur.

## Gönderici güvenilirliği

Kuyruk kaydı ağ çağrısından önce kalıcı olmalıdır. Zamanlanmış yakalama, finalization sonrası crash penceresini de kapatır. Claim/lease eşzamanlı çalışmayı sınırlar; ağ çağrısı DB transaction'ının dışında yapılır. Yeni tamamlanan analiz bekletilmeden kuyruğa alınır; ayrıca zamanlanmış bounded yakalama/teslim çalışır. 202 teslimin bittiği anlamına gelmez. Hatalarda ham gövde, anahtar veya kaynak metin loglanmaz.

WordPress trafik tetiklemeli cron tek başına kesintisiz otomasyon kanıtı değildir. Canlıya geçmeden gerçek sunucu zamanlayıcısı, saat uyumu, HTTPS/sertifika doğrulaması ve hedef bağlantısı doğrulanmalıdır. Otomatik taşıma kurulmadan dosya paketi hedef tamamlandı diye sunulamaz.

## Yapılandırma eşlemesi

| Portal environment | ByPusula sunucu sabiti / environment | Anlam |
| --- | --- | --- |
| `BYPUSULA_SYNC_ENABLED=true` | `MK_ISODA_PORTAL_SYNC_ENABLED=true` | Ayrı ayrı etkinleştirme; varsayılan kapalı. |
| `BYPUSULA_SYNC_KEY_ID` | `MK_ISODA_PORTAL_SYNC_KEY_ID` | Aynı anahtar kimliği. |
| `BYPUSULA_SYNC_SECRET` | `MK_ISODA_PORTAL_SYNC_SECRET` | Aynı yeni, bağımsız ortak sır; sadece güvenli sunucu yapılandırması. |
| `BYPUSULA_SYNC_INSTANCE_ID` | `mk_isoda_portal_instance_id` WordPress option'ı | Mevcut kalıcı kurulum UUID'si; yeniden üretilmez. |
| `BYPUSULA_SYNC_ACCOUNT_ID` | `MK_ISODA_PORTAL_SYNC_ACCOUNT_ID` | İzin verilen tek ByPusula hesabı. |
| `BYPUSULA_SYNC_ACTOR_ID` | — | Gerekli izinleri olan aktif Portal hesabının UUID'si. |
| — | `MK_ISODA_PORTAL_SYNC_USER_ID` | Seçili ByPusula hesabındaki aktif/geçmiş yetkili kullanıcı. |
| — | `MK_ISODA_PORTAL_SYNC_URL` | `https://portal.muhendiskafasi.com.tr/api/integrations/bypusula/sync` |
| — | `MK_ISODA_PORTAL_SYNC_SOURCE_URL` | `https://muhendiskafasi.com.tr/index.php/pusula-platform/` |

Portal hesabı ve ByPusula kullanıcı/hesap kimlikleri farklı sistemlere aittir; birbirlerinin yerine konulmaz. ByPusula config değerleri yalnız `wp-config.php` sabiti veya environment üzerinden alınır. İki tarafta da gerçek secret sohbet, kaynak, paket veya test çıktısına girmez. Kaynak göndericinin ayrıntılı kurulum belgesi: `C:\Users\arsla\OneDrive\Belgeler\bypusula\docs\portal-pusula-auto-sync-v1.md`.

## Değişiklik ve dar doğrulama

- Portal `0025_bypusula_transfer` kalıcı analiz/görev bağını, `0026_bypusula_auto_sync` otomatik alım ve proje onayı alanlarını ekler. Mevcut görev oluşturma transaction'ı ve kaynak tekilliği kullanılır; görevlerin elle değiştirilen alanlarına güncelleme yoktur.
- İmzalı HTTP alıcısının **4 odaklı testi geçti**: bozuk/eskimiş imza ve yanlış kaynak reddi, kapalı yapılandırma, 202/200 durumları, gövde sınırı ve güvenli hata yanıtları.
- Gerçek geçici MariaDB'de **1 odaklı senaryo geçti**: 27 adım, eşleme öncesi sıfır görev, planlanan projenin reddi, aktif proje onayı, adım bağlantısında zorlanmış hata ve transaction rollback, tekrar gönderimle tamamlama, mükerrer oluşturmama, elle tamamlanmış/düzenlenmiş görevi koruma, snapshot çakışması ve pasif aktör reddi. `0000`–`0026` migration zinciri uygulandı; geçici container/volume temizlendi. Komut: `npm run test:bypusula:auto`.
- ByPusula'da **6 yeni odaklı grup geçti**: imza/yapılandırma, değişmez kuyruk kaydı, lease/eski worker reddi, retry/202/200/409, yetki/paket kapsamı ve sınırlı yakalama. Kuyruk SQL'i bellek içi SQLite adaptöründe çalıştırıldı; WordPress outbox DDL'si ve gerçek MariaDB eşzamanlı kilitlemesi bu kaynak testinin kapsamına girmez.
- Kaynak PHP'nin ürettiği 2230 byte, 2 program/4 adımlı sentetik gövde ve HMAC, Portal'ın gerçek `envelopeSchema`, `syncSignature`, `validSyncHeaders`, `validSyncSignature` fonksiyonlarıyla **tek sınır kontrolünde geçti**. Kanıt: `outputs/bypusula-auto-sync/source-vector-result.json`. Ağ çağrısı yoktur; test anahtarı yalnız 64 adet `a` karakteridir.
- Portal typecheck ve değişen dosyalara odaklı lint; kaynak PHP syntax ve ZIP bütünlüğü geçti. Önceki export/aktarım testleri, tam suite ve E2E tekrar çalıştırılmadı. 17 Eylül canlı kurulum hazırlığında `next build --webpack` üretim derlemesi de geçti; sağlayıcının dağıtım sonucu ayrıca doğrulanmalıdır.
- phpMyAdmin paket üreticisine yalnız exact `0025`/`0026` DDL desteği eklendi. Bir odaklı test, altışar statement allowlist'ini, bileşik FK kolon sırasını ve onay kolonlarının nullable/precision/charset sözleşmesini doğruladı; mevcut 33 test yeniden çalıştırılmadı. Değişen iki dosyanın lint kontrolü geçti.

## Aday paketler

| Sistem | Yerel paket | Boyut / dosya | SHA-256 |
| --- | --- | --- | --- |
| Portal | `dist/portal-pusula-hostinger.zip` | 6.016.198 byte / 392 | `b2415d250c405bfb9d625165e437c803cb2e9a9632c9b524219abf34eae0042c` |
| ByPusula | `C:\Users\arsla\OneDrive\Belgeler\bypusula\bypusula-v0.18.0-beta-wordpress.zip` | 1.022.182 byte / 57 | `aadd10c129d1f9cd5862b455339325a18ac36f842254e8e9097ff8d5644adcae` |
| ByPusula canlı menü yaması | `C:\Users\arsla\OneDrive\Belgeler\bypusula\bypusula-v0.18.1-beta-wordpress.zip` | 1.022.186 byte / 57 | `e3ff08ae57913382284044777b3e6fa4cf39d2ea441091fddf715fedb7426ed9` |

Portal'ın mevcut `package:verify` komutu iki üretimde byte eşliğini doğruladı. Önceki yerel Portal ZIP'i `outputs/bypusula-auto-sync/portal-pusula-before-local-package.zip` altında korundu; bu dosyanın mevcut canlı sürümle aynı olduğu iddia edilmez. ByPusula 0.17.2'ye göre 3 yeni + 3 değişen dosya, 51 aynı dosya ve sıfır silme içerir. Önceki 0.17.1/0.17.2 paketleri korunmuştur; 0.17.2 otomatik entegrasyon adayı değildir.

## 17 Eylül canlı kurulum kaydı

- Kullanıcı Hostinger/WordPress kurulumu, yedek, veritabanı geçişleri ve zamanlayıcı kapsamını açıkça onayladı; ardından Hostinger oturumunu açtı. Önceki hosting erişimi onay engeli bu açık onayla giderildi. WordPress güncelleme hedefi `https://muhendiskafasi.com.tr/wp-admin/`; Portal phpMyAdmin ekranı kaynak eklenti yönetimi değildir.
- Hostinger'ın plan kapsamındaki dosya/veritabanı yedeği tamamlandı; panel zamanı **2026-09-17 11:34 (Özel)**. Portal'a ait SQL yedeği indirildi, hash'i ve exact 34 tablo kapsamı doğrulandı. Şifresiz geçici indirme kaldırıldı; Windows kullanıcısına bağlı DPAPI kopyası `outputs/bypusula-live-install/user-private/portal-before-bypusula.sql.gz.dpapi` altında kısıtlı ACL ile korunur. Bu kopya başka makinede taşınabilir bir yedek değildir; sağlayıcı yedeği ayrıca mevcuttur.
- Canlı salt okunur ön kontrol: exact 25 journal kaydı, son kayıt `0024`, 33 uygulama tablosu, iki yeni entegrasyon tablosu henüz yok; tüm tablolar InnoDB. Gerçek hedef/sunucu parmak izleri yalnız yerel hedefe bağlı artefaktlarda tutuldu.
- Alınan gerçek yedek, ağ/host portu/host mount'u olmayan ayrı MariaDB ortamında geri yüklendi. 25 journal kimliği kaynak zinciriyle eşleşti. Aynı yedek üzerinde disposable hedefe bağlı `0025` ve `0026` geçişleri birer kez başarıyla çalıştı: final 27 journal / 36 fiziksel tablo ve önceki 33 uygulama tablosunun checksum'ları aynı. Canlı yazma yapılmadı; geçici container/volume kaldırıldı. Redakte kanıt: `outputs/bypusula-live-install/restore-result.json`.
- Canlı hedefe bağlı SQL ve manifest çiftleri hazır: `dist/portal-pusula-incremental-0025_bypusula_transfer.sql` (SHA-256 `3dc5235d7ccf98b8b5f31416864dd7e6b462a35f0fa2a4cdec1e0dd2fb41381b`) ve `dist/portal-pusula-incremental-0026_bypusula_auto_sync.sql` (SHA-256 `43e8b55ad52788bc2d58d949a8e17c74e355270cc1d8bc8040e77c1bd7e2636a`). Her biri altı statement uygular; başlangıç journal sayıları sırasıyla 25 ve 26'dır. Disposable deneme paketleri canlıya yüklenmez.
- Kullanıcı Portal yazmalarının durduğunu ve WordPress oturumunun hazır olduğunu doğruladı. `0025` ve `0026` canlı hedefe sırayla **birer kez** uygulandı; phpMyAdmin her biri için başarılı içe aktarma / 117 sorgu bildirdi. İçe aktarma ekranı bundle'ın son SELECT başarı satırını göstermedi; SQL tekrarlanmadı. Salt okunur inceleme ilk adımda 26 journal + exact migration kimliğini ve iki tablonun tam `SHOW CREATE TABLE` tanımını doğruladı. Son adımda **27 journal / 35 uygulama tablosu**, exact `0026` kimliği, üç nullable `datetime(6)`, nullable ASCII approver UUID, CHECK ve RESTRICT FK doğrulandı. Yeni analiz ve görev bağı sayıları sıfır. Redakte kanıt: `outputs/bypusula-live-install/live-db-result.json`.
- Kaynak WordPress DB'si `home` ve `siteurl` ile doğru alan adına karşı doğrulandı; kurulum kimliği ve hesap/kullanıcı kapsamı alanları incelendi. SQL editörünün varsayılan sorguyu metnin sonuna eklediği fark edilince o sonuç okunmadan editör temizlendi ve sınırlı sorgu tekrar kuruldu. Güncelleme öncesinde `mk_isoda_portal_instance_id` henüz mevcut değildi; yeni eklentinin normal kurulumuyla oluşan kalıcı değer beklenir, elle uydurulmaz. Paneldeki üç firma hesabından hangisinin önceden belirtilen yalnız sentetik test hesabı olduğu kullanıcıya soruldu; adlardan tahmin yapılmadı.
- Hostinger'da gerçek sunucu zamanlayıcısı **her dakika** için oluşturuldu ve kayıt listesinde tek görev olarak doğrulandı. Komut, FTP hesap ekranında doğrulanan kaynak site kökü altındaki `public_html/wp-cron.php` dosyasını `/usr/bin/php` ile çalıştırır; dosyanın varlığı dosya yöneticisinde görüldü. Kaynak hesap parolası veya `wp-config.php` içeriği açılmadı. Kayıt varlığı çalışma/teslim başarısı değildir; worker zamanı ve tek sentetik teslim kabulü henüz beklenir. [Hostinger cron kurulumu](https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/) ve [dosya yolu doğrulaması](https://www.hostinger.com/support/1583514-troubleshooting-cron-jobs-at-hostinger/) esas alındı.
- Kullanıcı iki ZIP yüklemesini Codex'in tamamlamasını açıkça istedi; önceki yükleme devri kaldırıldı ve [Hostinger prosedürü](./hostinger-deploy.md) mevcut değerleri değiştirmeyen dağıtıma göre güncellendi. Ayar ekranında bazı mevcut sırların açık kaldığı görüldü; değerler kopyalanmadı/değiştirilmedi ve o bölüm tekrar görüntülenmedi. Yeni kimlik bilgisi girilmedi.
- **Portal canonical ZIP'i Codex tarafından yüklendi ve canlı dağıtım tamamlandı.** Hostinger kaydı **2026-09-17 13:27:53**, durum **Tamamlandı / Akım**. Node 24.x, `npm run build`, npm, `./`, `.next` ve mevcut environment değerleri korundu. Oturumlu `/gunum` ekranı açıldı; aktif Portal hesabı ve veritabanından gelen gün özeti görüldü. Tarayıcı denetimi düzeldikten sonra `/gorevler/bypusula` ekranı da açıldı: bağlantı kurulumu bekleniyor, henüz analiz yok, eşleşme yoksa aktif proje seçimi açıklaması mevcut. Kanıt: `outputs/bypusula-live-install/deployment-result.json`.
- **ByPusula güncellemesi tamamlandı; canlı etkin sürüm `0.18.1-beta`.** İlk yükleme yanıtı belirsiz kalınca kullanıcı WordPress sekmelerini yeniden açtı. Mevcut `0.17.1-beta` sürümü tekrar görüldükten sonra normal güncelleme akışıyla `0.18.0-beta` kuruldu ve başarı/etkinlik doğrulandı. Canlı kontrol, aktarım alt menüsünün ana menüden önce kaydolması nedeniyle yanlış bağlantı/erişim hatası verdiğini gösterdi. Yalnız `admin_menu` kayıt önceliği 20 yapıldı; iki dosyadaki sürüm bilgisi `0.18.1-beta` oldu. ZIP karşılaştırması 57 dosyadan yalnız bu üçünde değişiklik, sıfır ekleme/silme ve geçerli CRC gösterdi. Yama WordPress'in mevcut eklentiyi değiştirme akışıyla kuruldu. Son listede `0.18.1-beta` ve etkisizleştirme bağlantısı; yeni aktarım sayfasında **Otomatik aktarım kapalı** sonucu doğrulandı. Geniş test tekrar edilmedi. Kanıt: `outputs/bypusula-live-install/source-menu-patch-result.json`.
- Kaynak DB'de normal eklenti kurulumu tarafından oluşturulan kalıcı kurulum UUID'si, kuyruk şema sürümü `1.0.0` ve ayrı outbox tablosunun varlığı salt okunur doğrulandı. phpMyAdmin'in varsayılan DB bağlamından kaynaklanan ilk sorgu hatası, açık kaynak DB adıyla giderildi; veri değiştirilmedi. Kullanıcı Mühendis Kafası hesabının sentetik test kapsamı olduğunu doğruladı. Yeni ortak sır yapılandırması beklediği için **iki uygulama güncel olsa da otomatik aktarım canlıda etkin değildir**.
- Hostinger'ın ortam değişkenleri ekranını yeniden açma işlemi otomatik onay denetimince mevcut sırların görünme riskiyle reddedildi. Dolaylı erişim denenmedi. Ardından kullanıcı ayrı maskeli ortam değişkenleri sayfasını kendisi açıp devam istedi. Maske görsel olarak doğrulandı; Portal için beş gizli olmayan alan taslak olarak eklendi. Henüz uygulanmadı; SECRET değerinin kullanıcı tarafından girilip tüm değişikliklerin uygulanması bekleniyor. Yeni sır içermeyen, iki sunucu için tam bağlantı alanları `outputs/bypusula-live-install/connection-setup.md` içinde hazırdır.
- Kullanıcı teknik adımları yapamadığını bildirdi. Kaybolan beş alanlık Portal taslağı yeniden eklendi ve bu kez kalıcı kaydedildi; tetiklenen yapılandırma dağıtımı **Tamamlandı** olarak doğrulandı. Secret eklenmediği için bağlantı fail-closed kalır. Eski dosya yöneticisi oturumu erişim vermedi; aynı sitenin normal hPanel girişinden yeni oturum açılınca erişim sağlandı. `wp-config.php` dosyasının yalnız son bölümündeki boş satıra güvenli bir PHP açıklama işareti eklendi/kaydedildi ve bu satır kullanıcı yapıştırması için seçildi. Mevcut kimlik bilgileri okunmadı/değiştirilmedi.
- Teknik kullanıcı yükünü azaltmak için yalnız loopback adresinde çalışan `outputs/bypusula-live-install/setup-helper/` hazırlandı. Kullanıcı düğmeye bastığında tarayıcıda 32 rastgele byte'dan aynı 64 hex karakterli ortak anahtar oluşturulur; iki düğme yalnız kullanıcı hareketiyle Portal anahtarını ve WordPress yapılandırma bloğunu panoya kopyalar. Anahtar UI'da/logda/dosyada yer almaz; yardımcıdan ağ gönderimi yoktur. Model panoyu veya anahtarı okumaz. Kaynak JS sözdizimi ve başlangıç ekranı kontrol edildi; kullanıcı kopyalama adımı başarılı oldu. Yardımcı sekme yenilenmez: anahtar yalnız bu sekmenin belleğinde tutulur. Yeni kimlik bilgisinin iki hedefe yapıştırılması ve kaydedilmesi kullanıcıya adım adım bırakıldı.

## 17 Eylül bağlantı sonrası düzeltmeler

- Kullanıcı ortak anahtarı Portal ve WordPress'e kendisi kaydetti. Portal yapılandırma dağıtımı `01a0af14-55a4-7237-8c94-3068f86a3aa0` tamamlandı; alıcı ekranında bağlantı bekleme uyarısı kalktı. WordPress kapsamı hesap 1 / kullanıcı 1 olarak doğrulandı. Yardımcı sekme kullanıcı tarafından kapatıldı ve yerel kopyalama yardımcısının sunucusu durduruldu; anahtar modele okunmadı.
- Kullanıcı geçmiş yerine **son üç tamamlanmış analizden** başlanmasını istedi. Salt okunur sorgu bunların **12, 13, 14** olduğunu doğruladı (14–16 Eylül). Kurulum/hesap kapsamlı, gizli olmayan `mk_isoda_portal_start_ae33022228d496d60d8ea20c=12` seçeneği kaydedildi. ByPusula `0.18.2-beta`, yakalama, döngüsel tarama, kuyruktan alma, teslim ve durum listesinde bu dahil başlangıç sınırını uygular; eski kaynak veya kuyruk kayıtları silinmez.
- Canlıda ilk geçerli Türkçe snapshot kuyruğa yazılamıyordu. [WordPress `wpdb::get_table_charset`](https://developer.wordpress.org/reference/classes/wpdb/get_table_charset/) karışık ASCII/utf8mb4 sütunlarını ASCII kabul ettiği için JSON metni SQL'e ASCII hex olarak verilip `UNHEX` ile aynı byte'lara dönüştürülecek biçimde düzeltildi. Şema veya imzalanan içerik değişmedi. Bir odaklı PHP regresyon grubu (Unicode byte eşliği + tarihsel yakalama/kuyruk sınırı), üç PHP sözdizimi kontrolü ve ZIP karşılaştırması geçti; geniş paketler tekrar edilmedi. Canlı sürüm `0.18.2-beta`, başlangıç 12 ve işleyici `ok` doğrulandı.
- Bu düzeltmeden sonra son üç analiz Portal'a ulaştı, ancak genel oturum proxy'si HTTP 401 döndürdü. Yalnız `/api/integrations/bypusula/sync`, kendi hesap kapsamlı HMAC denetimine ulaşacak şekilde proxy oturum istisnasına eklendi. Bir odaklı proxy→route kontrolü geçerli imzanın kabulünü, yanlış imzanın reddini ve diğer API/UI yollarının korunmasını doğruladı (4 mevcut route testi tekrar edilmedi). Üretim build, odaklı lint ve canonical ZIP'in iki kez aynı byte'larla üretilmesi geçti. Paket karşılaştırmasında tek değişen dosya `src/proxy.ts` oldu; DB geçişi yok. Yeni Portal dağıtımı başlatıldı, canlı teslim kabulü bekleniyor.

## Canlıya geçişte kalan somut adımlar

Kullanıcı 17 Eylül günü geri döndü. Canlı imzalı alım artık doğrulandı: Portal listesinde Zevahir Home #14, ABC Farma #13 ve Kardeşler Alüminyum #12 proje seçimi bekliyor. Kaynak durum ekranı yalnız bu üç kayıt için HTTP **202 / pending_mapping**, sırasıyla **0/324, 0/303, 0/324** adım ve işleyici **ok (14:20:19 UTC)** gösterdi. Bu kabul edilen otomatik veri teslimidir; görev oluşturmanın tamamlandığı anlamına gelmez. Tek analiz önizlemesi tarayıcıda takıldığı, yenileme/kapatma denetimleri de yanıt vermediği için kullanıcıdan yalnız Portal sekmesini yeniden açması istendi. Yeni test veya DB geçişi çalıştırılmadı.

1. Canlı `0025`/`0026` DB adımları tamamlandı; **yeniden çalıştırma**. Sonuçtaki eksik başarı satırı salt okunur şema/journal incelemesiyle giderildi. Dağıtım kontrolleri tamamlandı; normal Portal kullanımı için yazma duraklaması artık gerekmez.
2. Portal oturum-proxy düzeltmesi **2026-09-17 14:39:51** dağıtım kaydında **Tamamlandı / Akım** olarak doğrulandı; aynı yüklemeyi tekrarlama. Ortak anahtar ve bağlantı kapsamı iki sunucuda tamamlandı; tekrar isteme.
3. Gerçek sır sohbet, kaynak, paket veya test çıktısına girmez. ByPusula kapsamı hesap 1 / kullanıcı 1, başlangıç analizi 12'dir.
4. ByPusula `0.18.2-beta`, başlangıç sınırı ve gerçek işleyicinin `ok` zamanı doğrulandı; aynı güncellemeyi veya cron kaydını tekrarlama. Portal dağıtımı sonrası HTTPS teslimini tek sentetik akışta doğrula.
5. Bağlantıyı açıp yalnız bir sentetik analizde **proje seçimi → otomatik görevler → synced → aynı gönderimin tekrarında mükerrer yok** akışını doğrula. Kullanıcı hedef projeyi seçer; firma adından proje tahmini yapılmaz. Geniş test veya tüm kaynak analizleri için ayrı test turu gerekmez. Gerekli dağıtım kontrolü geçince yazma duraklaması kaldırılır.

Geri dönüşte önce gönderim ve ilgili cron kapatılır, sonra gerekiyorsa önceki kod dağıtılır. Outbox, kurulum/teslim UUID'leri ve Portal görev bağları silinmez; oluşan görevler kod rollback'iyle kaldırılmaz. Veri restorasyonu ayrı karar gerektirir.


## 17 Eylül devamı: görev grupları ve zamanlayıcı düzeltmesi

Kullanıcı Zevahir Home #14 için Mühendis Kafası projesini Portal'da seçti. İlk 25 görevden sonra kaynak durum ekranında 50, ardından 75/324 ve HTTP 202 / processing görüldü. ABC Farma #13 ve Kardeşler Alüminyum #12 için hedef projeleri kullanıcı daha sonra seçecek; bu iki kayıt beklemede bırakıldı. Yeni test analizi oluşturulmadı.

Cron kayıtlı olsa da önceki "çalışıyor" çıkarımı tek başına worker zamanından yapılamıyordu: hPanel çıktısı `/usr/bin/php` ile PHP 7.2.34 çalıştığını ve WordPress 7.1'in bunu reddettiğini gösterdi. Web sitesinde mevcut seçili PHP 8.5 okundu; site ayarı değiştirilmedi. Cron, `/opt/alt/php85/usr/bin/php /home/u174613117/domains/muhendiskafasi.com.tr/public_html/wp-cron.php` komutuyla dakikada bir çalışacak şekilde düzeltildi; eski, yeniden oluşturulabilir cron ayarı kaldırıldı ve listede yalnız düzeltilmiş tek kayıt doğrulandı. Yeni çıktı boş; gerçek görev ilerlemesi ayrıca doğrulanacak. Sağlayıcının [PHP binary yolu açıklaması](https://www.hostinger.com/support/5792082-how-to-solve-common-composer-issues-at-hostinger/) ve [cron kılavuzu](https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/) esas alındı.

Kullanıcı aktarım sürerken görev yoğunluğunu azaltmayı ve aktarım/görev panosu düğmelerini yenilemeyi istedi. Görev panosunda ByPusula görevleri kalıcı analiz bağlantısı ve program koduyla kapalı gruplara alındı; arama sonuçları açılır, durum değişikliği sonrası odaklanan görevin üst grupları açılır. Elle düzenlenen açıklamalar gruplama kimliğini değiştirmez; yalnız programın görünen başlığında kullanılır. Aktarım önizlemesinde programlar açılır/kapanır ve sayıları gösterilir. Ortak düğme stilleri, seçili analiz satırı ve ilerleme çubuğu eklendi. Görev sorgusunda mevcut iki entegrasyon tablosuna benzersiz bağlarla salt okunur LEFT JOIN eklenmiştir; DB migration yoktur.

Yalnız 2 odaklı kontrol geçti: grup açma/arama görünürlüğü ve kalıcı kaynak bilgisinin görev projeksiyonu; 4 eski repository testi tekrar edilmedi. Odaklı lint, üretim build/TypeScript ve canonical ZIP eşliği geçti. Paket 6.026.716 byte / 395 dosya; SHA256 `e4550e1cfe86339df1b93d89df2715592729a9f36b68a8bd5af829fdbfb171fc`. Dağıtım 2026-09-17 17:59:51 panel kaydıyla başladı; son gözlem Derleniyor. Kanıt `outputs/bypusula-live-install/task-groups-package-result.json`.

Son canlı sonuç: düzeltilen cron sonrasında Zevahir Home #14 **324/324** olarak tamamlandı. Yeni görev panosunda aynı analiz **324 görevlik tek kapalı grup** olarak doğrulandı; bir program açılınca 11 görev kartı göründü. Arayüz dağıtımı 17:59:51 kaydında **Tamamlandı / Akım**. Kaynak son HTTP 200/synced etiketi tarayıcı takılması nedeniyle ayrıca okunmadı; tamamlanma iki Portal yüzeyinde doğrulandı. Diğer iki proje seçimi kullanıcı tarafından sonraya bırakıldı.

Kullanıcı canlı kontrollerini kendisi yaptı ve başarılı olduğunu doğruladı. İş tamamlandı; ek test çalıştırılmadı. #12 ve #13 hedef proje seçimi kullanıcının sonraki işlemidir.
