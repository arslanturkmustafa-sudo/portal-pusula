# phpMyAdmin mevcut şema yükseltme paketi — `0016` ve `0017`

Bu runbook, journal'ında exact `0000`–`0015` bulunan Portal Pusula veritabanına sırasıyla `0016_finance_accounts_ledger` ve `0017_work_task_visit` migration'larını uygular. Migration'lar iki ayrı, hedefe bağlı ve tek kullanımlık incremental paket olarak üretilir. Ham `drizzle/*.sql` dosyaları canlı hedefe doğrudan yapıştırılmaz; clean-only paket mevcut DB'de kullanılmaz.

MariaDB DDL transactional değildir. Uygulama yazmaları ön kontrolden güncel uygulama smoke testleri bitene kadar dondurulur. `0016` ile `0017` arasına uygulama deploy edilmez. Bir pakette exact başarı satırı görülmezse aynı paket yeniden çalıştırılmaz; sonraki migration'a geçilmez ve hedef salt okunur incelenir.

Bu belgenin, migration SQL'lerinin veya paket builder'ının kaynakta hazır olması; canlı hedefin ön kabulü geçtiğini, paketlerin o hedef için üretildiğini, import edildiğini ya da postflight'ın tamamlandığını kanıtlamaz.

## Değişmez güvenlik sınırları

- Doğru canlı DB, sunucu sürümü ve bakım penceresi iki bağımsız kontrolle doğrulanır.
- Güncel backup'ın doğru DB'yi kapsadığı ve ayrı disposable hedefe geri yüklenebildiği kanıtlanmadan paket üretilmez.
- Ham DB adı, kullanıcı adı, parola, connection string, gerçek digest veya artefakt hash'i belgeye, sohbete, ekran görüntüsüne ya da genel loga kopyalanmaz.
- Target/server digest girdileri yalnız kullanıcının gizli oturumunda geçici süreç environment'ına verilir; builder bu digest'leri tasarım gereği her paketin üretilen SQL ve manifest dosyasına gömer. Her paketin bu iki artefaktı hassas operasyon metadata'sıdır: change window boyunca yalnız exact hedef dosyalarda, yalnız yetkili kullanıcı ve sistem hesabının okuyabildiği ACL-kısıtlı alanda tutulur; Git'e eklenmez, canonical uygulama ZIP'ine girmez, sohbet/e-posta/public paylaşım veya model-visible ekrana taşınmaz. İki pakette de aynı hedef kimliği kullanılır.
- Change window kapanırken her SQL/manifest çifti için retention kararı kayda bağlanır. Saklanacaksa kurumun erişim-kısıtlı operasyon kanıt deposuna alınır; saklanmayacaksa exact dört artefakt yolu ve hedef dizin doğrulanarak kontrollü silinir. Genel `dist/` temizliği, glob veya geniş dizin silme kullanılmaz. Kanıt kaydında gerçek digest/hash yerine yalnız erişim-kısıtlı artefakt kaydına referans verilir.
- `0016` ve `0017` farklı SQL/manifest çiftleridir. Birleştirilmez, elle düzenlenmez ve başka hedefte yeniden kullanılmaz.
- Uygulanmış journal satırı veya migration SQL'i elle değiştirilmez. `DROP`, elle constraint düzeltme ve journal satırı ekleme/silme bu akışın parçası değildir.
- Exact başarı satırı dışındaki her sonuç `UNKNOWN` kabul edilir. “Nesne zaten var” benzeri bir hata replay izni vermez.

## Backup ve bakım penceresi kapısı

1. Provider yedeğinin doğru Portal Pusula DB'sini kapsadığı, alınma zamanı, retention sınırı ve restore erişimi secretsız bir kanıt kimliğiyle kaydedilir.
2. Yedek production DB'ye değil, yeni ve ayrı disposable DB/kullanıcı hedefe geri yüklenir. Restore hedefinde journal sırası/bütünlüğü, exact 24 uygulama tablosu ve kontrollü ilişki/satır örnekleri salt okunur doğrulanır.
3. RPO/RTO, yazma dondurması, sorumlu kişi ve abort koşulu onaylanır. Restore kanıtı güncel değişiklik penceresine ait değilse durulur.
4. Canlı yazmalar dondurulduktan sonra aşağıdaki ön kontroller tekrar çalıştırılır. Sonuçlar beklenenden farklıysa paket üretilmez veya import edilmez.

