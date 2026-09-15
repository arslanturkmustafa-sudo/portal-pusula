# Hostinger dağıtım runbook'u — Portal Pusula operasyon sürümü

Bu runbook, `portal.muhendiskafasi.com.tr` Hostinger Business Node.js Web App hedefini ve güncel operasyon sürümünü kapsar. Bu sürümün DB-first başlangıç koşulu, canlı journal'ın exact 24 kayıtla `0023_collection_card_accounts` seviyesinde olmasıdır. Daha eski hedef önce korunmuş sürümlü incremental runbook zinciriyle exact `0023` seviyesine getirilir. Ardından hedefe bağlı ve tek kullanımlık `0024_partial_card_payments` paketi uygulama deploy edilmeden uygulanır; final journal exact 25 kayıttır.

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

Son komut canonical uygulama artefaktı olan `dist/portal-pusula-hostinger.zip` dosyasını iki kez üretip byte-identical olduğunu doğrular ve nihai SHA-256 değerini verir. ZIP standardı Zip32/STORE, UTF-8 yollar, sabit tarih, sıralı girişler ve CRC32 kullanır. Dağıtımdan önce artefaktın byte boyutu, SHA-256 değeri ve kaynak commit'i change kaydına bağlanır. `dist/` altında benzer ad taşıyan başka bir ZIP, eski bir spike veya elle yeniden adlandırılmış kopya deployment ya da rollback adayı değildir.

