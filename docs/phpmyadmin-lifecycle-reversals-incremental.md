# phpMyAdmin mevcut şema yükseltme paketi — `0014` ve `0015`

Bu akış, journal'ında exact `0000`–`0013` bulunan Portal Pusula veritabanına sırasıyla `0014_record_lifecycle` ve `0015_financial_reversals` migration'larını uygular. İki migration ayrı, hedefe bağlı ve tek kullanımlık paketlerdir. Ham `drizzle/*.sql` dosyaları canlı hedefe doğrudan yüklenmez; clean-only paket mevcut DB'de kullanılmaz.

MariaDB DDL transactional değildir. Uygulama yazmaları ön kontrolden güncel uygulama smoke testleri bitene kadar dondurulur. Bir pakette exact başarı satırı görülmezse aynı paket yeniden çalıştırılmaz; hedef salt okunur incelenir ve gerekirse yeni forward-fix migration hazırlanır.

## Ortak ön kontrol

Güncel yedek ve geri yükleme provası, doğru DB hedefi ve bakım penceresi iki bağımsız kontrolle doğrulanır. Bu belge bir backup veya restore işleminin gerçekleştiğini iddia etmez. Her change window'da aşağıdaki prosedür yeniden tamamlanır:

1. Provider yedeğinin doğru Portal Pusula DB'sini kapsadığı, alınma zamanı ve retention sınırı secretsız bir kanıt kimliğiyle kaydedilir.
2. Yedek production DB'ye değil, yeni ve ayrı disposable DB/kullanıcı hedefe geri yüklenir; site/dosya restore'u ve diğer DB'ler kapsam dışında tutulur.
3. Restore hedefinde journal sıra/hash/timestamp bütünlüğü, 0013 şema nesneleri, temsili ilişki ve satır sayaçları salt okunur doğrulanır. Gerçek DB adı, kullanıcı, parola, connection string, PII veya finansal değer kanıt kaydına yazılmaz.
4. Restore doğrulaması, bakım penceresi, RPO/RTO ve abort koşulu onaylanmadan paket üretilmez, phpMyAdmin import'u yapılmaz ve uygulama deploy edilmez.

Canlı hedefte uygulama yazmaları ön kontrolden güncel uygulama smoke testleri bitene kadar tamamen dondurulur.

Başlangıçta beklenen durum:

- `__drizzle_migrations` exact 14 satırdır ve son satır sürümlü manifestteki `0013_login_attempt_throttle` hash/timestamp'ıyla eşleşir;
- `0014` archive/version kolonları ile `0015` void/reversal kolonları henüz yoktur;
- uygulama yazmaları tamamen dondurulmuştur;
- DB adı ve `VERSION()` değeri yalnız güvenli yerel süreçte SHA-256 digest'e çevrilmiştir.

Herhangi bir farkta paket üretilmez veya uygulanmaz.

### Sorgu kullanım kuralı

Aşağıdaki SQL blokları yalnız `SELECT` kullanır ve gerçek DB adı veya `VERSION()` değerini sonuç kümesine çıkarmaz. Her bloktaki `<manifest.targetDatabaseSha256>` ve `<manifest.serverVersionSha256>` yer tutucuları, o change window için üretilen target-bound manifestteki exact 64 küçük hex digest ile yalnız kullanıcının gizli phpMyAdmin oturumunda değiştirilir. Ham DB adı veya server version hiçbir komuta, ekran görüntüsüne, loga ya da belgeye kopyalanmaz.

Her sorguda beklenen sonuç bütün `*_ok` kolonlarının exact `1` olmasıdır. `0`, `NULL`, eksik kolon, SQL hatası veya beklenmeyen ek result set fail-closed sonuçtur. Builder ayrıca full journal prefix'i, her DDL statement hash'ini, per-statement preflight/postflight'ı, session politikasını ve advisory lock sahipliğini kendi içinde yeniden doğrular; aşağıdaki dış sorgular bundle guard'ının yerine geçmez.

Her fazda önce builder'ın full prefix kuralından türetilen şu ortak journal sorgusu çalıştırılır:

