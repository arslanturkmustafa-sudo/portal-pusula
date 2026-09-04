# Migration runbook'u — operasyon, proje ve finans şeması

Bu runbook Portal Pusula'nın migration mekanizmasını, platform temelini ve operasyon domain tablolarını kapsar. Sürümlü sıra iki immutable migration ve bunları değiştirmeden eklenen on dört ileri yönlü migration'dan oluşur:

- `0000_platform_migration_verification.sql`: yalnız sentetik `DECIMAL(19,4)`, UTC, transaction ve DB-level idempotency doğrulamasına ayrılmış `_platform_migration_verification` tablosu;
- `0001_platform_job_outbox_audit.sql`: yalnız `scheduled_job`, `job_run`, `outbox_event` ve `audit_event` platform tabloları;
- `0002_platform_state_constraints.sql`: `0001` tablolarına yalnız state ve giriş invariant'larını zorlayan named `CHECK` constraint'leri ekleyen forward-only audit fix'i; tablo veya domain eklemez.
- `0003_platform_cron_dispatch_gate.sql`: yalnız cross-process/restart dayanıklı cron minimum frekans kapısı için `cron_dispatch_gate` teknik tablosunu ekler; job, domain, auth veya scheduler eklemez.
- `0004_customer.sql`: müşteri kimliği, iletişim bilgisi ve aktif/pasif durumunu tutan ilk domain tablosunu ekler;
- `0005_consulting_contract_visits.sql`: müşteri sözleşmesi ile tarih bazlı aylık ziyaret taahhütlerini, iç saat/süreyi ve gerçekleşme durumunu ekler;
- `0006_receivables.sql`: sözleşme ayı ve açılış bakiyesi kaynaklı alacak snapshot'larını, kısmi tahsilatları; sözleşme/ay tekilliği ile açılış bakiyesi ve tahsilat istemci işlem anahtarlarına ait idempotency kısıtlarını ekler.
- `0007_user_account.sql`: bootstrap owner hesabının normalize e-posta, scrypt parola özeti, hesap durumu ve oturumları geçersiz kılan kimlik bilgisi sürümünü ekler.
- `0008_work_tasks.sql`: müşteri ve sorumlu bağlantısı kurulabilen Kanban görevlerini, durum/öncelik/vade alanlarını ve optimistic version sözleşmesini ekler.
- `0009_projects.sql`: proje portföyünü ve her görevi en fazla bir projeye bağlayan `work_task_project` ilişki tablosunu ekler.
- `0010_expenses_cards.sql`: kredi kartı tanımlarını, genel veya proje bağlantılı giderleri ve kart harcamalarından üretilen ekstre ayı/vade tarihli taksit planını ekler.
- `0011_customer_projects_partnership.sql`: müşteri–proje ilişkisini, sözleşme/alacak proje snapshot'larını ve ortaklık komisyonu, aylık katkı ile katkı tahsilat defterini ekler; mevcut kayıtları `MUHENDIS_KAFASI` ve var olan görev–proje bağlarıyla ileri yönlü doldurur.
- `0012_user_permissions.sql`: mevcut hesapları `owner` olarak koruyan `display_name`/`role` geçişini, ilk allowlist `user_permission` defterini, owner/member CHECK'lerini ve rol/durum indexini ekler.
- `0013_login_attempt_throttle.sql`: süreç restart'ı ve çoklu Node örneği boyunca kalıcı account/global login sınırlaması için digest anahtarlı `login_attempt_throttle` teknik tablosunu ekler; parola, düz e-posta/PII veya secret saklamaz.
- `0014_record_lifecycle.sql`: müşteri, danışmanlık sözleşmesi, proje ve görev ana kayıtlarına gerekçeli arşivleme, aktör, zaman ve optimistic version alanlarını; görev için `cancelled` durumunu; güncel 35 kodlu izin allowlist'ini ve lifecycle FK/CHECK/index sözleşmelerini ileri yönlü ekler.
- `0015_financial_reversals.sql`: alacak için gerekçeli `active`/`voided` lifecycle ve optimistic version alanlarını; alacak tahsilatı ile ortaklık katkı tahsilatında özgün kaydı silmeyen, aynı tutarlı ve tekil self-reference kullanan forward-only ters kayıt sözleşmesini ekler.

