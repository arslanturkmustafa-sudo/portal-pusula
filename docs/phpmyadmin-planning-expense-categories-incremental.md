# phpMyAdmin mevcut şema yükseltme paketi — `0018_planning_expense_categories`

Bu runbook, journal'ında exact `0000`–`0017` bulunan Portal Pusula veritabanına yalnız `0018_planning_expense_categories` migration'ını uygular. Migration; ziyaret taahhüdüne isteğe bağlı konum tanımı, yönetilebilir gider kategori referans tablosu, dokuz tarihsel kategori seed'i ve `expense.category` için `RESTRICT` FK ekler. Ham `drizzle/0018_planning_expense_categories.sql` canlı hedefe doğrudan yapıştırılmaz; clean-only paket mevcut DB'de kullanılmaz.

MariaDB DDL transactional değildir. Uygulama yazmaları ön kontrolden güncel uygulama smoke testleri bitene kadar dondurulur. Exact başarı satırı görülmezse aynı paket yeniden çalıştırılmaz ve uygulama deploy edilmez. Bu belgenin veya kaynak SQL'in hazır olması canlı migration, deploy, kabul ya da Dilim 0 GO kanıtı değildir.

## Değişmez güvenlik sınırları

- Doğru canlı DB, bakım penceresi ve güncel yedek iki bağımsız kontrolle doğrulanır; yedek ayrı disposable hedefte restore edilip şema, journal ve kontrollü veri kontrollerini geçmeden başlanmaz.
- Gerçek DB adı, kullanıcı, parola, connection string, token, server değeri, hedef digest'i veya artefakt hash'i belgeye, sohbete, ekran görüntüsüne ya da genel loga taşınmaz.
- Hedef/server digest'leri yalnız kullanıcının gizli terminal oturumunda geçici environment değerleri olarak verilir. Üretilen SQL/manifest hedefe bağlı hassas operasyon metadata'sıdır; Git'e veya Hostinger uygulama ZIP'ine girmez ve yalnız ACL-kısıtlı change-window alanında tutulur.
- Uygulanmış journal satırı veya migration SQL'i elle değiştirilmez. Journal/tablo/kolon/constraint/FK elle eklenmez, silinmez ya da yeniden adlandırılmaz.
- `DROP CONSTRAINT` ifadeleri yalnız aynı paket içindeki genişletilmiş named CHECK'lerle yer değiştirmek içindir. Ön kontrolde beklenen eski constraint şekli bulunmazsa paket DDL başlamadan fail-closed kalmalıdır.
- Bu geçiş yeni secret veya environment adı istemez.

## Backup, yazma dondurması ve ön kabul

1. Güncel provider yedeğinin doğru Portal Pusula DB'sini kapsadığı, alınma zamanı, retention sınırı ve restore erişimi secretsız bir kanıt kimliğiyle kaydedilir.
2. Yedek yeni ve ayrı disposable hedefe geri yüklenir. Restore hedefinde exact 18 journal kaydı, journal dışında 28 uygulama tablosu ve kontrollü satır/ilişki örnekleri salt okunur doğrulanır.
3. RPO/RTO, sorumlu kişi, bakım penceresi ve abort koşulu onaylanır. Uygulama yazmaları dondurulur; gider satır sayısı gibi postflight'ta karşılaştırılacak yalnız aggregate sayaçlar alınır.
4. Aşağıdaki ön kabul sonuçlarından biri farklıysa paket üretilmez veya import edilmez.

Journal'ın full prefix hash/timestamp zinciri üretilen manifest guard'ıyla exact eşleşmelidir. Aşağıdaki sayaç yalnız ek bir salt okunur kontroldür:

```sql
SELECT
  COUNT(*) = 18 AS journal_count_ok,
  COALESCE(MIN(`id`), 0) = 1 AS journal_min_ok,
  COALESCE(MAX(`id`), 0) = 18 AS journal_max_ok,
  (SELECT `AUTO_INCREMENT`
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = '__drizzle_migrations') = 19 AS journal_next_id_ok
FROM `__drizzle_migrations`;
```

Dört sonuç da exact `1` olmalıdır. Şema ön kabulü:

```sql
SELECT
  (SELECT COUNT(*)
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
      AND TABLE_NAME <> '__drizzle_migrations') = 28 AS exact_28_application_tables_ok,
  (SELECT COUNT(*)
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'expense_category') = 0 AS category_table_absent_ok,
  (SELECT COUNT(*)
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'monthly_visit_commitment'
      AND TABLE_TYPE = 'BASE TABLE'
      AND ENGINE = 'InnoDB'
      AND TABLE_COLLATION = 'utf8mb4_unicode_ci') = 1 AS visit_table_default_ok,
  (SELECT COUNT(*)
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'monthly_visit_commitment'
      AND COLUMN_NAME = 'location_label') = 0 AS location_column_absent_ok,
  (SELECT COUNT(*)
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'expense'
      AND COLUMN_NAME = 'category'
      AND DATA_TYPE = 'varchar'
      AND COLUMN_TYPE = 'varchar(32)'
      AND CHARACTER_MAXIMUM_LENGTH = 32
      AND CHARACTER_SET_NAME = 'ascii'
      AND COLLATION_NAME = 'ascii_bin'
      AND IS_NULLABLE = 'NO'
      AND (COLUMN_DEFAULT IS NULL OR BINARY COLUMN_DEFAULT = BINARY 'NULL')
      AND EXTRA = '') = 1 AS expense_category_column_shape_ok,
  (SELECT COUNT(*)
     FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND ((TABLE_NAME = 'expense' AND CONSTRAINT_NAME = 'chk_expense_category')
        OR (TABLE_NAME = 'monthly_visit_commitment'
          AND CONSTRAINT_NAME = 'chk_monthly_visit_optional_fields'))
      AND CONSTRAINT_TYPE = 'CHECK') = 2 AS prerequisite_checks_present_ok;
```

Altı sonuç da exact `1` olmalıdır. Mevcut giderlerin yeni referans tablosuna güvenle bağlanabilmesi için kategori kodları kimlik veya tutar döndürmeden kontrol edilir:

```sql
SELECT COUNT(*) = 0 AS legacy_expense_categories_ok
FROM `expense`
WHERE BINARY `category` NOT IN (
  BINARY 'rent', BINARY 'software_subscription', BINARY 'transportation',
  BINARY 'meals_hospitality', BINARY 'marketing', BINARY 'office',
  BINARY 'external_service', BINARY 'tax_fee', BINARY 'other'
);
```

Sonuç exact `1` değilse migration uygulanmaz. Builder'ın hedefe bağlı global guard'ı ayrıca journal prefix'ini; `monthly_visit_commitment` tablo varsayılanını ve hedef kolon yokluğunu; `expense.category` exact tip/charset/collation/nullability biçimini; tarihsel kategori veri uyumunu; session policy, hedef ve server digest'ini DDL öncesinde exact doğrular. FK adımından hemen önce iki uçtaki kolon biçimi, parent unique indexi ve yetim kategori yokluğu yeniden doğrulanır.

## Hedefe bağlı paket üretimi

Digest değerleri yalnız gizli ve geçici PowerShell oturumunda sağlanır; aşağıdaki yer tutucular kaynak dosyada gerçek değerle değiştirilmez:

```powershell
$env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG = "0018_planning_expense_categories"
$env:PHPMYADMIN_TARGET_DB_SHA256 = "<64-kucuk-hex-hedef-digest>"
$env:PHPMYADMIN_SERVER_VERSION_SHA256 = "<64-kucuk-hex-sunucu-digest>"
npm run db:bundle:phpmyadmin:incremental
```

Üretilen hedefe bağlı çift:

- `dist/portal-pusula-incremental-0018_planning_expense_categories.sql`
- `dist/portal-pusula-incremental-0018_planning_expense_categories.manifest.json`

Manifestte `expectedJournalCount = 18`, `expectedPreviousMigration.tag = 0017_work_task_visit`, `migration.tag = 0018_planning_expense_categories` ve `migration.statementHashes` uzunluğu exact `9` olmalıdır. Hedef/server digest alanları bu change window girdileriyle eşleşmelidir. SQL byte boyutu ve SHA-256 özeti manifestle karşılaştırılır; aynı girdilerle ikinci üretim byte-identical olmalıdır. Gerçek digest/hash değerleri belgeye veya sohbete kopyalanmaz.

phpMyAdmin'de yalnız üretilen SQL artefaktı bir kez içe aktarılır. Çıktıda `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` ve `0018_planning_expense_categories` birlikte görülmeden başarı kabul edilmez.

## Final postflight

Generated bundle'ın statement ve final postflight kontrollerinin tamamı PASS olmalıdır. Ardından aşağıdaki salt okunur kontroller yeniden yapılır:

