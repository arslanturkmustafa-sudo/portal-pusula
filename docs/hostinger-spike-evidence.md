# Hostinger canlı spike kanıtı

- **Komut:** 2 — Hostinger canlı yetenek keşfi
- **Başlangıç:** 30 Ağustos 2026
- **Durum:** Business Node.js canlı spike, rotasyon sonrası yetkili readiness ve gerçek Hostinger MySQL `SELECT 1` kanıtlandı; Portal Pusula readiness spike DB'sini kapsayan plan-geneli manuel yedek `PANEL PASS`; boş kaynağın ayrı disposable hedef restore'u ve yerel şifreli recovery kopyası dar kapsamda `PASS`; Komut 3C şema/journal/veri restore'u ile cron canlı deneyi `UNKNOWN`, rollback güvenli yöntem bulunana kadar blokeli
- **Kapsam sınırı:** Bu belge Dilim 0 `GO` vermez ve Komut 3 uygulamasını kapsamaz.

## Kanıt güvenliği

- Ham ekran görüntüsü, hesap tanımlayıcısı, alan adı sahipliği ayrıntısı, bağlantı dizesi, parola, token, secret ve Authorization değeri repoya alınmaz.
- Geçici `hostingersite.com` HTTPS adresi public ve doğrulanabilir operasyon endpoint'idir; secret, credential veya Hostinger hesap tanımlayıcısı değildir. Yalnız SSR/HTTPS/CDN/PWA kanıtını tekrar doğrulayabilmek için dar istisna olarak tutulur; sahiplik veya hesap metadata'sı kaydedilmez.
- Ham kanıtlar repo dışındaki geçici dizinde tutulur. Zorunlu olursa yalnız `.gitignore` ile dışlanan `work/hostinger-evidence/` kullanılır.
- Bu belgede yalnız secretsız özet ve `EV-*` biçiminde redakte referans bulunur.
- `PANEL`, ekranda görülen seçeneği; `CANLI`, gerçek istek/dağıtım davranışını ifade eder. Panel metni tek başına canlı çalışma kanıtı değildir.

## Geçici kaynak kaydı

| Kaynak | Önerilen ad | Amaç | Durum | Temizlik |
|---|---|---|---|---|
| Node.js uygulaması | hPanel geçici Node.js web app | Nötr uygulamanın canlı runtime testi | YAYINDA; 1/5 web app hakkı | Kanıt kabulünden sonra panelden kaldır |
| Geçici alt alan adı | `sandybrown-wolf-559614.hostingersite.com` | HTTPS/CDN/PWA testi | YAYINDA; üretim alan adı bağlı değil | Uygulama kaldırılırken bağlantıyı sil |
| Boş MySQL/MariaDB | `spike-db`; ayrı kullanıcı `spike-db-user` | Yalnız güvenli bağlantı ve `SELECT 1` | OLUŞTURULDU; nötr kanıt etiketleridir, gerçek DB/kullanıcı/hesap tanımlayıcıları kaydedilmez; tablo/migration/import ve gerçek veri yok | Kanıt kabulünden sonra boş DB ve kullanıcıyı kaldır |
| Cron deneyi | `pp-spike-cron-capability-20260830` | Yöntem/header/zaman/retry/çakışma ölçümü | OLUŞTURULMADI | Her duraklamadan önce devre dışı bırak; kabulden sonra sil |

`yonetim.muhendiskafasi.com.tr` bu spike'ta kullanılmaz. Gerçek müşteri veya finans verisi kullanılmaz.

## Ön kabul kapısı

Zaman: `2026-08-30T08:54:50Z` / `2026-08-30T11:54:50+03:00`  
Ortam: yerel Windows çalışma alanı; Node `v24.19.0`, npm `12.0.2`.

