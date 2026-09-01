# phpMyAdmin mevcut şema yükseltme paketi

Bu akış, journal'ı bulunan mevcut Portal Pusula veritabanına **yalnız sıradaki seçili migration'ı** uygular. Clean-only paket mevcut veritabanında kullanılmaz; `drizzle/0006_receivables.sql` dosyası da `--> statement-breakpoint` ayraçları nedeniyle doğrudan phpMyAdmin'e verilmez.

## Üretim ve uygulama

1. Canlı DB'nin güncel yedeğini al. Uygulama deployunu henüz başlatma.
2. phpMyAdmin'de doğru DB'yi seçip clean-only runbook'taki salt okunur probe ile DB ve tam sunucu sürümü SHA-256 değerlerini yeniden al.
3. Digest'leri yalnız mevcut PowerShell sürecine girip paketi üret:

```powershell
$env:PHPMYADMIN_TARGET_DB_SHA256 = "<64-kucuk-harf-hex>"
$env:PHPMYADMIN_SERVER_VERSION_SHA256 = "<64-kucuk-harf-hex>"
$env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG = "0006_receivables"
npm run db:bundle:phpmyadmin:incremental
Remove-Item Env:PHPMYADMIN_TARGET_DB_SHA256
Remove-Item Env:PHPMYADMIN_SERVER_VERSION_SHA256
Remove-Item Env:PHPMYADMIN_INCREMENTAL_MIGRATION_TAG
```

Manifestteki `sqlSha256` ile aşağıdaki sonucun aynı olduğunu doğrula:

```powershell
$manifest = Get-Content .\dist\portal-pusula-incremental-0006_receivables.manifest.json | ConvertFrom-Json
(Get-FileHash .\dist\portal-pusula-incremental-0006_receivables.sql -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $manifest.sqlSha256
```

4. Sonuç exact `True` ise `dist/portal-pusula-incremental-0006_receivables.sql` dosyasını değiştirmeden, SQL/UTF-8 ve sıfır sorgu atlama ile bir kez içe aktar.
5. Yalnız sonuçta `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` ve `0006_receivables` birlikte görünürse başarılı say. Ardından salt okunur olarak `receivable`, `receivable_collection` tablolarını ve yedi exact journal satırını doğrula; sonra uygulama ZIP'ini dağıt.

Paket hedef DB/sunucu digest'ini, exact önceki journal zincirini, beklenen önceki migration'ı ve hedef nesnelerin yokluğunu DDL'den önce doğrular. Her DDL adımı hex kodlu aday SQL, SHA-256 ve `information_schema` postflight kontrolüyle ilerler; journal eklemesi exact hash/timestamp ile idempotent yazılmıştır.

MariaDB DDL transactional değildir ve bu paket rollback vaat etmez. Exact başarı satırı yoksa, import hata verirse veya bağlantı kesilirse **yeniden çalıştırma**. Paket hedef nesnelerden biri oluşmuşsa yeniden çalışmayı fail-closed reddeder. Hedefi yalnız salt okunur incele; veri kaybı yoksa ayrı forward-fix paketi hazırla, aksi durumda kanıtlanmış yedekten onaylı geri yükleme uygula.
