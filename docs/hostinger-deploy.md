# Hostinger dağıtım, güvenli giriş ve müşteri dilimi

Bu runbook, Hostinger Business Node.js Web App hedefindeki güncel Portal Pusula dağıtımını kapsar. Kaynakta güvenli yönetici girişi, müşteri arayüzü/API'si ve `0004_customer.sql` hazırdır. Güncel ZIP henüz canlıya dağıtılmamış, `0004` mevcut Hostinger hedefinde uygulanmamış ve auth environment değerleri eklenmemiştir.

## Kanıtlanan runtime ve dağıtım kararı

- Geçici uygulama: `https://sandybrown-wolf-559614.hostingersite.com`
- Node.js: panelde 24.x, gerçek build runtime `v24.6.0`
- Engines: Node `>=24 <25`, npm `>=12 <13`
- Next.js: 16.3.3 App Router
- Paket yöneticisi: npm 12; lockfile v3
- Uygulama kökü: `./`
- Build çıktısı: `.next`
- Build: `npm run build` → `next build --webpack`
- Start: Hostinger Next.js başlangıcı (`next start`, platform port yönetimi)
- Dağıtım: kökünde `package.json` bulunan ZIP; v3 başarıyla `Akım`
- hCDN: otomatik etkin

Hostinger'ın eski glibc sürümü native SWC yolunu çalıştırmadı. Bu nedenle `next.config.mjs` ve webpack build [ADR-0003](./adr/0003-node24-npm12-hostinger-webpack.md) ile bağlı Hostinger uyumluluk sınırıdır; `next.config.ts` veya varsayılan native SWC build yoluna ayrı spike olmadan geri dönülmez.

## Deterministik ZIP oluşturma

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
npm run package:hostinger
```

Son komut `dist/portal-pusula-hostinger.zip` üretir. ZIP standardı Zip32/STORE, UTF-8 yollar, sabit tarih, sıralı girişler ve CRC32 kullanır; aynı kaynak iki çalıştırmada aynı SHA-256 değerini verir.

Uygulama ZIP'i DB şeması uygulamaz. npm/SSH erişimi olmayan, yeni ve tamamen boş disposable staging DB'si için hedefe bağlı SQL artefaktı gerekiyorsa [phpMyAdmin clean-only migration runbook'u](./phpmyadmin-clean-migration.md) izlenir; bu artefakt Hostinger ZIP'inin içine eklenmez.

Arşiv kökünde doğrudan `package.json`, `package-lock.json`, `.nvmrc`, `next.config.mjs`, `next-env.d.ts`, `tsconfig.json` ve `postcss.config.mjs` bulunur. `drizzle/` içindeki immutable `0000`/`0001` ile ileri yönlü `0002`/`0003`, `public/`, production için gereken migration scriptleri ve testleri çıkarılmış `src/` sabit allowlist ile dahil edilir. `src/**/*.test.ts(x)`, `tests/`, disposable DB/E2E/paketleme scriptleri, herhangi bir alt dizindeki `.env*`, özel anahtar/credential dosyaları, `.next/`, `node_modules/`, `dist/`, `outputs/`, `work/`, log/coverage/Playwright/test çıktıları ve Git verisi hariçtir. Nested yasak yol bulunduğunda paket içerik üretmeden fail-closed olur. Production ZIP migration dosyalarını taşısa da bu yalnız dağıtılabilir artefakt içeriğidir; canlı migration veya deploy kanıtı değildir.

## Hostinger yükleme akışı — bu turda uygulanmadı

1. Yerel kalite kapılarını ve ZIP içeriği doğrulamasını tamamla.
2. hPanel Node.js Web App dağıtımında yeni ZIP'i seç.
3. Node 24.x, kök `./` ve çıktı `.next` ayarlarını koru.
4. Build komutunun `npm run build` üzerinden `next build --webpack` çalıştırdığını doğrula.
5. Gerçek environment değerlerini yalnız kullanıcı hPanel'in güvenli alanına girer; eski token varsa yeni paket öncesi tam 16 ASCII alfanümerik rastgele değerle değiştirir. Cron değişkenlerini bu turda ekleme veya etkinleştirme.
6. Dağıtım `Akım` olduktan sonra ana sayfa, liveness, yetkisiz readiness, yetkili readiness ve `/sw.js` başlıklarını HTTPS üzerinden doğrula.
7. Runtime loglarında yalnız genel sonuç/correlation ID ara; raw DB hatası, parola, token veya Authorization değeri bulunmamalı.

## MySQL readiness ayarları

Hostinger aynı hesap içindeki MySQL erişimini `localhost:3306` üzerinden destekliyor. Uygulama connection string üretmez veya kabul etmez.

Hostinger environment alanında gereken adlar:

- `DB_HOST` — boş bırakılırsa `localhost`
- `DB_PORT` — boş bırakılırsa `3306`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `READINESS_BEARER_TOKEN`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD_HASH` — yeni değerlerde `auth:generate` çıktısındaki `$` içermeyen `scrypt:32768:8:1:<salt>:<key>` biçimi kullanılır; alana yalnız değer yazılır
- `SESSION_SECRET`
- `LOG_LEVEL` — isteğe bağlı, boşsa `info`