## Ortak hedef ve journal ön kontrolü

Aşağıdaki sorgular yalnız kullanıcının gizli phpMyAdmin oturumunda çalıştırılır. Yer tutucular, aynı change window için güvenli biçimde hesaplanan değerlerle yalnız o oturumda değiştirilir. Gerçek değerler bu dosyaya veya başka bir kayıt yüzeyine eklenmez.

```sql
SELECT
  BINARY LOWER(SHA2(DATABASE(), 256)) =
    BINARY '<manifest.targetDatabaseSha256>' AS target_database_digest_ok,
  BINARY LOWER(SHA2(VERSION(), 256)) =
    BINARY '<manifest.serverVersionSha256>' AS server_version_digest_ok;
```

Beklenen iki sonuç da exact `1`dir. Sonuçta ham DB adı veya sunucu sürümü gösterilmez.

Journal fazı için şu salt okunur kontrol kullanılır:

```sql
WITH phase (phase_name, expected_count) AS (
  SELECT '0016_preflight', 16 UNION ALL
  SELECT '0016_postflight__0017_preflight', 17 UNION ALL
  SELECT '0017_postflight', 18
),
actual AS (
  SELECT COUNT(*) AS row_count,
         COALESCE(MIN(`id`), 0) AS min_id,
         COALESCE(MAX(`id`), 0) AS max_id,
         (SELECT `AUTO_INCREMENT`
            FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = '__drizzle_migrations') AS next_id
    FROM `__drizzle_migrations`
)
SELECT phase.phase_name,
       actual.row_count,
       actual.min_id,
       actual.max_id,
       actual.next_id,
       IF(actual.row_count = phase.expected_count
          AND actual.min_id = 1
          AND actual.max_id = phase.expected_count
          AND actual.next_id = phase.expected_count + 1, 1, 0) AS phase_count_ok
  FROM phase
 CROSS JOIN actual
 ORDER BY phase.expected_count;
```

Yalnız güncel faz satırının `phase_count_ok` değeri `1` olmalıdır: `0016` öncesi `16 | 1 | 16 | 17`, `0016` sonrası `17 | 1 | 17 | 18`, `0017` sonrası `18 | 1 | 18 | 19`. Bu sayaç sorgusu tek başına full journal kanıtı değildir. Üretilen target-bound paketin guard'ı ve manifest incelemesi, uygulanmış full prefix'in her hash/timestamp değerini sürümlü journal ile exact karşılaştırmalıdır; bu karşılaştırma PASS değilse durulur.

## Ortak izin allowlist kontrolü

Aşağıdaki sorgu hem `0015` öncesi allowlist'i hem `0016` sonrası final allowlist'i aynı kaynak listesiyle doğrular:

```sql
WITH expected_code (code, introduced_in_0016) AS (
  SELECT 'accounts.manage', 0 UNION ALL
  SELECT 'customers.read', 0 UNION ALL SELECT 'customers.write', 0 UNION ALL
  SELECT 'customers.lifecycle', 0 UNION ALL SELECT 'customers.contact.read', 0 UNION ALL
  SELECT 'contracts.read', 0 UNION ALL SELECT 'contracts.write', 0 UNION ALL
  SELECT 'contracts.lifecycle', 0 UNION ALL SELECT 'contracts.billing.read', 0 UNION ALL
  SELECT 'contracts.billing.write', 0 UNION ALL SELECT 'visits.read', 0 UNION ALL
  SELECT 'visits.write', 0 UNION ALL SELECT 'daily-plan.read', 0 UNION ALL
  SELECT 'projects.read', 0 UNION ALL SELECT 'projects.write', 0 UNION ALL
  SELECT 'projects.lifecycle', 0 UNION ALL SELECT 'tasks.read', 0 UNION ALL
  SELECT 'tasks.write', 0 UNION ALL SELECT 'tasks.lifecycle', 0 UNION ALL
  SELECT 'tasks.assign', 0 UNION ALL SELECT 'tasks.reports.export', 0 UNION ALL
  SELECT 'finance.receivables.read', 0 UNION ALL SELECT 'finance.receivables.write', 0 UNION ALL
  SELECT 'finance.receivables.reverse', 0 UNION ALL SELECT 'finance.expenses.read', 0 UNION ALL
  SELECT 'finance.expenses.write', 0 UNION ALL SELECT 'finance.expenses.reverse', 0 UNION ALL
  SELECT 'finance.cards.read', 0 UNION ALL SELECT 'finance.cards.write', 0 UNION ALL
  SELECT 'finance.partnership.read', 0 UNION ALL SELECT 'finance.partnership.write', 0 UNION ALL
  SELECT 'finance.partnership.reverse', 0 UNION ALL SELECT 'finance.reports.read', 0 UNION ALL
  SELECT 'finance.reports.export', 0 UNION ALL SELECT 'audit.read', 0 UNION ALL
  SELECT 'finance.accounts.read', 1 UNION ALL SELECT 'finance.accounts.write', 1
),
installed_check AS (
  SELECT LOWER(c.CHECK_CLAUSE) AS check_text
    FROM information_schema.CHECK_CONSTRAINTS c
    JOIN information_schema.TABLE_CONSTRAINTS t
      ON t.CONSTRAINT_SCHEMA = c.CONSTRAINT_SCHEMA
     AND t.CONSTRAINT_NAME = c.CONSTRAINT_NAME
   WHERE c.CONSTRAINT_SCHEMA = DATABASE()
     AND t.TABLE_NAME = 'user_permission'
     AND t.CONSTRAINT_NAME = 'chk_user_permission_code'
     AND t.CONSTRAINT_TYPE = 'CHECK'
)
SELECT
  SUM(introduced_in_0016 = 0) AS base_codes,
  SUM(introduced_in_0016 = 0
      AND LOCATE(CONCAT(CHAR(39), code, CHAR(39)), check_text) > 0) AS base_codes_found,
  SUM(introduced_in_0016 = 1
      AND LOCATE(CONCAT(CHAR(39), code, CHAR(39)), check_text) > 0) AS account_codes_found,
  MAX(LENGTH(check_text) - LENGTH(REPLACE(check_text, CHAR(39), ''))) AS quote_delimiters,
  IF(SUM(introduced_in_0016 = 0
         AND LOCATE(CONCAT(CHAR(39), code, CHAR(39)), check_text) > 0) = 35
     AND SUM(introduced_in_0016 = 1
             AND LOCATE(CONCAT(CHAR(39), code, CHAR(39)), check_text) > 0) = 0
     AND MAX(LENGTH(check_text) - LENGTH(REPLACE(check_text, CHAR(39), '')) = 70,
     1, 0) AS exact_0015_allowlist,
  IF(SUM(LOCATE(CONCAT(CHAR(39), code, CHAR(39)), check_text) > 0) = 37
     AND MAX(LENGTH(check_text) - LENGTH(REPLACE(check_text, CHAR(39), '')) = 74,
     1, 0) AS exact_0016_allowlist
  FROM expected_code
 CROSS JOIN installed_check;
```

`0016` öncesi beklenen sonuç `35 | 35 | 0 | 70 | 1 | 0`, `0016` ve `0017` sonrası `35 | 35 | 2 | 74 | 0 | 1`dir. `user_permission` içindeki mevcut satırların bu allowlist dışında kalmadığı ayrıca doğrulanır; gerçek hesap kimlikleri sonuç kümesine çıkarılmaz:

```sql
SELECT COUNT(*) = 0 AS permission_rows_allowlisted_ok
  FROM `user_permission`
 WHERE BINARY `permission_code` NOT IN (
   BINARY 'accounts.manage',
   BINARY 'customers.read', BINARY 'customers.write', BINARY 'customers.lifecycle',
   BINARY 'customers.contact.read',
   BINARY 'contracts.read', BINARY 'contracts.write', BINARY 'contracts.lifecycle',
   BINARY 'contracts.billing.read', BINARY 'contracts.billing.write',
   BINARY 'visits.read', BINARY 'visits.write', BINARY 'daily-plan.read',
   BINARY 'projects.read', BINARY 'projects.write', BINARY 'projects.lifecycle',
   BINARY 'tasks.read', BINARY 'tasks.write', BINARY 'tasks.lifecycle',
   BINARY 'tasks.assign', BINARY 'tasks.reports.export',
   BINARY 'finance.receivables.read', BINARY 'finance.receivables.write',
   BINARY 'finance.receivables.reverse',
   BINARY 'finance.expenses.read', BINARY 'finance.expenses.write',
   BINARY 'finance.expenses.reverse',
   BINARY 'finance.cards.read', BINARY 'finance.cards.write',
   BINARY 'finance.accounts.read', BINARY 'finance.accounts.write',
   BINARY 'finance.partnership.read', BINARY 'finance.partnership.write',
   BINARY 'finance.partnership.reverse',
   BINARY 'finance.reports.read', BINARY 'finance.reports.export',
   BINARY 'audit.read'
 );
```

