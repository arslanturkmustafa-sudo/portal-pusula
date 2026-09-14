# `0024_partial_card_payments` phpMyAdmin incremental runbook'u

Bu akış, journal'ı exact `0000`–`0023` olan Portal Pusula veritabanına yalnız `0024_partial_card_payments` migration'ını uygular. Migration, kısmi kredi kartı ödemelerini ve bunların ters kayıtlarını immutable satırlar olarak tutan `credit_card_installment_payment` tablosunu ekler. Mevcut `credit_card_installment` kolonlarını değiştirmez; daha önce `paid` durumuna getirilmiş taksitleri tutar, tarih ve varsa finans hareketi bağlantısıyla yeni tabloya taşır.

MariaDB DDL transactional değildir. Uygulama yazmaları ön kontrolden güncel uygulama smoke testleri bitene kadar dondurulur. Exact başarı satırı görülmezse paket yeniden çalıştırılmaz; hedef salt okunur incelenir ve gerekirse yeni forward-fix migration hazırlanır. Bu belgenin veya kaynak SQL'in hazır olması canlı migration/deploy kanıtı değildir.

## Ön kabul

- Doğru canlı DB, bakım penceresi ve güncel yedek iki bağımsız kontrolle doğrulanır; yedek ayrı disposable hedefte restore edilip şema, journal ve kontrollü veri kontrollerini geçmeden başlanmaz.
- Journal exact 24 satırdır; `MIN(id)=1`, `MAX(id)=24`, `AUTO_INCREMENT=25` ve id 24 satırı `created_at=1789195799696`, `hash=e4a5e27b1b6113baa0bafcc52b29c7d1e8a78a293ee326daf5eb086b48bed5e3` değerlerini taşır.
- Journal dışında exact 32 uygulama tablosu vardır. `credit_card_installment_payment` bulunmaz.
- `credit_card_installment`, `finance_transaction` ve bunların `id` kolonları InnoDB, canonical `char(36) CHARACTER SET ascii COLLATE ascii_bin`, tek kolon primary key biçimindedir.
- `credit_card_installment.status` exact `varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'planned'` biçimindedir. `paid` satırlarda `paid_on` boş değildir; pozitif tutar ve varsa `finance_transaction_id` ilişkisi geçerlidir.
- Gerçek DB adı, kullanıcı, parola, connection string, müşteri/finans verisi veya ham sunucu sürümü belgeye, sohbete, komuta ya da genel loga taşınmaz.

Ön kabul sayaçları salt okunur olarak kontrol edilir:

```sql
SELECT
  (SELECT COUNT(*) FROM `__drizzle_migrations`) = 24 AS journal_count_ok,
  (SELECT COALESCE(MIN(`id`), 0) FROM `__drizzle_migrations`) = 1 AS journal_min_ok,
  (SELECT COALESCE(MAX(`id`), 0) FROM `__drizzle_migrations`) = 24 AS journal_max_ok,
  (SELECT `AUTO_INCREMENT` FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = '__drizzle_migrations') = 25 AS journal_next_id_ok,
  (SELECT COUNT(*) FROM `__drizzle_migrations`
    WHERE `id` = 24
      AND BINARY `hash` = BINARY 'e4a5e27b1b6113baa0bafcc52b29c7d1e8a78a293ee326daf5eb086b48bed5e3'
      AND `created_at` = 1789195799696) = 1 AS previous_migration_ok,
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME <> '__drizzle_migrations') = 32 AS application_table_count_ok,
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'credit_card_installment_payment') = 0 AS target_absent_ok;
```

Bütün `*_ok` değerleri exact `1` değilse durulur. Builder ayrıca full journal prefix'ini, target/server digest'lerini, session politikasını, tablo/kolon/PK biçimlerini ve her statement'ın hash'ini DDL öncesinde yeniden doğrular.

## Hedefe bağlı paketi üretme

Canlı phpMyAdmin oturumunda salt okunur alınan DB ve tam MariaDB sürüm SHA-256 digest'leri yalnız mevcut process environment içinde kullanılır:

```powershell
$env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG = "0024_partial_card_payments"
$env:PHPMYADMIN_TARGET_DB_SHA256 = "<64-kucuk-harf-hex-db-digesti>"
$env:PHPMYADMIN_SERVER_VERSION_SHA256 = "<64-kucuk-harf-hex-surum-digesti>"
npm run db:bundle:phpmyadmin:incremental
Remove-Item Env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG
Remove-Item Env:PHPMYADMIN_TARGET_DB_SHA256
Remove-Item Env:PHPMYADMIN_SERVER_VERSION_SHA256
```

Manifest şu kaynak sözleşmesini exact göstermelidir:

- `expectedJournalCount = 24`
- `expectedPreviousMigration.tag = 0023_collection_card_accounts`
- `migration.tag = 0024_partial_card_payments`
- `migration.createdAt = 1789383073515`
- `migration.hash = e9dd804de1525319cc1da6fed05d4d4c69afa776dde4cda99457cfcdab6d1bf5`
- `migration.statementHashes` uzunluğu `6`

SQL/manifest SHA-256 değerleri gerçek dosyalarla eşleşmeli ve aynı girdilerle ikinci üretim byte-identical olmalıdır. Hedefe bağlı dosyalar `dist/` altında yerel artefakttır; Git'e veya uygulama ZIP'ine alınmaz.