Bu şema müşteri, sözleşme, ziyaret, alacak/tahsilat, hesap/izin, kalıcı giriş sınırlaması, görev, proje portföyü, gider, kredi kartı ödeme planı ve ortaklık finans defterini içerir; organization/workspace çoklu-tenant izolasyonu ve resmi vergi beyanı içermez. İlk owner hesabı güvenli geçişte mevcut environment kimliğinden oluşturulur; sonraki hesap, giriş ve parola işlemleri `user_account`/`user_permission` üzerinden yürür. Immutable `0000`/`0001` dosyaları değiştirilmemiştir; `0002`–`0015` ayrı ileri yönlü migration'lardır. Clean zincir 16 migration ve migration başına bir olmak üzere 16 journal kaydıdır.

Canlı Hostinger veritabanında migration yalnız kullanıcı onaylı DB-first değişiklik penceresinde ve uygulama yazmaları dondurularak uygulanır. Mevcut canlı journal exact `0013_login_attempt_throttle` seviyesindeyse sıradaki şema geçişi araya uygulama deploy edilmeden `0014_record_lifecycle` → `0015_financial_reversals` olmalıdır. Gerçek veritabanı parolası veya başka bir sır CLI argümanına, komut geçmişine, loga, test çıktısına ya da sürümlü dosyaya yazılmaz.