Bu son sorgunun sonucu her fazda exact `1` olmalıdır. `0016` öncesi iki yeni kodun CHECK tarafından henüz kabul edilmemesi beklenir; sorgudaki geniş liste mevcut satırlarda tanımsız başka kod bulunmadığını kontrol eder.

## `0016_finance_accounts_ledger`

### 0016 preflight

Ortak hedef sorgusunda iki digest kontrolü, journal sorgusunda yalnız `0016_preflight` ve allowlist sorgusunda yalnız `exact_0015_allowlist` PASS olmalıdır. Ardından tablo sınırı doğrulanır:

```sql
SELECT
  (SELECT COUNT(*)
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
      AND TABLE_NAME <> '__drizzle_migrations') = 24 AS exact_24_application_tables_ok,
  (SELECT COUNT(*)
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN (
        'finance_account', 'finance_transaction',
        'finance_ledger_entry', 'work_task_visit'
      )) = 0 AS target_tables_absent_ok,
  (SELECT COUNT(*)
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN (
        'user_permission', 'work_task', 'monthly_visit_commitment'
      )) = 3 AS prerequisite_tables_present_ok;
```

Üç sonuç da exact `1` olmalıdır. `finance.accounts.read` veya `finance.accounts.write` kodlu mevcut satır bulunmaması da kimlik döndürmeden kontrol edilir:

```sql
SELECT COUNT(*) = 0 AS account_permission_rows_absent_ok
  FROM `user_permission`
 WHERE BINARY `permission_code` IN (
   BINARY 'finance.accounts.read', BINARY 'finance.accounts.write'
 );
```

### 0016 target-bound paket üretimi

Digest değerleri yalnız gizli ve geçici shell oturumunda sağlanır; aşağıdaki yer tutucular kaynak dosyada gerçek değerle değiştirilmez:

```powershell
$env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG = "0016_finance_accounts_ledger"
$env:PHPMYADMIN_TARGET_DB_SHA256 = "<64-kucuk-hex-hedef-digest>"
$env:PHPMYADMIN_SERVER_VERSION_SHA256 = "<64-kucuk-hex-sunucu-digest>"
npm run db:bundle:phpmyadmin:incremental
```

Üretilen iki ayrı dosya şunlardır:

- `dist/portal-pusula-incremental-0016_finance_accounts_ledger.sql`
- `dist/portal-pusula-incremental-0016_finance_accounts_ledger.manifest.json`

Manifestte `expectedJournalCount = 16`, `expectedPreviousMigration.tag = 0015_financial_reversals`, `migration.tag = 0016_finance_accounts_ledger` ve `migration.statementHashes` uzunluğu exact 15 olmalıdır. Hedef ve sunucu digest alanları bu change window girdileriyle eşleşmelidir. SQL byte boyutu ve SHA-256 özeti yerelde yeniden hesaplanıp manifestle karşılaştırılır; aynı girdilerle ikinci üretim byte-identical olmalıdır. Gerçek özet değerleri bu belgeye veya sohbete kopyalanmaz. SQL ve manifest, yukarıdaki ACL/retention sınırı uygulanmadan ortak veya kalıcı bir klasöre kopyalanmaz.

phpMyAdmin'de yalnız bu SQL artefaktı bir kez içe aktarılır. Çıktıda `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` ve `0016_finance_accounts_ledger` birlikte görülmeden başarı kabul edilmez.

### 0016 postflight

Ortak hedef sorgusu yeniden PASS olmalı; journal sorgusunda yalnız `0016_postflight__0017_preflight`, allowlist sorgusunda yalnız `exact_0016_allowlist` PASS olmalıdır. Aşağıdaki tablo kontrolünün bütün kolonları exact `1` vermelidir:

