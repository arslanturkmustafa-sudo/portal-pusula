# Portal Pusula güvenlik sınırı — Komut 3C

## Amaç ve güven modeli

Bu belge mevcut platform altyapısının tehdit sınırını kaydeder. Portal Pusula henüz kullanıcı auth, session, organization/workspace veya RBAC uygulamaz; dolayısıyla bu alanlarda güvenlik garantisi vermez. Geçici Hostinger uygulaması internete açıktır fakat gerçek müşteri/finans verisi ve production domain'i içermez.

Korunan varlıklar server-side environment secret'ları, DB erişimi, migration bütünlüğü, job/outbox/audit kayıtları, iç endpoint'lerin varlık/çalışma ayrıntıları ve gelecekteki iş verisidir. Hostinger paneli, public internet/CDN, Node runtime, MariaDB, cron scheduler ve geliştirici çalışma alanı ayrı güven sınırlarıdır.

Kanıt belgesinde tutulan geçici `hostingersite.com` URL'si public operasyon endpoint'idir; secret, credential veya Hostinger hesap kimliği değildir. Yalnız HTTPS/SSR/CDN/PWA kanıtını tekrar doğrulama istisnasıdır; hesap sahipliği metadata'sı veya gerçek DB/kullanıcı tanımlayıcısı kaydedilmez.

## Secret ve yapılandırma politikası

Yalnız aşağıdaki environment **adları** geçerli mevcut sözleşmedir:

- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`;
- `READINESS_BEARER_TOKEN`;
- `CRON_ENDPOINT_ENABLED`, `CRON_BEARER_TOKEN`, `CRON_MIN_INTERVAL_SECONDS`;
- isteğe bağlı `LOG_LEVEL`.

Gerçek değerler repoya, ZIP'e, checkpoint'e, belgeye, sohbete, CLI argümanına, URL'ye, loga, audit payload'ına veya hata metnine yazılmaz. Connection string üretilmez. Readiness ve cron token'ları farklı olmak zorundadır; cron minimum aralığı yalnız canonical `60..86400` saniye olabilir. Environment eksik veya biçim dışıysa davranış fail-closed'dur.

Canlı panelde secret gösteren rollback ekranı daha önce gözlendi; değerler kaydedilmeden ekrandan çıkıldı ve ilgili secret'lar kullanıcı tarafından rotasyonla geçersiz kılındı. Güvenli, model-visible olmayan yöntem bulunana kadar bu ekran yeniden açılmaz ve canlı rollback `BLOCKED` kalır.

## İç endpoint politikası

[ADR-0002](./adr/0002-internal-endpoint-response-policy.md) bağlayıcıdır:

- eksik/yanlış auth, kapalı özellik ve yanlış method generic 404;
- exact Bearer yalnız `Authorization` header'ında;
- yetkili cron dispatch veya dayanıklı suppression aynı generic 202;
- gerçek DB/config/dispatch arızası generic 503;
- yanıtlar `private, no-store`, minimal JSON ve correlation ID;
- auth şeması, queue depth, lock/rate durumu, zaman, DB adı ve ham hata açığa çıkmaz.

İlk plandaki cron `401` kararı bu machine-to-machine sınır için geçersizdir. Bu seçim gelecekteki kullanıcı auth/UI için emsal değildir.

Token karşılaştırması exact sözleşme ve sabit uzunluklu digest üzerinde timing-safe yapılır. Cron request'i exact `POST /api/internal/cron/dispatch` olmalı; query/hash, body ve cookie tümüyle reddedilir. Token query string, path, body veya cookie'ye düşürülmez. `CRON_MIN_INTERVAL_SECONDS` leading zero, işaret, ondalık/exponent, whitespace veya Unicode rakam kabul etmez. Hostinger cron'un exact `POST` ve özel header desteği canlı kanıtlanamazsa endpoint açılmaz; URL'ye secret eklemek fallback değildir.

## DB, migration ve iş motoru kontrolleri

- Readiness SQL'i sabit `SELECT 1`'dir; kullanıcı girdisi SQL veya identifier belirlemez.
- Bağlantı havuzları küçüktür; queue, connect/query ve toplam deadline sınırları vardır.
- Migration journal sırası ve SHA-256 bütünlüğü her koşuda fail-closed doğrulanır; uygulanan SQL değiştirilmez.
- Migration ve cron advisory lock adları DB adını açığa çıkarmayan hash'ten türetilir.
- Job claim/finalize conditional update, affected-row kontrolü ve lease-token fencing kullanır.
- Job type ve payload sürümlüdür; kayıtlı olmayan handler keyfi kod veya SQL çalıştırmaz.
- Audit yalnız uygulama API'sinde append edilir. DB trigger privilege'ı canlı kanıtlanmadığı için bu, değiştirilemez compliance ledger garantisi değildir.
- Outbox at-least-once'dur; exactly-once iddiası yoktur. Production adapter ve hedef tarafı idempotency henüz yoktur.

Canlı DB kullanıcısının least-privilege yetkileri, trigger desteği, migration lock süresi ve `CHECK` enforcement'ı güncel şema üzerinde Hostinger'da kanıtlanmamıştır.

## Log, hata ve gözlemlenebilirlik

Logger redaction politikası parola, readiness/cron token'ı, Authorization/cookie, connection string ve yaygın nested varyantları sansürler. Ham exception veya DB mesajı istemciye dönmez; job/audit kayıtları yalnız allowlist güvenli hata kodu taşır.

Correlation ID iz sürme içindir; secret veya güvenlik kararı içermez. Canlı log retention süresi ve Komut 3C paketi için kapsamlı sızıntı taraması henüz `UNKNOWN`dur. Generic response suppression'ın operasyon ayrıntısı için güvenli bir ayrı gözlem kanalı tasarlanmıştır diye varsayılmaz.

## Paket, cache ve istemci sınırı

- Hostinger production ZIP'i sabit dosya/dizin allowlist'idir. Beklenmeyen production yolu fail-closed; test/local script exact exclude edilir.
- Herhangi bir nested `.env*`, private key, token/auth/credential benzeri kapsayıcı veya sembolik bağlantı paketi durdurur.
- Kaynak checkpoint'i `outputs/`, `work/`, build/test çıktısı, environment ve secret-benzeri yolları kapsamaz.
- Internal/dynamic yanıtlar cache'lenmez. Service worker yalnız sürümlü offline HTML ve ikon allowlist'ini saklar; API, auth veya iş verisi cache'lemez.
- Client bundle'a server environment, DB kodu veya secret taşınmaz.

## Backup custody sınırı

- Doğru readiness backup kopyası `PPBK1` envelope içinde AES-256-GCM ile korunur; 583 byte ciphertext için SHA-256 `83df1d5353615b339274f8f17910a8b0a3569709bd2f2a61cb4bb241fa5d15c1` doğrulanmıştır. Plaintext hash'i belgeye alınmaz.
- Anahtar ciphertext'ten ayrı, ACL ile kısıtlı bir anahtar dizinindedir. Windows DPAPI kapsamı `LocalMachine`; dosya ACL'si yalnız hedef Windows kullanıcı SID'si ile `SYSTEM` erişimine izin verir. Bu model `CurrentUser` DPAPI değildir.
- DPAPI açma, AES-GCM authentication, kaynak hash eşleşmesi ve tam decrypt roundtrip `PASS` olmuştur. Restore plaintext'i ve geçici restore dizini exact-target cleanup ile silinmiştir.
- DPAPI/ACL modeli aynı Windows makinesi ve yetkili hedef kullanıcı bağlamına bağımlıdır; taşınabilir/off-site recovery garantisi değildir. Makine kaybı için ayrı anahtar escrow/rotasyon ve restore prosedürü hâlâ gerekir.
- Sağlayıcı indirmesinin kısa süre `Downloads` alanına düşmesi kaydedilmiş bir custody sapmasıdır; hash doğrulamasından sonra exact kopya silinmiştir. Yanlış kaynak artefaktı mantıksal karantinadadır ve anahtarı ayrı anahtar dizinindedir.

## Açık tehditler ve blocker'lar

| Risk | Durum | Canlıya geçiş koşulu |
| --- | --- | --- |
| Hostinger cron method/header/secret saklama yeteneği | UNKNOWN | Secretsız canlı yetenek deneyi ve exact header kanıtı |
| Scheduler retry/overlap/timezone ve güvenli çağrı sıklığı | UNKNOWN | Kontrollü canlı ölçüm; dayanıklı kapı davranışıyla birlikte değerlendirme |
| Güncel migration/ZIP | UNKNOWN | Onaylı change window, backup/restore, migration ve smoke kanıtı |
| Plan-geneli backup kapsamı | PANEL PASS | Portal Pusula spike DB özel yedekte doğrulandı; gerçek tanımlayıcılar redakte |
| Boş readiness kaynağının restore doğruluğu | PASS | İkinci disposable hedef; import hatasız, 0 tablo ve journal yok |
| Komut 3C şema/journal/veri restore doğruluğu | UNKNOWN | Toplam yedi tablo (altı teknik + journal), dört journal satırı ve kontrollü veri için ayrı tatbikat |
| Şifreli yerel kopya ve ciphertext checksum | PASS — yerel custody | Aynı makine/kullanıcı bağımlılığını giderecek escrow/off-site prosedürü |
| Secret-safe application rollback | BLOCKED | Secret göstermeyen ayrı staging/geri dönüş prosedürü |
| Manuel dead-letter/requeue ve production adapter | Yok | Ayrı auth, audit, idempotency ve operasyon tasarımı |
| Kullanıcı auth/RBAC/organization izolasyonu | Yok | Komut 4 ve sonraki domain dilimleri |

Bu blocker'lar kapanmadan cron etkinleştirilmez, canlı migration/deploy yapılmaz ve gerçek iş verisi alınmaz.

Komut 4 / auth için henüz HAZIR DEĞİL; Dilim 0 GO değildir.