SSH/npm erişimi olmayan Hostinger hedefindeki yalnız boş ve disposable staging kurulumu için ayrı [phpMyAdmin clean-only migration runbook'u](./phpmyadmin-clean-migration.md) kullanılır. Bu paket mevcut şemayı yükseltmez. Journal'ı bulunan mevcut hedefte `0011`, `0012` ve `0013` için sırasıyla [0011 incremental runbook'u](./phpmyadmin-incremental-migration.md), [0012 kullanıcı-yetki incremental runbook'u](./phpmyadmin-user-permissions-incremental.md) ve [0013 giriş sınırlama incremental runbook'u](./phpmyadmin-login-throttle-incremental.md) kullanılır. `0014` ve `0015` için hedefe bağlı paket üretim, tek-kullanımlık import ve postflight sözleşmesi [ayrı runbook'ta](./phpmyadmin-lifecycle-reversals-incremental.md) tanımlıdır. Canlı DB/server digest'lerine bağlı exact artefakt üretilip onaylanmadan kaynak SQL canlıya doğrudan uygulanmaz ve başarı iddia edilmez.

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

- boş veritabanında `0000` → `0015` sırasıyla 16 migration ile clean migrate ve 16 satırlı eksiksiz journal;
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
- `0011` önce dört yeni `InnoDB` / `utf8mb4_unicode_ci` tabloyu, onların single-column `RESTRICT` FK ve indexlerini; ardından nullable `char(36) ascii_bin` sözleşme/alacak `project_id` kolonlarını oluşturmalı;
- `0011` yalnız sürümlü üç canonical backfill ifadesini çalıştırmalı: tüm müşteriler `MUHENDIS_KAFASI` projesine, var olan görev–proje çiftleri müşteri ilişkisine, sözleşme/alacaklar ise proje snapshot'ına taşınmalı; backfill sonrasında null veya ilişkisiz sözleşme/alacak kalmamalı;
- yeni sözleşme unique'i ve proje sorgu indexleri backfill sonrasında, composite müşteri–proje FK'leri bunların ardından kurulmalı; en son ve tek destructive ifade eski `uq_consulting_contract_customer_start` indexini kaldırmalı;
- `0011` kimlik, idempotency, proje, durum ve enum alanlarında `ascii/ascii_bin`; para alanlarında `DECIMAL(19,4)`; zamanlarda UTC `DATETIME(6)` sözleşmesini korumalı; komisyon oranı katkı biçimine göre exact `%10/%25/%50` olmalı ve katkı tahsilatı ayrı immutable receipt kayıtlarıyla izlenmeli.
- `0012` önce eski `chk_user_account_state` constraint'ini kaldırmalı, mevcut satırları exact `owner` ve `Portal Yöneticisi` varsayılanlarıyla ileri yönlü doldurmalı, ardından yeni hesap varsayılanını `member` yapmalı;
- `0012` yalnız allowlist permission kodlarını kabul eden `user_permission` tablosunu, `RESTRICT/RESTRICT` hesap FK'sini, owner/member ve display-name CHECK'lerini, `(role,status)` indexini kurmalı; parola/hash veya seed permission üretmemeli;
- `0013` yalnız `login_attempt_throttle` tablosu ile updated/blocked zaman indexlerini oluşturmalı; `bucket_key` exact 64 lower-case hex ve primary key, `bucket_type` yalnız `account`/`global`/`network`, failure/zaman/blok invariant'ları named CHECK'lerle korunmalı;
- `0013` düz e-posta/PII, parola, secret, token, bağlantı dizesi, trigger, event/scheduler, seed veri, foreign key veya destructive DDL içermemeli;
- `0014` ana kayıtları hard-delete etmemeli; müşteri, sözleşme, proje ve görev için archive metadata'sını all-null/all-present biçiminde, aktörü `user_account` `RESTRICT` FK'siyle, durum/timeline/version invariant'larını named CHECK'lerle ve güncel allowlist'i exact 35 izin koduyla korumalı;
- `0015` özgün alacak/tahsilat kayıtlarını silmemeli veya tutarı yerinde tersine çevirmemeli; alacak void metadata'sını all-null/all-present biçiminde, tahsilat ters kaydını özgün kayda `RESTRICT` self-FK ve `reversal_of_id` tekilliğiyle, gerekçeyi trimli ve bounded olarak korumalı;
- clean toplamı 174 migration statement, 24 uygulama tablosu ve journal ile 25 fiziksel tablo olmalı; migration sayısı ve journal kaydı exact 16 olmalı.

Uygulanmış bir SQL dosyası sonradan düzenlenmez; düzeltme yeni ve ileri yönlü bir migration olarak eklenir.

## `0011_customer_projects_partnership` için DB-first canlı sıra

Canlı migration ayrı kullanıcı onayı ve değişiklik penceresi olmadan başlatılmaz. Hostinger Git bağlantısı `main` birleşmesini otomatik dağıtabileceği için sıra şöyledir:

1. Proje dalındaki SQL farkını ve kalite kapılarını doğrula; PR CI tamamen yeşil olsun, ancak `main` birleşmesini henüz yapma.
2. `0011_customer_projects_partnership` migration kimliği, SQL özeti ve 25 statement'ı sürümlü journal ile üretilen manifestten doğrula; bu değerleri elle kopyalayıp belgeye sabitleme.
3. Migration öncesi güncel yedeğin zamanını ve kimliğini doğrula; bakım/geri dönüş penceresini ve durdurma koşullarını belirle.
4. Uygulama yazmalarını dondur. phpMyAdmin'de canlı DB'nin 11 exact journal satırında ve son `0010_expenses_cards` kaydında olduğunu; tek uygun `MUHENDIS_KAFASI` projesini, dört hedef tablonun ve iki `project_id` kolonunun bulunmadığını salt okunur doğrula.
5. DB ve sunucu sürümü digest'lerini importtan hemen önce al; yalnız `0011_customer_projects_partnership` için [incremental paketi](./phpmyadmin-incremental-migration.md) üretip manifest/hash kontrollerinden geçir.
6. Hedefe bağlı paketi tek kez içe aktar. Yalnız exact `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` / `0011_customer_projects_partnership` sonucu başarıdır; sonuç yoksa paketi yeniden çalıştırma ve yazma dondurmasını kaldırma.
7. On iki journal satırını; dört yeni tabloyu; yedi yeni `RESTRICT` FK'yi; iki kolonun `ascii_bin`/nullable biçimini; sıfır null/ilişkisiz backfill sayacını ve beklenen unique/check/index yapılarını salt okunur doğrula.
8. Yazma dondurmasını sürdür ve aşağıdaki `0012_user_permissions` sırasına geç. Bu noktada PR birleştirme veya güncel ZIP dağıtma.

`0011` yeni kolonları nullable ekleyerek DB-first uyumluluğu korur; fakat deterministik backfill ve postflight nedeniyle migration penceresinde eski uygulamanın yazma yapmasına izin verilmez. Uygulama ZIP'i migration çalıştırmaz. Backup/restore ayrıntıları ve geri dönüş yetki sınırı [backup/restore runbook'unda](./backup-restore.md) korunur.

