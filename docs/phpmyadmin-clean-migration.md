# phpMyAdmin temiz veritabanı migration paketi

Bu runbook, Portal Pusula'nın sürümlü migration'larını npm/SSH erişimi olmayan bir Hostinger MariaDB hedefine phpMyAdmin dosya içe aktarmasıyla uygulamak için kullanılan **clean-only** paketi tanımlar. Paket yalnız yeni oluşturulmuş, boş ve gözden çıkarılabilir bir staging veritabanını başlangıç şemasına getirir. Mevcut tablo veya veri bulunan bir veritabanını yükseltmez.

Bu akış uygulamayı dağıtmaz, kullanıcı oluşturmaz, environment değişkeni girmez, yedek almaz ve phpMyAdmin erişimi sağlamaz. Hedef bağlayıcı SHA-256 değerleri de parola veya şifreleme değildir; yanlış veritabanının seçilmesi riskini azaltan fail-closed doğrulama girdileridir.

## Değişmez güvenlik sınırı

- Yalnız ayrı oluşturulmuş disposable staging hedefinde kullanılır. Canlı, veri taşıyan, daha önce import denenmiş veya başka uygulamayla paylaşılan DB hedef olamaz.
- Hedefte tablo, view, routine, trigger ve event sayısı sıfır olmalıdır. Paket ikinci kez çalıştırılmak üzere tasarlanmamıştır.
- SQL ve manifest dosyaları elle düzenlenmez. Hedef veya sunucu değiştiğinde paket yeni digest'lerle yeniden üretilir.
- Gerçek DB adı, kullanıcı adı, parola, connection string veya ham `VERSION()` çıktısı komuta, dosyaya, sohbete, issue'ya, commit'e ya da ekran görüntüsüne yazılmaz.
- Üretilen hedefe bağlı dosyalar `dist/` altında yerel deployment artefaktıdır; Git'e eklenmez ve herkese açık depoda yayımlanmaz.
- Paket `SET GLOBAL` çalıştırmaz ve sağlayıcının global `sql_mode` değerini değiştirmeye çalışmaz. Hostinger'ın paylaşımlı global varsayımları yalnız salt okunur bağlam bilgisidir; migration güvenliği paketin kendi bağlantısında kurduğu ve doğruladığı session sözleşmesinden gelir.
- Başarısız import geri alınabilir kabul edilmez. MariaDB DDL implicit commit yapabildiği için aynı DB üzerinde temizleme veya yeniden deneme yapılmaz; disposable hedef silinip yeniden oluşturulur.
- Canlı migration ancak ayrıca açık kullanıcı onayı, kanıtlanmış backup/restore ve değişiklik penceresiyle ele alınır. Bu runbook canlı import yetkisi vermez.

## Paketin korumaları

Üretici yalnız sürümlü `drizzle/` journal'ında bulunan ve dar allowlist'ten geçen `CREATE TABLE`, `CREATE INDEX` ve güvenli `ALTER TABLE ... ADD CONSTRAINT` ifadelerini kabul eder. Paket:

- hedef DB adının ve tam MariaDB `VERSION()` değerinin SHA-256 digest'lerine bağlanır;
- MariaDB 10.6 veya üstünü, varsayılan InnoDB motorunu, `utf8mb4` ve etkin global/session `CHECK`/foreign-key/unique kontrollerini doğrular;
- import bağlantısındaki önceki exact `@@SESSION.sql_mode` değerini saklar; kendi session'ında exact `STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` politikasını kurup geri okuyarak doğrular;
- uygulama migration runner'ıyla aynı, DB adını göstermeyen advisory lock'u en çok 10 saniye bekler;
- yalnız tamamen boş şemada başlar;
- her guarded DDL ve journal adımının hemen öncesinde ve doğrulama sonrasında canonical session sözleşmesini yeniden kontrol eder; ortadaki bir session sapmasında sonraki mutasyonları güvenli no-op'a çevirir;
- her DDL adımından sonra beklenen tablo, kolon, constraint veya index'i `information_schema` üzerinden doğrular;
- migration tamamlanınca dört exact journal kaydını ve toplam yedi teknik tabloyu doğrular;
- phpMyAdmin çoklu sorgu hatasından sonra devam edecek biçimde ayarlanmış olsa bile guard başarısızlığından sonra yeni DDL veya journal adımı çalıştırmaz;
- yalnız tüm kontroller ve lock bırakma işlemi geçtiğinde `PORTAL_PUSULA_MIGRATION_BUNDLE_OK` sonucunu üretir.