| ID | Kontrol | Gerçek sonuç | Durum | Kanıt referansı |
|---|---|---|---|---|
| PRE-01 | `package-lock.json` ve npm tabanlı temiz kurulum | Lockfile v3; `npm ci` 453 paketi kurdu; audit 0 | PASS | EV-LOCAL-CI-01 |
| PRE-02 | Lint | `eslint . --no-cache`, çıkış 0 | PASS | EV-LOCAL-LINT-01 |
| PRE-03 | TypeScript strict/typecheck | `tsc --noEmit`, çıkış 0 | PASS | EV-LOCAL-TYPE-01 |
| PRE-04 | Unit ve bileşen testleri | 9 dosya, 16 test geçti | PASS | EV-LOCAL-UNIT-01 |
| PRE-05 | Integration iskeleti | 1 dosya, 2 test geçti; gerçek MariaDB Komut 3 kapsamı | PASS | EV-LOCAL-INT-01 |
| PRE-06 | Production build | Next.js 16.3.3 build başarılı | PASS | EV-LOCAL-BUILD-01 |
| PRE-07 | E2E | Masaüstü/mobil 8 testin tamamı geçti; runner kapanış beklemesi sonrası durduruldu, test portu kalmadı | PASS | EV-LOCAL-E2E-01 |
| PRE-08 | Yerel runtime tanısı ve health sınırları | Başlangıç logu Node `v24.19.0`; liveness 200/minimal, readiness 404/generic; ikisi de private no-store ve correlation ID içeriyor | PASS | EV-LOCAL-RUNTIME-01 |

Notlar: Temiz kurulumda ADR-0001'de kayıtlı ESLint peer metadata uyarıları ve npm'in isteğe bağlı `unrs-resolver` postinstall engeli görüldü. Lint/test/build davranışı başarılıdır.

## Canlı test matrisi

Her satır canlı çalışmadan sonra UTC ve `Europe/Istanbul` zamanı, kullanılan ayar, beklenen/gerçek sonuç ve redakte kanıt referansıyla güncellenir. Kanıtlanmayan satır `PASS` yapılamaz.

