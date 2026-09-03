# Migration runbook'u — operasyon, proje ve finans şeması

Bu runbook Portal Pusula'nın migration mekanizmasını, platform temelini ve operasyon domain tablolarını kapsar. Sürümlü sıra iki immutable migration ve bunları değiştirmeden eklenen dokuz ileri yönlü migration'dan oluşur:

- `0000_platform_migration_verification.sql`: yalnız sentetik `DECIMAL(19,4)`, UTC, transaction ve DB-level idempotency doğrulamasına ayrılmış `_platform_migration_verification` tablosu;
- `0001_platform_job_outbox_audit.sql`: yalnız `scheduled_job`, `job_run`, `outbox_event` ve `audit_event` platform tabloları;
- `0002_platform_state_constraints.sql`: `0001` tablolarına yalnız state ve giriş invariant'larını zorlayan named `CHECK` constraint'leri ekleyen forward-only audit fix'i; tablo veya domain eklemez.
- `0003_platform_cron_dispatch_gate.sql`: yalnız cross-process/restart dayanıklı cron minimum frekans kapısı için `cron_dispatch_gate` teknik tablosunu ekler; job, domain, auth veya scheduler eklemez.
- `0004_customer.sql`: müşteri kimliği, iletişim bilgisi ve aktif/pasif durumunu tutan ilk domain tablosunu ekler;
- `0005_consulting_contract_visits.sql`: müşteri sözleşmesi ile tarih bazlı aylık ziyaret taahhütlerini, iç saat/süreyi ve gerçekleşme durumunu ekler;
- `0006_receivables.sql`: sözleşme ayı ve açılış bakiyesi kaynaklı alacak snapshot'larını, kısmi tahsilatları; sözleşme/ay tekilliği ile açılış bakiyesi ve tahsilat istemci işlem anahtarlarına ait idempotency kısıtlarını ekler.
- `0007_user_account.sql`: tek yönetici hesabının normalize e-posta, scrypt parola özeti, hesap durumu ve oturumları geçersiz kılan kimlik bilgisi sürümünü ekler.
- `0008_work_tasks.sql`: müşteri ve sorumlu bağlantısı kurulabilen Kanban görevlerini, durum/öncelik/vade alanlarını ve optimistic version sözleşmesini ekler.
- `0009_projects.sql`: proje portföyünü ve her görevi en fazla bir projeye bağlayan `work_task_project` ilişki tablosunu ekler.
- `0010_expenses_cards.sql`: kredi kartı tanımlarını, genel veya proje bağlantılı giderleri ve kart harcamalarından üretilen ekstre ayı/vade tarihli taksit planını ekler.

Bu şema müşteri, sözleşme, ziyaret, alacak/tahsilat, yönetici hesabı, görev, proje portföyü, gider ve kredi kartı ödeme planını içerir; henüz vergi tahmini, proje bazlı gelir-gider kârlılığı, çok kullanıcılı workspace/organization veya RBAC tablolarını içermez. İlk yönetici hesabı güvenli geçişte mevcut environment kimliğinden oluşturulur; sonraki giriş ve parola değişiklikleri `user_account` üzerinden yürür. Immutable `0000`/`0001` dosyaları değiştirilmemiştir; `0002`–`0010` ayrı ileri yönlü migration'lardır. Uygulanan her migration daha sonra değiştirilemez; sonraki düzeltme yine yeni migration olmalıdır.

Canlı Hostinger veritabanında `0010_expenses_cards` yalnız kullanıcı onaylı DB-first değişiklik penceresinde ve hedefe bağlı incremental phpMyAdmin paketiyle uygulanır. Gerçek veritabanı parolası veya başka bir sır CLI argümanına, komut geçmişine, loga, test çıktısına ya da sürümlü dosyaya yazılmaz.