Bu korumalar yedek veya rollback yerine geçmez. Bir DDL adımında hata oluşursa önceki DDL'lerin transaction ile geri alınacağı varsayılmaz.

Canonical strict mod yalnız bundle'ın kendi phpMyAdmin bağlantısına uygulanır. Global değer değişmez. Paket hem normal başarı yolunda hem de phpMyAdmin'in hata sonrasında kalan ifadeleri çalıştırdığı continue-on-error yolunda, başlangıçta sakladığı önceki session `sql_mode` değerini exact olarak geri yükler ve geri yüklemeyi doğrular. Geri yükleme kanıtlanamazsa başarı imzası üretmez. Bağlantı/import tamamen kesilirse session sağlayıcı tarafından kapatılmalı; hedef yine `UNKNOWN/başarısız` kabul edilir ve tekrar kullanılmaz.

Disposable otomatik kabul ortamı pinned MariaDB 11.4.8 üzerinde çalışır. Farklı Hostinger sürümü yalnız minimum sürüm kontrolüyle “kanıtlanmış” sayılmaz; aşağıdaki exact sürüm digest'i ve capability probe'u geçmeli, clean staging importu da o sunucudaki gerçek kabul kanıtını üretmelidir.

## 1. Yerel kalite kapıları

Paket hazırlanmadan önce repository kökünde aşağıdaki kapılar geçmelidir:

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run test:mariadb
```

`test:mariadb`, paketi gerçek ve disposable MariaDB üzerinde; başarılı clean import, yanlış digest, dolu şema, lock yarışı, hata sonrası devam davranışı, journal bütünlüğü ve normal migration runner'ıyla uyumluluk açısından doğrular. Bu kapı geçmeden phpMyAdmin import'una başlanmaz.

## 2. Boş hedefi salt okunur doğrulama

Hostinger'da bu iş için yeni bir DB ve yalnız gerekli yetkilere sahip kullanıcı oluşturulur. Daha önce import denenmiş bir DB yeniden kullanılmaz. phpMyAdmin'de sol menüden doğru hedef seçildikten sonra aşağıdaki salt okunur probe çalıştırılır:

```sql
SELECT
  SHA2(DATABASE(), 256) AS target_database_sha256,
  SHA2(VERSION(), 256) AS server_version_sha256,
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()) AS schema_object_count,
  (SELECT COUNT(*) FROM information_schema.ROUTINES
    WHERE ROUTINE_SCHEMA = DATABASE()) AS routine_count,
  (SELECT COUNT(*) FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE()) AS trigger_count,
  (SELECT COUNT(*) FROM information_schema.EVENTS
    WHERE EVENT_SCHEMA = DATABASE()) AS event_count,
  @@SESSION.check_constraint_checks AS session_check_constraints,
  @@SESSION.foreign_key_checks AS session_foreign_keys,
  @@SESSION.unique_checks AS session_unique_checks,
  @@GLOBAL.check_constraint_checks AS global_check_constraints,
  @@GLOBAL.foreign_key_checks AS global_foreign_keys,
  @@GLOBAL.unique_checks AS global_unique_checks,
  @@SESSION.default_storage_engine AS session_default_storage_engine,
  @@GLOBAL.default_storage_engine AS global_default_storage_engine,
  @@SESSION.sql_mode AS session_sql_mode,
  @@GLOBAL.sql_mode AS global_sql_mode;
