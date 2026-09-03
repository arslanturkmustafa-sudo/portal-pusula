# Hostinger dağıtım runbook'u — Müşteri–Proje ve Ortaklık Finansı

Bu runbook, `portal.muhendiskafasi.com.tr` üzerindeki Hostinger Business Node.js Web App hedefini ve `0011_customer_projects_partnership` ile gelen müşteri–proje, proje raporu ve 7 Emlak ortaklık finansı dilimini kapsar. Canlı veritabanı `0010_expenses_cards` seviyesindeyken yeni uygulama dağıtılmadan önce `0011_customer_projects_partnership` hedefe bağlı incremental paketle uygulanır. Mevcut auth, müşteri, sözleşme, ziyaret, finans, günlük plan, görev, proje, gider ve kart verileri korunur.

## Kanıtlanan runtime ve dağıtım kararı

- Üretim uygulaması: `https://portal.muhendiskafasi.com.tr`
- Node.js: panelde 24.x, gerçek build runtime `v24.6.0`
- Engines: Node `>=24 <25`, npm `>=12 <13`
- Next.js: 16.3.3 App Router
- Paket yöneticisi: npm 12; lockfile v3
- Uygulama kökü: `./`
- Build çıktısı: `.next`
- Build: `npm run build` → `next build --webpack`
- Start: Hostinger Next.js başlangıcı (`next start`, platform port yönetimi)
- Dağıtım: `main` dalına bağlı Git akışı veya kökünde `package.json` bulunan deterministik ZIP
- hCDN: otomatik etkin

Hostinger'ın eski glibc sürümü native SWC yolunu çalıştırmadı. Bu nedenle `next.config.mjs` ve webpack build [ADR-0003](./adr/0003-node24-npm12-hostinger-webpack.md) ile bağlı Hostinger uyumluluk sınırıdır; `next.config.ts` veya varsayılan native SWC build yoluna ayrı spike olmadan geri dönülmez.