| ID | Ortam / deney | Beklenen | Gerçek | Tür | Durum | Kanıt | Temizlik |
|---|---|---|---|---|---|---|---|
| HST-01 | Business plan ve Node.js hakkı | Plan etkin, geçici uygulama hakkı var | Node.js app oluşturuldu ve çalışıyor; panel 1/5 web app, 200 GB disk, 3 GB RAM, 2 CPU gösteriyor | PANEL/CANLI | PASS | EV-PANEL-PLAN-02 | Uygulanamaz |
| HST-02 | Seçilebilir Node LTS sürümleri | Panel seçenekleri kaydedilir | 24.x, 22.x, 20.x ve 18.x seçilebilir | PANEL | PASS | EV-PANEL-NODE-01 | Uygulanamaz |
| HST-03 | Node runtime sürümü | Seçilen LTS başlangıç logunda doğrulanır | 24.x seçildi; build logu gerçek sürümü `v24.6.0` olarak gösterdi | CANLI | PASS | EV-LIVE-NODE-01 | Uygulama sonradan kaldırılır |
| HST-04 | SSR ana sayfa | HTTPS üzerinden 200 ve dinamik sunum | `Portal Pusula` ana sayfası HTTPS 200; Next.js SSR route çalışıyor | CANLI | PASS | EV-LIVE-SSR-01 | Uygulama sonradan kaldırılır |
| HST-05 | Route Handler / liveness | Minimal `{"status":"ok"}`, iç ayrıntı yok | HTTPS 200, JSON `{"status":"ok"}`, private no-store | CANLI | PASS | EV-LIVE-HEALTH-01 | Uygulama sonradan kaldırılır |
| HST-06 | Readiness sınırı | Yetkisiz istek generic 404 ve no-store; geçerli bearer yalnız güvenli readiness sonucuna erişir | Headersız HTTPS isteği rotasyon ve restart sonrasında 404 `{"status":"not_found"}`, correlation ID `a5a1512c-9cac-412e-b5c0-42ff90e4bb62`. Yeni bearer ile hardened probe 200 `{"status":"ready"}`, correlation ID `e99628b1-7221-48bb-b39d-571f5c62f328`; eski bearer geçersiz | CANLI | PASS | EV-LIVE-READY-03 | Probe kapalı tutulur |
| HST-07 | Dağıtım seçeneği | Tek GitHub veya ZIP yolu kanıtlanır | Panel GitHub/ZIP/Connector sundu; spike için ZIP seçildi ve canlı çalıştı | PANEL/CANLI | PASS | EV-LIVE-ZIP-01 | Geçici kaynak korunur |
| HST-08 | Build ve start | Kesin komutlar canlı çalışır | npm install adımı, `npm run build` → `next build --webpack`, `.next` ve otomatik `next start`/port 3000 çalıştı | CANLI | PASS | EV-LIVE-BUILD-01 | Geçici kaynak korunur |
| HST-09 | Environment davranışı | Server-only ayar runtime'da çalışır, istemciye sızmaz | Kalıcı DB environment anahtarları `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ve `READINESS_BEARER_TOKEN` kullanılıyor; secret, credential ve hesap tanımlayıcısı belgeye alınmadı, yalnız environment adları ile nötr kanıt etiketleri tutuldu. Rollback ekranı olayı sonrasında kullanıcı `DB_PASSWORD` ile `READINESS_BEARER_TOKEN` değerlerini yenileriyle rotasyon etti ve uygulama yeniden başlatıldı; eski değerler geçersiz | PANEL/CANLI | PASS | EV-LIVE-ENV-03 | Güncel secret'lar gizli tutulur |
| HST-10 | Build/runtime logları | Loglara erişilir; correlation ID izlenir | Build ayrıntıları ve son 1 saat runtime logları erişilebilir; panelde `Sorunlar 0` / `Hatalar 0`, readiness yanıtında correlation ID var | PANEL/CANLI | PASS | EV-LIVE-LOG-01 | Uygulanamaz |
| HST-11 | Redeploy | Kontrollü yeni sürüm çalışır | Yeni deterministik `dist/portal-pusula-hostinger.zip` 50 saniyede dağıtıldı; panel `Tamamlandı` / `Akım`, runtime Node 24.x. Environment değişikliklerindeki otomatik dağıtımlar ve olay sonrası app restart tamamlandı. Önceki v3 geri dönüş adayı olarak korunuyor | CANLI | PASS | EV-LIVE-REDEPLOY-04 | Son sağlam v3 korunur |
| HST-12 | Rollback/geri dağıtım | Sağlam sürüme dönüş kanıtlanır; secret'lar hiçbir model-visible yüzeyde görünmez | Rollback ayar ekranının model-visible UI snapshot'ı secret değerlerini maskesiz sundu. Ekrandaki secret, credential ve hesap tanımlayıcıları bu belgeye veya repoya alınmadı; yalnız nötr sonuç/kanıt etiketleri tutuldu ve deployment başlatılmadan ekrandan çıkıldı. Resmi Hostinger Node belgelerinde Node'a özel tek tık rollback yolu belgelenmemiştir. Güvenli yöntem bulunana kadar canlı rollback tatbikatı durduruldu; önerilen kontrollü yol ayrı staging Node app + ayrı DB üzerinde sürümlü ZIP doğrulamasıdır | PANEL/RESMİ | BLOCKED | EV-SEC-ROLLBACK-01, EV-OFFICIAL-NODE-ROLLBACK-01 | Son sağlam v3 korunur; secret görüntüleyen akış tekrar açılmaz |
| DB-01 | MariaDB oluşturma ve güvenli bağlantı yöntemi | Sağlayıcı önerisi kaydedilir | `2026-08-30` tarihinde nötr kanıt etiketleriyle `spike-db` boş veritabanı ve ayrı `spike-db-user` kullanıcısı oluşturuldu. Tablo, migration, import veya gerçek veri yok. `localhost:3306` ve server-only `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` environment alanlarıyla canlı bağlantı doğrulandı; secret, credential veya gerçek DB/kullanıcı/hesap tanımlayıcısı belgeye alınmadı | PANEL/CANLI | PASS | EV-LIVE-DB-01 | Boş DB sonradan kaldırılır |
| DB-02 | `SELECT 1` | Güvenli bağlantıda başarılı, ayrıntı sızmaz | Olay sonrası yeni secret'larla hardened probe gerçek Hostinger MySQL `SELECT 1` sonucunu HTTPS 200 `{"status":"ready"}`, correlation ID `e99628b1-7221-48bb-b39d-571f5c62f328` olarak doğruladı. Veritabanı ayrıntıları yanıtta yok | CANLI | PASS | EV-LIVE-DB-SELECT1-02 | DB sonradan kaldırılır |
| CRN-01 | Desteklenen HTTP yöntemleri | Tek üretim yöntemi canlı seçilebilir | Resmi Hostinger belgeleri Business planda cron ve `Custom` cron komutunu destekliyor. Node uygulamasına özel scheduler belgelenmemiştir; canlı, secretsız HTTP çağrı deneyi yapılmadı | RESMİ | UNKNOWN | EV-OFFICIAL-CRON-01 | Cron oluşturulmadı |
| CRN-02 | Sabit özel Authorization header | Değer loglanmadan destek ölçülür | Aday yöntem ayrı klasik site cron'undan `curl` + `Authorization: Bearer`; canlı ve secretsız probe bekleniyor | PANEL/CANLI | UNKNOWN | EV-PANEL-CRON-02 | Cron oluşturulmadı |
| CRN-03 | Dinamik timestamp + HMAC-SHA256 | Tam canonical girdi her çağrıda imzalanır | Ölçülmedi | CANLI | UNKNOWN | — | Cron devre dışı |
| CRN-04 | Saat dilimi | Gerçek tetik zamanı ve panel timezone'u belirlenir | Resmi Hostinger cron zamanlaması UTC+0 olarak belgeleniyor; gerçek tetik zamanı henüz ölçülmedi | RESMİ/CANLI | UNKNOWN | EV-OFFICIAL-CRON-TZ-01 | Cron devre dışı |
| CRN-05 | Timeout | Sınırlı gecikmede davranış ölçülür | Ölçülmedi | CANLI | UNKNOWN | — | Cron devre dışı |
| CRN-06 | Hata ve retry | Kontrollü başarısız yanıtta tekrar davranışı ölçülür | Ölçülmedi | CANLI | UNKNOWN | — | Cron devre dışı |
| CRN-07 | Üst üste çağrı | Zararsız probe ile overlap davranışı ölçülür | Ölçülmedi | CANLI | UNKNOWN | — | Cron devre dışı |
| WEB-01 | HTTPS | Geçici alt alan adı geçerli HTTPS sunar | Geçici Hostinger alan adı geçerli HTTPS ile 200 sunuyor | CANLI | PASS | EV-LIVE-HTTPS-01 | Alt alan adı sonradan kaldırılır |
| WEB-02 | Dinamik no-store / CDN | API/readiness/probe CDN ve tarayıcıda saklanmaz | Otomatik Hostinger CDN açık; root, liveness ve readiness `private, no-store`; güvenlik başlıkları mevcut | CANLI | PASS | EV-LIVE-CACHE-01 | Probe kapalı tutulur |
| WEB-03 | PWA manifest | HTTPS, doğru MIME ve manifest içeriği | 200, `application/manifest+json`; ad, scope, standalone ve üç ikon mevcut | CANLI | PASS | EV-LIVE-PWA-01 | Uygulama sonradan kaldırılır |
| WEB-04 | Service worker | Yalnız güvenli statik allowlist cache'lenir | Yeni canlı sürümde `/sw.js` 200, `application/javascript`, `private, no-store` ve `Service-Worker-Allowed: /`; manifest 200. Worker güvenli statik allowlist ile sınırlı | CANLI | PASS | EV-LIVE-SW-02 | Uygulama sonradan kaldırılır |
| OPS-01 | Günlük ve isteğe bağlı yedek | Gerçek seçenekler görünür | Kullanıcının işlem anı onayıyla plan-geneli manuel yedek başlatıldı. Panel önce `Devam ediyor` gösterdi; ardından dosya yedeği listesinde `2026-08-30 22:51 (Özel)` kaydı göründü. Panel saat dilimi ayrıca doğrulanmadı | PANEL | PASS | EV-PANEL-BACKUP-03 | 24 saatlik manuel yedek hakkı kullanıldı; yeniden başlatılmaz |
| OPS-02 | MariaDB geri yükleme yolu | Portal Pusula readiness girdisi birebir seçilebilir ve ayrı disposable hedefe import edilebilir | Doğru kaynak seçildi; 550 byte gzip SQL 0 `CREATE TABLE`, journal yok ve 0 yasak directive içerdi. İkinci disposable hedef import'u hatasız tamamlandı; sonrasında boş marker, 0 tablo yapısı bağlantısı ve journal yokluğu doğrulandı | PANEL/CANLI | PASS | EV-PANEL-DBBACKUP-03, EV-RST-READINESS-01 | Yalnız readiness-only boş kaynak; production write/restore başlatılmadı |
| OPS-03 | Log saklama/görüntüleme | Erişim yolu ve görülebilen süre belirlenir | Runtime logs ekranı zaman ve seviye filtresi, hata/sorun sayacı ve son dağıtımı gösteriyor; kesin saklama süresi henüz ölçülmedi | PANEL | UNKNOWN | EV-PANEL-RUNTIMELOG-01 | Uygulanamaz |
| OPS-04 | Spike DB yedek/geri yükleme kanıtı | Readiness backup indirme, custody ve ayrı hedef restore zinciri ölçülür | İlk deneme yanlış kaynak nedeniyle `FAIL/BLOCKED` oldu; 34 CMS-benzeri tablo yalnız disposable hedefte görüldü, işlem durduruldu, plaintext temizlendi, yanlış DB/kullanıcı exact cleanup `PASS`, artefakt mantıksal karantinaya alındı. Doğru tekrar 0 tablo/journal yok ile `PASS`; AES-256-GCM ciphertext ve ayrı DPAPI/ACL anahtar custody kontrolleri `PASS` | PANEL/CANLI/YEREL | PASS — readiness-only | EV-PANEL-BACKUP-COVERAGE-03, EV-RST-WRONG-SOURCE-01, EV-RST-READINESS-01 | Komut 3C şema/journal/veri restore'u `UNKNOWN` |
| SEC-01 | Uygulama secret sızıntısı | İstemci paketi, yanıt ve loglarda değer yok | Readiness yanıtları rotasyon sonrasında da yalnız generic 404/200 verdi; güncel secret değerleri okunmadı veya kaydedilmedi. Kapsamlı canlı paket/log kontrolü bekliyor | CANLI | UNKNOWN | EV-LIVE-SECRET-03 | Güncel secret'lar gizli tutulur |
| SEC-02 | Panel/rollback secret görünürlüğü | Secret'lar model-visible UI snapshot'larında maskeli kalır | Rollback ayar ekranı önceki `DB_PASSWORD` ve `READINESS_BEARER_TOKEN` değerlerini maskesiz sundu. Deployment başlatılmadı; kullanıcı iki değeri de rotasyon etti, app restart edildi ve eski değerler geçersiz kılındı. Güvenli rollback yöntemi henüz yok | PANEL/CANLI | BLOCKED | EV-SEC-ROLLBACK-01 | Riskli ekran tekrar açılmaz; secret/credential değerleri asla belgeye alınmaz |