```sql
SELECT
  (SELECT COUNT(*)
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
      AND TABLE_NAME <> '__drizzle_migrations') = 27 AS exact_27_application_tables_ok,
  (SELECT COUNT(*)
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN (
        'finance_account', 'finance_transaction', 'finance_ledger_entry'
      )) = 3 AS finance_tables_present_ok,
  ((SELECT COUNT(*) FROM `finance_account`)
   + (SELECT COUNT(*) FROM `finance_transaction`)
   + (SELECT COUNT(*) FROM `finance_ledger_entry`)) = 0 AS finance_tables_empty_ok,
  (SELECT COUNT(*)
     FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME IN (
        'finance_account', 'finance_transaction', 'finance_ledger_entry'
      )
      AND CONSTRAINT_TYPE = 'PRIMARY KEY') = 3 AS primary_keys_ok,
  (SELECT COUNT(*)
     FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME IN (
        'finance_account', 'finance_transaction', 'finance_ledger_entry'
      )
      AND CONSTRAINT_TYPE = 'UNIQUE') = 5 AS unique_constraints_ok,
  (SELECT COUNT(*)
     FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONSTRAINT_NAME IN (
        'fk_finance_ledger_entry_transaction',
        'fk_finance_ledger_entry_account',
        'fk_finance_transaction_source_account',
        'fk_finance_transaction_target_account',
        'fk_finance_transaction_reversal'
      )
      AND DELETE_RULE = 'RESTRICT'
      AND UPDATE_RULE = 'RESTRICT') = 5 AS restrict_foreign_keys_ok,
  (SELECT COUNT(*)
     FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME IN (
        'finance_account', 'finance_transaction', 'finance_ledger_entry'
      )
      AND CONSTRAINT_TYPE = 'CHECK') = 16 AS named_checks_ok,
  (SELECT COUNT(DISTINCT TABLE_NAME, INDEX_NAME)
     FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND INDEX_NAME IN (
        'idx_finance_account_status_type_name',
        'idx_finance_ledger_account_created',
        'idx_finance_transaction_occurred',
        'idx_finance_transaction_source_occurred',
        'idx_finance_transaction_target_occurred'
      )) = 5 AS query_indexes_ok,
  (SELECT COUNT(*)
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'work_task_visit') = 0 AS work_task_visit_still_absent_ok;
```

Generated bundle'ın per-statement postflight kontrolleri de PASS olmalıdır. Özellikle `DECIMAL(19,4)`, exact `TRY`, canonical `ascii_bin` kimlik/idempotency, gelir-gider-transfer şekli, iki taraflı ledger unique'leri ve forward-only reversal self-FK/unique sözleşmeleri migration kaynağıyla karşılaştırılır. Bu kapıların biri eksikse `0017` paketi üretilmez.

## `0017_work_task_visit`

### Fazlar arası kapı

- `0016` exact başarı ve bütün postflight sonuçları PASS olmalıdır.
- Uygulama yazma dondurması devam eder; bu noktada Git merge, ZIP yükleme veya başka uygulama deploy'u yapılmaz.
- Hedef DB ve server digest'leri değişmemelidir. Değişirse eski paketler kullanılmaz; değişiklik penceresi yeniden değerlendirilir.
- `work_task_visit` hâlâ yok, `work_task` ve `monthly_visit_commitment` tabloları mevcut olmalıdır.

İki parent kimlik kolonu ve bunların referanslanabilir primary key şekli, herhangi bir `0017` DDL'i çalışmadan önce exact doğrulanır:

```sql
SELECT
  (SELECT COUNT(*)
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('work_task', 'monthly_visit_commitment')
      AND COLUMN_NAME = 'id'
      AND BINARY DATA_TYPE = BINARY 'char'
      AND BINARY COLUMN_TYPE = BINARY 'char(36)'
      AND CHARACTER_MAXIMUM_LENGTH = 36
      AND BINARY CHARACTER_SET_NAME = BINARY 'ascii'
      AND BINARY COLLATION_NAME = BINARY 'ascii_bin'
      AND BINARY IS_NULLABLE = BINARY 'NO'
      AND (COLUMN_DEFAULT IS NULL OR BINARY COLUMN_DEFAULT = BINARY 'NULL')
      AND EXTRA = '') = 2 AS exact_parent_id_columns_ok,
  ((SELECT COUNT(*)
      FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('work_task', 'monthly_visit_commitment')
       AND CONSTRAINT_NAME = 'PRIMARY'
       AND CONSTRAINT_TYPE = 'PRIMARY KEY') = 2
   AND
   (SELECT COUNT(*)
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('work_task', 'monthly_visit_commitment')
       AND INDEX_NAME = 'PRIMARY') = 2
   AND
   (SELECT COUNT(*)
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('work_task', 'monthly_visit_commitment')
       AND INDEX_NAME = 'PRIMARY'
       AND NON_UNIQUE = 0
       AND INDEX_TYPE = 'BTREE'
       AND SEQ_IN_INDEX = 1
       AND COLUMN_NAME = 'id') = 2) AS exact_parent_primary_keys_ok;
```