## `0012_user_permissions` için ikinci DB-first canlı sıra

Güncel uygulama `user_account.display_name`, `user_account.role` ve `user_permission` nesnelerine bağımlıdır; bu nedenle `0011` sonrasında doğrudan yeni build dağıtılamaz.

1. `0011` postflight sonucu ve exact 12 journal satırı doğrulanmışken yazma dondurmasını sürdür.
2. Aynı canlı DB ve server digest'leriyle [0012 incremental runbook'unu](./phpmyadmin-user-permissions-incremental.md) izleyerek yalnız `0012_user_permissions` için hedefe bağlı paket üret; manifest 7 statement, önceki migration `0011_customer_projects_partnership` ve beklenen journal sayısı 12 olmalıdır.
3. Paketi bir kez uygula. Yalnız exact `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` / `0012_user_permissions` sonucu başarıdır; sonuç yoksa tekrar çalıştırma.
4. Journal'ın 13 satır olduğunu; mevcut hesapların `owner` ve dolu display name ile korunduğunu; yeni hesap varsayılanının `member` olduğunu; `user_permission` PK/FK/CHECK, iki user-account CHECK'i ve rol/durum indexini salt okunur doğrula.
5. Yazma dondurmasını sürdür ve aşağıdaki `0013_login_attempt_throttle` sırasına geç. Bu noktada PR birleştirme veya güncel ZIP dağıtma.

## `0013_login_attempt_throttle` için üçüncü DB-first canlı sıra

Güncel production `database` auth yolu kalıcı hesap/global sınırlaması için `login_attempt_throttle` tablosuna bağımlıdır; bu nedenle `0012` sonrasında doğrudan yeni build dağıtılamaz.

1. `0012` postflight sonucu ve exact 13 journal satırı doğrulanmışken yazma dondurmasını sürdür.
2. Aynı canlı DB ve server digest'leriyle [0013 incremental runbook'unu](./phpmyadmin-login-throttle-incremental.md) izleyerek yalnız `0013_login_attempt_throttle` için hedefe bağlı paket üret; manifest 3 statement, önceki migration `0012_user_permissions` ve beklenen journal sayısı 13 olmalıdır.
3. Paketi bir kez uygula. Yalnız exact `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` / `0013_login_attempt_throttle` sonucu başarıdır; sonuç yoksa tekrar çalıştırma.
4. Journal'ın 14 satır olduğunu; `login_attempt_throttle` tablosunun boş başladığını; primary key, iki named CHECK, updated/blocked indexleri, engine/collation ve kolon sözleşmesini salt okunur doğrula. Düz e-posta/PII, parola, secret veya bucket digest'i operasyon çıktısına yazma.
5. `0013` postflight geçse bile güncel uygulamayı henüz dağıtma ve yazma dondurmasını kaldırma; aşağıdaki `0014_record_lifecycle` → `0015_financial_reversals` DB-first devam kapısına geç. Auth limiter smoke'u, tüm şema zinciri ve güncel uygulama birlikte hazır olduğunda yapılır.

`0011`, `0012` ve `0013` üç ayrı immutable journal kaydıdır; aynı SQL dosyasına birleştirilmez ve aralarına uygulama deploy edilmez. Canlı hedef exact `0013` seviyesine geldikten sonra da aynı kural `0014` ve `0015` için geçerlidir.

## `0014_record_lifecycle` ve `0015_financial_reversals` için DB-first devam kapısı

