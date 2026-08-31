# Portal Pusula

Portal Pusula; müşteri, planlama, görev ve finans süreçlerini güvenli bir modüler monolitte birleştirecek mobil öncelikli PWA'dır. Çalışma alanı yeni bağlayıcı şartnamedeki **Komut 0 — proje tabanı ve izlenebilirlik** içindedir. Yerel platform tabanı `baseline-platform-v0.1` etiketiyle korunur; private remote, branch protection ve uzak CI henüz kalan kapılardır. Geçici spike uygulamasında rotasyon sonrası gerçek Hostinger MySQL `SELECT 1` readiness sonucu canlı kanıtlanmıştır. Eski teknik serideki Komut 3C'nin migration, job/outbox/audit ve dayanıklı cron frekans kapısı temeli disposable yerel MariaDB'de doğrulanmıştır; Hostinger DB'ye uygulanmamış ve güncel ZIP canlıya dağıtılmamıştır. Şema `_platform_migration_verification`, dört platform iş tablosu (`scheduled_job`, `job_run`, `outbox_event`, `audit_event`) ve teknik `cron_dispatch_gate` tablosunu içerir; gerçek domain/auth tablosu yoktur. Cron route'u kaynakta bulunur fakat varsayılan kapalıdır, production handler/adapter registry'leri boştur. Dilim 0 `GO` verilmemiştir.

## Kanıtlanan Hostinger tabanı

| Alan | Canlı sonuç |
|---|---|
| Plan | Hostinger Business Node.js Web App etkin |
| Geçici adres | `https://sandybrown-wolf-559614.hostingersite.com` |
| Node.js | Panel 24.x; gerçek build runtime `v24.6.0` |
| Next.js | 16.3.3, App Router |
| Paket yöneticisi | npm 12 ve repoya alınmış `package-lock.json` |
| Engines | Node `>=24 <25`, npm `>=12 <13` |
| Uygulama kökü / çıktı | `./` / `.next` |
| Dağıtım | Kökünde `package.json` bulunan ZIP; v3 canlıda `Akım` |
| Build | `npm run build` → `next build --webpack` |
| Start | Hostinger'ın Next.js başlangıcı (`next start`) |
| CDN | Otomatik hCDN açık |

Hostinger'ın eski glibc ortamı native SWC yükleyemediği için kullanıcı tarafından yapılan iki uyumluluk kararı korunur: yapılandırma `next.config.mjs` dosyasındadır ve production build zorunlu olarak webpack kullanır. `next.config.ts` veya varsayılan SWC/Turbopack build yoluna geri dönmeyin.

## Yerel kurulum

Önkoşullar Node.js 24 LTS (`>=24 <25`), npm 12 (`>=12 <13`) ve E2E için Playwright Chromium'dur.

```bash
npm ci
npm run icons:generate
npx playwright install chromium
```

`.env.example` yalnız değişken adlarını ve güvenli açıklamaları taşır. Gerçek parola veya token yalnız yerel `.env.local` ya da Hostinger environment alanında bulunmalı; repoya, ZIP'e, belgeye, loga veya sohbete yazılmamalıdır.

| Değişken | Davranış |
|---|---|
| `LOG_LEVEL` | Boşsa `info`; desteklenen Pino seviyesi |
| `DB_HOST` | Boşsa `localhost` |
| `DB_PORT` | Boşsa `3306` |
| `DB_NAME` | Readiness DB adı; zorunlu |
| `DB_USER` | Readiness DB kullanıcısı; zorunlu |
| `DB_PASSWORD` | Hostinger environment alanında tutulan gizli parola; zorunlu |
| `READINESS_BEARER_TOKEN` | Tam 16 karakter, yalnız ASCII `A-Z`, `a-z`, `0-9`; rastgele üretilmiş ve gizli Bearer token; zorunlu |
| `CRON_ENDPOINT_ENABLED` | Yerel cron adayı için yalnız exact `true`; eksik/boş/`false` iken kapalı. Bu turda Hostinger'a eklenmez |
| `CRON_BEARER_TOKEN` | Yalnız etkin yerel aday için tam 43 base64url karakter; readiness token'dan farklı ve gizli. Bu turda canlı değer yok |
| `CRON_MIN_INTERVAL_SECONDS` | Yalnız etkin yerel aday için canonical `60..86400` tam sayı saniye; bu turda canlı değer yok |

## Sağlık sınırları