İki sonuç da exact `1` olmalıdır. Target-bound builder aynı sözleşmeyi, ilk candidate DDL hazırlanmasından önceki global guard içinde tekrar doğrular. Kolon veya key drift'inde paket hiçbir `CREATE`/`ALTER` çalıştırmadan guard failure ile durmalıdır; `work_task_visit` oluşmuşsa eski paket yeniden çalıştırılmaz ve hedef salt okunur incelenir.

### 0017 target-bound paket üretimi

Aynı gizli shell oturumunda yalnız migration tag'i değiştirilir:

```powershell
$env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG = "0017_work_task_visit"
npm run db:bundle:phpmyadmin:incremental
```

Üretilen ikinci SQL/manifest çifti şunlardır:

- `dist/portal-pusula-incremental-0017_work_task_visit.sql`
- `dist/portal-pusula-incremental-0017_work_task_visit.manifest.json`

Manifestte `expectedJournalCount = 17`, `expectedPreviousMigration.tag = 0016_finance_accounts_ledger`, `migration.tag = 0017_work_task_visit` ve `migration.statementHashes` uzunluğu exact 4 olmalıdır. Hedef/server digest'leri 0016 paketiyle aynı olmalıdır. Boyut/hash eşleşmesi ve ikinci byte-identical üretim aynı biçimde doğrulanır; gerçek değerler bu belgeye yazılmaz. İkinci SQL/manifest çifti de ilk çiftle aynı ACL/retention sınırına tabidir.

phpMyAdmin'de yalnız 0017 SQL artefaktı bir kez içe aktarılır. Çıktıda `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` ve `0017_work_task_visit` birlikte görülmeden başarı kabul edilmez.

### 0017 final postflight

Ortak hedef sorgusu yeniden PASS olmalı; journal sorgusunda yalnız `0017_postflight`, allowlist sorgusunda yalnız `exact_0016_allowlist` PASS olmalıdır. Final tablo kontrolünün bütün kolonları exact `1` vermelidir:

```sql
SELECT
  (SELECT COUNT(*)
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
      AND TABLE_NAME <> '__drizzle_migrations') = 28 AS exact_28_application_tables_ok,
  (SELECT COUNT(*) FROM `work_task_visit`) = 0 AS work_task_visit_empty_ok,
  (SELECT COUNT(*)
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'work_task_visit') = 4 AS exact_columns_ok,
  (SELECT COUNT(*)
     FROM information_schema.KEY_COLUMN_USAGE
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'work_task_visit'
      AND CONSTRAINT_NAME = 'PRIMARY'
      AND COLUMN_NAME = 'task_id'
      AND ORDINAL_POSITION = 1) = 1 AS task_primary_key_ok,
  (SELECT COUNT(*)
     FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONSTRAINT_NAME IN (
        'fk_work_task_visit_task', 'fk_work_task_visit_visit'
      )
      AND DELETE_RULE = 'RESTRICT'
      AND UPDATE_RULE = 'RESTRICT') = 2 AS restrict_foreign_keys_ok,
  (SELECT COUNT(*)
     FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'work_task_visit'
      AND CONSTRAINT_TYPE = 'CHECK'
      AND CONSTRAINT_NAME IN (
        'chk_work_task_visit_identity', 'chk_work_task_visit_timeline'
      )) = 2 AS named_checks_ok,
  (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
     FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'work_task_visit'
      AND INDEX_NAME = 'idx_work_task_visit_visit_task') =
    'visit_id,task_id' AS visit_task_index_ok,
  (SELECT COUNT(*)
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN (
        'finance_account', 'finance_transaction', 'finance_ledger_entry'
      )) = 3 AS finance_tables_preserved_ok;
```