```sql
WITH expected_migration (id, migration_hash, created_at) AS (
  SELECT 1, '3fdcdcd582fc0c2002948f6f3d5b1993b117bccc5fb2581714e932c0575a65a8', 1788107612321 UNION ALL
  SELECT 2, 'a113ac3d3d40cb4017d7a8a9406f4cc4d568e274f22d2d4e5577e11fd4635cce', 1788112845060 UNION ALL
  SELECT 3, 'b2a4f6a5c53f9e48b300467045c03f9e602f58a0ab33572dc315fff173b2952c', 1788116023820 UNION ALL
  SELECT 4, '42b92645038c4f436b0ea88c544f0859ef016f8e04e4c10f3b547ec0cf6e51bd', 1788117573101 UNION ALL
  SELECT 5, '8027aef0d0c48a6c29d806a45c7e074a50ea7cf890dc1a40786c0f3b63bf0dc5', 1788262397356 UNION ALL
  SELECT 6, '33b7926be1645c3367dd5c8a7db79ee7aea78391331d457dc694624e68264a4b', 1788265670001 UNION ALL
  SELECT 7, '5e559147a2b664853f48dcac08e520c5d976eadc3f6ee98b383bbc397a9dfb91', 1788282029501 UNION ALL
  SELECT 8, '4ec9220ec18d7766ccb52535586082a6a6bcb69f9b0ceed1aa4d8f3344adb380', 1788288108173 UNION ALL
  SELECT 9, '9835a13facbd1a0485bcc4cb6e6776e0f2d64b9b1d1c59aa0798fa97dbb21aa3', 1788352666114 UNION ALL
  SELECT 10, '86e1b6730d77d1e5d70ed011a0073926a1704b14940fa22c12bce94ae9b3d8f2', 1788423447345 UNION ALL
  SELECT 11, '1a2d0d64e14138d940fa2d6f4e56561b16ad06c7a63b1be6e63d6073c0c0c629', 1788428596372 UNION ALL
  SELECT 12, 'b3abd1340be3a5f4c96c1a63348d44c134bdc907fc5a24e1b978093ad6708c81', 1788435178955 UNION ALL
  SELECT 13, '31e4ab2e12ae6596a042c912c32ea3e90e96f8160e670530ae00adca3d0c7872', 1788457473182 UNION ALL
  SELECT 14, '587449c0221adfc447216d95c3ee453d32a19457a93ae3f71e0d7f91b73f3d67', 1788504772177 UNION ALL
  SELECT 15, '616db5f1f8c62efce707f98febdf5a2d325f8fa8791811429aa20b374f96aba4', 1788512254928 UNION ALL
  SELECT 16, 'cce0b24f60ec8a30ec99b985aa079c2de2e1d5dbcd60b1c1507f0794f3ec71be', 1788512602613
),
expected_phase (phase_name, expected_count, target_hash, target_created_at) AS (
  SELECT '0014_preflight', 14, '616db5f1f8c62efce707f98febdf5a2d325f8fa8791811429aa20b374f96aba4', 1788512254928 UNION ALL
  SELECT '0014_postflight__0015_preflight', 15, 'cce0b24f60ec8a30ec99b985aa079c2de2e1d5dbcd60b1c1507f0794f3ec71be', 1788512602613 UNION ALL
  SELECT '0015_postflight', 16, NULL, NULL
),
actual_summary AS (
  SELECT COUNT(*) AS actual_count,
         COALESCE(MAX(`id`), 0) AS max_id,
         (SELECT `AUTO_INCREMENT` FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = '__drizzle_migrations') AS next_id
  FROM `__drizzle_migrations`
),
exact_match AS (
  SELECT p.phase_name, COUNT(a.`id`) AS exact_rows
  FROM expected_phase p
  JOIN expected_migration e ON e.id <= p.expected_count
  LEFT JOIN `__drizzle_migrations` a
    ON a.`id` = e.id
   AND OCTET_LENGTH(a.`hash`) = 64
   AND BINARY a.`hash` = BINARY e.migration_hash
   AND a.`created_at` = e.created_at
  GROUP BY p.phase_name
),
target_collision AS (
  SELECT p.phase_name, COUNT(a.`id`) AS target_collisions
  FROM expected_phase p
  LEFT JOIN `__drizzle_migrations` a
    ON p.target_hash IS NOT NULL
   AND (BINARY a.`hash` = BINARY p.target_hash
        OR a.`created_at` = p.target_created_at)
  GROUP BY p.phase_name
)
SELECT p.phase_name,
       s.actual_count,
       s.max_id,
       s.next_id,
       m.exact_rows,
       c.target_collisions,
       IF(
         s.actual_count = p.expected_count
         AND s.max_id = p.expected_count
         AND s.next_id = p.expected_count + 1
         AND m.exact_rows = p.expected_count
         AND c.target_collisions = 0,
         1,
         0
       ) AS phase_pass
FROM expected_phase p
CROSS JOIN actual_summary s
JOIN exact_match m ON m.phase_name = p.phase_name
JOIN target_collision c ON c.phase_name = p.phase_name
ORDER BY p.expected_count;
```

Beklenen exact tek PASS satırı faza göre şöyledir; diğer iki satırın `phase_pass` değeri `0` olmalıdır:

| Faz | `actual_count` | `max_id` | `next_id` | `exact_rows` | `target_collisions` | `phase_pass` |
|---|---:|---:|---:|---:|---:|---:|
| 0014 öncesi `0014_preflight` | 14 | 14 | 15 | 14 | 0 | 1 |
| 0014 sonrası / 0015 öncesi `0014_postflight__0015_preflight` | 15 | 15 | 16 | 15 | 0 | 1 |
| 0015 sonrası `0015_postflight` | 16 | 16 | 17 | 16 | 0 | 1 |

## `0014_record_lifecycle`

Önce aşağıdaki secretsız preflight sorgusu çalıştırılır:

```sql
SELECT
  BINARY SHA2(DATABASE(), 256) = BINARY '<manifest.targetDatabaseSha256>'
    AS target_database_digest_ok,
  BINARY SHA2(VERSION(), 256) = BINARY '<manifest.serverVersionSha256>'
    AS server_version_digest_ok,
  (
    @@GLOBAL.check_constraint_checks = 1
    AND @@GLOBAL.foreign_key_checks = 1
    AND @@GLOBAL.unique_checks = 1
    AND BINARY @@GLOBAL.default_storage_engine = BINARY 'InnoDB'
  ) AS global_integrity_policy_ok,
  (
    SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
      AND ENGINE = 'InnoDB'
      AND TABLE_NAME IN (
        'consulting_contract', 'customer', 'project',
        'user_permission', 'work_task', 'user_account'
      )
  ) = 6 AS required_innodb_tables_ok,
  (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME = 'consulting_contract' AND COLUMN_NAME IN ('customer_id', 'status', 'ends_on'))
        OR (TABLE_NAME = 'customer' AND COLUMN_NAME IN ('status', 'display_name'))
        OR (TABLE_NAME = 'project' AND COLUMN_NAME IN ('status', 'display_name'))
        OR (TABLE_NAME = 'work_task' AND COLUMN_NAME IN ('status', 'due_on', 'updated_at_utc'))
        OR (TABLE_NAME = 'user_account' AND COLUMN_NAME = 'id')
      )
  ) = 11 AS prerequisite_columns_ok,
  (
    (SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = '__drizzle_migrations'
        AND TABLE_TYPE = 'BASE TABLE'
        AND ENGINE = 'InnoDB') = 1
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = '__drizzle_migrations') = 3
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = '__drizzle_migrations'
        AND COLUMN_NAME IN ('id', 'hash', 'created_at')) = 3
    AND (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = '__drizzle_migrations'
        AND INDEX_NAME = 'PRIMARY'
        AND NON_UNIQUE = 0
        AND SEQ_IN_INDEX = 1
        AND COLUMN_NAME = 'id') = 1
  ) AS journal_structure_ok,
  (
    (SELECT COUNT(*) FROM `__drizzle_migrations`) = 14
    AND (SELECT COALESCE(MAX(`id`), 0) FROM `__drizzle_migrations`) = 14
    AND (SELECT `AUTO_INCREMENT` FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = '__drizzle_migrations') = 15
    AND (SELECT COUNT(*) FROM `__drizzle_migrations`
      WHERE `id` = 14
        AND OCTET_LENGTH(`hash`) = 64
        AND BINARY `hash` = BINARY '587449c0221adfc447216d95c3ee453d32a19457a93ae3f71e0d7f91b73f3d67'
        AND `created_at` = 1788504772177) = 1
    AND (SELECT COUNT(*) FROM `__drizzle_migrations`
      WHERE BINARY `hash` = BINARY '616db5f1f8c62efce707f98febdf5a2d325f8fa8791811429aa20b374f96aba4'
         OR `created_at` = 1788512254928) = 0
  ) AS journal_0013_baseline_ok,
  (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME = 'consulting_contract' AND COLUMN_NAME IN ('archive_reason', 'archived_at_utc', 'archived_by_user_account_id', 'version'))
        OR (TABLE_NAME = 'customer' AND COLUMN_NAME IN ('archive_reason', 'archived_at_utc', 'archived_by_user_account_id', 'version'))
        OR (TABLE_NAME = 'project' AND COLUMN_NAME IN ('archive_reason', 'archived_at_utc', 'archived_by_user_account_id'))
        OR (TABLE_NAME = 'work_task' AND COLUMN_NAME IN ('archive_reason', 'archived_at_utc', 'archived_by_user_account_id'))
      )
  ) = 0 AS lifecycle_columns_absent_ok,
  (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME = 'partnership_contribution_receipt' AND COLUMN_NAME IN ('entry_type', 'reversal_of_id', 'reversal_reason'))
        OR (TABLE_NAME = 'receivable' AND COLUMN_NAME IN ('record_state', 'void_reason', 'voided_at_utc', 'version'))
        OR (TABLE_NAME = 'receivable_collection' AND COLUMN_NAME IN ('entry_type', 'reversal_of_id', 'reversal_reason'))
      )
  ) = 0 AS reversal_columns_absent_ok,
  (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONCAT(TABLE_NAME, '.', CONSTRAINT_NAME) IN (
        'consulting_contract.chk_consulting_contract_version',
        'consulting_contract.chk_consulting_contract_archive',
        'customer.chk_customer_version',
        'customer.chk_customer_archive',
        'project.chk_project_archive',
        'work_task.chk_work_task_archive',
        'consulting_contract.fk_consulting_contract_archived_by',
        'customer.fk_customer_archived_by',
        'project.fk_project_archived_by',
        'work_task.fk_work_task_archived_by'
      )
  ) = 0 AS lifecycle_new_constraints_absent_ok,
  (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONSTRAINT_TYPE = 'CHECK'
      AND CONCAT(TABLE_NAME, '.', CONSTRAINT_NAME) IN (
        'consulting_contract.chk_consulting_contract_timeline',
        'customer.chk_customer_timeline',
        'project.chk_project_timeline',
        'user_permission.chk_user_permission_code',
        'work_task.chk_work_task_status',
        'work_task.chk_work_task_timeline'
      )
  ) = 6 AS replaced_checks_present_ok,
  (
    (SELECT COUNT(*) = 3 AND MIN(NON_UNIQUE) = 1 AND MAX(NON_UNIQUE) = 1
       AND MIN(INDEX_TYPE) = 'BTREE' AND MAX(INDEX_TYPE) = 'BTREE'
       AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') = 'customer_id,status,ends_on'
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consulting_contract'
         AND INDEX_NAME = 'idx_consulting_contract_customer_status')
    AND (SELECT COUNT(*) = 2 AND MIN(NON_UNIQUE) = 1 AND MAX(NON_UNIQUE) = 1
       AND MIN(INDEX_TYPE) = 'BTREE' AND MAX(INDEX_TYPE) = 'BTREE'
       AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') = 'status,display_name'
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer'
         AND INDEX_NAME = 'idx_customer_status_name')
    AND (SELECT COUNT(*) = 2 AND MIN(NON_UNIQUE) = 1 AND MAX(NON_UNIQUE) = 1
       AND MIN(INDEX_TYPE) = 'BTREE' AND MAX(INDEX_TYPE) = 'BTREE'
       AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') = 'status,display_name'
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project'
         AND INDEX_NAME = 'idx_project_status_name')
    AND (SELECT COUNT(*) = 3 AND MIN(NON_UNIQUE) = 1 AND MAX(NON_UNIQUE) = 1
       AND MIN(INDEX_TYPE) = 'BTREE' AND MAX(INDEX_TYPE) = 'BTREE'
       AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') = 'status,due_on,updated_at_utc'
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_task'
         AND INDEX_NAME = 'idx_work_task_board')
  ) AS replaced_indexes_exact_ok;
```

Beklenen tek satırda on iki kolonun tamamı exact `1` olmalıdır. Bu sonuç alındıktan sonra target-bound paket üretilir.

Hedef ve server digest'leri gerçek kimlik değerlerini açığa çıkarmadan environment üzerinden verilir:

```powershell
$env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG = "0014_record_lifecycle"
$env:PHPMYADMIN_TARGET_DB_SHA256 = "<64-kucuk-hex-digest>"
$env:PHPMYADMIN_SERVER_VERSION_SHA256 = "<64-kucuk-hex-digest>"
npm run db:bundle:phpmyadmin:incremental
```

Çıktılar `dist/portal-pusula-incremental-0014_record_lifecycle.sql` ve aynı köklü `.manifest.json` dosyasıdır. Manifest exact previous migration olarak `0013_login_attempt_throttle`, `expectedJournalCount = 14` ve 44 migration statement hash'i göstermelidir. Aynı girdilerle ikinci üretim byte-identical olmalıdır.

phpMyAdmin'de yalnız bu SQL artefaktı bir kez içe aktarılır. Çıktıda `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` ve `0014_record_lifecycle` birlikte görülmeden başarı kabul edilmez.

Exact başarı satırından hemen sonra, uygulama deploy edilmeden aşağıdaki postflight çalıştırılır:

```sql
SELECT
  BINARY SHA2(DATABASE(), 256) = BINARY '<manifest.targetDatabaseSha256>'
    AS target_database_digest_ok,
  BINARY SHA2(VERSION(), 256) = BINARY '<manifest.serverVersionSha256>'
    AS server_version_digest_ok,
  (
    (SELECT COUNT(*) FROM `__drizzle_migrations`) = 15
    AND (SELECT COALESCE(MAX(`id`), 0) FROM `__drizzle_migrations`) = 15
    AND (SELECT `AUTO_INCREMENT` FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = '__drizzle_migrations') = 16
    AND (SELECT COUNT(*) FROM `__drizzle_migrations`
      WHERE `id` = 15
        AND OCTET_LENGTH(`hash`) = 64
        AND BINARY `hash` = BINARY '616db5f1f8c62efce707f98febdf5a2d325f8fa8791811429aa20b374f96aba4'
        AND `created_at` = 1788512254928) = 1
  ) AS journal_0014_final_ok,
  (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME IN ('consulting_contract', 'customer', 'project', 'work_task')
          AND COLUMN_NAME = 'archive_reason'
          AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 500
          AND IS_NULLABLE = 'YES'
          AND (COLUMN_DEFAULT IS NULL OR BINARY COLUMN_DEFAULT = BINARY 'NULL')
          AND EXTRA = '')
        OR (TABLE_NAME IN ('consulting_contract', 'customer', 'project', 'work_task')
          AND COLUMN_NAME = 'archived_at_utc'
          AND DATA_TYPE = 'datetime' AND DATETIME_PRECISION = 6
          AND IS_NULLABLE = 'YES'
          AND (COLUMN_DEFAULT IS NULL OR BINARY COLUMN_DEFAULT = BINARY 'NULL')
          AND EXTRA = '')
        OR (TABLE_NAME IN ('consulting_contract', 'customer', 'project', 'work_task')
          AND COLUMN_NAME = 'archived_by_user_account_id'
          AND DATA_TYPE = 'char' AND CHARACTER_MAXIMUM_LENGTH = 36
          AND CHARACTER_SET_NAME = 'ascii' AND COLLATION_NAME = 'ascii_bin'
          AND IS_NULLABLE = 'YES'
          AND (COLUMN_DEFAULT IS NULL OR BINARY COLUMN_DEFAULT = BINARY 'NULL')
          AND EXTRA = '')
        OR (TABLE_NAME IN ('consulting_contract', 'customer')
          AND COLUMN_NAME = 'version'
          AND DATA_TYPE = 'int' AND COLUMN_TYPE LIKE '%unsigned%'
          AND IS_NULLABLE = 'NO'
          AND REPLACE(COLUMN_DEFAULT, '''', '') = '1'
          AND EXTRA = '')
      )
  ) = 14 AS lifecycle_columns_exact_ok,
  (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONSTRAINT_TYPE = 'CHECK'
      AND CONCAT(TABLE_NAME, '.', CONSTRAINT_NAME) IN (
        'consulting_contract.chk_consulting_contract_version',
        'consulting_contract.chk_consulting_contract_archive',
        'consulting_contract.chk_consulting_contract_timeline',
        'customer.chk_customer_version',
        'customer.chk_customer_archive',
        'customer.chk_customer_timeline',
        'project.chk_project_archive',
        'project.chk_project_timeline',
        'user_permission.chk_user_permission_code',
        'work_task.chk_work_task_archive',
        'work_task.chk_work_task_status',
        'work_task.chk_work_task_timeline'
      )
  ) = 12 AS lifecycle_checks_exact_ok,
  (
    SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
     AND r.TABLE_NAME = k.TABLE_NAME
     AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE()
      AND CONCAT(k.TABLE_NAME, '.', k.CONSTRAINT_NAME) IN (
        'consulting_contract.fk_consulting_contract_archived_by',
        'customer.fk_customer_archived_by',
        'project.fk_project_archived_by',
        'work_task.fk_work_task_archived_by'
      )
      AND k.COLUMN_NAME = 'archived_by_user_account_id'
      AND k.REFERENCED_TABLE_NAME = 'user_account'
      AND k.REFERENCED_COLUMN_NAME = 'id'
      AND k.ORDINAL_POSITION = 1
      AND k.POSITION_IN_UNIQUE_CONSTRAINT = 1
      AND r.UPDATE_RULE = 'RESTRICT'
      AND r.DELETE_RULE = 'RESTRICT'
  ) = 4 AS archived_actor_foreign_keys_exact_ok,
  (
    (SELECT COUNT(*) = 4 AND MIN(NON_UNIQUE) = 1 AND MAX(NON_UNIQUE) = 1
       AND MIN(INDEX_TYPE) = 'BTREE' AND MAX(INDEX_TYPE) = 'BTREE'
       AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') = 'customer_id,archived_at_utc,status,ends_on'
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consulting_contract'
         AND INDEX_NAME = 'idx_consulting_contract_customer_status')
    AND (SELECT COUNT(*) = 3 AND MIN(NON_UNIQUE) = 1 AND MAX(NON_UNIQUE) = 1
       AND MIN(INDEX_TYPE) = 'BTREE' AND MAX(INDEX_TYPE) = 'BTREE'
       AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') = 'archived_at_utc,status,display_name'
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer'
         AND INDEX_NAME = 'idx_customer_status_name')
    AND (SELECT COUNT(*) = 3 AND MIN(NON_UNIQUE) = 1 AND MAX(NON_UNIQUE) = 1
       AND MIN(INDEX_TYPE) = 'BTREE' AND MAX(INDEX_TYPE) = 'BTREE'
       AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') = 'archived_at_utc,status,display_name'
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project'
         AND INDEX_NAME = 'idx_project_status_name')
    AND (SELECT COUNT(*) = 4 AND MIN(NON_UNIQUE) = 1 AND MAX(NON_UNIQUE) = 1
       AND MIN(INDEX_TYPE) = 'BTREE' AND MAX(INDEX_TYPE) = 'BTREE'
       AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') = 'archived_at_utc,status,due_on,updated_at_utc'
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_task'
         AND INDEX_NAME = 'idx_work_task_board')
  ) AS lifecycle_indexes_exact_ok,
  (
    (SELECT COUNT(*) FROM `consulting_contract`
      WHERE `archive_reason` IS NOT NULL OR `archived_at_utc` IS NOT NULL
         OR `archived_by_user_account_id` IS NOT NULL OR `version` <> 1)
    + (SELECT COUNT(*) FROM `customer`
      WHERE `archive_reason` IS NOT NULL OR `archived_at_utc` IS NOT NULL
         OR `archived_by_user_account_id` IS NOT NULL OR `version` <> 1)
    + (SELECT COUNT(*) FROM `project`
      WHERE `archive_reason` IS NOT NULL OR `archived_at_utc` IS NOT NULL
         OR `archived_by_user_account_id` IS NOT NULL)
    + (SELECT COUNT(*) FROM `work_task`
      WHERE `archive_reason` IS NOT NULL OR `archived_at_utc` IS NOT NULL
         OR `archived_by_user_account_id` IS NOT NULL)
  ) = 0 AS existing_rows_lifecycle_defaults_ok,
  (
    SELECT COUNT(*) FROM `user_permission`
    WHERE BINARY `permission_code` NOT IN (
      BINARY 'accounts.manage',
      BINARY 'customers.read', BINARY 'customers.write', BINARY 'customers.lifecycle',
      BINARY 'customers.contact.read',
      BINARY 'contracts.read', BINARY 'contracts.write', BINARY 'contracts.lifecycle',
      BINARY 'contracts.billing.read', BINARY 'contracts.billing.write',
      BINARY 'visits.read', BINARY 'visits.write', BINARY 'daily-plan.read',
      BINARY 'projects.read', BINARY 'projects.write', BINARY 'projects.lifecycle',
      BINARY 'tasks.read', BINARY 'tasks.write', BINARY 'tasks.lifecycle', BINARY 'tasks.assign',
      BINARY 'tasks.reports.export',
      BINARY 'finance.receivables.read', BINARY 'finance.receivables.write',
      BINARY 'finance.receivables.reverse',
      BINARY 'finance.expenses.read', BINARY 'finance.expenses.write',
      BINARY 'finance.expenses.reverse',
      BINARY 'finance.cards.read', BINARY 'finance.cards.write',
      BINARY 'finance.partnership.read', BINARY 'finance.partnership.write',
      BINARY 'finance.partnership.reverse',
      BINARY 'finance.reports.read', BINARY 'finance.reports.export',
      BINARY 'audit.read'
    )
  ) = 0 AS permission_rows_allowlisted_ok,
  (
    SELECT COUNT(*) FROM `work_task`
    WHERE BINARY `status` NOT IN (
      BINARY 'backlog', BINARY 'todo', BINARY 'in_progress',
      BINARY 'blocked', BINARY 'done', BINARY 'cancelled'
    )
  ) = 0 AS work_task_status_rows_valid_ok;
```