Hedefe bağlı üretim ve doğrulama ayrıntıları [0014/0015 incremental runbook'unda](./phpmyadmin-lifecycle-reversals-incremental.md) belgelenmiştir. Bu bölüm canlı başarı kaydı değildir; canlı DB/server digest'lerine bağlı iki exact artefakt ayrıca üretilip onaylanmadan aşağıdaki sıra başlatılmaz:

1. Canlı journal'ın exact 14 kayıtla `0013_login_attempt_throttle` üzerinde bittiğini, uygulanmış hash zincirinin geçerli olduğunu ve `0014`/`0015` alanlarının henüz bulunmadığını salt okunur doğrula; farklı başlangıç durumunda dur.
2. Güncel, restore edilerek sınanmış yedeği ve yazma dondurmasını doğrula. Runbook'a göre `0014_record_lifecycle` için hedefe bağlı exact paket/manifest üretilemez veya doğrulanamazsa dur; kaynak migration SQL'ini phpMyAdmin'e doğrudan yapıştırma.
3. Onaylı exact runbook yalnız `0014`ü bir kez uyguladıktan sonra 15 journal kaydını; dört lifecycle kayıt türündeki archive/version alanlarını, aktör FK'lerini, named CHECK/indexleri ve exact 35 izin kodunu salt okunur doğrulamalıdır. Exact başarı sonucu ve postflight kanıtı yoksa yeniden deneme, `0015`e geçme veya uygulama deploy etme.
4. `0015_financial_reversals` için ayrı hedefe bağlı exact paket/manifest üretilemez veya doğrulanamazsa dur. Onaylı paket yalnız `0015`i bir kez uyguladıktan sonra 16 journal kaydını; receivable void/version sözleşmesini, iki ters kayıt tipindeki entry/reason alanlarını, self-FK/unique/CHECK/index yapılarını ve mevcut özgün kayıtların korunduğunu salt okunur doğrulamalıdır.
5. Ancak her iki DB postflight kapısı ayrı ayrı geçtikten sonra aynı kaynakla üretilmiş uygulama artefaktı dağıtım adayı olabilir. Lifecycle, izin, audit redaksiyonu, void/reversal bakiyeleri ve 409 optimistic concurrency davranışı smoke edilmeden yazma dondurması kaldırılmaz.

Zorunlu canlı sıra `0013` → `0014` → `0015`tir; bu sıranın belgelenmesi migration'ların canlıda uygulandığı veya 16 journal kaydının canlıda görüldüğü anlamına gelmez.

## Geri dönüş sınırları

- Migration yaklaşımı forward-only'dir; otomatik `down` migration yoktur.
- Kullanıcı tarafından oluşturulan müşteri, sözleşme, proje, görev, alacak, gider ve tahsilat ana kayıtları normal operasyon akışında hard-delete edilmez. Düzeltme arşiv/restore, void veya özgün kayda bağlı yeni bir ters kayıtla ilerler; ters kayıt kendi başına silinmez ya da ikinci kez ters çevrilmez.
- MariaDB/MySQL DDL işlemleri implicit commit yapabildiğinden tüm şema değişiminin tek transaction ile geri alınacağı varsayılmaz.
- Hata veri yazılmadan yakalanırsa, uygulanmış SQL değiştirilmeden yeni bir düzeltme migration'ı hazırlanır ve aynı kapılardan geçirilir.
- Uygulama rollback'i yalnız önceki uygulama sürümü yeni şemayla uyumluysa güvenlidir; bu uyumluluk önceden test edilmelidir.
- Ortak MariaDB session initializer ve doğrulamasını taşımayan eski runner veya uygulama artefaktına rollback yasaktır. Şemayla uyumlu görünmesi bu yasağı kaldırmaz; önceki sürüm ancak aynı fail-closed session sözleşmesiyle yeniden üretilip tüm kapılardan geçirilirse aday olabilir.
- Veri kaybı, uyumsuz şema veya geri döndürülemez DDL durumunda tek güvenilir dönüş, önceden restore edilerek kanıtlanmış yedeğin onaylı bakım penceresinde geri yüklenmesidir. Olası veri kaybı aralığı ayrıca kullanıcıya bildirilir.
- `DROP`, kolon daraltma/yeniden adlandırma veya veri dönüşümü bu doğrulama diliminin dışında ayrı tasarım, yedek ve restore provası gerektirir.

Bu runbook'un güncellenmesi canlı migration, deploy, canlı kabul veya Dilim 0 GO anlamına gelmez; gerçek sonuç change window sırasında ayrı olarak doğrulanır.