```

Kabul koşulları:

- iki digest de tam 64 karakter küçük harf hexadecimal olmalı;
- dört nesne sayacı da `0` olmalı;
- üç session ve üç global kontrol değeri de `1` olmalı;
- iki varsayılan depolama motoru da exact `InnoDB` olmalı;
- global veya ilk session `sql_mode` değerinde strict mod bulunması ön koşul değildir. Bu iki değer yalnız bağlam için okunur; bundle kendi session'ında canonical strict modu kurup geri okumadan hiçbir DDL çalıştırmaz.

Digest'ler dışında probe çıktısı kopyalanmaz veya proje dosyalarına kaydedilmez. `DATABASE()` seçili değilse digest `NULL` olur; bu durumda import yapılmaz. Sunucu yükseltmesi veya yeniden yönlendirme tam `VERSION()` değerini değiştirebileceği için digest'ler importtan hemen önce yeniden alınır.

## 3. Hedefe bağlı paketi üretme

Probe'dan alınan iki digest yalnız mevcut PowerShell sürecine girilir. Köşeli parantezli yer tutucular gerçek değer değildir ve komutta bırakılmamalıdır:

```powershell
$env:PHPMYADMIN_TARGET_DB_SHA256 = "<64-kucuk-harf-hex-db-digesti>"
$env:PHPMYADMIN_SERVER_VERSION_SHA256 = "<64-kucuk-harf-hex-surum-digesti>"
npm run db:bundle:phpmyadmin
Remove-Item Env:PHPMYADMIN_TARGET_DB_SHA256
Remove-Item Env:PHPMYADMIN_SERVER_VERSION_SHA256
```

Komut digest eksikse veya biçimi yanlışsa dosya üretmeden hata verir. Başarılı çalışmada iki dosya oluşur:

- `dist/portal-pusula-phpmyadmin-migration.sql`
- `dist/portal-pusula-phpmyadmin-migration.manifest.json`

Manifest; `formatVersion: 2`, minimum MariaDB sürümü, migration timestamp/hash'leri, her SQL adımının hash'i, beklenen teknik şema, bundle ID ve SQL dosyasının byte sayısı/SHA-256 değerini içerir. `sessionPolicy` alanı canonical SQL mode, charset, collation, timezone ve storage engine değerleriyle birlikte `modifiesGlobalSqlMode: false` ve `restoresOriginalSqlMode: true` sınırını taşır. Gerçek DB adı, ham sunucu sürümü veya credential içermez.

SQL bütünlüğü importtan önce PowerShell ile doğrulanır:

```powershell
$manifest = Get-Content .\dist\portal-pusula-phpmyadmin-migration.manifest.json | ConvertFrom-Json
$manifestPolicyOk = (
  $manifest.formatVersion -eq 2 -and
  $manifest.sessionPolicy.sqlMode -ceq "STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION" -and
  $manifest.sessionPolicy.characterSet -ceq "utf8mb4" -and
  $manifest.sessionPolicy.collation -ceq "utf8mb4_unicode_ci" -and
  $manifest.sessionPolicy.timeZone -ceq "+00:00" -and
  $manifest.sessionPolicy.storageEngine -ceq "InnoDB" -and
  $manifest.sessionPolicy.modifiesGlobalSqlMode -eq $false -and
  $manifest.sessionPolicy.restoresOriginalSqlMode -eq $true
)
$actualSqlHash = (Get-FileHash .\dist\portal-pusula-phpmyadmin-migration.sql -Algorithm SHA256).Hash.ToLowerInvariant()
$manifestPolicyOk
$actualSqlHash -eq $manifest.sqlSha256
```

İki sonuç da exact `True` değilse import yapılmaz; iki artefakt silinip kalite kapıları ve üretim adımı baştan çalıştırılır. Dosya adları değiştirilmez, SQL ZIP'e alınmaz ve metin olarak phpMyAdmin SQL sekmesine yapıştırılmaz.

Yalnız güncel üreticinin session initializer, doğrulama ve exact restore adımlarını taşıyan artefaktı kullanılabilir. Bu politika eklenmeden önce üretilmiş bir SQL/manifest çifti hash'i sağlam görünse bile import, yeniden deneme veya rollback adayı değildir; silinir ve güncel kaynakla yeniden üretilir.

## 4. phpMyAdmin ile dosya importu

1. Aynı phpMyAdmin oturumunda hedef DB tekrar sol menüden seçilir.
2. `İçe Aktar / Import` ekranında yalnız `portal-pusula-phpmyadmin-migration.sql` dosyası seçilir.
3. Biçim `SQL`, karakter seti `utf-8` olarak bırakılır. Partial import/resume kullanılmaz; dosyanın başından atlanacak sorgu sayısı `0` olmalıdır.
4. Tek bir import başlatılır. Aynı anda migration runner, ikinci phpMyAdmin importu veya şema yazan başka işlem çalıştırılmaz.
5. İşlem sonucu içinde exact `PORTAL_PUSULA_MIGRATION_BUNDLE_OK` satırı aranır.

phpMyAdmin'in genel “içe aktarma tamamlandı” bildirimi tek başına başarı kanıtı değildir. Exact başarı satırı yoksa, herhangi bir SQL hatası görülürse, bağlantı kesilirse veya sonucun tamamı okunamıyorsa işlem **başarısız/UNKNOWN** sayılır. Hata içeriği credential veya sunucu ayrıntısı içerebileceğinden ham çıktı sohbete ya da repository'ye kopyalanmaz.

## 5. Başarı sonrası salt okunur kabul

Exact başarı satırından sonra aynı hedefte aşağıdaki sorgular çalıştırılır:

```sql
SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