- `GET /api/health/live` public ve minimaldir; yalnız `{"status":"ok"}` döndürür, DB veya runtime ayrıntısı vermez.
- `GET /api/internal/readiness` yalnız tam olarak `Authorization: Bearer <yapılandırılmış-token>` ile çalışır. Karşılaştırma SHA-256 özetleri üzerinde timing-safe yapılır; şema, büyük/küçük harf ve boşluklar exact olmalıdır.
- Token sözleşmesi tam 16 ASCII alfanümerik karakterdir. 15/17 karakter, boşluk, Türkçe/özel karakter veya sembol fail-closed reddedilir.
- Token yoksa veya header eksik/yanlışsa generic `404 {"status":"not_found"}` döner ve DB sorgusu çalışmaz.
- Token doğru fakat DB ayarı eksikse, bağlantı/sorgu başarısızsa veya timeout olursa generic `503 {"status":"unavailable"}` döner.
- Token doğru ve sabit `SELECT 1 AS readiness_ok` sonucu başarılıysa `200 {"status":"ready"}` döner.

Readiness yalnız server-side `mysql2/promise` kullanır. Havuz en fazla iki bağlantıdır; connect/query/deadline süreleri kısadır, kuyrukta bekleme kapalıdır ve SQL kullanıcı girdisi içermez. DB hatası, parola, token veya bağlantı ayrıntısı loglanmaz. Tüm health yanıtları `private, no-store` ve correlation ID taşır.

## Hostinger ZIP paketi

```bash
npm run package:hostinger
```

Komut deterministik `dist/portal-pusula-hostinger.zip` üretir ve yalnız dosya sayısı, boyut ile SHA-256 özetini yazdırır. ZIP'in kökünde doğrudan `package.json` bulunur. Gerekli kök yapılandırmaları, sürümlü `drizzle/` SQL'i, `public/`, production/operasyon `scripts/` dosyaları ve test dosyaları çıkarılmış `src/` dahil edilir. Disposable MariaDB test orkestrasyonu pakete girmez.

Tarihsel Komut 3B post-audit-fix üretim kanıtı: 76 dosya, açılmış toplam 570446 byte, ZIP boyutu 581148 byte, SHA-256 `bd0891d7deaffe15fbb24446be02687fa8eaab7186da0cf7ca5af09f004b17a3`. Bu ölçüler yalnız o 3B artefaktına aittir. İki ardışık üretim byte-for-byte aynıdır; immutable `0000`/`0001`, ileri yönlü `0002` ve varsayılan kapalı cron route'u pakettedir.

Güncel yerel baseline üretim kanıtı (31 Ağustos 2026): 80 giriş, açılmış toplam 626878 byte, ZIP boyutu 638222 byte, SHA-256 `88428e0ed92b1e70cdd83e635d1717218870b1e88951093186df9d87cbfeb991`. İki seri üretim byte-for-byte aynıdır. Paket immutable `0000`/`0001`/`0002` ile ileri yönlü `0003_platform_cron_dispatch_gate.sql` migration'ını taşır; bu artefakt canlıya dağıtılmamıştır.

Şunlar hiçbir zaman pakete girmez: `src/**/*.test.ts(x)`, `tests/`, herhangi bir alt dizindeki `.env*`, özel anahtar/credential dosyaları, `.next/`, `node_modules/`, `dist/`, `outputs/`, `work/`, coverage, Playwright/test sonuçları ve Git verisi. Paket yalnız sabit kök dosya/dizin allowlist'inden toplanır; yasak bir nested yol görülürse içerik okunup çıktıya yazılmadan fail-closed çalışır. Betik ayrıca sembolik bağlantı, case-insensitive yol çakışması ve Zip32 sınırlarında kapanır.

## PWA ve cache güvenliği

Hostinger hCDN, `public/sw.js` dosyasına Next header kurallarını uygulamadığı için service worker artık public dosya değildir. Aynı güvenli içerik `GET /sw.js` Node Route Handler'ından şu başlıklarla sunulur:

- `Cache-Control: private, no-store, max-age=0, must-revalidate`
- `Content-Type: application/javascript; charset=utf-8`
- `Service-Worker-Allowed: /`

Worker yalnız `/offline-v1.html` ve üç sürümlü ikonu cache'ler; navigation/API/auth/iş verisi saklamaz. Hassas veri içermeyen `offline-v1.html` sürümlü public dosya olarak kalır.

## Mimari ve operasyon belgeleri