Uygulama ZIP'i DB şeması uygulamaz. npm/SSH erişimi olmayan, yeni ve tamamen boş disposable staging DB'si için [phpMyAdmin clean-only migration runbook'u](./phpmyadmin-clean-migration.md) kullanılır. Journal'ı bulunan eski hedefler korunmuş tarihsel runbook zinciriyle yükseltilir; [0014/0015 yaşam döngüsü ve ters kayıt incremental runbook'u](./phpmyadmin-lifecycle-reversals-incremental.md), [0016/0017 finans hesabı ve görev–ziyaret incremental runbook'u](./phpmyadmin-finance-calendar-incremental.md) ve [0018 planlama ve gider kategorileri incremental runbook'u](./phpmyadmin-planning-expense-categories-incremental.md) değiştirilmeden korunur. Güncel canlı geçişte [0024 kısmi kart ödemesi incremental runbook'u](./phpmyadmin-partial-card-payments-incremental.md) izlenir ve `scripts/build-phpmyadmin-incremental-migration.mjs` ile yalnız `0024_partial_card_payments` için hedefe bağlı paket üretilir. Üretilmiş clean/incremental phpMyAdmin bundle artefaktları canonical Hostinger ZIP'ine girmez; sürümlü Drizzle migration SQL'leri ise doğrulama ve ileriye dönük bakım için paketlenir ancak install/build/start sırasında otomatik uygulanmaz.

Arşiv kökünde doğrudan `package.json`, `package-lock.json`, `.nvmrc`, `next.config.mjs`, `next-env.d.ts`, `tsconfig.json` ve `postcss.config.mjs` bulunur. `drizzle/` içindeki exact `0000`–`0024` zinciri, production için gereken üç migration scripti ve testleri çıkarılmış `src/` sabit allowlist ile dahil edilir. Clean zincir exact 25 migration, 25 journal kaydı, journal dışında 33 uygulama tablosu ve journal ile toplam 34 fiziksel tablodur. Public allowlist yalnız Mühendis Kafası logosu, üç PWA ikonu ve `offline-v1.html` dosyasıdır; `/sw.js` public dosya değil Node Route Handler'dır. `src/**/*.test.ts(x)`, `tests/`, disposable DB/E2E/paketleme scriptleri, `.env*`, özel anahtar/credential dosyaları, `.next/`, `node_modules/`, `dist/`, `outputs/`, `work/`, log/coverage/Playwright/test çıktıları ve Git verisi hariçtir. Nested yasak yol bulunduğunda paket içerik üretmeden fail-closed olur. Hostinger'a yüklenen ZIP'in kökünde `package.json` doğrudan görünmelidir; arşiv bir üst klasör içine sarılmaz.

## DB-first Hostinger yükleme akışı

1. Proje dalının yerel kalite kapıları ve PR CI sonucu tamamlanır; Hostinger'ı tetikleyebilecek `main` birleştirmesi bekletilir. Canonical ZIP final committen `npm run package:verify` ile yeniden üretilir; byte boyutu ve SHA-256 değeri kaydedilir.
2. Doğru canlı DB hedefi, bakım penceresi ve güncel yedeğin kapsamı iki bağımsız kontrolle doğrulanır. Yedek ayrı ve disposable bir hedefe geri yüklenip güncel şema, journal ve kontrollü veri doğrulamalarını geçmeden migration veya uygulama deploy'u başlatılmaz. Bu runbook ya da geçmiş bir restore kaydı güncel kanıt yerine geçmez.
3. Uygulama yazmaları ön kontrolden deploy sonrası smoke testleri bitene kadar dondurulur. Başlangıç journal'ı exact 24 satır, `MAX(id)=24`, `AUTO_INCREMENT=25` ve son kayıt kaynak zincirindeki `0023_collection_card_accounts` kimliğiyle (`created_at=1789195799696`, `hash=e4a5e27b1b6113baa0bafcc52b29c7d1e8a78a293ee326daf5eb086b48bed5e3`) eşleşmiyorsa durulur. `credit_card_installment_payment` tablosu önceden varsa da durulur; daha eski hedef önce kendi tarihsel runbook'larıyla exact `0023` seviyesine getirilir.
4. Canlı DB/server SHA-256 digest'lerine bağlı paket `PHPMYADMIN_INCREMENTAL_MIGRATION_TAG=0024_partial_card_payments`, `PHPMYADMIN_TARGET_DB_SHA256` ve `PHPMYADMIN_SERVER_VERSION_SHA256` process environment adlarıyla `npm run db:bundle:phpmyadmin:incremental` çalıştırılarak üretilir. Manifest; `expectedJournalCount=24`, önceki migration `0023_collection_card_accounts`, altı statement, migration `createdAt=1789383073515` ve `hash=e9dd804de1525319cc1da6fed05d4d4c69afa776dde4cda99457cfcdab6d1bf5` değerlerini göstermeli; manifest SQL SHA-256 değeri gerçek dosya hash'iyle eşleşmelidir. Yalnız `dist/portal-pusula-incremental-0024_partial_card_payments.sql` phpMyAdmin'de bir kez uygulanır. Exact `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` / `0024_partial_card_payments` sonucu, final journal 25 ve journal dışında 33 uygulama tablosu doğrulanmadan uygulama deploy edilmez. Postflight'ta `credit_card_installment_payment` tablosunun exact 10 kolonu, üç named CHECK'i, dört unique/primary indexi, bir tarih indexi ve üç `RESTRICT` FK'si bulunmalıdır. Eski `paid` taksitlerin her biri tutar, ödeme tarihi ve varsa `finance_transaction_id` korunarak exact bir `payment` satırına taşınmış olmalıdır; parent kolonları değiştirilmez. Exact başarı yoksa aynı SQL tekrar çalıştırılmaz; hedef salt okunur incelenir ve gerekirse yeni forward-fix hazırlanır.
5. DB adımı PASS olduktan sonra yalnız bu paketle aynı final committen üretilmiş canonical uygulama artefaktı kullanılır. Hostinger Git bağlantısı otomatik dağıtıyorsa commit `main`e ancak bu noktada birleştirilir. Manuel ZIP akışında yalnız `dist/portal-pusula-hostinger.zip` kullanıcı tarafından kendi gizli hPanel oturumunda yüklenir; secret değerlerini maskesiz gösterebilen ayarlar ekranı Codex veya başka model-visible otomasyonla açılmaz.
6. Node 24.x, npm 12, kök `./`, çıktı `.next`, `next.config.mjs`, `npm run build` → `next build --webpack` ve platformun `next start`/port yönetimi korunur. Sabit production portu tanımlanmaz; install/build/start komutlarına migration eklenmez.
7. Canlı auth exact `database` modunda kalır. E-posta bildirimi açılacaksa aşağıdaki e-posta ve cron değişkenleri kullanıcı tarafından gizli hPanel/GitHub alanlarına girilir; değerler repoya, ZIP'e, komut satırına veya sohbete taşınmaz.
8. Dağıtım `Akım` olduktan sonra liveness/readiness, giriş/kullanıcı yetkileri, alan redaksiyonu, yaşam döngüsü, void/ters kayıt, audit geçmişi, kart bazlı borçlar, manuel gider kategorileri, kasa/banka hesapları, firma görev raporu, haftalık/aylık nakit akışı ve müşteri/konum filtreli günlük plan doğrulanır; yalnız sonra yazma dondurması kaldırılır.
9. Runtime loglarında yalnız genel sonuç/correlation ID aranır; raw DB hatası, parola, e-posta/PII, token, Authorization değeri veya throttle bucket digest'i bulunmamalıdır.

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
- `EMAIL_NOTIFICATIONS_ENABLED` — yalnız exact `true` bildirimi açar
- `RESEND_API_KEY`
- `EMAIL_FROM_ADDRESS` — Resend üzerinde doğrulanmış gönderen adresi
- `EMAIL_FROM_NAME` — isteğe bağlı; boşsa `Portal Pusula`
- `CRON_ENDPOINT_ENABLED` — günlük özet için exact `true`
- `CRON_BEARER_TOKEN` — readiness token'dan farklı, tam 43 base64url karakter
- `CRON_MIN_INTERVAL_SECONDS` — önerilen `60`; canonical `60..86400`

Gerçek değerleri Codex okumaz, yazmaz veya sohbet/belgeye istemez. Hostinger manuel yeniden dağıtım ayarları mevcut environment değerlerini maskesiz gösterebildiği için bu ekran model-visible otomasyonda açılmaz. Böyle bir görünürlük olayı gerçekleşirse değerler tekrar edilmez; `DB_PASSWORD`, `READINESS_BEARER_TOKEN`, `SESSION_SECRET` ve yönetici kimlik bilgileri kullanıcı tarafından rotasyonla geçersiz kılınır. `DB_NAME`, `DB_USER`, `DB_PASSWORD` ve tam 16 karakterlik, yalnız ASCII `A-Z`/`a-z`/`0-9` içeren rastgele readiness token eksik veya biçim dışıysa sınır fail-closed çalışır. 15/17 karakter, boşluk, Türkçe/özel karakter ve semboller kabul edilmez.

Hostinger'ın global `sql_mode` değeri paylaşımlı sağlayıcı ayarıdır. Portal Pusula bu değeri değiştirmez, `SET GLOBAL` yetkisi istemez ve global strict moda güvenmez. Uygulama havuzdan aldığı her bağlantıda, DB işi başlamadan önce exact canonical strict session modunu, UTC/InnoDB/integrity-check/`utf8mb4` sözleşmesini kurup geri okuyarak doğrular. Kurulum veya doğrulama başarısızsa bağlantı havuza dönmez; imha edilir ve ilgili endpoint genel fail-closed yanıt verir.

GitHub Actions her gün 08.00'de ve bekleyen e-posta kuyruğunu güvenli biçimde boşaltmak için her saatin 10. dakikasında `Europe/Istanbul` zaman diliminde exact `POST /api/internal/cron/dispatch` çağrısı yapar. GitHub repository secret adı `PORTAL_PUSULA_CRON_BEARER_TOKEN` olup değeri Hostinger'daki `CRON_BEARER_TOKEN` ile aynıdır. Token curl komut argümanına değil stdin config'ine verilir ve yalnız `Authorization` header'ında taşınır. DB idempotency aynı güne ait özeti bir kez oluşturur; Resend idempotency anahtarı tekrar teslimi etkisizleştirir. Tek çağrı en fazla iki outbox teslimi dener ve her sağlayıcı isteği 1 saniyede kesilir; böylece 4 saniyelik endpoint bütçesi korunur. Cron environment'ı eksik veya biçim dışıysa endpoint fail-closed kalır.

Yeni gider e-postası yalnız başarıyla oluşturulan ilk kayıt için hazırlanır; idempotent tekrar kayıtları yeni bildirim üretmez. Gönderim hatası gider yazımını geri almaz; olay outbox içinde güvenli tekrar için kalır. Günlük e-posta; planlı/telafi bekleyen ziyaret, tamamlanmamış günlük iş veya vadesi bugün/geçmiş açık alacak ya da ödeme varsa aktif owner hesaplarına gider. Finans satırları yalnız `finance.reports.read` erişimi olan alıcıya eklenir; sabah özeti için tam nakit akış raporu değil dar vadeli-kalem sorgusu kullanılır.

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

## Canlı giriş sınırlaması

- Production auth exact `PORTAL_PUSULA_AUTH_STORAGE_MODE=database` kullanır; DB erişilemezse `environment` kimliğine geri düşmez.
- MariaDB'deki dayanıklı account bucket 15 dakikada 5, global bucket 15 dakikada 100 başarısız deneme sınırıdır; blok süresi 15 dakikadır.
- Opsiyonel network bucket yalnız ek sinyaldir. Hostinger proxy/IP header güven zinciri resmî olarak kanıtlanmadığı için bu header'lar hesap/global sınırların yerine geçmez ve tek başına istemci kimliği sayılmaz.
- Geçersiz, bloklanmış veya limiter/DB arızası nedeniyle fail-closed girişler ayrıntı sızdırmayan aynı `303` hata yönlendirmesini ve `private, no-store` politikasını kullanır.
- Parola, e-posta/PII, session secret, bucket digest'i, sayaç/blok durumu ve ham DB hatası response veya runtime loguna girmez.

## hCDN ve service worker

Canlı kabulte `/sw.js` yanıtında şu başlıklar birlikte görülmelidir:

- `Cache-Control: private, no-store, max-age=0, must-revalidate`
- `Content-Type: application/javascript; charset=utf-8`
- `Service-Worker-Allowed: /`

`offline-v1.html` hassas veri taşımadığı için sürümlü/public kalır. Worker yalnız offline belgeyi ve sürümlü ikonları cache'ler.

## Logo, görev raporu ve PDF sınırı

Görev raporu `public/brand/muhendis-kafasi-logo.png` dosyasını yerel paket asset'i olarak kullanır; hotlink yapılmaz. Kaynak, şirketin resmî sitesindeki `https://muhendiskafasi.com.tr/wp-content/uploads/2023/01/muhendis-kafasi-logo-site.png` adresidir. Yerel PNG 191×100, 16.739 byte ve SHA-256 `c0c38daafab133838af67f46febc816c897a6da9dc6a1d08579c7ec6d81d49f9` olmalıdır. Açık lisans iddiası yoktur; ürün içi kullanım şirket sahibinin onay sınırındadır.

`/gorevler/rapor` binary PDF endpoint'i üretmez. `tasks.reports.export` izni olan kullanıcı firma, durum ve en fazla 366 günlük vade filtresiyle en çok 1.000 görevi açar; tarayıcının yazdırma diyaloğunda “PDF olarak kaydet” seçeneğini kullanır. Kabulde A4 önizleme, Türkçe karakter, logo, sayfa kırılması ve finans alanı bulunmadığı doğrulanır.

## Mobil kabul

- 360, 390 ve 430 px genişlikte alt navigasyon, “Daha fazla” menüsü ve güvenli alan boşlukları görünür olmalı;
- yatay masaüstü tabloları müşteri, nakit akışı ve kullanıcı ekranında kart/satır düzenine dönmeli; belge gövdesinde istemsiz yatay taşma olmamalı;
- dokunma hedefleri rahat kullanılmalı, odak halkası ve klavye sırası korunmalı;
- PWA kurulumunda başlangıç yolu `/`, yön serbest ve hassas API yanıtları Cache Storage dışında kalmalı;
- görev raporu mobil ekranda okunabilir, yazdırma önizlemesinde ise A4 belge düzeninde olmalıdır.

## Redeploy ve geri alma

- Güncel uygulama `0024_partial_card_payments` şemasına bağımlıdır; final journal exact 25 olmadan bu build dağıtılmaz.
- `0014`–`0024` forward-only DDL/veri taşıma zinciridir. Eski uygulama yeni lifecycle/void/reversal, hesap ledger'ı, görev–ziyaret, konum/gider kategori, bildirim/tekrar, tahsilat–kart hareket bağlantısı ve kısmi kart ödeme geçmişi sözleşmelerinin tümünü bilmediği için sıradan bir uygulama rollback'i güvenli sayılmaz; yazma trafiği şema uyumlu uygulama yeniden etkin olana kadar kapalı kalır.
- MariaDB DDL transactional değildir. Exact başarı satırı alınmayan incremental paket yeniden çalıştırılmaz; hedef salt okunur incelenir ve gerekirse yeni forward-fix migration hazırlanır.
- Önceki uygulama artefaktı yalnız canonical paket sözleşmesiyle yeniden üretilmiş, secret-safe biçimde korunmuş, final 0024 şemasıyla uyumluluğu doğrulanmış ve aynı MariaDB session güvenlik sözleşmesini taşıyorsa geri dönüş adayıdır. Benzer adlı eski ZIP veya spike artefaktı bu koşulu sağlamaz.
- `/api/internal/cron/dispatch` varsayılan kapalıdır; bu dağıtım cron kurulumu veya değişikliği yapmaz.

## Canlı kabul kontrolü

- [ ] Doğru canlı DB'yi kapsayan güncel yedek ayrı disposable hedefte güncel şema/journal/kontrollü veriyle restore edildi; hedef kimliği, bakım penceresi ve abort koşulu onaylandı.
- [ ] Yazma trafiği donduruldu; başlangıç journal'ı exact 24 satır, `MAX(id)=24`, `AUTO_INCREMENT=25` ve son kayıt `0023_collection_card_accounts` kimliğiyle eşleşiyor; `credit_card_installment_payment` henüz yok.
- [ ] Hedefe bağlı `0024_partial_card_payments` paketi exact başarıyla tamamlandı; final journal 25, `MAX(id)=25`, `AUTO_INCREMENT=26`, id 25 kaydı `created_at=1789383073515` ve `hash=e9dd804de1525319cc1da6fed05d4d4c69afa776dde4cda99457cfcdab6d1bf5`; journal dışında 33 uygulama tablosu, ödeme tablosunun exact 10 kolon/3 CHECK/5 index/3 RESTRICT FK sözleşmesi ve eski paid taksitlerin bire bir backfill'i doğru.
- [ ] Canonical `dist/portal-pusula-hostinger.zip` final committen iki kez byte-identical üretildi; byte boyutu/SHA-256/commit kaydı eşleşiyor ve başka benzer adlı ZIP kullanılmıyor.
- [ ] Git veya canonical ZIP build'i `Akım` ve runtime hata sayısı 0.
- [ ] Ana sayfa 200; public liveness minimal 200.
- [ ] Readiness header olmadan ve yanlış header ile generic 404.
- [ ] Doğru header + eksik/yanlış DB ayarında generic 503.
- [ ] Doğru header + Hostinger MySQL ile canonical session doğrulaması ve aynı bağlantıda `SELECT 1` sonucu generic 200.
- [ ] Yanıt/log/client bundle içinde parola, e-posta/PII, token, throttle bucket digest'i veya bağlantı ayrıntısı yok.
- [ ] `/sw.js` Node yanıtında no-store, JS MIME ve `Service-Worker-Allowed: /` var.
- [ ] PWA Cache Storage yalnız güvenli sürümlü allowlist'i içeriyor.
- [ ] Güncel ZIP Node 24.x/npm 12 engines sözleşmesiyle build/start oluyor.
- [ ] Güncel ZIP ortak MariaDB session initializer'ı içeriyor; global `sql_mode` değiştirilmeden her checkout'ta strict/UTC/InnoDB/integrity-check/`utf8mb4` doğrulanıyor.
- [ ] `/projeler` üzerinde proje oluşturma/düzenleme çalışıyor.
- [ ] `/gorevler` üzerinde proje seçme, rozet ve filtreleme çalışıyor.
- [ ] `/finans/giderler` üzerinde genel ve proje bağlantılı gider oluşturma, manuel kategori ekleme, filtreleme, düzenleme ve gerekçeli iptal çalışıyor; iptal edilen gider aktif toplamdan çıkıyor.
- [ ] `/finans/kartlar` üzerinde yalnız son dört hane ile kart oluşturma/düzenleme, borçları kart ve dönem bazında toplu görme, ekstre-vade planını izleme ve seçili açık taksitleri kontrollü biçimde ödendi işaretleme çalışıyor.
- [ ] Kredi kartı giderinde taksitlerin toplamı gider toplamına exact eşit; ödenmiş taksiti bulunan giderde finansal/kart planı değişikliği engelleniyor.
- [ ] `/musteriler` sözleşme düzenleme modu kendiliğinden kapanmıyor ve kayıt tamamlanıyor.
- [ ] `/musteriler` müşteri proje bağları oluşturuluyor/düzenleniyor; sözleşme yalnız aktif müşteri projesini seçiyor ve kullanımda olan bağ kaldırılamıyor.
- [ ] `/musteriler` listesinde aylık ücret/ödeme günü/sıradaki ziyaret/açık-gecikmiş alacak karta girmeden görünüyor; bugünkü ziyaret İstanbul iş gününe göre yalnız aktif müşterileri sayıyor ve izinsiz member'da iletişim, ziyaret ve billing alanları yanıt/SQL'den çıkarılıyor.
- [ ] `/kullanicilar` owner-only çalışıyor; member izinleri, hesap devre dışı bırakma, owner koruması ve eski oturum iptali doğrulanıyor.
- [ ] `/giris` account 5/15 dk ve global 100/15 dk DB sayaçlarını dayanıklı uygular; invalid/blok/limiter arızası ayrıntısız `303` + no-store kalır ve Hostinger proxy header'ı kanıtsız bir güven sınırı yapılmaz.
- [ ] Müşteri, sözleşme, proje ve görevlerde gerekçeli arşivleme/geri alma; optimistic version ve aktör kaydı doğru, yetkisiz lifecycle yazmaları reddediliyor.
- [ ] Alacak ve gider void; tahsilat ve ortaklık tahsilatı ters kayıtları özgün kaydı silmeden çalışıyor, ikinci ters kayıt engelleniyor ve audit geçmişi aktör/zaman/gerekçeyi doğru gösteriyor.
- [ ] `/gorevler/rapor` firma filtresi, 1.000 kayıt sınırı, 403 davranışı ve Mühendis Kafası logolu A4 “PDF olarak kaydet” önizlemesi doğru.
- [ ] `/finans/hesaplar` üzerinde kasa/banka açılış bakiyesi, hesap açılış gününden önceye hareket engeli, gelir/gider/transfer, çift taraflı ledger bakiyesi, pasife alma ve ileri yönlü ters kayıt izin sınırları doğru.
- [ ] `/finans/nakit-akisi` haftalık/aylık kırılımda gerçekleşen/planlanan/gecikmiş/tarihi belirsiz ayrımını doğru yapıyor; kart gideri+taksit ve katkı parent+receipt çift sayılmıyor; açılış/kapanış bakiyesi uydurulmuyor.
- [ ] `/finans/raporlar` proje bazlı tahakkuk, tahsilat, gider, açık/gecikmiş alacak ve vergi öncesi faaliyet farkını doğru gösteriyor.
- [ ] `/finans/ortaklik` `%10/%25/%50` payı doğru hesaplıyor; aylık katkı gideri negatife çevirmeden ayrı tutuluyor ve parçalı tahsilatlar receipt defterinde izleniyor.
- [ ] Günlük planın günlük/haftalık/aylık görünümü doğru aralığı gösteriyor; müşteri/konum filtreleri, görevlerin takvim ve uygun ziyaret bağı, ziyaret tamamlama iş maddeleri ile yetki sınırları doğru çalışıyor.
- [ ] Müşteri takvim dışa aktarımı yalnız seçilen müşterinin planlı/telafi ziyaretlerini içeriyor; tamamlanmış/iptal ziyaretleri, görevleri ve iç saat/süre bilgisini sızdırmıyor.
- [ ] 360/390/430 px mobil navigasyon, kartlaşan tablolar, modal/menü dokunma hedefleri ve PWA başlangıç davranışı doğrulandı.
- [ ] Uygulama smoke kontrollerinden sonra yazma dondurması kaldırıldı.
- [ ] E-posta ve cron environment adları gizli alanlarda tanımlandı; gerçek değerler log/repo/ZIP/sohbete girmedi.
- [ ] Manuel GitHub workflow tetiklemesi generic 202 döndürdü; ardından tek test e-postası ulaştı ve günlük tekrar kaydı oluşmadı.
- [ ] Secret-safe önceki uygulama sürümüne dönüş yolu tatbik edildi.
- [ ] Rollback adayı initializer içermeyen eski artefakt değil; aynı session sözleşmesiyle yeniden üretilmiş ve şema uyumluluğu kanıtlanmış sürüm.

Kontrol listesi change window sırasında gerçek canlı sonuçlarla kapatılır. Bu belgenin güncellenmesi tek başına migration, uygulama dağıtımı, canlı kabul veya Dilim 0 GO anlamına gelmez.
