# phpMyAdmin mevcut şema yükseltme paketi — `0012_user_permissions`

Bu akış, journal'ında exact `0000`–`0011` bulunan Portal Pusula veritabanına yalnız `0012_user_permissions` migration'ını uygular. Ham `drizzle/0012_user_permissions.sql` canlı hedefe doğrudan yüklenmez; clean-only paket mevcut DB'de kullanılmaz.

MariaDB DDL transactional değildir. Uygulama yazmaları `0011` ön kontrolünden güncel build smoke testleri bitene kadar dondurulur. Exact başarı satırı görülmezse paket yeniden çalıştırılmaz; hedef salt okunur incelenir ve gerekirse yeni forward-fix migration hazırlanır.

## Ön kontrol

Güncel yedek ve doğru DB hedefi iki kişi/iki bağımsız kontrolle doğrulanır. Gerçek DB adı, kullanıcı, parola veya connection string komuta, loga ve belgeye yazılmaz. Salt okunur kontrolün beklenen sonucu:

- `__drizzle_migrations` exact 12 satır; son satır sürümlü manifestteki `0011_customer_projects_partnership` hash/timestamp'ıyla eşleşir;
- `user_account` vardır; `display_name` ve `role` kolonları yoktur;
- `chk_user_account_state` vardır;
- `user_permission`, `chk_user_account_display_name` ve `idx_user_account_role_status` yoktur;
- uygulama yazmaları tamamen dondurulmuştur.

Herhangi bir farkta paket üretilmez veya uygulanmaz.

## Hedefe bağlı paket

DB adı ve server sürümü yalnız yerel süreçte SHA-256 digest'e çevrilir. Digest değeri hedef kimliğini açığa çıkarmaz; yine de paket başka DB/sürüme uygulanamaz. Güvenli süreç environment'ında şu adlar tanımlanır:

```powershell
$env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG = "0012_user_permissions"
$env:PHPMYADMIN_TARGET_DB_SHA256 = "<64-kucuk-hex-digest>"
$env:PHPMYADMIN_SERVER_VERSION_SHA256 = "<64-kucuk-hex-digest>"
npm run db:bundle:phpmyadmin:incremental
```

Çıktılar:

- `dist/portal-pusula-incremental-0012_user_permissions.sql`
- `dist/portal-pusula-incremental-0012_user_permissions.manifest.json`

Manifestte `expectedJournalCount = 12`, previous tag `0011_customer_projects_partnership`, migration tag `0012_user_permissions` ve exact 7 statement hash'i bulunmalıdır. SQL/manifest SHA-256 değerleri ikinci üretimde byte-identical olmalıdır.

## Tek seferlik import ve postflight

1. phpMyAdmin'de yalnız doğrulanmış hedef DB seçilir ve yalnız incremental SQL artefaktı bir kez içe aktarılır.
2. Yalnız `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` ile `0012_user_permissions` birlikte görünürse başarı kabul edilir.
3. Journal exact 13 satır ve son satır manifest target hash/timestamp'ıyla eşleşmelidir.
4. Eski tüm hesaplar `role = owner`, boş olmayan `display_name` ve mevcut `credential_version/status` değerleriyle korunmalıdır. Yeni hesap varsayılanı `member` olmalıdır.
5. `user_permission` üç kolonlu, composite primary key'li, yalnız 27 allowlist kodunu kabul eden CHECK'li ve `user_account`a `RESTRICT/RESTRICT` FK'li olmalıdır.
6. `chk_user_account_display_name`, güncellenmiş `chk_user_account_state` ve `(role,status)` indexi doğrulanmalıdır.
7. Geçersiz permission kodu, geçersiz rol ve boş display name disposable kontrolde DB tarafından reddedilmelidir. Canlıda sentetik write testi yapılmaz.

Postflight bitmeden uygulama dağıtılmaz. Sonrasında aynı committen üretilmiş ZIP dağıtılır; owner girişi, member oluşturma/devre dışı bırakma, owner koruması, finansal alan redaksiyonu ve 401/403 smoke kontrolleri geçince yazma dondurması kaldırılır.

Bu belgenin izlenmesi ayrıca kullanıcı onayı, bakım penceresi ve backup/restore kapısı gerektirir; belge tek başına canlı migration yetkisi vermez.