SELECT id, hash, created_at
FROM `__drizzle_migrations`
ORDER BY id;
```

İlk sorgu yalnız şu yedi teknik tabloyu döndürmelidir:

- `__drizzle_migrations`
- `_platform_migration_verification`
- `audit_event`
- `cron_dispatch_gate`
- `job_run`
- `outbox_event`
- `scheduled_job`

İkinci sorgu dört satır döndürmeli; sıra, `hash` ve `created_at` değerleri üretilen manifestteki dört migration kaydıyla exact eşleşmelidir. Uygulama tabloları boş kalır; yalnız migration journal'ında dört teknik kayıt bulunur.

Kabul kanıtına şunlar kaydedilebilir: UTC zaman, manifestteki `bundleId`, SQL `sqlSha256`, exact başarı imzasının görüldüğü, yedi tablo/dört journal satırı sonucu ve operatör. DB adı, kullanıcı, parola, tam sunucu sürümü, URL query'si, cookie veya Authorization değeri kaydedilmez.

Kabul tamamlanınca hedefe bağlı SQL ve manifest güvenli deployment alanından kaldırılır. Uygulama ZIP dağıtımı, environment ayarları, readiness ve rollback doğrulaması [Hostinger dağıtım runbook'unda](./hostinger-deploy.md) ayrı kapılardır.

## Hata ve yeniden başlatma kararı

Exact başarı imzası alınmayan her importta:

1. Yeni write veya “kaldığı yerden devam” denemesi yapılmaz.
2. Hedef yalnız salt okunur sayım için incelenebilir; bu inceleme hedefi tekrar kullanılabilir yapmaz. Hata alan phpMyAdmin isteğinin bağlantıyı kapatacağı lock cleanup'ının bir parçasıdır; sonuç UNKNOWN ise oturum kapatılır ve aynı bağlantı yeniden kullanılmaz.
3. Disposable hedef exact kimliği doğrulanarak Hostinger panelinden silinir ve yeni boş DB oluşturulur.
4. Sunucu/version ve yeni DB digest'leri tekrar alınır.
5. Paket yeniden üretilir; eski SQL/manifest kullanılmaz.
6. Kalıcı veya canlı veri söz konusuysa silme yapılmaz; işlem durdurulur ve [backup/restore runbook'u](./backup-restore.md) üzerinden ayrıca kullanıcı onayı alınır.

Advisory lock alınamaması, yanlış digest, sunucu sürümü değişimi veya hedefin boş olmaması DDL başlamadan fail-closed sonuç vermek üzere tasarlanmıştır. Buna rağmen operatör dışarıdan hangi adımda kesinti olduğunu kesin bilemeyeceği için başarısız hedefi yeniden kullanmama kuralı değişmez.

## Sonraki migration'lar

Bu paket başlangıç şemasının temiz kurulumu içindir. Başarılı hedefe aynı paket ikinci kez import edilmez. Yeni migration eklendiğinde:

- uygulanmış SQL dosyaları değiştirilmez;
- ileri yönlü yeni migration normal inceleme ve MariaDB test kapılarından geçirilir;
- mevcut veri taşıyan hedef için clean-only bootstrap kullanılmaz;
- onaylı migration runner veya ayrıca tasarlanıp test edilmiş mevcut-şema yükseltme prosedürü kullanılır.

Normal runner ve immutable journal sözleşmesi [migration runbook'unda](./migrations.md) açıklanır.
