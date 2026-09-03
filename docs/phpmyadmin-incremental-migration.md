# phpMyAdmin mevcut şema yükseltme paketi — `0011_customer_projects_partnership`

Bu akış, journal'ında `0000`–`0010` bulunan mevcut Portal Pusula veritabanına yalnız `0011_customer_projects_partnership` migration'ını uygular. Clean-only paket ve ham `drizzle/0011_customer_projects_partnership.sql` mevcut veritabanına doğrudan yüklenmez.

`0011`; müşteri–proje bağlantısı ile 7 Emlak komisyonu, aylık ortak katkısı ve katkı tahsilat defteri için dört tablo ekler. Sözleşme ve alacağa nullable/binary-exact `project_id` ekler; mevcut müşterileri `MUHENDIS_KAFASI` projesine, mevcut görev–proje çiftlerini de kendi projelerine bağlar; eski sözleşme ve alacakları projeyle doldurur. Yeni composite FK ve proje bazlı indexler doğrulandıktan sonra yalnız eski `(customer_id, starts_on)` sözleşme unique indexi kaldırılır.

MariaDB DDL transactional değildir. Bu migration veri backfill'i içerdiğinden uygulama yazmaları baştan sona dondurulur. Exact başarı satırı görülmeden yazma trafiği açılmaz; hata/bağlantı kesintisinde aynı paket yeniden çalıştırılmaz.

## 1. Canlı ön kontrol ve yazma dondurma

1. Kalite kapıları ve PR CI başarılı olmalı; `main` birleştirmesi henüz yapılmamalıdır.
2. Canlı DB'nin güncel, geri yüklenebilir yedeği doğrulanır.
3. Portalın yazma trafiği bakım penceresinde durdurulur. Sadece bu phpMyAdmin oturumu şema/veri yazabilir; ikinci import veya migration runner çalıştırılmaz.
4. Hedef DB seçiliyken şu salt okunur kontroller yapılır:

```sql
SELECT
  LOWER(SHA2(DATABASE(), 256)) AS target_database_sha256,
  LOWER(SHA2(VERSION(), 256)) AS server_version_sha256;

SELECT id, hash, created_at
FROM __drizzle_migrations
ORDER BY id;

SELECT COUNT(*) AS muhendis_kafasi_project_count
FROM project
WHERE BINARY short_code = BINARY 'MUHENDIS_KAFASI'
  AND BINARY status IN (BINARY 'planned', BINARY 'active', BINARY 'on_hold');

SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'customer_project',
    'partnership_commission',
    'partnership_contribution',
    'partnership_contribution_receipt'
  );

SELECT TABLE_NAME, COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND COLUMN_NAME = 'project_id'
  AND TABLE_NAME IN ('consulting_contract', 'receivable');
```

İki digest 64 küçük hexadecimal karakter olmalıdır. Journal exact 11 satır içermeli; `id = 11` sürümlü manifestteki `0010_expenses_cards` hash/timestamp'ıyla aynı olmalıdır. `muhendis_kafasi_project_count` exact `1`, dört hedef tablo ve iki yeni kolon yok olmalıdır. Herhangi bir farkta paket üretilmez veya uygulanmaz.

## 2. Hedefe bağlı paketi üretme

Digest'leri yalnız mevcut PowerShell sürecinde tut:

```powershell
$env:PHPMYADMIN_TARGET_DB_SHA256 = "<64-kucuk-harf-hex-db-digesti>"
$env:PHPMYADMIN_SERVER_VERSION_SHA256 = "<64-kucuk-harf-hex-surum-digesti>"
$env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG = "0011_customer_projects_partnership"
try {
  npm run db:bundle:phpmyadmin:incremental
  if ($LASTEXITCODE -ne 0) { throw "Incremental paket üretilemedi." }
}
finally {
  Remove-Item Env:PHPMYADMIN_TARGET_DB_SHA256 -ErrorAction SilentlyContinue
  Remove-Item Env:PHPMYADMIN_SERVER_VERSION_SHA256 -ErrorAction SilentlyContinue
  Remove-Item Env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG -ErrorAction SilentlyContinue
}
```

Çıktılar:

- `dist/portal-pusula-incremental-0011_customer_projects_partnership.sql`
- `dist/portal-pusula-incremental-0011_customer_projects_partnership.manifest.json`

```powershell
$manifest = Get-Content .\dist\portal-pusula-incremental-0011_customer_projects_partnership.manifest.json | ConvertFrom-Json
$actualSqlHash = (Get-FileHash .\dist\portal-pusula-incremental-0011_customer_projects_partnership.sql -Algorithm SHA256).Hash.ToLowerInvariant()
@(
  $actualSqlHash -ceq $manifest.sqlSha256
  $manifest.migration.tag -ceq "0011_customer_projects_partnership"
  $manifest.expectedJournalCount -eq 11
  $manifest.expectedPreviousMigration.tag -ceq "0010_expenses_cards"
  $manifest.migration.createdAt -gt 0
  $manifest.migration.hash -cmatch "^[0-9a-f]{64}$"
  $manifest.migration.statementHashes.Count -eq 25
)
```