Gerçek değerleri Codex okumaz, yazmaz veya sohbet/belgeye istemez. `DB_NAME`, `DB_USER`, `DB_PASSWORD` ve tam 16 karakterlik, yalnız ASCII `A-Z`/`a-z`/`0-9` içeren rastgele readiness token eksik veya biçim dışıysa sınır fail-closed çalışır. 15/17 karakter, boşluk, Türkçe/özel karakter ve semboller kabul edilmez.

Hostinger'ın global `sql_mode` değeri paylaşımlı sağlayıcı ayarıdır. Portal Pusula bu değeri değiştirmez, `SET GLOBAL` yetkisi istemez ve global strict moda güvenmez. Uygulama havuzdan aldığı her bağlantıda, DB işi başlamadan önce exact canonical strict session modunu, UTC/InnoDB/integrity-check/`utf8mb4` sözleşmesini kurup geri okuyarak doğrular. Kurulum veya doğrulama başarısızsa bağlantı havuza dönmez; imha edilir ve ilgili endpoint genel fail-closed yanıt verir.

Komut 3C kaynaklarında ayrıca `CRON_ENDPOINT_ENABLED` ve `CRON_BEARER_TOKEN` adları tanımlıdır; bunlar yalnız yerel, varsayılan kapalı aday içindir. Bu turda hPanel'e eklenmez. Aday ancak `CRON_ENDPOINT_ENABLED` exact `true`, cron token exact 43 base64url karakter ve readiness token'dan farklı olduğunda açılabilir. Exact secret doğrulaması, DB advisory lock, batch 10 ve 4 saniye deadline korunur. Hostinger cron'un exact `POST`, custom Authorization header ve güvenli secret saklama yeteneği; güvenli çağrı sıklığı; token rotasyon/iptal prosedürü canlı olarak kanıtlanmadan bu route etkinleştirilmez.

Komut 3C ile yalnız etkin adayda `CRON_MIN_INTERVAL_SECONDS` da zorunludur; leading zero/işaret/ondalık/exponent/whitespace/Unicode kabul etmeyen canonical `60..86400` saniye aralığı dışı fail-closed'dur. DB'deki `cron_dispatch_gate` process/restart'lar arasında son permit zamanını korur. Minimum aralık içinde kalan yetkili çağrı dispatch ve advisory lock çalıştırmadan, izin verilen çağrıyla aynı generic 202 yanıtını alır. Bu yerel sözleşme Hostinger cron yöntem/header/timezone/retry/overlap davranışını kanıtlamaz; üç cron değişkeni hPanel'e bu turda eklenmez.

## Readiness davranışı

- Yöntem: yalnız `GET /api/internal/readiness`.
- Auth: exact `Authorization: Bearer <token>`; SHA-256 digest + `timingSafeEqual`.
- Token biçimi: tam 16 ASCII alfanümerik karakter; rastgele üretilmiş olmalıdır.
- Yetkisiz veya token yapılandırılmamış: generic 404, DB çağrısı yok.
- Yetkili fakat DB yapılandırması eksik, session sözleşmesi kurulamaz/doğrulanamaz, DB ulaşılamaz veya timeout oluşur: generic 503.
- Yetkili ve aynı bağlantıda canonical session doğrulamasından sonra sabit `SELECT 1 AS readiness_ok` başarılı: generic 200.
- Yanıtlar: `private, no-store`, JSON ve correlation ID.
- Havuz: `connectionLimit: 2`, `maxIdle: 2`, `waitForConnections: false`, 2 saniye connect/query ve 2,5 saniye toplam deadline.
- `multipleStatements` kapalıdır; SQL sabittir ve kullanıcı girdisi almaz.
- Raw MySQL Error/log yoktur; `DB_PASSWORD`, `READINESS_BEARER_TOKEN` ve Authorization redakte edilir.