## Deterministik ZIP oluşturma

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:mariadb
npm run build
npm run test:e2e:run
npm run package:verify
```

Son komut `dist/portal-pusula-hostinger.zip` dosyasını iki kez üretip byte-identical olduğunu doğrular ve nihai SHA-256 değerini verir. ZIP standardı Zip32/STORE, UTF-8 yollar, sabit tarih, sıralı girişler ve CRC32 kullanır.

Uygulama ZIP'i DB şeması uygulamaz. npm/SSH erişimi olmayan, yeni ve tamamen boş disposable staging DB'si için [phpMyAdmin clean-only migration runbook'u](./phpmyadmin-clean-migration.md); journal'ı bulunan mevcut DB'de yalnız sıradaki migration için [phpMyAdmin incremental migration runbook'u](./phpmyadmin-incremental-migration.md) izlenir. SQL artefaktları Hostinger ZIP'inin içine eklenmez.

Arşiv kökünde doğrudan `package.json`, `package-lock.json`, `.nvmrc`, `next.config.mjs`, `next-env.d.ts`, `tsconfig.json` ve `postcss.config.mjs` bulunur. `drizzle/` içindeki `0000`–`0011`, `public/`, production için gereken migration scriptleri ve testleri çıkarılmış `src/` sabit allowlist ile dahil edilir. `src/**/*.test.ts(x)`, `tests/`, disposable DB/E2E/paketleme scriptleri, herhangi bir alt dizindeki `.env*`, özel anahtar/credential dosyaları, `.next/`, `node_modules/`, `dist/`, `outputs/`, `work/`, log/coverage/Playwright/test çıktıları ve Git verisi hariçtir. Nested yasak yol bulunduğunda paket içerik üretmeden fail-closed olur. Production ZIP migration dosyalarını taşısa da Hostinger build/start akışı migration çalıştırmaz; canlı DB yalnız ayrı incremental paketle yükseltilir.

## DB-first Hostinger yükleme akışı

1. Proje dalının yerel kalite kapıları ve PR CI sonucu tamamlanır; Hostinger'ı tetikleyebilecek `main` birleştirmesi bekletilir.
2. Canlı DB yedeği ve 11 satırlı journal doğrulanır; `customer_project` ile üç ortaklık tablosunun ve sözleşme/alacak `project_id` kolonlarının henüz bulunmadığı kontrol edilir.
3. Uygulama yazmaları bakım penceresi boyunca dondurulur. [Incremental migration runbook'u](./phpmyadmin-incremental-migration.md) ile yalnız `0011_customer_projects_partnership` hedefe bağlı paketi üretilir, doğrulanır ve tek kez içe aktarılır.
4. Exact başarı satırı, 12 journal satırı, dört yeni tablo, backfill sayaçları, yedi yeni `RESTRICT` foreign key ve sürümlü CHECK/UNIQUE/index sözleşmesi doğrulanır.
5. PR `main` dalına birleştirilir. Hostinger Git bağlantısı otomatik dağıtıyorsa yeni commitin tamamlanması beklenir; değilse aynı doğrulanmış kaynakla yeniden üretilen `dist/portal-pusula-hostinger.zip` hPanel'den yüklenir.
6. Node 24.x, kök `./`, çıktı `.next` ve `npm run build` → `next build --webpack` ayarları korunur.
7. Bu dilim yeni environment değişkeni istemez. Mevcut secret/env değerleri değiştirilmez; cron değişkenleri eklenmez veya etkinleştirilmez.
8. Dağıtım `Akım` olduktan sonra liveness/readiness, giriş, müşteri–proje/sözleşme, görev uyumu, proje finans raporu, ortaklık, gider ve kart akışları doğrulanır; yalnız sonra yazma dondurması kaldırılır.
9. Runtime loglarında yalnız genel sonuç/correlation ID aranır; raw DB hatası, parola, token veya Authorization değeri bulunmamalıdır.

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
- `PORTAL_PUSULA_AUTH_STORAGE_MODE` — isteğe bağlı; varsayılan ve canlı kullanım `database`
- `LOG_LEVEL` — isteğe bağlı, boşsa `info`

Gerçek değerleri Codex okumaz, yazmaz veya sohbet/belgeye istemez. `DB_NAME`, `DB_USER`, `DB_PASSWORD` ve tam 16 karakterlik, yalnız ASCII `A-Z`/`a-z`/`0-9` içeren rastgele readiness token eksik veya biçim dışıysa sınır fail-closed çalışır. 15/17 karakter, boşluk, Türkçe/özel karakter ve semboller kabul edilmez.

Hostinger'ın global `sql_mode` değeri paylaşımlı sağlayıcı ayarıdır. Portal Pusula bu değeri değiştirmez, `SET GLOBAL` yetkisi istemez ve global strict moda güvenmez. Uygulama havuzdan aldığı her bağlantıda, DB işi başlamadan önce exact canonical strict session modunu, UTC/InnoDB/integrity-check/`utf8mb4` sözleşmesini kurup geri okuyarak doğrular. Kurulum veya doğrulama başarısızsa bağlantı havuza dönmez; imha edilir ve ilgili endpoint genel fail-closed yanıt verir.

Kaynakta ayrıca `CRON_ENDPOINT_ENABLED` ve `CRON_BEARER_TOKEN` adları tanımlıdır; bunlar varsayılan kapalı aday içindir. Bu sürümde hPanel'e eklenmez. Aday ancak `CRON_ENDPOINT_ENABLED` exact `true`, cron token exact 43 base64url karakter ve readiness token'dan farklı olduğunda açılabilir. Hostinger cron'un exact `POST`, custom Authorization header ve güvenli secret saklama yeteneği canlı olarak kanıtlanmadan bu route etkinleştirilmez.

Yalnız etkin cron adayında `CRON_MIN_INTERVAL_SECONDS` da zorunludur; canonical `60..86400` saniye aralığı dışı fail-closed'dur. Bu sürümde üç cron değişkeni hPanel'e eklenmez.

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

Canlı kabulte `/sw.js` yanıtında şu başlıklar birlikte görülmelidir:

- `Cache-Control: private, no-store, max-age=0, must-revalidate`
- `Content-Type: application/javascript; charset=utf-8`
- `Service-Worker-Allowed: /`

`offline-v1.html` hassas veri taşımadığı için sürümlü/public kalır. Worker yalnız offline belgeyi ve sürümlü ikonları cache'ler.

## Redeploy ve geri alma

- `0011_customer_projects_partnership` kolonları nullable eklediği için eski okuma yollarıyla uyumludur; ancak veri backfill'i nedeniyle migration penceresinde eski uygulama yazmaları kapalı kalır.
- Migration başarıyla uygulandıktan sonra eski uygulamaya dönmek dört yeni tabloyu veya proje snapshot'larını silmez. Eski kod bunları kullanmaz; buna rağmen dönüş boyunca yeni sözleşme/alacak yazılması veri bağı koparacağından yazma trafiği yeni sürüm tekrar etkin olana kadar kapalı tutulur.
- MariaDB DDL transactional değildir. Exact başarı satırı alınmayan incremental paket yeniden çalıştırılmaz; hedef salt okunur incelenir ve gerekirse yeni forward-fix migration hazırlanır.
- Önceki uygulama artefaktı yalnız secret-safe biçimde korunmuş, yeni şemayla uyumluluğu doğrulanmış ve aynı session güvenlik sözleşmesini taşıyorsa geri dönüş adayıdır.
- `/api/internal/cron/dispatch` varsayılan kapalıdır; bu dağıtım cron kurulumu veya değişikliği yapmaz.

## Canlı kabul kontrolü

- [ ] Yazma trafiği donduruldu; `0011_customer_projects_partnership` incremental importu exact başarı satırıyla tamamlandı.
- [ ] Journal 12 satır; dört yeni tablo, iki `ascii_bin` proje kolonu, sıfır eksik backfill, yedi yeni `RESTRICT` FK ve sürümlü CHECK/UNIQUE/index sözleşmesi doğrulandı.
- [ ] Git veya yeniden üretilmiş ZIP build'i `Akım` ve runtime hata sayısı 0.
- [ ] Ana sayfa 200; public liveness minimal 200.
- [ ] Readiness header olmadan ve yanlış header ile generic 404.
- [ ] Doğru header + eksik/yanlış DB ayarında generic 503.
- [ ] Doğru header + Hostinger MySQL ile canonical session doğrulaması ve aynı bağlantıda `SELECT 1` sonucu generic 200.
- [ ] Yanıt/log/client bundle içinde parola, token veya bağlantı ayrıntısı yok.
- [ ] `/sw.js` Node yanıtında no-store, JS MIME ve `Service-Worker-Allowed: /` var.
- [ ] PWA Cache Storage yalnız güvenli sürümlü allowlist'i içeriyor.
- [ ] Güncel ZIP Node 24.x/npm 12 engines sözleşmesiyle build/start oluyor.
- [ ] Güncel ZIP ortak MariaDB session initializer'ı içeriyor; global `sql_mode` değiştirilmeden her checkout'ta strict/UTC/InnoDB/integrity-check/`utf8mb4` doğrulanıyor.
- [ ] Migration öncesi güncel canlı DB yedeği ve hedef kimliği doğrulandı.
- [ ] `/projeler` üzerinde proje oluşturma/düzenleme çalışıyor.
- [ ] `/gorevler` üzerinde proje seçme, rozet ve filtreleme çalışıyor.
- [ ] `/finans/giderler` üzerinde genel ve proje bağlantılı gider oluşturma, filtreleme, düzenleme ve gerekçeli iptal çalışıyor; iptal edilen gider aktif toplamdan çıkıyor.
- [ ] `/finans/kartlar` üzerinde yalnız son dört hane ile kart oluşturma/düzenleme, ekstre-vade planını görme ve taksiti ödendi/planlandı işaretleme çalışıyor.
- [ ] Kredi kartı giderinde taksitlerin toplamı gider toplamına exact eşit; ödenmiş taksiti bulunan giderde finansal/kart planı değişikliği engelleniyor.
- [ ] `/musteriler` sözleşme düzenleme modu kendiliğinden kapanmıyor ve kayıt tamamlanıyor.
- [ ] `/musteriler` müşteri proje bağları oluşturuluyor/düzenleniyor; sözleşme yalnız aktif müşteri projesini seçiyor ve kullanımda olan bağ kaldırılamıyor.
- [ ] `/finans/raporlar` proje bazlı tahakkuk, tahsilat, gider, açık/gecikmiş alacak ve vergi öncesi faaliyet farkını doğru gösteriyor.
- [ ] `/finans/ortaklik` `%10/%25/%50` payı doğru hesaplıyor; aylık katkı gideri negatife çevirmeden ayrı tutuluyor ve parçalı tahsilatlar receipt defterinde izleniyor.
- [ ] Uygulama smoke kontrollerinden sonra yazma dondurması kaldırıldı.
- [ ] Hostinger cron exact `POST` ve custom Authorization header'ı secret sızdırmadan destekliyor; timezone/retry/overlap ölçüldü.
- [ ] Yetkili permit ile dayanıklı suppression aynı generic 202'yi veriyor; gerçek gate/DB arızası generic 503 kalıyor.
- [ ] Secret-safe önceki uygulama sürümüne dönüş yolu tatbik edildi.
- [ ] Rollback adayı initializer içermeyen eski artefakt değil; aynı session sözleşmesiyle yeniden üretilmiş ve şema uyumluluğu kanıtlanmış sürüm.

Kontrol listesi change window sırasında gerçek canlı sonuçlarla kapatılır. Bu belgenin güncellenmesi tek başına migration veya uygulama dağıtımı yapıldığı anlamına gelmez.
