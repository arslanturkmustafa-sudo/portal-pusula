# phpMyAdmin mevcut şema yükseltme paketi — `0009_projects`

Bu akış, ilk dokuz migration'ı journal'ında taşıyan mevcut Portal Pusula veritabanına yalnız sıradaki `0009_projects` migration'ını uygular. Clean-only paket mevcut veritabanında kullanılmaz. `drizzle/0009_projects.sql` içindeki statement breakpoint'leri ve journal yazımı nedeniyle ham migration dosyası da doğrudan phpMyAdmin'e verilmez.

`0009_projects`, yalnız `project` ve `work_task_project` tablolarını, iki `RESTRICT` foreign key'i ve gerekli indexleri ekler. Mevcut tabloyu veya kolonu değiştirmez, veri taşımaz ve başlangıç projesi eklemez. Bu nedenle eski uygulama migration sonrasında yeni uygulama dağıtılana kadar çalışmaya devam edebilir; canlı geçiş sırası DB-first'tür.

## 1. Canlı ön kontrol

1. Proje dalının kalite kapıları ve PR CI sonucu başarılı olmalıdır. Hostinger'ı otomatik tetikleyebilecek `main` birleştirmesi henüz yapılmaz.
2. Canlı DB'nin güncel yedeği ve hedefin doğru Portal Pusula veritabanı olduğu doğrulanır.
3. phpMyAdmin'de hedef DB seçiliyken şu salt okunur sorgular çalıştırılır:

```sql
SELECT
  LOWER(SHA2(DATABASE(), 256)) AS target_database_sha256,
  LOWER(SHA2(VERSION(), 256)) AS server_version_sha256;

SELECT id, hash, created_at
FROM __drizzle_migrations
ORDER BY id;

SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('project', 'work_task_project');
```

İki digest 64 karakter küçük hexadecimal olmalıdır. Journal dokuz exact satır içermeli; son satır `id = 9`, `hash = 9835a13facbd1a0485bcc4cb6e6776e0f2d64b9b1d1c59aa0798fa97dbb21aa3`, `created_at = 1788352666114` olmalıdır. İki hedef tablo henüz bulunmamalıdır. Fark varsa paket üretilmez veya uygulanmaz.

## 2. Hedefe bağlı paketi üretme

Digest'leri yalnız mevcut PowerShell sürecine girip paketi üret:

```powershell
$env:PHPMYADMIN_TARGET_DB_SHA256 = "<64-kucuk-harf-hex-db-digesti>"
$env:PHPMYADMIN_SERVER_VERSION_SHA256 = "<64-kucuk-harf-hex-surum-digesti>"
$env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG = "0009_projects"
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

Başarılı komut şu iki dosyayı üretir:

- `dist/portal-pusula-incremental-0009_projects.sql`
- `dist/portal-pusula-incremental-0009_projects.manifest.json`

Manifesti ve SQL bütünlüğünü doğrula:

```powershell
$manifest = Get-Content .\dist\portal-pusula-incremental-0009_projects.manifest.json | ConvertFrom-Json
$actualSqlHash = (Get-FileHash .\dist\portal-pusula-incremental-0009_projects.sql -Algorithm SHA256).Hash.ToLowerInvariant()
@(
  $actualSqlHash -ceq $manifest.sqlSha256
  $manifest.migration.tag -ceq "0009_projects"
  $manifest.expectedJournalCount -eq 9
  $manifest.expectedPreviousMigration.tag -ceq "0008_work_tasks"
  $manifest.migration.createdAt -eq 1788423447345
  $manifest.migration.hash -ceq "86e1b6730d77d1e5d70ed011a0073926a1704b14940fa22c12bce94ae9b3d8f2"
  $manifest.migration.statementHashes.Count -eq 7
)
```

Yedi sonuç da exact `True` değilse import yapılmaz.

## 3. Tek seferlik phpMyAdmin importu

1. Aynı phpMyAdmin oturumunda canlı hedef DB yeniden seçilir.
2. İçe Aktar ekranında yalnız `portal-pusula-incremental-0009_projects.sql` dosyası seçilir.
3. Biçim `SQL`, karakter seti `UTF-8`, baştan atlanacak sorgu sayısı `0` olmalıdır; partial import/resume kullanılmaz.
4. Aynı anda ikinci import, migration runner veya başka bir şema yazma işlemi çalıştırılmaz.
5. Paket yalnız bir kez başlatılır. Yalnız exact `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` ve `0009_projects` birlikte görünürse başarı sayılır.

## 4. Migration sonrası salt okunur doğrulama

```sql
SELECT COUNT(*) AS journal_count FROM __drizzle_migrations;

SELECT id, hash, created_at
FROM __drizzle_migrations
WHERE id = 10;

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('project', 'work_task_project')
ORDER BY TABLE_NAME;

SELECT CONSTRAINT_NAME, UPDATE_RULE, DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND CONSTRAINT_NAME IN (
    'fk_work_task_project_project',
    'fk_work_task_project_task'
  )
ORDER BY CONSTRAINT_NAME;
```

Beklenen sonuç; on journal satırı, `id = 10` için `hash = 86e1b6730d77d1e5d70ed011a0073926a1704b14940fa22c12bce94ae9b3d8f2` ve `created_at = 1788423447345`, iki `InnoDB` / `utf8mb4_unicode_ci` tablo ve iki `RESTRICT` / `RESTRICT` foreign key'tir. Bu doğrulamadan sonra uygulama dağıtımı başlatılır.

Paket hedef DB/sunucu digest'ini, exact önceki journal zincirini, beklenen önceki migration'ı ve hedef nesnelerin yokluğunu DDL'den önce doğrular. Her DDL adımı hex kodlu aday SQL, SHA-256 ve `information_schema` postflight kontrolüyle ilerler; journal eklemesi exact hash/timestamp ile idempotent yazılmıştır.

MariaDB DDL transactional değildir ve bu paket rollback vaat etmez. Exact başarı satırı yoksa, import hata verirse veya bağlantı kesilirse **yeniden çalıştırma**. Hedefi yalnız salt okunur incele; veri kaybı yoksa ayrı forward-fix paketi hazırla, aksi durumda kanıtlanmış yedekten onaylı geri yükleme uygula.