Beklenen tek satırda on kolonun tamamı exact `1` olmalıdır. İzin CHECK'inin yalnız constraint adına değil exact 35 literal içeriğine sahip olduğu ayrıca doğrulanır:

```sql
WITH expected_code (code) AS (
  SELECT 'accounts.manage' UNION ALL
  SELECT 'customers.read' UNION ALL SELECT 'customers.write' UNION ALL
  SELECT 'customers.lifecycle' UNION ALL SELECT 'customers.contact.read' UNION ALL
  SELECT 'contracts.read' UNION ALL SELECT 'contracts.write' UNION ALL
  SELECT 'contracts.lifecycle' UNION ALL SELECT 'contracts.billing.read' UNION ALL
  SELECT 'contracts.billing.write' UNION ALL SELECT 'visits.read' UNION ALL
  SELECT 'visits.write' UNION ALL SELECT 'daily-plan.read' UNION ALL
  SELECT 'projects.read' UNION ALL SELECT 'projects.write' UNION ALL
  SELECT 'projects.lifecycle' UNION ALL SELECT 'tasks.read' UNION ALL
  SELECT 'tasks.write' UNION ALL SELECT 'tasks.lifecycle' UNION ALL
  SELECT 'tasks.assign' UNION ALL SELECT 'tasks.reports.export' UNION ALL
  SELECT 'finance.receivables.read' UNION ALL SELECT 'finance.receivables.write' UNION ALL
  SELECT 'finance.receivables.reverse' UNION ALL SELECT 'finance.expenses.read' UNION ALL
  SELECT 'finance.expenses.write' UNION ALL SELECT 'finance.expenses.reverse' UNION ALL
  SELECT 'finance.cards.read' UNION ALL SELECT 'finance.cards.write' UNION ALL
  SELECT 'finance.partnership.read' UNION ALL SELECT 'finance.partnership.write' UNION ALL
  SELECT 'finance.partnership.reverse' UNION ALL SELECT 'finance.reports.read' UNION ALL
  SELECT 'finance.reports.export' UNION ALL SELECT 'audit.read'
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
SELECT COUNT(*) AS expected_codes,
       SUM(LOCATE(CONCAT(CHAR(39), code, CHAR(39)), check_text) > 0)
         AS expected_codes_found,
       MAX(LENGTH(check_text) - LENGTH(REPLACE(check_text, CHAR(39), '')))
         AS quote_delimiters,
       IF(
         COUNT(*) = 35
         AND SUM(LOCATE(CONCAT(CHAR(39), code, CHAR(39)), check_text) > 0) = 35
         AND MAX(LENGTH(check_text) - LENGTH(REPLACE(check_text, CHAR(39), ''))) = 70,
         1,
         0
       ) AS exact_35_allowlist
FROM expected_code
CROSS JOIN installed_check;
```