## Tek import ve veri taşıma

Yalnız `dist/portal-pusula-incremental-0024_partial_card_payments.sql` doğru hedefte bir kez import edilir. Kaynak `drizzle/0024_partial_card_payments.sql` doğrudan yüklenmez veya metin olarak yapıştırılmaz.

Paket sırasıyla:

1. exact 10 kolonlu InnoDB/`utf8mb4_unicode_ci` ödeme tablosunu, canonical ASCII UUID ve entry-type alanlarını, üç CHECK ile primary/üç unique indexi oluşturur;
2. taksit, finans hareketi ve self-reversal için üç `RESTRICT/RESTRICT` FK ekler;
3. `(installment_id, paid_on, created_at_utc)` indexini ekler;
4. her eski `paid` taksit için yeni canonical UUID id/operation key, exact taksit tutarı, `paid_on`, varsa `finance_transaction_id`, `entry_type='payment'` ve tarihsel `updated_at_utc` ile bir satır ekler;
5. exact postflight geçerse immutable migration journal kaydını ekler.

Yalnız exact `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` / `0024_partial_card_payments` sonucu başarıdır. Genel “import tamamlandı” bildirimi tek başına yeterli değildir.

## Postflight

```sql
SELECT
  (SELECT COUNT(*) FROM `__drizzle_migrations`) = 25 AS journal_count_ok,
  (SELECT COALESCE(MAX(`id`), 0) FROM `__drizzle_migrations`) = 25 AS journal_max_ok,
  (SELECT `AUTO_INCREMENT` FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = '__drizzle_migrations') = 26 AS journal_next_id_ok,
  (SELECT COUNT(*) FROM `__drizzle_migrations`
    WHERE `id` = 25
      AND BINARY `hash` = BINARY 'e9dd804de1525319cc1da6fed05d4d4c69afa776dde4cda99457cfcdab6d1bf5'
      AND `created_at` = 1789383073515) = 1 AS migration_identity_ok,
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME <> '__drizzle_migrations') = 33 AS application_table_count_ok,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'credit_card_installment_payment') = 10 AS exact_column_count_ok;
```

Backfill eşitliği ayrıca salt okunur doğrulanır:

```sql
SELECT
  (SELECT COUNT(*) FROM `credit_card_installment_payment`) =
    (SELECT COUNT(*) FROM `credit_card_installment`
      WHERE BINARY `status` = BINARY 'paid') AS exact_backfill_count_ok,
  (SELECT COUNT(*)
    FROM `credit_card_installment_payment` payment
    JOIN `credit_card_installment` installment
      ON installment.`id` = payment.`installment_id`
    WHERE BINARY installment.`status` <> BINARY 'paid'
       OR BINARY payment.`entry_type` <> BINARY 'payment'
       OR payment.`reversal_of_id` IS NOT NULL
       OR payment.`reversal_reason` IS NOT NULL
       OR payment.`amount` <> installment.`amount`
       OR payment.`paid_on` <> installment.`paid_on`
       OR NOT (payment.`finance_transaction_id` <=> installment.`finance_transaction_id`)) = 0
    AS exact_backfill_values_ok,
  (SELECT COUNT(*) FROM (
    SELECT `installment_id`
    FROM `credit_card_installment_payment`
    GROUP BY `installment_id`
    HAVING COUNT(*) <> 1
  ) duplicate_payment) = 0 AS one_legacy_payment_per_installment_ok;
```

Tabloda ayrıca `chk_credit_card_installment_payment_identity`, `chk_credit_card_installment_payment_amount`, `chk_credit_card_installment_payment_entry`; `uq_credit_card_installment_payment_operation`, `uq_credit_card_installment_payment_transaction`, `uq_credit_card_installment_payment_reversal`; `idx_credit_card_installment_payment_installment_date`; `fk_credit_card_installment_payment_installment`, `fk_credit_card_installment_payment_transaction` ve `fk_credit_card_installment_payment_reversal` exact adlarıyla doğrulanır. Üç FK de `ON DELETE RESTRICT ON UPDATE RESTRICT` olmalıdır.

Her sonuç exact kabul koşulunu sağlamadan uygulama deploy edilmez. Başarıdan sonra aynı final committen üretilmiş uygulama artefaktıyla kısmi ödeme, kalan borç, kaynak hesap hareketi ve ters kayıt için dar smoke uygulanır; ardından yazma dondurması kaldırılır.

## Hata sınırı

- Exact başarı satırı yoksa SQL/manifest çifti ikinci kez import edilmez.
- Journal, backfill satırları, constraint veya indexler elle eklenmez, silinmez ya da düzeltilmez.
- Hedef salt okunur incelenir; devam yalnız restore edilmiş yedek veya yeni immutable forward-fix migration ile ayrı change window'da yapılır.
- `UUID()` ile oluşan teknik anahtarlar finansal veri veya credential değildir; yine de ham iş verileri operasyon kaydına taşınmaz.

Bu runbook canlı migration'ın uygulandığını, deploy'un tamamlandığını veya Dilim 0 GO verildiğini iddia etmez.