## Üretim karar durumu

- Üretim Node LTS / `engines`: **Node 24.x CANLI KANITLANDI; Komut 3C kaynak sözleşmesi `>=24 <25`, npm `>=12 <13` olarak ADR-0003 ile KARARLAŞTIRILDI; engines içeren güncel ZIP henüz canlıya dağıtılmadı**
- Dağıtım yöntemi: **SPIKE İÇİN ZIP KANITLANDI; üretim GitHub/ZIP kararı bekliyor**
- Build/start: **`npm run build` (`next build --webpack`) + Hostinger otomatik Next.js start/port 3000 KANITLANDI**
- Cron HTTP yöntemi: **KARAR VERİLMEDİ**
- Cron auth modu: **KARAR VERİLMEDİ**
- MariaDB güvenli bağlantı yöntemi: **`localhost:3306` + ayrı server-only environment alanları ve gerçek `SELECT 1` CANLI KANITLANDI**
- Rollback yöntemi: **BLOKELİ; Node'a özel tek tık rollback belgelenmedi, güvenli aday ayrı staging Node app + ayrı DB üzerinde sürümlü ZIP doğrulaması**
- Yedek/geri yükleme: **PLAN-GENELİ MANUEL DOSYA + DB YEDEĞİ PANELDE KANITLANDI; READINESS-ONLY BOŞ KAYNAĞIN AYRI DISPOSABLE HEDEF RESTORE'U VE YEREL ŞİFRELİ RECOVERY KOPYASI PASS; KOMUT 3C ŞEMA/JOURNAL/VERİ RESTORE'U UNKNOWN**