Generated bundle'ın per-statement kontrolleri ayrıca `task_id` ve `visit_id` için canonical `ascii_bin` kimlikleri, görev başına tek ilişkiyi sağlayan primary key'i, `work_task`/`monthly_visit_commitment` hedefli iki `RESTRICT` FK'yi, UTC timeline CHECK'ini ve `(visit_id, task_id)` indexini exact doğrulamalıdır. Migration backfill, seed veya mevcut satır değişikliği üretmemelidir.

Final kabulde 0016 finans şekli de yeniden doğrulanır. `0016 postflight` bölümündeki sorgu salt okunur olarak tekrar çalıştırılır: 0017 nedeniyle `exact_27_application_tables_ok` ve `work_task_visit_still_absent_ok` sonuçlarının artık `0` olması beklenir; `finance_tables_present_ok`, `finance_tables_empty_ok`, `primary_keys_ok`, `unique_constraints_ok`, `restrict_foreign_keys_ok`, `named_checks_ok` ve `query_indexes_ok` sonuçlarının tamamı exact `1` kalmalıdır. Ayrıca 0016 artefaktının daha önce onaylanmış per-statement postflight'ından türetilen salt okunur `information_schema`/`SHOW CREATE TABLE` karşılaştırmaları; kolon/default/collation, named CHECK clause, FK hedefi ve index sırası için üç finans tablosunda yeniden PASS olmalıdır. Bunun için 0016 SQL paketi veya herhangi bir DDL yeniden çalıştırılmaz; yalnız onaylı read-only kontrol sorguları kullanılır. Herhangi bir drift final deploy'u durdurur.

İşlem tamamlandıktan sonra geçici shell değerleri temizlenir:

```powershell
Remove-Item Env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG -ErrorAction SilentlyContinue
Remove-Item Env:PHPMYADMIN_TARGET_DB_SHA256 -ErrorAction SilentlyContinue
Remove-Item Env:PHPMYADMIN_SERVER_VERSION_SHA256 -ErrorAction SilentlyContinue
```

## Partial failure ve replay yasağı

- 0016 exact başarı satırı yoksa `0017` uygulanmaz ve uygulama deploy edilmez.
- 0017 exact başarı satırı yoksa uygulama deploy edilmez.
- Hata öncesinde DDL'nin kısmen uygulanmış olabileceği varsayılır. Aynı SQL/manifest çifti ikinci kez import edilmez. Builder'ı yeniden çalıştırıp aynı migration için başka bir paket üretmek replay yasağını aşmaz; bu paketi üretmek veya uygulamak da yasaktır.
- Journal, tablo, kolon, constraint veya index elle eklenmez, silinmez ya da yeniden adlandırılmaz. Canlı veriye düzeltme/backfill uygulanmaz.
- Yazma dondurması korunur; hedef yalnız `SELECT`, `information_schema` ve sağlayıcının read-only gözlem araçlarıyla incelenir. Sonraki adım onaylı backup restore'u veya yeni immutable forward-fix migration olabilir.
- Restore kararı olası veri kaybı aralığı, RPO/RTO ve doğru target doğrulamasıyla ayrıca kullanıcı tarafından onaylanır.

## Uygulama dağıtım ve smoke kapısı

Yalnız iki migration'ın exact başarı satırı ve bütün postflight kontrolleri PASS olduktan sonra, aynı final committen üretilen canonical Hostinger ZIP'i veya ona bağlı Git deploy'u kullanılabilir. İki DB migration'ı arasında uygulama deploy edilmez.

Dağıtım `Akım` olduktan sonra en az şu sınırlar smoke edilir:

- liveness/readiness ve secret/redaction davranışı;
- owner/member izinlerinde `finance.accounts.read` ile `finance.accounts.write` ayrımı;
- kasa/banka açılış bakiyesi, gelir/gider/transfer, çift taraflı bakiye ve ileri yönlü ters kayıt;
- günlük/haftalık/aylık planda görev projeksiyonu, ziyaret bağı ve görev yazma yetkisi olmadan iş maddesi reddi;
- lifecycle, audit geçmişi, finansal alan redaksiyonu ve mevcut PWA/cache politikası.

Smoke PASS olmadan yazma dondurması kaldırılmaz. Kaynakta hazır migration, doküman, manifest şeması veya yerel test sonucu canlı import/postflight/deploy kanıtı değildir; canlı kabul yalnız change window sırasında elde edilen hedefe bağlı kanıtlarla verilir.
