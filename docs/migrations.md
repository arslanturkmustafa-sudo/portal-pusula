# Migration runbook'u — Komut 3C

Bu runbook Portal Pusula'nın migration mekanizmasını ve dar platform job/outbox/audit/cron-gate temelini gerçek ve disposable bir yerel MariaDB üzerinde doğrular. Sürümlü sıra iki immutable migration ve bunları değiştirmeden eklenen iki ileri yönlü migration'dan oluşur:

- `0000_platform_migration_verification.sql`: yalnız sentetik `DECIMAL(19,4)`, UTC, transaction ve DB-level idempotency doğrulamasına ayrılmış `_platform_migration_verification` tablosu;
- `0001_platform_job_outbox_audit.sql`: yalnız `scheduled_job`, `job_run`, `outbox_event` ve `audit_event` platform tabloları;
- `0002_platform_state_constraints.sql`: `0001` tablolarına yalnız state ve giriş invariant'larını zorlayan named `CHECK` constraint'leri ekleyen forward-only audit fix'i; tablo veya domain eklemez.
- `0003_platform_cron_dispatch_gate.sql`: yalnız cross-process/restart dayanıklı cron minimum frekans kapısı için `cron_dispatch_gate` teknik tablosunu ekler; job, domain, auth veya scheduler eklemez.

Bu şema müşteri, finans, görev, kullanıcı/auth, workspace/organization veya RBAC/domain tablosu içermez. Immutable `0000`/`0001` dosyaları değiştirilmemiştir; `0002` ve `0003` ayrı ileri yönlü migration'lardır. Uygulanan her migration daha sonra değiştirilemez; sonraki düzeltme yine yeni migration olmalıdır.

Bu adımlar canlı Hostinger veritabanına uygulanmaz. Gerçek veritabanı parolası veya başka bir sır CLI argümanına, komut geçmişine, loga, test çıktısına ya da sürümlü dosyaya yazılmaz.

SSH/npm erişimi olmayan Hostinger hedefindeki yalnız boş ve disposable staging kurulumu için ayrı [phpMyAdmin clean-only migration runbook'u](./phpmyadmin-clean-migration.md) kullanılır. Bu paket mevcut şemayı yükseltmez ve normal runner'ın yerine genel bir migration yöntemi değildir.

## Yerel disposable MariaDB doğrulaması

Ön koşullar: Node/npm sürümleri proje ile uyumlu olmalı, Docker Engine çalışmalı ve Docker Compose v2 erişilebilir olmalıdır.

```bash
npm ci
npm run test:mariadb
```

`npm run test:mariadb`, `compose.mariadb-test.yml` içindeki `mariadb-test` servisini rastgele bir Compose proje adı ve yalnız loopback'e bağlanan dinamik port ile açar; sağlıklı olmasını bekler, migration ve doğruluk testlerini çalıştırır, ardından başarılı veya hatalı sonuçta volume'larla birlikte kapatır. Bu komut canlı DB bilgisi kullanmaz veya istemez.

Test hedefleri iki ayrı kanıt sınıfıdır:

**Migration correctness**

- boş veritabanında `0000` → `0001` → `0002` → `0003` sırasıyla clean migrate ve eksiksiz journal;
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

Uygulanmış bir SQL dosyası sonradan düzenlenmez; düzeltme yeni ve ileri yönlü bir migration olarak eklenir.

## Production öncesi güvenli sıra

Canlı migration için bu turda yetki yoktur. Ayrı kullanıcı onayı ve değişiklik penceresi alınmadan aşağıdaki sıra başlatılmaz:

1. Hedef sürümün tam SQL farkını iki kişi veya eşdeğer bağımsız inceleme ile onayla; immutable `0000`/`0001` ve ileri yönlü `0002`/`0003` hash'lerini/migration kimliklerini kaydet.
2. Hedef DB motor/sürüm uyumluluğunu, `CHECK` enforcement'ını, beklenen lock süresini ve uygulamanın eski/yeni şemayla geriye uyumunu doğrula. `0002` öncesi mevcut satırların tüm yeni constraint'lere uyduğunu read-only sorgularla kanıtla; uygunsuz canlı veriyi otomatik düzeltme. `0003` için DB zamanı, transaction/row-lock ve concurrent permit davranışını ayrı staging hedefinde ölç.
3. Migration öncesi yedeğin zamanını ve kimliğini kaydet. Yedeğin güncel Komut 3C şemasını içerdiğini doğrula; ayrı bir disposable hedefe restore et ve toplam yedi tablonun (altı teknik tablo + migration journal), dört journal satırının ve kontrollü veri doğruluk sorgularının geçtiğine ilişkin kanıt üret. Boş readiness spike DB'sinin 0 tablo/journal yok restore `PASS` sonucu bu migration kapısını karşılamaz. Yalnız “backup alındı” görüntüsü yeterli değildir.
4. Uygulama ve DB için bakım/geri dönüş penceresini, sorumluyu ve durdurma koşullarını belirle.
5. DB değişkenlerini yalnız onaylı secret/env yönetimiyle sürece enjekte et. Parola, token veya connection string'i CLI argümanına, loga, sohbete ya da dosyaya koyma.
6. Ayrı onaylı canlı çalıştırmada runner'ı tek kez çalıştır; migration journal, süre ve genel sonucu kaydet. Ham DB hatasını veya bağlantı ayrıntısını kanıta kopyalama.
7. Migration sonrası şema/journal kontrolünü, uygulama liveness/readiness kontrollerini ve ilgili smoke testlerini çalıştır; hata bütçesini gözle.

Hostinger plan-geneli manuel yedeği ve boş readiness kaynağının ayrı disposable hedef restore'u tamamlanmıştır; production write/restore başlatılmamıştır. Bu dar `PASS`, güncel Komut 3C migration şeması/journal/veri restore kanıtı değildir. Production öncesi [güncel şemayı kapsayan backup + ayrı hedef restore kanıtı](./backup-restore.md) gerekliliği sürer. Bu runbook kapsamında canlı migration, deploy veya environment değişikliği çalıştırılmamıştır.

## Geri dönüş sınırları

- Migration yaklaşımı forward-only'dir; otomatik `down` migration yoktur.
- MariaDB/MySQL DDL işlemleri implicit commit yapabildiğinden tüm şema değişiminin tek transaction ile geri alınacağı varsayılmaz.
- Hata veri yazılmadan yakalanırsa, uygulanmış SQL değiştirilmeden yeni bir düzeltme migration'ı hazırlanır ve aynı kapılardan geçirilir.
- Uygulama rollback'i yalnız önceki uygulama sürümü yeni şemayla uyumluysa güvenlidir; bu uyumluluk önceden test edilmelidir.
- Veri kaybı, uyumsuz şema veya geri döndürülemez DDL durumunda tek güvenilir dönüş, önceden restore edilerek kanıtlanmış yedeğin onaylı bakım penceresinde geri yüklenmesidir. Olası veri kaybı aralığı ayrıca kullanıcıya bildirilir.
- `DROP`, kolon daraltma/yeniden adlandırma veya veri dönüşümü bu doğrulama diliminin dışında ayrı tasarım, yedek ve restore provası gerektirir.

Komut 4 / auth için henüz HAZIR DEĞİL; Dilim 0 GO değildir.