İki cron auth modu aynı anda etkinleştirilmeyecek. Güvenli özel header kanıtlanamazsa query string/body/path kullanılmayacak ve sonuç engel olarak kaydedilecektir.

## Canlı envanter notları

- Kullanıcı plan yükseltmesini tamamladı; Node.js Web App oluşturma ve 1/5 uygulama kapasitesi canlı olarak doğrulandı.
- Geçici uygulama `sandybrown-wolf-559614.hostingersite.com` adresinde üretim alan adına bağlanmadan yayında.
- v1, Hostinger'ın eski glibc ortamında native SWC ve `next.config.ts` yükleme yolunda başarısız oldu.
- `next.config.mjs` ve `next build --webpack` düzeltmesi native SWC engelini aştı; v2 yalnız ZIP'e yanlışlıkla alınan test dosyaları nedeniyle typecheck'te durdu.
- Test dosyaları çıkarılmış v3, `2026-08-30 12:31 +03:00` civarında 1 dakika 8 saniyede tamamlandı ve `Akım` oldu.
- Bilinen sağlam v3 arşivi: `portal-pusula-spike-20260830-v3.zip`, 118569 bayt, SHA-256 `F022C6C2DC0BBD31E14CC22C6EB119CDF2C241DB6A7AB407CFD2E2E033D3E642`.
- Hostinger otomatik CDN açık; bağımlılık güvenlik taramasında kritik/yüksek/orta/düşük/bilinmeyen bulgu 0.
- Backup UI aktif; kullanıcı onayıyla plan-geneli manuel yedek oluşturuldu. Dosya yedeği listesinde `2026-08-30 22:51 (Özel)` kaydı göründü; panel saat dilimi ayrıca doğrulanmadı.
- Veritabanı yedeği listesinde aynı özel yedek ve 14 DB seçeneği görüldü; Portal Pusula spike DB'nin kapsamda olduğu boolean kontrolle doğrulandı. Gerçek DB/kullanıcı/hesap tanımlayıcıları kaydedilmedi.
- İlk restore girişimi yanlış kaynak seçimi nedeniyle `FAIL/BLOCKED` kapatıldı: beklenen 0 tablo/journal yok imzasına karşı 34 CMS-benzeri tablo yalnız disposable hedefte gözlendi. İşlem durduruldu; plaintext temizliği ile yanlış disposable DB/kullanıcı exact cleanup `PASS` oldu. Yanlış kaynak şifreli artefaktı mantıksal karantinada, anahtarı ayrı erişim-kısıtlı anahtar dizinindedir.
- Doğru readiness kaynağı birebir seçildi. 550 byte gzip SQL için 0 `CREATE TABLE`, journal yok ve 0 yasak directive doğrulandı; ikinci disposable hedef import'u hata olmadan tamamlandı ve boş marker, 0 tablo yapısı bağlantısı, journal yok sonucu verdi. Production write/restore başlatılmadı.
- Doğru recovery artefaktı `PPBK1`/AES-256-GCM ile 583 byte ciphertext olarak korundu; SHA-256 `83df1d5353615b339274f8f17910a8b0a3569709bd2f2a61cb4bb241fa5d15c1`. Anahtar ayrı ACL-kısıtlı dizinde, DPAPI `LocalMachine` ve yalnız hedef Windows kullanıcı SID'si/`SYSTEM` ACL sınırındadır. AES/auth/source hash/DPAPI roundtrip `PASS`; geçici plaintext ve restore temp dizini silindi. Sağlayıcı indirmesinin kısa süre `Downloads` alanına düşmesi kaydedilmiş sapmadır ve exact kopya hash doğrulamasından sonra silinmiştir. Bu model aynı makine/kullanıcı bağlamına bağımlıdır; off-site recovery garantisi değildir.
- Resmi Hostinger belgelerinde Business plan için UTC+0 zamanlamalı `Custom` cron desteği doğrulandı; Node'a özel scheduler veya tek tık rollback yolu belgelenmedi. Güvenli dağıtım/geri dönüş adayı ayrı staging Node app + ayrı DB ve sürümlü ZIP'tir.
- Cron kaynağı oluşturulmadı; production write/restore başlatılmadı.
- `2026-08-30` tarihinde spike için nötr kanıt etiketleriyle boş `spike-db` ve ayrı `spike-db-user` oluşturuldu; gerçek DB/kullanıcı/hesap tanımlayıcıları kaydedilmedi. Bu ilk readiness kuruluş adımında gerçek veri, tablo, migration veya import yoktu; production write/restore başlatılmadı.
- Dağıtılan yeni arşiv `dist/portal-pusula-hostinger.zip`; SHA-256 `C4539E54D42AF82DC0798E346277D31BA97548EA1380468A8F8EC63ACF26CDB3`. Dağıtım 50 saniyede `Tamamlandı` / `Akım` oldu ve Node 24.x ile çalışıyor.
- Yeni canlı sürümde ana sayfa 200 ve `private, no-store`; liveness 200 `{"status":"ok"}`; headersız readiness 404 `{"status":"not_found"}`; manifest 200; `/sw.js` 200, `application/javascript`, `private, no-store`, `Service-Worker-Allowed: /` olarak doğrulandı.
- `2026-08-30` tarihinde 16 karakterlik ASCII alfanümerik `READINESS_BEARER_TOKEN` kullanıcı tarafından kalıcı uygulama environment akışında hPanel'e gizli eklendi; secret token değeri belgeye veya repoya alınmadı. `Ekle` ardından `Değişiklikleri uygula` otomatik deployment başlattı ve dağıtım tamamlandı.
- Geçerli bearer ile DB ayarları yokken readiness 503 `{"status":"unavailable"}` ve correlation ID `7b3ca422-1e1c-4d24-9ade-0e5a86fc51e1` verdi; böylece auth sınırı DB'den bağımsız kanıtlandı.
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` kalıcı server-only environment anahtarları eklendi; değerler ve parola kaydedilmedi. Yeniden dağıtım tamamlandı; gerçek Hostinger MySQL `SELECT 1` sonucu readiness 200 `{"status":"ready"}`, correlation ID `aa35be2a-aa0d-4530-9084-43a2620ce464` oldu.
- Rollback ayar ekranının model-visible UI snapshot'ında önceki `DB_PASSWORD` ve `READINESS_BEARER_TOKEN` değerleri maskesiz göründü. Deployment başlatılmadan çıkıldı; hiçbir secret değeri belgeye yazılmadı.
- Olay sonrasında kullanıcı `DB_PASSWORD` ve `READINESS_BEARER_TOKEN` değerlerini yenileriyle rotasyon etti; uygulama restart edildi ve eski değerler geçersiz kaldı. Rotasyon sonrası headersız readiness 404, correlation ID `a5a1512c-9cac-412e-b5c0-42ff90e4bb62`; hardened yetkili probe 200 `{"status":"ready"}`, correlation ID `e99628b1-7221-48bb-b39d-571f5c62f328` verdi.
- Güvenli ve secretsız rollback yöntemi bulunana kadar rollback kanıtı blokeli; cron canlı deneyi ve güncel Komut 3C şema/journal/veri restore'u bekliyor. Plan-geneli manuel yedek ile readiness-only boş kaynak restore'u tamamlandı; bu dar sonuç Komut 3C recovery kapısını kapatmaz. Bu nedenle Dilim 0 için `GO` verilmez.
- Kullanıcının satış/landing sayfası görünümüne ilişkin tasarım itirazı kaydedildi. Sonraki yerel dilimde dashboard shell, ana navigasyon ve genel bakış ekranı satış arayüzünden ayrıştırılmış bir “operasyon masası” olarak yeniden tasarlandı; yerel kalite kapıları geçti. Bu değişiklik canlı Hostinger spike kanıtı değildir.

## Komut 3C kanıt ayrımı

Komut 3C'de Node/npm engines sözleşmesi, iç endpoint generic 404/202 politikası, `0003_platform_cron_dispatch_gate` ve architecture/security/backup-restore runbook'ları yerel kaynakta eklenmiştir. Bu bölüm yeni bir canlı deney kaydı değildir:

- güncel Komut 3C ZIP'i deploy edilmedi;
- `0001`/`0002`/`0003` Hostinger DB'ye uygulanmadı;
- `CRON_ENDPOINT_ENABLED`, `CRON_BEARER_TOKEN` ve `CRON_MIN_INTERVAL_SECONDS` canlı environment'a eklenmedi;
- Hostinger cron exact `POST`/Authorization, timezone, timeout, retry ve overlap davranışı hâlâ `UNKNOWN`;
- Portal Pusula readiness DB'sini kapsayan manuel backup `PANEL PASS`; boş kaynağın ayrı hedef restore'u ve yerel şifreli recovery kopyası `PASS`, fakat Komut 3C şema/journal/veri restore'u `UNKNOWN`;
- secret-safe uygulama rollback'i hâlâ `BLOCKED`.

Dolayısıyla bu belgedeki önceki Node/build/readiness/PWA ve readiness-only restore `PASS` sonuçları korunur; Komut 3C migration/cron/deploy veya güncel şema recovery maddelerine taşınmaz.

## Duraklama güvenliği

Geçici Node.js uygulaması yeni ZIP sürümüyle yayındadır; v3 geri dönüş adayı olarak korunur. Üretim alan adı bağlı değildir; gerçek müşteri/finans verisi veya cron yoktur. Boş spike DB ve ayrı kullanıcıyla rotasyon sonrası gerçek MySQL `SELECT 1` kanıtlanmıştır. Güncel secret değerleri gizlidir; önceki değerler rotasyonla geçersiz kılınmıştır. Readiness yetkisiz erişimde fail-closed 404; geçerli bearer ile DB hazır olduğunda generic 200 verir. Secret'ları model-visible sunmayan bir yöntem bulunana kadar rollback blokelidir. Kullanıcı onaylı plan-geneli `2026-08-30 22:51 (Özel)` manuel dosya ve DB yedeği panelde mevcuttur. Readiness-only boş kaynak ikinci disposable hedefte 0 tablo/journal yok sonucu ile restore edilmiş; şifreli recovery custody'si doğrulanmıştır. Production write/restore başlatılmadı. Güncel Komut 3C şema/journal/veri restore'u ile cron canlı deneyi yapılmadan Dilim 0 `GO` verilmez. Her kullanıcı devri, hata veya bekleme öncesi bu bölüm yeniden doğrulanır.