Beklenen exact sonuç `35 | 35 | 70 | 1`dir. Manifestte `expectedJournalCount = 14`, migration statement sayısı 44, migration hash'i `616db5f1f8c62efce707f98febdf5a2d325f8fa8791811429aa20b374f96aba4` ve timestamp `1788512254928` olmalıdır.

Bu postflight geçmeden `0015` paketi uygulanmaz.

## `0015_financial_reversals`

Ortak journal sorgusunda yalnız `0014_postflight__0015_preflight` satırı PASS olmalı ve 0014 postflight bloklarının tamamı hâlâ exact sonucu vermelidir. Ardından 0015 hedef nesnelerinin yokluğu ve prerequisites doğrulanır:

```sql
SELECT
  BINARY SHA2(DATABASE(), 256) = BINARY '<manifest.targetDatabaseSha256>'
    AS target_database_digest_ok,
  BINARY SHA2(VERSION(), 256) = BINARY '<manifest.serverVersionSha256>'
    AS server_version_digest_ok,
  (
    SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
      AND ENGINE = 'InnoDB'
      AND TABLE_NAME IN (
        'partnership_contribution_receipt', 'receivable', 'receivable_collection'
      )
  ) = 3 AS required_innodb_tables_ok,
  (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME = 'partnership_contribution_receipt' AND COLUMN_NAME = 'id')
        OR (TABLE_NAME = 'receivable' AND COLUMN_NAME IN ('id', 'due_on', 'customer_id'))
        OR (TABLE_NAME = 'receivable_collection' AND COLUMN_NAME = 'id')
      )
  ) = 5 AS prerequisite_columns_ok,
  (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME = 'partnership_contribution_receipt' AND COLUMN_NAME IN ('entry_type', 'reversal_of_id', 'reversal_reason'))
        OR (TABLE_NAME = 'receivable' AND COLUMN_NAME IN ('record_state', 'void_reason', 'voided_at_utc', 'version'))
        OR (TABLE_NAME = 'receivable_collection' AND COLUMN_NAME IN ('entry_type', 'reversal_of_id', 'reversal_reason'))
      )
  ) = 0 AS reversal_columns_absent_ok,
  (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONSTRAINT_TYPE = 'CHECK'
      AND CONCAT(TABLE_NAME, '.', CONSTRAINT_NAME) IN (
        'partnership_contribution_receipt.chk_partnership_contribution_receipt_identity',
        'receivable.chk_receivable_timeline',
        'receivable_collection.chk_receivable_collection_identity'
      )
  ) = 3 AS replaced_checks_present_ok,
  (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONCAT(TABLE_NAME, '.', CONSTRAINT_NAME) IN (
        'partnership_contribution_receipt.chk_partnership_contribution_receipt_entry',
        'partnership_contribution_receipt.fk_partnership_contribution_receipt_reversal',
        'receivable.chk_receivable_record_state',
        'receivable.chk_receivable_void_shape',
        'receivable.chk_receivable_version',
        'receivable_collection.chk_receivable_collection_entry',
        'receivable_collection.fk_receivable_collection_reversal'
      )
  ) = 0 AS reversal_new_constraints_absent_ok,
  (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND CONCAT(TABLE_NAME, '.', INDEX_NAME) IN (
        'partnership_contribution_receipt.uq_partnership_contribution_receipt_reversal',
        'receivable.idx_receivable_state_due',
        'receivable_collection.uq_receivable_collection_reversal'
      )
  ) = 0 AS reversal_index_rows_absent_ok;
```

Beklenen tek satırda sekiz kolonun tamamı exact `1` olmalıdır.

0015 DDL'si özgün kayıt kimliklerini ve para alanlarını değiştirmemelidir. Yazmalar hâlâ donukken aşağıdaki secretsız fingerprint sonucu preflight kanıtına erişim-kısıtlı biçimde bağlanır; result set belgeye, sohbete veya genel loga kopyalanmaz:

```sql
SELECT object_name, identity_amount_sha256
FROM (
  SELECT 'partnership_contribution_receipt' AS object_name,
         SHA2(CONCAT_WS(0x1F,
           COALESCE(HEX(`id`), 'NULL'),
           COALESCE(HEX(`client_operation_key`), 'NULL'),
           COALESCE(HEX(`contribution_id`), 'NULL'),
           COALESCE(HEX(CAST(`amount` AS CHAR)), 'NULL')), 256) AS identity_amount_sha256
  FROM `partnership_contribution_receipt`
  UNION ALL
  SELECT 'receivable',
         SHA2(CONCAT_WS(0x1F,
           COALESCE(HEX(`id`), 'NULL'),
           COALESCE(HEX(`client_operation_key`), 'NULL'),
           COALESCE(HEX(`customer_id`), 'NULL'),
           COALESCE(HEX(`contract_id`), 'NULL'),
           COALESCE(HEX(`project_id`), 'NULL'),
           COALESCE(HEX(CAST(`net_amount` AS CHAR)), 'NULL'),
           COALESCE(HEX(CAST(`vat_amount` AS CHAR)), 'NULL'),
           COALESCE(HEX(CAST(`total_amount` AS CHAR)), 'NULL'),
           COALESCE(HEX(`currency`), 'NULL')), 256)
  FROM `receivable`
  UNION ALL
  SELECT 'receivable_collection',
         SHA2(CONCAT_WS(0x1F,
           COALESCE(HEX(`id`), 'NULL'),
           COALESCE(HEX(`client_operation_key`), 'NULL'),
           COALESCE(HEX(`receivable_id`), 'NULL'),
           COALESCE(HEX(CAST(`amount` AS CHAR)), 'NULL')), 256)
  FROM `receivable_collection`
) AS fingerprints
ORDER BY BINARY object_name, BINARY identity_amount_sha256;
```

Aynı canlı DB/server digest'leri korunarak yalnız tag değiştirilir:

```powershell
$env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG = "0015_financial_reversals"
npm run db:bundle:phpmyadmin:incremental
```

Çıktılar `dist/portal-pusula-incremental-0015_financial_reversals.sql` ve aynı köklü `.manifest.json` dosyasıdır. Manifest exact previous migration olarak `0014_record_lifecycle`, `expectedJournalCount = 15` ve 26 migration statement hash'i göstermelidir. Aynı girdilerle ikinci üretim byte-identical olmalıdır.

phpMyAdmin'de yalnız bu SQL artefaktı bir kez içe aktarılır. Çıktıda `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` ve `0015_financial_reversals` birlikte görülmeden başarı kabul edilmez.

Exact başarı satırından hemen sonra aşağıdaki postflight çalıştırılır:

```sql
SELECT
  BINARY SHA2(DATABASE(), 256) = BINARY '<manifest.targetDatabaseSha256>'
    AS target_database_digest_ok,
  BINARY SHA2(VERSION(), 256) = BINARY '<manifest.serverVersionSha256>'
    AS server_version_digest_ok,
  (
    (SELECT COUNT(*) FROM `__drizzle_migrations`) = 16
    AND (SELECT COALESCE(MAX(`id`), 0) FROM `__drizzle_migrations`) = 16
    AND (SELECT `AUTO_INCREMENT` FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = '__drizzle_migrations') = 17
    AND (SELECT COUNT(*) FROM `__drizzle_migrations`
      WHERE `id` = 16
        AND OCTET_LENGTH(`hash`) = 64
        AND BINARY `hash` = BINARY 'cce0b24f60ec8a30ec99b985aa079c2de2e1d5dbcd60b1c1507f0794f3ec71be'
        AND `created_at` = 1788512602613) = 1
  ) AS journal_0015_final_ok,
  (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME = 'partnership_contribution_receipt' AND COLUMN_NAME = 'entry_type'
          AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 16
          AND IS_NULLABLE = 'NO'
          AND REPLACE(COLUMN_DEFAULT, '''', '') = 'receipt' AND EXTRA = '')
        OR (TABLE_NAME = 'receivable_collection' AND COLUMN_NAME = 'entry_type'
          AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 16
          AND IS_NULLABLE = 'NO'
          AND REPLACE(COLUMN_DEFAULT, '''', '') = 'collection' AND EXTRA = '')
        OR (TABLE_NAME = 'receivable' AND COLUMN_NAME = 'record_state'
          AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 16
          AND IS_NULLABLE = 'NO'
          AND REPLACE(COLUMN_DEFAULT, '''', '') = 'active' AND EXTRA = '')
        OR (TABLE_NAME IN ('partnership_contribution_receipt', 'receivable_collection')
          AND COLUMN_NAME = 'reversal_of_id'
          AND DATA_TYPE = 'char' AND CHARACTER_MAXIMUM_LENGTH = 36
          AND CHARACTER_SET_NAME = 'ascii' AND COLLATION_NAME = 'ascii_bin'
          AND IS_NULLABLE = 'YES'
          AND (COLUMN_DEFAULT IS NULL OR BINARY COLUMN_DEFAULT = BINARY 'NULL')
          AND EXTRA = '')
        OR (TABLE_NAME IN ('partnership_contribution_receipt', 'receivable_collection')
          AND COLUMN_NAME = 'reversal_reason'
          AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 2000
          AND IS_NULLABLE = 'YES'
          AND (COLUMN_DEFAULT IS NULL OR BINARY COLUMN_DEFAULT = BINARY 'NULL')
          AND EXTRA = '')
        OR (TABLE_NAME = 'receivable' AND COLUMN_NAME = 'void_reason'
          AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 2000
          AND IS_NULLABLE = 'YES'
          AND (COLUMN_DEFAULT IS NULL OR BINARY COLUMN_DEFAULT = BINARY 'NULL')
          AND EXTRA = '')
        OR (TABLE_NAME = 'receivable' AND COLUMN_NAME = 'voided_at_utc'
          AND DATA_TYPE = 'datetime' AND DATETIME_PRECISION = 6
          AND IS_NULLABLE = 'YES'
          AND (COLUMN_DEFAULT IS NULL OR BINARY COLUMN_DEFAULT = BINARY 'NULL')
          AND EXTRA = '')
        OR (TABLE_NAME = 'receivable' AND COLUMN_NAME = 'version'
          AND DATA_TYPE = 'int' AND COLUMN_TYPE LIKE '%unsigned%'
          AND IS_NULLABLE = 'NO'
          AND REPLACE(COLUMN_DEFAULT, '''', '') = '1' AND EXTRA = '')
      )
  ) = 10 AS reversal_columns_exact_ok,
  (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONSTRAINT_TYPE = 'CHECK'
      AND CONCAT(TABLE_NAME, '.', CONSTRAINT_NAME) IN (
        'partnership_contribution_receipt.chk_partnership_contribution_receipt_entry',
        'partnership_contribution_receipt.chk_partnership_contribution_receipt_identity',
        'receivable.chk_receivable_record_state',
        'receivable.chk_receivable_void_shape',
        'receivable.chk_receivable_version',
        'receivable.chk_receivable_timeline',
        'receivable_collection.chk_receivable_collection_entry',
        'receivable_collection.chk_receivable_collection_identity'
      )
  ) = 8 AS reversal_checks_exact_ok,
  (
    SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
     AND r.TABLE_NAME = k.TABLE_NAME
     AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE()
      AND CONCAT(k.TABLE_NAME, '.', k.CONSTRAINT_NAME) IN (
        'partnership_contribution_receipt.fk_partnership_contribution_receipt_reversal',
        'receivable_collection.fk_receivable_collection_reversal'
      )
      AND k.COLUMN_NAME = 'reversal_of_id'
      AND k.REFERENCED_TABLE_NAME = k.TABLE_NAME
      AND k.REFERENCED_COLUMN_NAME = 'id'
      AND k.ORDINAL_POSITION = 1
      AND k.POSITION_IN_UNIQUE_CONSTRAINT = 1
      AND r.UPDATE_RULE = 'RESTRICT'
      AND r.DELETE_RULE = 'RESTRICT'
  ) = 2 AS reversal_foreign_keys_exact_ok,
  (
    (SELECT COUNT(*) = 1 AND MIN(NON_UNIQUE) = 0 AND MAX(NON_UNIQUE) = 0
       AND MIN(INDEX_TYPE) = 'BTREE' AND MAX(INDEX_TYPE) = 'BTREE'
       AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') = 'reversal_of_id'
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'partnership_contribution_receipt'
         AND INDEX_NAME = 'uq_partnership_contribution_receipt_reversal')
    AND (SELECT COUNT(*) = 1 AND MIN(NON_UNIQUE) = 0 AND MAX(NON_UNIQUE) = 0
       AND MIN(INDEX_TYPE) = 'BTREE' AND MAX(INDEX_TYPE) = 'BTREE'
       AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') = 'reversal_of_id'
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'receivable_collection'
         AND INDEX_NAME = 'uq_receivable_collection_reversal')
    AND (SELECT COUNT(*) = 3 AND MIN(NON_UNIQUE) = 1 AND MAX(NON_UNIQUE) = 1
       AND MIN(INDEX_TYPE) = 'BTREE' AND MAX(INDEX_TYPE) = 'BTREE'
       AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') = 'record_state,due_on,customer_id'
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'receivable'
         AND INDEX_NAME = 'idx_receivable_state_due')
  ) AS reversal_indexes_exact_ok,
  (
    (SELECT COUNT(*) FROM `receivable`
      WHERE BINARY `record_state` <> BINARY 'active'
         OR `void_reason` IS NOT NULL OR `voided_at_utc` IS NOT NULL
         OR `version` <> 1)
    + (SELECT COUNT(*) FROM `partnership_contribution_receipt`
      WHERE BINARY `entry_type` <> BINARY 'receipt'
         OR `reversal_of_id` IS NOT NULL OR `reversal_reason` IS NOT NULL)
    + (SELECT COUNT(*) FROM `receivable_collection`
      WHERE BINARY `entry_type` <> BINARY 'collection'
         OR `reversal_of_id` IS NOT NULL OR `reversal_reason` IS NOT NULL)
  ) = 0 AS existing_rows_reversal_defaults_ok;
```

Beklenen tek satırda sekiz kolonun tamamı exact `1` olmalıdır. Ortak journal sorgusunda yalnız `0015_postflight` satırı `16 | 16 | 17 | 16 | 0 | 1` ile PASS olmalıdır. Son olarak 0015 preflight fingerprint sorgusu byte-for-byte aynı SQL ile yeniden çalıştırılır; sıralı `object_name | identity_amount_sha256` result seti preflight kanıtıyla exact eşleşmelidir. Herhangi bir fark veri koruma hatasıdır ve deploy'u durdurur.

Manifestte `expectedJournalCount = 15`, migration statement sayısı 26, migration hash'i `cce0b24f60ec8a30ec99b985aa079c2de2e1d5dbcd60b1c1507f0794f3ec71be` ve timestamp `1788512602613` olmalıdır.

## Dağıtım kapısı

Her iki postflight tamamlandıktan sonra yalnız aynı committen üretilmiş Hostinger ZIP dağıtılır. Yetkisiz erişim, yaşam döngüsü, ters kayıt, audit geçmişi, finansal toplamlar, readiness ve mevcut PWA/security smoke testleri geçmeden yazma dondurması kaldırılmaz.

Bu belgedeki versioned migration hash/timestamp değerleri final committe `readExpectedMigrations()` sonucu ve target-bound manifestlerle yeniden eşleştirilir. Herhangi bir farkta sorgu, manifest veya SQL elle düzeltilmez; paketleme durdurulur ve sürümlü kaynak/artefakt zinciri yeniden üretilip incelenir.

Bir SQL/manifest dosyasının `dist/` altında bulunması, restore provasının, canlı import'un veya postflight'ın yapıldığı anlamına gelmez. Bu belge yalnız paket üretim ve kontrol sözleşmesidir; kullanıcı onayı, bakım penceresi, güncel backup/restore kanıtı, canlı import veya canlı başarı kanıtı yerine geçmez.
