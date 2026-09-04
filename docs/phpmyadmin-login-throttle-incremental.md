# phpMyAdmin mevcut şema yükseltme paketi — `0013_login_attempt_throttle`

Bu akış, journal'ında exact `0000`–`0012` bulunan Portal Pusula veritabanına yalnız `0013_login_attempt_throttle` migration'ını uygular. Ham `drizzle/0013_login_attempt_throttle.sql` canlı hedefe doğrudan yüklenmez; clean-only paket mevcut DB'de kullanılmaz.

MariaDB DDL transactional değildir. Uygulama yazmaları ön kontrolden güncel build ve giriş güvenliği smoke testleri bitene kadar dondurulur. Exact başarı satırı görülmezse paket yeniden çalıştırılmaz; hedef salt okunur incelenir ve gerekirse yeni forward-fix migration hazırlanır.

## Ön kontrol

Güncel yedek ve doğru DB hedefi iki kişi/iki bağımsız kontrolle doğrulanır. Gerçek DB adı, kullanıcı, parola veya connection string komuta, loga ve belgeye yazılmaz. Salt okunur kontrolün beklenen sonucu:

- `__drizzle_migrations` exact 13 satır; son satır sürümlü manifestteki `0012_user_permissions` hash/timestamp'ıyla eşleşir;
- `login_attempt_throttle` tablosu yoktur;
- `chk_login_attempt_throttle_key`, `chk_login_attempt_throttle_state`, `idx_login_attempt_throttle_updated` ve `idx_login_attempt_throttle_blocked` yoktur;
- MariaDB session policy doğrulanmıştır ve uygulama yazmaları tamamen dondurulmuştur.

Herhangi bir farkta paket üretilmez veya uygulanmaz. `0011` ve `0012` henüz uygulanmadıysa arada uygulama dağıtımı yapılmadan önce onların ayrı hedefe bağlı runbook'ları tamamlanır; `0013`, yalnız journal exact `0012` durumundayken üretilir.

## Hedefe bağlı paket üretimi

DB adı ve server sürümü yalnız güvenli yerel süreçte SHA-256 digest'e çevrilir. Gerçek kimlik değerleri veya bağlantı sırları shell geçmişine, loga ya da belgeye yazılmaz. Digest paketi yalnız doğrulanan DB/sürüme bağlar. Güvenli süreç environment'ında şu adlar tanımlanır:

```powershell
$env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG = "0013_login_attempt_throttle"
$env:PHPMYADMIN_TARGET_DB_SHA256 = "<64-kucuk-hex-digest>"
$env:PHPMYADMIN_SERVER_VERSION_SHA256 = "<64-kucuk-hex-digest>"
npm run db:bundle:phpmyadmin:incremental
```

Çıktılar:

- `dist/portal-pusula-incremental-0013_login_attempt_throttle.sql`
- `dist/portal-pusula-incremental-0013_login_attempt_throttle.manifest.json`

Manifestte `expectedJournalCount = 13`, previous tag `0012_user_permissions`, migration tag `0013_login_attempt_throttle` ve exact 3 migration statement hash'i bulunmalıdır. SQL ve manifest SHA-256 değerleri ikinci üretimde byte-identical olmalıdır. Artefaktın hedef/server digest'leri ön kontrolde hesaplanan değerlerle karşılaştırılır.

## Tek seferlik import

1. phpMyAdmin'de yalnız iki bağımsız kontrolle doğrulanmış hedef DB seçilir.
2. Yalnız incremental `portal-pusula-incremental-0013_login_attempt_throttle.sql` artefaktı bir kez içe aktarılır.
3. Çıktıda yalnız `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` ile `0013_login_attempt_throttle` birlikte görünürse import başarı kabul edilir.
4. Guard-failure, SQL hatası, bağlantı kopması veya belirsiz sonuçta aynı paket ikinci kez çalıştırılmaz; yazma dondurması korunur ve hedef salt okunur incelenir.

## Postflight

Canlıda sentetik yazma testi yapılmadan şu salt okunur kanıtlar alınır:

1. Journal exact 14 satırdır; son satır manifest target hash/timestamp'ıyla eşleşir.
2. `login_attempt_throttle`, InnoDB ve `utf8mb4_unicode_ci` tablo collation'ıyla vardır.
3. `bucket_key` exact `char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL` ve primary key'dir.
4. `bucket_type` exact `varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`; `failure_count` unsigned integer ve `NOT NULL`dır.
5. `window_started_at_utc` ve `updated_at_utc` exact `datetime(6) NOT NULL`; `blocked_until_utc` exact `datetime(6) NULL`dır.
6. `chk_login_attempt_throttle_key` yalnız 64 karakter küçük-hex bucket anahtarını; `chk_login_attempt_throttle_state` yalnız `account`, `global`, `network` tiplerini, `1..1000` sayaç aralığını ve zaman sırasını kabul eder.
7. `idx_login_attempt_throttle_updated(updated_at_utc)` ve `idx_login_attempt_throttle_blocked(blocked_until_utc)` non-unique BTREE indexleri exact birer kolondur.
8. Disposable MariaDB kabul testinde uppercase/bozuk bucket anahtarı ile geçersiz type/count/timeline satırları DB tarafından reddedilir; canlıda sentetik kayıt oluşturulmaz.

Postflight tamamlanmadan uygulama dağıtılmaz. Sonrasında aynı committen üretilmiş Hostinger ZIP dağıtılır; DB-backed auth storage, doğru/yanlış/bloklu girişlerin aynı ayrıntısız `303` yönlendirmesini ve `private, no-store` politikasını koruması, kalıcı throttle eşikleri, başarılı girişte yalnız hesap sayacının güvenli temizliği ve readiness smoke kontrolleri geçince yazma dondurması kaldırılır.

Bu belgenin izlenmesi ayrıca kullanıcı onayı, bakım penceresi ve backup/restore kapısı gerektirir; belge tek başına canlı migration veya dağıtım yetkisi vermez.