- [Teknik mimari](docs/architecture.md)
- [Güvenlik sınırı](docs/security.md)
- [Platform job/cron runbook'u](docs/platform-jobs.md)
- [Migration runbook'u](docs/migrations.md)
- [Backup/restore runbook'u](docs/backup-restore.md)
- [Hostinger deploy runbook'u](docs/hostinger-deploy.md)
- [İç endpoint yanıt ADR'si](docs/adr/0002-internal-endpoint-response-policy.md)
- [Node/npm/webpack ADR'si](docs/adr/0003-node24-npm12-hostinger-webpack.md)

## Standart komutlar

```bash
npm run lint
npm run typecheck
npm run scan:secrets
npm test
npm run test:integration
npm run test:mariadb
npm run db:generate
npm run db:migrate
npm run build
npm run test:e2e
npm run package:hostinger
npm run package:verify
npm run checkpoint:source -- --slice komut3c-local-operational-hardening
npm run start
```

Standart integration testleri gerçek secret veya bağlantı dizesi kullanmadan readiness, cron ve paketleme sınırlarını doğrular. Son yerel kapıda unit/policy 174/174, secretsız integration 15/15 ve masaüstü/mobil E2E 12/12 geçmiştir. `npm run test:mariadb`, yalnız loopback'e bağlanan ve koşu sonunda volume'ıyla birlikte silinen MariaDB 11.4.8 üzerinde migration doğruluğunu 15/15, job/outbox/audit davranışını 12/12 ve dayanıklı cron gate sözleşmesini ayrı seri süreçte 6/6 doğrulamıştır. Ayrıntılı güvenli sıra [migration runbook'unda](docs/migrations.md), iş motoru sözleşmesi ise [platform jobs runbook'unda](docs/platform-jobs.md) bulunur. Önceki geçici spike sürümünün gerçek Hostinger `SELECT 1` sonucu canlı PASS'tir; bu kanıt `0001`/`0002`/`0003` SQL'inin veya güncel ZIP'in canlıya uygulandığı anlamına gelmez.

## Bilinen sınırlar

- Rotasyon sonrası gerçek Hostinger MySQL `SELECT 1` ve hardened readiness geçici spike uygulamasında canlı doğrulandı.
- Immutable `0000` + `0001` ve ileri yönlü `0002`/`0003` migration sırası ile job/outbox/audit/cron-gate temeli yalnız disposable yerel MariaDB'de PASS'tir; Hostinger DB'ye uygulanmadı ve güncel ZIP canlıya dağıtılmadı. Kullanıcı onaylı plan-geneli manuel dosya + DB backup `2026-08-30 22:51 (Özel)` panel kaydıyla `PANEL PASS` durumundadır. Readiness-only boş kaynak ikinci disposable hedefte 0 tablo/journal yok sonucu ile restore edilmiş ve AES-256-GCM şifreli yerel recovery kopyası doğrulanmıştır. Bu, Komut 3C'nin toplam yedi tablolu güncel şemasının (altı teknik tablo + migration journal), dört satırlık journal'ının veya kontrollü verisinin restore'u değildir; o kapı `UNKNOWN` kalır.
- Node Route Handler tabanlı `/sw.js` başlıkları önceki canlı spike sürümünde hCDN arkasında doğrulandı; bu durum Komut 3A ZIP'inin canlı olduğu anlamına gelmez.
- ZIP redeploy çalıştı; sağlam sürüme gerçek rollback deneyi henüz tamamlanmadı.
- Cron adayı kaynakta exact `POST` + exact Bearer, 10 kayıt/4 saniye sınırı, DB advisory lock ve `60..86400` saniyelik dayanıklı DB frekans kapısıyla vardır; varsayılan kapalıdır. Yetkili permit ve suppression aynı generic 202'yi verir. Hostinger cron yöntem/header/secret/timezone/retry/overlap davranışı, gerçek handler/adapter, manuel requeue ve canlı yedek/restore akışı kanıtlanmamıştır.
- ESLint 10 peer metadata uyarısı ve npm'in `unrs-resolver` optional postinstall engeli ADR-0001'de kayıtlıdır; kalite kapıları davranışla doğrulanır.
- Yerel Git baseline `main` + `baseline-platform-v0.1` ile başlar; bu tarihten önceki pre-3A veya pre-audit-fix geçmişi geriye dönük üretilemez. Private remote, branch protection ve uzak CI henüz kurulmamıştır. Immutable Komut 3A post-audit checkpoint'i `dist/portal-pusula-source-checkpoint-komut3a-post-audit.zip` yolunda yerel olarak korunur: 624973 byte, SHA-256 `c51ef39e2d07c6a012afd8dd79a4c59de5bef59d8fcee431247bbb831621d438`.
- Komut 3B sonrası kaynak checkpoint'i `dist/portal-pusula-source-checkpoint-komut3b-post-platform-jobs.zip` yolunda güvenli slice etiketiyle iki kez byte-identical doğrulandı: manifest dahil 123 giriş (122 kaynak), açılmış toplam 775763 byte, SHA-256 `e352c850d4dbb142d45d760c6480f136b79ad971a5c8e1e83420fb1f906ff5d5`. Hiçbir checkpoint pre-3A baseline veya Hostinger backup/restore kanıtı değildir. README, öz-referanslı hash oluşmaması için checkpoint allowlist'inin bilinçli olarak dışındadır; sürümlü `docs/` runbook'ları checkpoint'e dahildir.
- Bağımsız denetim düzeltmeleri sonrası ayrı checkpoint `dist/portal-pusula-source-checkpoint-komut3b-post-audit-fix.zip` yolunda mevcut checkpoint'lere dokunmadan üretildi ve iki okumada byte-identical doğrulandı: 871373 byte, manifest dahil 128 giriş (127 kaynak), açılmış toplam 853095 byte, SHA-256 `fa325ae68b1fcd2b80fbf27c37bfd27fd61067226f4c4c38af1ea9dcdd224599`. Yasak environment/key, build çıktısı, `outputs/` veya `work/` girdisi yoktur.
- Komut 3C yerel operasyonel sertleştirme checkpoint'i `dist/portal-pusula-source-checkpoint-komut3c-local-operational-hardening.zip` yolunda eski üç artefakta dokunmadan üretildi ve iki okumada byte-identical doğrulandı: 992695 byte, manifest dahil 140 giriş (139 kaynak), açılmış toplam 972583 byte, SHA-256 `01d5097d50838a9333449129c63e36933bc51816451d2f379c83f1cff013406e`. Yasak environment/key, build çıktısı, `outputs/` veya `work/` girdisi yoktur.
- Kullanıcı onaylı plan-geneli manuel backup kanıtı sonrası ayrı checkpoint `dist/portal-pusula-source-checkpoint-komut3c-post-manual-backup-evidence.zip` yolunda iki kez aynı üretildi: 140 giriş (139 kaynak), açılmış toplam 973979 byte, SHA-256 `11d065ef1da6bcae425cbf3aa46500c83ba7b09db30039c1a3d2a4cb6ffde084`. Bu checkpoint provider backup dosyası değildir; yalnız secretsız çalışma ağacı ve kanıt runbook'larını kaydeder.
- Son statü tutarlılığı düzeltmeleri önceki immutable checkpoint'e dokunulmadan `dist/portal-pusula-source-checkpoint-komut3c-post-manual-backup-evidence-final.zip` yolunda iki kez byte-identical mühürlendi: 994166 byte, manifest dahil 140 giriş (139 kaynak), açılmış toplam 974054 byte, SHA-256 `7328aec7433644df9ce22f36ea9c6a585469585169de131031a7da5850b3ecce`. Bu checkpoint Hostinger backup/restore artefaktı değildir.
- Bağımsız incelemede bulunan son rollback statü çelişkisi giderildikten sonra güncel başvuru checkpoint'i `dist/portal-pusula-source-checkpoint-komut3c-post-manual-backup-evidence-reviewed.zip` yolunda iki kez byte-identical üretildi: 994229 byte, manifest dahil 140 giriş (139 kaynak), açılmış toplam 974117 byte, SHA-256 `574fc553c50e01f3af2b619844fd18d4e70be21c0e9112995637f2de3f7140f5`. Önceki checkpoint'lerin hiçbiri değiştirilmedi; bu da provider backup/restore artefaktı değildir.
- Readiness-only restore tatbikatı belgeleri ve güncel yerel operasyon masası UI dilimi sonrası yeni immutable checkpoint `dist/portal-pusula-source-checkpoint-komut3c-post-restore-drill-reviewed.zip` yolunda iki kez byte-identical üretildi: 1022607 byte, manifest dahil 140 giriş (139 kaynak), açılmış toplam 1002495 byte, SHA-256 `788a9796164ff2d06f9af56903fc662b4725e263e1c7c6653c4788164db245b0`. Önceki checkpoint'lere dokunulmadı; bu ZIP provider backup/restore artefaktı veya canlı deploy kanıtı değildir.

Planlama kaynakları `outputs/`, canlı spike çalışma paketleri ise `work/` altında kullanıcıya ait içerik olarak korunur.

Komut 0'ın yerel baseline dilimi HAZIR'dır; private remote/branch protection/uzak CI ve canlı staging kanıtları henüz tamamlanmamıştır. Plan-geneli manuel backup kapsamı `PANEL PASS`, readiness-only boş kaynak restore'u ve aynı-makine sınırlı şifreli recovery kopyası `PASS` durumundadır. Yerel dashboard shell, ana navigasyon ve genel bakış ekranının ilk “operasyon masası” tasarım dilimi uygulanmış; secret scan, lint, typecheck, 174 unit/policy, production build, disposable MariaDB paketleri ve masaüstü/mobil 12 E2E testi geçmiştir. Güncel şema/journal/veri restore'u, canlı Hostinger migration/deploy/cron ve güvenli rollback kanıtları tamamlanmadan Dilim 0 GO ve kullanıcı auth'u yoktur. Production write/restore başlatılmamıştır.