SSH/npm erişimi olmayan Hostinger hedefindeki yalnız boş ve disposable staging kurulumu için ayrı [phpMyAdmin clean-only migration runbook'u](./phpmyadmin-clean-migration.md) kullanılır. Bu paket mevcut şemayı yükseltmez. Journal'ı bulunan mevcut hedefte yalnız sıradaki seçili migration için [phpMyAdmin incremental migration runbook'u](./phpmyadmin-incremental-migration.md) kullanılır.

## Ortak MariaDB session sözleşmesi

Hostinger'ın paylaşımlı global `sql_mode` değeri uygulamanın kontrolünde değildir. Portal Pusula `SET GLOBAL` çalıştırmaz ve global değerin strict olmasına güvenmez. Normal migration runner ile uygulamanın readiness, transaction ve advisory-lock yolları, havuzdan alınan **her bağlantı checkout'ında** herhangi bir iş sorgusundan önce aynı fail-closed session politikasını kurup geri okuyarak doğrular:

- exact `STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` SQL mode;
- UTC session timezone;
- InnoDB varsayılan motoru;
- etkin `CHECK`, foreign-key ve unique kontrolleri;
- `utf8mb4` bağlantı karakter seti ve beklenen seçili veritabanı.

Kurulum sorgusu, geri okuma, timeout veya herhangi bir karşılaştırma başarısızsa bağlantı havuza bırakılmaz; imha edilir ve migration/transaction/lock/readiness işi başlamadan genel bir hatayla kapanır. Yalnız process başlangıcında veya yalnız ilk fiziksel bağlantıda kontrol yeterli değildir: Hostinger yeniden bağlantı kurabilir ve havuzdaki session durumu önceki kullanımdan etkilenebilir. Bu nedenle sözleşme her checkout'ta yeniden uygulanır.

## Yerel disposable MariaDB doğrulaması

Ön koşullar: Node/npm sürümleri proje ile uyumlu olmalı, Docker Engine çalışmalı ve Docker Compose v2 erişilebilir olmalıdır.

```bash
npm ci
npm run test:mariadb
```

`npm run test:mariadb`, `compose.mariadb-test.yml` içindeki `mariadb-test` servisini rastgele bir Compose proje adı ve yalnız loopback'e bağlanan dinamik port ile açar; sağlıklı olmasını bekler, migration ve doğruluk testlerini çalıştırır, ardından başarılı veya hatalı sonuçta volume'larla birlikte kapatır. Bu komut canlı DB bilgisi kullanmaz veya istemez.

Test hedefleri iki ayrı kanıt sınıfıdır:

**Migration correctness**

- boş veritabanında `0000` → `0010` sırasıyla clean migrate ve eksiksiz journal;
- ikinci runner çalışmasının no-op olması;
- uyumsuz aynı adlı tablo varken migration'ın ve journal kaydının fail-closed kalması;
- değiştirilmiş uygulanmış SQL/journal hash'inin şema veya veri değişmeden reddedilmesi;
- iki eşzamanlı runner'ın advisory lock ile sıraya girip migration başına tek journal satırı oluşturması;
- `0000` üzerinde transaction commit ve rollback;
- `DECIMAL(19,4)` değerinin JS `number` dönüşümü olmadan string/`Decimal` ile birebir korunması;
- duplicate idempotency anahtarının DB unique constraint'i tarafından reddedilmesi;
- UTC yazma/okuma davranışı;
- `0001` tablo, kolon, engine/collation, FK, unique constraint ve index yapısının doğrudan `information_schema` ile doğrulanması;
- `0002` named `CHECK` constraint'lerinin `information_schema` içinde bulunması ve geçersiz state/kimlik girdilerini gerçek MariaDB'nin reddetmesi.
- `0003` tablo/kolon/primary key/`CHECK` yapısının doğrudan `information_schema` ile doğrulanması; canonical gate key, yalnız `active` state ve UTC timeline invariant'larının gerçek MariaDB'de zorlanması.
- global strict mode kapalı disposable MariaDB'de runner'ın kendi session sözleşmesini kurması, iki ayrı fiziksel bağlantı ve yeniden checkout sonrasında strict davranışın korunması;

**Platform job/outbox/audit davranışı**

- eşzamanlı claim yarışında tek kazanan, conditional update ve exact affected-row kontrolü;
- lease token fencing, stale finalize reddi ve süresi dolmuş lease reclaim'i;
- bounded retry/backoff, max-attempt sonrasında dead-letter ve bounded catch-up;
- job finalize + audit append + outbox insert'in aynı transaction'da commit olması ve kontrollü hata halinde birlikte rollback edilmesi;
- audit için yalnız append API'si, outbox için at-least-once/crash-window ve idempotent adapter sözleşmesi;
- test-only doğrulama handler'ının production registry'ye taşınmaması.
- dayanıklı cron gate'in ilk permit, minimum aralık içinde suppression, aralık sonunda permit, eşzamanlı çağrıda tek permit, time-regression fail-closed ve kontrollü rollback davranışı.

Test yarıda kesilirse aynı test komutu yeniden çalıştırılabilir; rastgele Compose proje adı çakışmayı önler. Artık kalmış bir test projesi ancak adı kesin olarak belirlendikten sonra `docker compose -p <test-proje-adı> -f compose.mariadb-test.yml down --volumes` ile temizlenir. Geniş bir Docker volume silme komutu kullanılmaz.

## Migration runner'ı açıkça çalıştırma

Runner `scripts/migrate.mjs`, sürümlü `drizzle/` SQL dosyalarını uygular. Yalnız disposable ve açıkça hedeflenmiş bir veritabanında, gerekli `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` ve `DB_PASSWORD` süreç ortamına güvenli biçimde sağlandıktan sonra çalıştırılır:

```bash
npm run db:migrate
npm run db:migrate
```

Runner aynı veritabanındaki eşzamanlı çalışmaları, DB adını açığa çıkarmayan sabit uzunluklu bir MariaDB advisory lock ile sıraya alır. Lock alınamazsa migration başlamadan genel bir hatayla kapanır; lock ve bağlantı cleanup'ı bitmeden başarı yazmaz.

Runner bağlantıyı aldıktan sonra advisory lock, journal okuması veya Drizzle DDL'inden önce ortak session sözleşmesini kurup doğrular. Sağlayıcının global `sql_mode` değeri bu sırada okunabilir fakat değiştirilmez ve güvenlik garantisi olarak kullanılmaz. Session kurulumu ya da doğrulaması başarısızsa bağlantı imha edilir; aynı bağlantıyla lock veya migration denenmez.

Her çalıştırmada journal'ın uygulanmış tüm satırları, migration başlamadan önce `drizzle/meta/_journal.json` sırası ve sürümlü SQL dosyalarının SHA-256 özetleriyle karşılaştırılır. Fazla satır, sıra boşluğu, beklenmeyen timestamp veya hash farkı fail-closed sonuç verir. Migration sonrasında journal'ın eksiksiz olduğu yeniden doğrulanır. Uygulanmış bir SQL dosyasının değiştirilmesi normal bir düzeltme yolu değildir; yeni ileri yönlü migration hazırlanmalıdır.

İkinci çalıştırma yeni migration yoksa değişiklik yapmamalıdır. Değerleri komut satırına ekleme; connection string oluşturma veya yazdırma. Runner çıktısında parola, kullanıcı bilgisi ya da bağlantı dizesi bulunmamalıdır.

Temiz DB kabulü için `npm run test:mariadb` tek yetkili kapıdır. Yalnız migration runner'ın sıfır exit code vermesi; migration doğruluğunun veya job/outbox/audit davranışının kanıtı sayılmaz. Platform motorunun ayrıntılı operasyon sözleşmesi [platform jobs runbook'unda](./platform-jobs.md) tutulur.

## SQL inceleme kapısı

Her migration uygulanmadan önce `drizzle/` altındaki yeni SQL sürüm kontrolü farkında doğrudan incelenir:

- `0000` yalnız `_platform_migration_verification` tablosunu oluşturmalı; `InnoDB`, `utf8mb4`, binary-exact idempotency, sentetik `DECIMAL(19,4)` ve UTC `TIMESTAMP(6)` sınırları korunmalı;
- `0001` yalnız `scheduled_job`, `job_run`, `outbox_event` ve `audit_event` tablolarını oluşturmalı;
- dört `0001` tablosu `InnoDB` ve `utf8mb4` olmalı; kimlik, idempotency, lease, tür/durum ve correlation alanlarında açık `ascii_bin` karşılaştırma korunmalı;
- operasyon zamanları UTC `DATETIME(6)` olmalı; `scheduled_job.payload_schema_version` + JSON `payload` ve `outbox_event.schema_version` + JSON `payload` birlikte bulunmalı;
- `job_run.job_id` → `scheduled_job.id` FK'si hem update hem delete için `RESTRICT` olmalı;
- `scheduled_job` için `(job_type, idempotency_key)` ve `lease_token`; `outbox_event` için `idempotency_key` ve `lease_token`; `job_run` için `(job_id, attempt_no)` DB-level unique constraint'leri bulunmalı;
- ready/expired claim, job/correlation geçmişi ve audit entity/correlation UTC sorguları için migration'daki dar indexler korunmalı;
- `DROP`, `TRUNCATE`, veri kaybettiren `ALTER`, domain/auth/finans tablo adı, dinamik SQL veya kullanıcı girdisinden türeyen identifier bulunmamalı. `0001` içindeki tek `ALTER`, yeni `job_run` tablosuna named `RESTRICT` FK ekler ve destructive değildir;
- trigger bulunmamalı. `audit_event` append-only davranışı yalnız uygulama API'siyle uygulanır; Hostinger trigger privilege'ı kanıtlanmadan DB-trigger garantisi verilemez.
- `0002` yalnız `ALTER TABLE ... ADD CONSTRAINT ... CHECK` ifadeleri içermeli; yeni tablo, kolon, trigger, domain/auth/finans nesnesi, veri taşıma veya destructive DDL eklememeli;
- `scheduled_job` ve `outbox_event` için `max_attempts >= 1`, `attempt_count <= max_attempts`, allowlist durumlar ve `leased` durumuyla lease alanlarının birlikte dolu/boş olması DB seviyesinde zorlanmalı;
- `job_run` için `running` sonucunda completion zamanının boş, terminal allowlist sonucunda dolu olması zorlanmalı; `audit_event.actor_type` yalnız `system`/`user` olmalı;
- kimlik ve lease token alanları canonical lower-case UUID biçiminde olmalı; job/event/idempotency/correlation/owner/hata kodu gibi ASCII sözleşme alanları boşluk içermeyen yazdırılabilir ASCII ile sınırlandırılmalı.
- `0003` yalnız `cron_dispatch_gate` tablosunu oluşturmalı; `gate_key` binary-exact printable ASCII primary key, state yalnız `active`, `created_at_utc <= last_permitted_at_utc = updated_at_utc` ve tüm zamanlar `DATETIME(6)` olmalı;
- `0003` içinde seed row, event/scheduler, trigger, domain/auth/finans nesnesi, destructive DDL veya kullanıcı girdisinden türeyen SQL bulunmamalı.
- `0008` yalnız `work_task` tablosunu, müşteri ve yönetici hesabına iki `RESTRICT` foreign key'i ve Kanban sorgu indexlerini eklemeli; destructive DDL veya seed veri içermemeli;
- `0009` yalnız `project` ve `work_task_project` tablolarını, iki `RESTRICT` foreign key'i ve üç sorgu indexini eklemeli; mevcut tablo/kolon değiştirmemeli, seed veri veya destructive DDL içermemeli;
- `0009` proje kimliği/kodu/türü/durumu/para birimi ile görev-proje kimliklerinde `ascii_bin`, metin alanlarında `utf8mb4_unicode_ci`, para alanında `DECIMAL(19,4)` ve zaman alanlarında UTC `DATETIME(6)` sözleşmesini korumalı.
- `0010` yalnız `credit_card`, `expense` ve `credit_card_installment` tablolarını, üç `RESTRICT` foreign key'i ve gider/kart planı sorgu indexlerini eklemeli; mevcut tablo/kolon değiştirmemeli, seed veri veya destructive DDL içermemeli;
- `0010` canonical kimlik/idempotency, allowlist durum-kategori-ödeme alanları, `DECIMAL(19,4)` para snapshot'ları, aktif/iptal gider bütünlüğü, taksit sıra/ödeme bütünlüğü ve UTC `DATETIME(6)` sözleşmelerini DB seviyesinde korumalı;
- `credit_card` yalnız kartın uygulama içi adı, isteğe bağlı banka ve son dört hanesini tutmalı; tam kart numarası, CVV, son kullanma tarihi veya başka ödeme sırrı şemada bulunmamalı.

Uygulanmış bir SQL dosyası sonradan düzenlenmez; düzeltme yeni ve ileri yönlü bir migration olarak eklenir.

## `0010_expenses_cards` için DB-first canlı sıra

Canlı migration ayrı kullanıcı onayı ve değişiklik penceresi olmadan başlatılmaz. Hostinger Git bağlantısı `main` birleşmesini otomatik dağıtabileceği için sıra şöyledir:

1. Proje dalındaki SQL farkını ve kalite kapılarını doğrula; PR CI tamamen yeşil olsun, ancak `main` birleşmesini henüz yapma.
2. `0010_expenses_cards` migration kimliği, SQL özeti ve statement sayısını sürümlü journal ile üretilen manifestten doğrula; bu değerleri elle kopyalayıp belgeye sabitleme.
3. Migration öncesi güncel yedeğin zamanını ve kimliğini doğrula; bakım/geri dönüş penceresini ve durdurma koşullarını belirle.
4. phpMyAdmin'de canlı DB'nin on exact journal satırında ve son `0009_projects` kaydında olduğunu; `credit_card`, `expense` ve `credit_card_installment` tablolarının bulunmadığını salt okunur doğrula.
5. DB ve sunucu sürümü digest'lerini importtan hemen önce al; yalnız `0010_expenses_cards` için [incremental paketi](./phpmyadmin-incremental-migration.md) üretip manifest/hash kontrollerinden geçir.
6. Hedefe bağlı paketi tek kez içe aktar. Yalnız exact `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` / `0010_expenses_cards` sonucu başarıdır; sonuç yoksa paketi yeniden çalıştırma.
7. On bir journal satırını; üç yeni `InnoDB` / `utf8mb4_unicode_ci` tabloyu; üç `RESTRICT` foreign key'i ve beklenen unique/check/index yapılarını salt okunur doğrula.
8. DB doğrulandıktan sonra PR'ı `main` dalına birleştir. Bağlı Git dağıtımını bekle veya aynı kaynakla yeniden üretilmiş güncel Hostinger ZIP'ini dağıt.
9. Liveness/readiness ile giriş, mevcut operasyon akışları, `/finans/giderler` gider oluşturma/düzenleme/iptal ve `/finans/kartlar` kart/taksit ödeme planı smoke kontrollerini çalıştır.

`0010` additive bir migration'dır: eski uygulama üç yeni tabloyu kullanmadığı için DB-first aralığında çalışmaya devam eder. Uygulama ZIP'i migration çalıştırmaz. Backup/restore ayrıntıları ve geri dönüş yetki sınırı [backup/restore runbook'unda](./backup-restore.md) korunur.

## Geri dönüş sınırları

- Migration yaklaşımı forward-only'dir; otomatik `down` migration yoktur.
- MariaDB/MySQL DDL işlemleri implicit commit yapabildiğinden tüm şema değişiminin tek transaction ile geri alınacağı varsayılmaz.
- Hata veri yazılmadan yakalanırsa, uygulanmış SQL değiştirilmeden yeni bir düzeltme migration'ı hazırlanır ve aynı kapılardan geçirilir.
- Uygulama rollback'i yalnız önceki uygulama sürümü yeni şemayla uyumluysa güvenlidir; bu uyumluluk önceden test edilmelidir.
- Ortak MariaDB session initializer ve doğrulamasını taşımayan eski runner veya uygulama artefaktına rollback yasaktır. Şemayla uyumlu görünmesi bu yasağı kaldırmaz; önceki sürüm ancak aynı fail-closed session sözleşmesiyle yeniden üretilip tüm kapılardan geçirilirse aday olabilir.
- Veri kaybı, uyumsuz şema veya geri döndürülemez DDL durumunda tek güvenilir dönüş, önceden restore edilerek kanıtlanmış yedeğin onaylı bakım penceresinde geri yüklenmesidir. Olası veri kaybı aralığı ayrıca kullanıcıya bildirilir.
- `DROP`, kolon daraltma/yeniden adlandırma veya veri dönüşümü bu doğrulama diliminin dışında ayrı tasarım, yedek ve restore provası gerektirir.

Bu runbook'un güncellenmesi canlı migration veya deploy yapıldığı anlamına gelmez; gerçek sonuç, change window sırasında ayrı olarak doğrulanır.