## hCDN ve service worker

Canlı v3'te hCDN, public `/sw.js` dosyasına Next `Cache-Control` ve `Service-Worker-Allowed` başlıklarını uygulamadı. Yeni paket public çakışmasını kaldırır ve aynı worker içeriğini Node Route Handler üzerinden sunar. Canlı kabulte şu başlıklar birlikte görülmelidir:

- `Cache-Control: private, no-store, max-age=0, must-revalidate`
- `Content-Type: application/javascript; charset=utf-8`
- `Service-Worker-Allowed: /`

`offline-v1.html` hassas veri taşımadığı için sürümlü/public kalır. Worker yalnız offline belgeyi ve sürümlü ikonları cache'ler.

## Redeploy ve geri alma

- Üç ZIP dağıtımından test dosyaları çıkarılmış v3 canlıda sağlam `Akım` sürümdür.
- Güncel yerel paket artık `0001` platform tablolarını, bunlara forward-only CHECK constraint'leri ekleyen `0002` audit fix'ini, teknik `0003` cron gate tablosunu ve varsayılan kapalı cron route'unu taşır; bu nedenle önceki spike'ın basit redeploy'u olarak değerlendirilmez. Ayrı backup/restore kanıtı, migration onayı ve canlı değişiklik penceresi olmadan yüklenmez.
- Ortak MariaDB session initializer ve fail-closed doğrulamasını içermeyen v3 ya da başka bir eski ZIP, güncel DB kullanan ortama rollback adayı değildir. Önceki kod ancak yeni şemayla uyumluluğu kanıtlanıp aynı session sözleşmesiyle yeniden paketlenerek tüm kalite ve canlı kabul kapılarından geçerse aday olabilir.
- ZIP redeploy kanıtlandı, fakat secret-safe gerçek rollback/önceki sürüme dönüş yöntemi bulunmadığı için durum `BLOCKED`dır ve bu alt adımda PASS sayılmaz.
- `/api/internal/cron/dispatch` kaynakta vardır fakat varsayılan kapalıdır; production job ve outbox registry'leri boştur. hPanel cron kaydı, cron secret'ı, gerçek handler veya dış adapter bu alt adımda yoktur.

## Komut 3C canlı olmayan sınır

Komut 3C kodlama turunda canlı Hostinger DB/migration, ZIP deploy, environment, cron, backup veya restore işlemi yapılmamıştır. Sonraki kullanıcı onaylı operasyon adımında plan-geneli manuel dosya + DB backup oluşturulmuş ve Portal Pusula readiness spike DB kapsamı panelde doğrulanmıştır. Bu boş kaynak ikinci disposable hedefe hatasız import edilerek 0 tablo/journal yok sonucu vermiş; şifreli yerel recovery kopyası ve ciphertext checksum'u doğrulanmıştır. Production write/restore başlatılmamıştır. Güncel Komut 3C şema/journal/veri restore'u yapılmamış ve `UNKNOWN` kalmıştır.