Yedi sonucun tamamı exact `True` değilse import yapılmaz.

## 3. Tek seferlik phpMyAdmin importu

1. Canlı hedef DB tekrar seçilir; yazma dondurmasının sürdüğü doğrulanır.
2. İçe Aktar ekranında yalnız `portal-pusula-incremental-0011_customer_projects_partnership.sql` seçilir.
3. Biçim `SQL`, karakter seti `UTF-8`, baştan atlanacak sorgu `0`; partial import/resume kapalıdır.
4. Paket yalnız bir kez başlatılır.
5. Yalnız exact `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` ve `0011_customer_projects_partnership` birlikte görünürse başarı kabul edilir.

Başarı satırı yoksa yeniden çalıştırma. Yazma dondurmasını koru; hedefi salt okunur incele ve ayrı forward-fix/yedekten geri yükleme kararı al.

## 4. Migration sonrası salt okunur doğrulama

```sql
SELECT COUNT(*) AS journal_count FROM __drizzle_migrations;

SELECT id, hash, created_at
FROM __drizzle_migrations
WHERE id = 12;

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'customer_project',
    'partnership_commission',
    'partnership_contribution',
    'partnership_contribution_receipt'
  )
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
       CHARACTER_SET_NAME, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND COLUMN_NAME = 'project_id'
  AND TABLE_NAME IN ('consulting_contract', 'receivable')
ORDER BY TABLE_NAME;

SELECT
  (SELECT COUNT(*) FROM consulting_contract WHERE project_id IS NULL)
    AS contract_without_project,
  (SELECT COUNT(*) FROM receivable WHERE project_id IS NULL)
    AS receivable_without_project,
  (SELECT COUNT(*)
     FROM consulting_contract cc
     LEFT JOIN customer_project cp
       ON cp.customer_id = cc.customer_id AND cp.project_id = cc.project_id
    WHERE cp.customer_id IS NULL) AS contract_without_customer_project,
  (SELECT COUNT(*)
     FROM receivable r
     LEFT JOIN customer_project cp
       ON cp.customer_id = r.customer_id AND cp.project_id = r.project_id
    WHERE cp.customer_id IS NULL) AS receivable_without_customer_project;

SELECT CONSTRAINT_NAME, TABLE_NAME, UPDATE_RULE, DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND CONSTRAINT_NAME IN (
    'fk_customer_project_customer',
    'fk_customer_project_project',
    'fk_consulting_contract_customer_project',
    'fk_receivable_customer_project',
    'fk_partnership_commission_project',
    'fk_partnership_contribution_project',
    'fk_partnership_contribution_receipt_contribution'
  )
ORDER BY CONSTRAINT_NAME;

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_in_order
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND INDEX_NAME IN (
    'uq_consulting_contract_customer_start',
    'uq_consulting_contract_customer_project_start',
    'idx_consulting_contract_customer_project_status',
    'idx_receivable_customer_project',
    'idx_receivable_project_due'
  )
GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
ORDER BY TABLE_NAME, INDEX_NAME;
```

Beklenen: journal 12 satır ve `id = 12` manifestle exact eşleşir; dört yeni tablo `InnoDB` / `utf8mb4_unicode_ci`; iki `project_id` `char(36)`, nullable, `ascii/ascii_bin`; dört backfill sayacı `0`; yedi FK `RESTRICT/RESTRICT`; yeni unique/indexler doğru kolon sırasındadır ve eski `uq_consulting_contract_customer_start` sonucu yoktur.

## 5. Uygulama dağıtımı ve dondurmayı kaldırma

Yeni uygulama aynı doğrulanmış committen dağıtılır. Giriş, `/musteriler` proje bağlantısı ve sözleşme projesi, `/gorevler` müşteri–proje uyumu, `/finans`, `/finans/raporlar` ve `/finans/ortaklik` smoke kontrolleri başarılı olduktan sonra yazma dondurması kaldırılır.

Paket DB/sunucu digest'ini, exact önceki journal zincirini, tek aktif/planlı `MUHENDIS_KAFASI` projesini ve hedef nesnelerin yokluğunu DDL'den önce doğrular. Her adım aday SQL SHA-256 ve `information_schema`/veri postflight kontrolüyle ilerler. DDL implicit commit sınırı nedeniyle exact başarı yoksa otomatik rollback veya tekrar deneme yoktur.