```sql
SELECT
  (SELECT COUNT(*) FROM `__drizzle_migrations`) = 19 AS journal_count_ok,
  (SELECT COALESCE(MIN(`id`), 0) FROM `__drizzle_migrations`) = 1 AS journal_min_ok,
  (SELECT COALESCE(MAX(`id`), 0) FROM `__drizzle_migrations`) = 19 AS journal_max_ok,
  (SELECT COUNT(*)
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
      AND TABLE_NAME <> '__drizzle_migrations') = 29 AS exact_29_application_tables_ok,
  (SELECT COUNT(*) FROM `expense_category`) = 9 AS exact_seed_count_ok,
  (SELECT COUNT(*) FROM `expense_category`
    WHERE `is_system` = 1 AND BINARY `status` = BINARY 'active') = 9 AS seed_state_ok,
  (SELECT COUNT(*) FROM `expense` e
    LEFT JOIN `expense_category` c ON BINARY c.`code` = BINARY e.`category`
    WHERE c.`code` IS NULL) = 0 AS expense_category_reference_ok;
```

Yedi sonuç da exact `1` olmalıdır. Ayrıca `information_schema` üzerinden şu sözleşmeler exact doğrulanır:

- `expense_category` `InnoDB`/`utf8mb4_unicode_ci`; primary key, üç unique, durum-ad indexi ve altı named CHECK;
- `id` ve `client_operation_key` canonical `ascii_bin` UUID; `code` FK tarafıyla eşleşen `varchar(32) CHARACTER SET ascii COLLATE ascii_bin`;
- `fk_expense_category`, `expense.category` → `expense_category.code` ve hem update hem delete için `RESTRICT`;
- `monthly_visit_commitment.location_label` nullable `varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, NULL default/boş `EXTRA` metadata'sı ve genişletilmiş `chk_monthly_visit_optional_fields` içinde trimli 1–191 karakter sınırı;
- seed kodları exact dokuz tarihsel kod; preflight'ta kaydedilen gider aggregate sayısı ve finansal tutarlar değişmemiş;
- `user_permission` allowlist'i exact 37 kodda kalmış; 0018 izin modeli değiştirmemiş.

Bu kontrollerden biri eksikse uygulama deploy edilmez. Exact başarı satırı olsa bile beklenmeyen şema/veri drift'i ayrı inceleme gerektirir.

Geçici environment değerleri change window sonunda temizlenir:

```powershell
Remove-Item Env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG -ErrorAction SilentlyContinue
Remove-Item Env:PHPMYADMIN_TARGET_DB_SHA256 -ErrorAction SilentlyContinue
Remove-Item Env:PHPMYADMIN_SERVER_VERSION_SHA256 -ErrorAction SilentlyContinue
```

## Partial failure ve replay yasağı

- Exact başarı satırı yoksa aynı SQL/manifest çifti ikinci kez import edilmez. Aynı migration için builder'ı yeniden çalıştırmak replay yasağını aşmaz.
- DDL'nin kısmen uygulanmış olabileceği varsayılır. Journal, seed, tablo, kolon, CHECK, index veya FK elle düzeltilmez.
- Yazma dondurması korunur; hedef yalnız `SELECT`, `information_schema` ve sağlayıcının read-only gözlem araçlarıyla incelenir.
- Sonraki adım, ayrı kullanıcı onaylı pencerede kanıtlanmış yedeğin restore'u veya yeni immutable forward-fix migration olabilir.

## Uygulama dağıtım ve smoke kapısı

Yalnız 0018 exact başarı satırı ve bütün postflight kontrolleri PASS olduktan sonra, aynı final committen üretilen canonical Hostinger ZIP'i veya ona bağlı Git deploy'u kullanılabilir. Dağıtım `Akım` olduktan sonra en az şu sınırlar smoke edilir:

- müşteri/konum filtreli günlük–haftalık–aylık plan ve müşteri ekranına geçmeden ziyaret tamamlama;
- yalnız seçilen müşterinin planlı/telafi ziyaretlerini içeren, görev/iç saat/süre sızdırmayan takvim/yazdırma dışa aktarımı;
- gider kategori listeleme/oluşturma, duplicate ve eşzamanlı duplicate güvenli davranışı;
- kart bazlı açık borç görünümü ve seçili taksitleri idempotent/denetimli biçimde ödendi işaretleme;
- haftalık/aylık nakit akışı ve İstanbul iş gününe göre doğru müşteri özeti;
- owner/member izinleri, finansal alan redaksiyonu, liveness/readiness, audit ve mevcut PWA/cache politikası.

Smoke PASS olmadan yazma dondurması kaldırılmaz. Bu runbook canlı migration'ın uygulandığını, deploy'un tamamlandığını veya Dilim 0 GO verildiğini iddia etmez.