- `0001_platform_job_outbox_audit.sql` yalnız `scheduled_job`, `job_run`, `outbox_event` ve `audit_event` tablolarını ekler; yalnız disposable MariaDB 11.4.8 üzerinde kanıtlanmıştır.
- Immutable `0000`/`0001` değiştirilmemiştir. `0002_platform_state_constraints.sql` yeni tablo, kolon, domain/auth/finans nesnesi veya trigger eklemeden yalnız ileri yönlü named `CHECK` constraint'leri ekler: attempt sınırları, status/lease birlikteliği, `job_run` outcome/completion ilişkisi, audit actor allowlist'i, canonical lower-case UUID ve boşluksuz yazdırılabilir ASCII sözleşmesi.
- `0002` yalnız disposable MariaDB'de clean migrate/no-op, gerçek constraint enforcement ve regresyon kapılarıyla kanıtlanır. Production ZIP içinde yer alır fakat Hostinger DB'ye uygulanmamış ve ZIP canlıya dağıtılmamıştır.
- `0003_platform_cron_dispatch_gate.sql` yalnız `cron_dispatch_gate` teknik tablosunu ekler. Permit/suppression/concurrency/time invariant'ı disposable yerel MariaDB'de PASS'tir; canlı Hostinger migration veya scheduler PASS'i değildir.
- Job/outbox claim, lease/fencing, retry/dead-letter, bounded catch-up, audit append ve transactional outbox davranışları yerel gerçek DB testlerinden geçmiştir. Bu, Hostinger DB migration PASS'i değildir.
- Cron adayı yalnız exact `POST` + exact Bearer kabul eder; kapalı/yetkisiz durumda generic 404, DB/gate/dispatch hatasında generic 503, permit veya dayanıklı suppression durumunda aynı generic 202 verir. Batch 10, deadline 4 saniye, DB frekans kapısı ve DB adını açığa çıkarmayan nonblocking advisory lock kullanır. Yanıt semantiği [ADR-0002](./adr/0002-internal-endpoint-response-policy.md) ile bağlıdır.
- Production registry ve adapter listeleri bilinçli olarak boştur; canlı iş veya dış etki yoktur.
- [Ayrı hedefte readiness restore'u](./backup-restore.md) ve yerel şifreli recovery kopyası dar kapsamda `PASS`tir. Komut 3C'nin toplam yedi tablolu (altı teknik + journal), dört journal satırlı güncel şema/veri restore'u; Hostinger migration; cron yöntem/header/secret ve gerçek scheduler davranışı; güvenli çağrı sıklığı; token rotasyonu; gerçek rollback ve manuel dead-letter/requeue prosedürü açık blocker olarak kalır. Plan-geneli manuel backup kapsamı `PANEL PASS`tir.

## Canlı kabul kontrolü

- [ ] Yeni ZIP build'i `Akım` ve runtime hata sayısı 0.
- [ ] Ana sayfa 200; public liveness minimal 200.
- [ ] Readiness header olmadan ve yanlış header ile generic 404.
- [ ] Doğru header + eksik/yanlış DB ayarında generic 503.
- [ ] Doğru header + Hostinger MySQL ile canonical session doğrulaması ve aynı bağlantıda `SELECT 1` sonucu generic 200.
- [ ] Yanıt/log/client bundle içinde parola, token veya bağlantı ayrıntısı yok.
- [ ] `/sw.js` Node yanıtında no-store, JS MIME ve `Service-Worker-Allowed: /` var.
- [ ] PWA Cache Storage yalnız güvenli sürümlü allowlist'i içeriyor.
- [ ] Güncel ZIP Node 24.x/npm 12 engines sözleşmesiyle build/start oluyor.
- [ ] Güncel ZIP ortak MariaDB session initializer'ı içeriyor; global `sql_mode` değiştirilmeden her checkout'ta strict/UTC/InnoDB/integrity-check/`utf8mb4` doğrulanıyor.
- [x] Backup boş Portal Pusula readiness DB'sini kapsıyor ve ayrı disposable hedefte 0 tablo/journal yok sonucu doğrulandı.
- [ ] Backup güncel Komut 3C şemasını kapsıyor; toplam yedi tablo (altı teknik + journal), dört journal satırı ve kontrollü veri ayrı hedefte doğrulandı.
- [ ] `0001`/`0002`/`0003` migration journal/hash/şema kontrolleri onaylı pencerede geçiyor.
- [ ] Hostinger cron exact `POST` ve custom Authorization header'ı secret sızdırmadan destekliyor; timezone/retry/overlap ölçüldü.
- [ ] Yetkili permit ile dayanıklı suppression aynı generic 202'yi veriyor; gerçek gate/DB arızası generic 503 kalıyor.
- [ ] Secret-safe önceki uygulama sürümüne dönüş yolu tatbik edildi.
- [ ] Rollback adayı initializer içermeyen eski artefakt değil; aynı session sözleşmesiyle yeniden üretilmiş ve şema uyumluluğu kanıtlanmış sürüm.

Bu kontrol listesi güncel Komut 3C paketiyle canlı kanıtlanmadan maddeler Komut 3C PASS'i yapılamaz. Önceki spike'ın MySQL/hCDN PASS sonuçları tarihsel kanıt olarak korunur fakat güncel migration/ZIP/cron'a aktarılmaz. **DİLİM 0 GO: VERİLMEDİ.**

Komut 3C sonrası durum özeti: Node engines ve yerel mimari/güvenlik/runbook kararları kayıtlıdır; güncel cron, migration ve deployment `UNKNOWN`; plan-geneli manuel backup kapsamı `PANEL PASS`; readiness-only boş kaynak restore'u `PASS`; Komut 3C şema/journal/veri restore'u `UNKNOWN`; rollback `BLOCKED` durumundadır.

Komut 4 / auth için henüz HAZIR DEĞİL; Dilim 0 GO değildir.
