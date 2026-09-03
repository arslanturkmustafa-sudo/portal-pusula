# phpMyAdmin mevcut şema yükseltme paketi — `0010_expenses_cards`

Bu akış, ilk on migration'ı journal'ında taşıyan mevcut Portal Pusula veritabanına yalnız sıradaki `0010_expenses_cards` migration'ını uygular. Clean-only paket mevcut veritabanında kullanılmaz. `drizzle/0010_expenses_cards.sql` içindeki statement breakpoint'leri ve journal yazımı nedeniyle ham migration dosyası da doğrudan phpMyAdmin'e verilmez.

`0010_expenses_cards`, yalnız `credit_card`, `expense` ve `credit_card_installment` tablolarını, üç `RESTRICT` foreign key'i ve gerekli indexleri ekler. Mevcut tabloyu veya kolonu değiştirmez, veri taşımaz ve başlangıç kaydı eklemez. Kart tablosunda yalnız uygulama içi ad, isteğe bağlı banka ve son dört hane saklanır; tam kart numarası, CVV, son kullanma tarihi veya başka ödeme sırrı tutulmaz. Bu nedenle eski uygulama migration sonrasında yeni uygulama dağıtılana kadar çalışmaya devam edebilir; canlı geçiş sırası DB-first'tür.

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
  AND TABLE_NAME IN ('credit_card', 'expense', 'credit_card_installment');
```

İki digest 64 karakter küçük hexadecimal olmalıdır. Journal on exact satır içermeli ve son satır sürümlü manifestteki `0009_projects` önceki migration kimliğiyle birebir eşleşmelidir. Üç hedef tablo henüz bulunmamalıdır. Fark varsa paket üretilmez veya uygulanmaz.

## 2. Hedefe bağlı paketi üretme

Digest'leri yalnız mevcut PowerShell sürecine girip paketi üret:

```powershell
$env:PHPMYADMIN_TARGET_DB_SHA256 = "<64-kucuk-harf-hex-db-digesti>"
$env:PHPMYADMIN_SERVER_VERSION_SHA256 = "<64-kucuk-harf-hex-surum-digesti>"
$env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG = "0010_expenses_cards"
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

- `dist/portal-pusula-incremental-0010_expenses_cards.sql`
- `dist/portal-pusula-incremental-0010_expenses_cards.manifest.json`

Manifesti ve SQL bütünlüğünü doğrula:

```powershell
$manifest = Get-Content .\dist\portal-pusula-incremental-0010_expenses_cards.manifest.json | ConvertFrom-Json
$actualSqlHash = (Get-FileHash .\dist\portal-pusula-incremental-0010_expenses_cards.sql -Algorithm SHA256).Hash.ToLowerInvariant()
@(
  $actualSqlHash -ceq $manifest.sqlSha256
  $manifest.migration.tag -ceq "0010_expenses_cards"
  $manifest.expectedJournalCount -eq 10
  $manifest.expectedPreviousMigration.tag -ceq "0009_projects"
  $manifest.migration.createdAt -gt 0
  $manifest.migration.hash -cmatch "^[0-9a-f]{64}$"
  $manifest.migration.statementHashes.Count -eq 12
)
```

Yedi sonuç da exact `True` değilse import yapılmaz.

## 3. Tek seferlik phpMyAdmin importu

1. Aynı phpMyAdmin oturumunda canlı hedef DB yeniden seçilir.
2. İçe Aktar ekranında yalnız `portal-pusula-incremental-0010_expenses_cards.sql` dosyası seçilir.
3. Biçim `SQL`, karakter seti `UTF-8`, baştan atlanacak sorgu sayısı `0` olmalıdır; partial import/resume kullanılmaz.
4. Aynı anda ikinci import, migration runner veya başka bir şema yazma işlemi çalıştırılmaz.
5. Paket yalnız bir kez başlatılır. Yalnız exact `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` ve `0010_expenses_cards` birlikte görünürse başarı sayılır.

## 4. Migration sonrası salt okunur doğrulama

```sql
SELECT COUNT(*) AS journal_count FROM __drizzle_migrations;

SELECT id, hash, created_at
FROM __drizzle_migrations
WHERE id = 11;

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('credit_card', 'expense', 'credit_card_installment')
ORDER BY TABLE_NAME;

SELECT CONSTRAINT_NAME, UPDATE_RULE, DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND CONSTRAINT_NAME IN (
    'fk_credit_card_installment_expense',
    'fk_expense_project',
    'fk_expense_credit_card'
  )
ORDER BY CONSTRAINT_NAME;

SHOW CREATE TABLE `credit_card`;
SHOW CREATE TABLE `expense`;
SHOW CREATE TABLE `credit_card_installment`;
```

Beklenen sonuç; on bir journal satırı, `id = 11` değerlerinin üretilen manifestteki `0010_expenses_cards` migration kimliğiyle birebir eşleşmesi, üç `InnoDB` / `utf8mb4_unicode_ci` tablo ve üç `RESTRICT` / `RESTRICT` foreign key'tir. Tablo CHECK/UNIQUE kısıtları ile gider, kart durumu, vade/ekstre ve proje/kart sorgu indexleri de sürümlü SQL ile aynı olmalıdır. Bu doğrulamadan sonra uygulama dağıtımı başlatılır; üretim smoke kontrolünde `/finans/giderler` ve `/finans/kartlar` sayfaları, gider kaydı, kart taksit planı ve ödeme durumu akışları doğrulanır.

Paket hedef DB/sunucu digest'ini, exact önceki journal zincirini, beklenen önceki migration'ı ve hedef nesnelerin yokluğunu DDL'den önce doğrular. Her DDL adımı hex kodlu aday SQL, SHA-256 ve `information_schema` postflight kontrolüyle ilerler; journal eklemesi exact hash/timestamp ile idempotent yazılmıştır.

MariaDB DDL transactional değildir ve bu paket rollback vaat etmez. Exact başarı satırı yoksa, import hata verirse veya bağlantı kesilirse **yeniden çalıştırma**. Hedefi yalnız salt okunur incele; veri kaybı yoksa ayrı forward-fix paketi hazırla, aksi durumda kanıtlanmış yedekten onaylı geri yükleme uygula.
