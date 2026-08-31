# ADR-0003 — Node 24, npm 12 ve Hostinger webpack hattı

- **Durum:** Kabul edildi
- **Tarih:** 30 Ağustos 2026
- **Kapsam:** Yerel ve Hostinger build/runtime araç zinciri

## Bağlam

Komut 1'de Node 24 yalnız yerel adaydı ve `package.json.engines` bilinçli olarak ertelenmişti. Hostinger Business Node.js Web App spike'ında panelde Node 24.x seçilebildi; gerçek build runtime'ı `v24.6.0`, npm ana sürümü 12 ve Next.js 16.3.3 build/start akışı canlı çalıştı.

İlk dağıtım yolu Hostinger'ın eski glibc ortamında native SWC yüklerken başarısız oldu. Yapılandırmanın `next.config.mjs` olarak yüklenmesi ve production build'in `next build --webpack` ile çalıştırılması aynı ortamda başarılı oldu. Bu uyumluluk davranışı geçici bir yerel tercih değil, mevcut Hostinger hedefinin kanıtlanmış sınırıdır.

## Karar

- `package.json.engines.node` değeri `>=24 <25`, `package.json.engines.npm` değeri `>=12 <13` olarak sabitlenir. `package-lock.json` kök paket metadata'sı aynı değerleri taşır.
- `.nvmrc` ana sürüm `24` olarak kalır; `packageManager` deterministik npm sürümünü kaydetmeye devam eder.
- Next yapılandırması `next.config.mjs` dosyasında tutulur.
- Production build komutu `next build --webpack` olarak kalır. Varsayılan Turbopack/native SWC yoluna sessiz geçiş yapılmaz.
- Hostinger start ve port yönetimi platformun Next.js başlangıcına bırakılır; uygulama sabit production portu kodlamaz.
- Bu karar dependency sürümlerini değiştirmez. Node 25 veya npm 13'e otomatik genişlemez; her yeni ana sürüm ayrı clean-install, lint, typecheck, test, build ve Hostinger doğrulaması ister.

## Gerekçeler

- Ana sürüm aralığı canlıda kanıtlanan çalışma çizgisini korurken Node 24/npm 12 patch-minor güncellemelerine izin verir.
- `next.config.mjs` ve webpack, mevcut sağlayıcı glibc sınırında doğrulanmış tek başarılı build yoludur.
- `package.json` ile lockfile kök metadata'sının eşleşmesi clean install ve paket denetimini deterministik kılar.

## Sonuçlar

- Node/npm ana sürümü uyumsuz ortamlarda paket yöneticisi uyarı veya fail davranışı gösterebilir; CI/dağıtım bu uyarıyı yok saymamalıdır.
- Next.js ya da Hostinger native SWC/glibc desteği değiştiğinde webpack kararını kaldırmak otomatik refactor değildir; ayrı spike ve ADR güncellemesi gerekir.
- Canlı spike'ın eski ZIP'i bu kararı destekleyen kanıttır. Güncel Komut 3C kaynak/ZIP'inin canlıya dağıtıldığı anlamına gelmez.
- Canlı migration, cron, backup/restore ve rollback hâlâ ayrı kabul kapılarıdır; bu ADR Dilim 0 `GO` vermez.

