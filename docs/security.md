# Portal Pusula güvenlik sınırı

## Amaç ve güven modeli

Bu belge mevcut platform altyapısının tehdit sınırını kaydeder. Portal Pusula DB tabanlı owner/member hesapları, scrypt parola doğrulama, imzalı 8 saatlik oturum, 37 kodlu allowlist izin defteri ve DB tabanlı kalıcı giriş sınırlaması uygular; ilk owner mevcut environment kimliğinden tek seferlik güvenli geçişle oluşturulabilir. Parola değişikliği veya hesabı devre dışı bırakma kimlik bilgisi sürümünü artırarak eski oturumları geçersiz kılar. Sayfalar proxy/server katmanında, iş API'leri ise yeniden oturum ve izin kontrolüyle korunur. Organization/workspace çoklu-tenant izolasyonu ve parola kurtarma henüz yoktur.

Finansal gizlilik yalnız istemci görünürlüğüne bırakılmaz. Müşteri liste sorgusu izinsiz billing/contact/visit kolonlarını DB seçiminde keser; sözleşme API'si aylık ücret, KDV ve ödeme gününü `contracts.billing.read` olmadan döndürmez; finans modülleri kendi read/write izinlerini ister. Ayrıntı [erişim kontrolü belgesindedir](./access-control.md).

## Yaşam döngüsü ve finansal düzeltme güvenliği

- Müşteri, sözleşme, proje ve görev ana kayıtlarında normal kullanıcı işlemi hard-delete yapmaz. Arşivleme gerekçe, zaman ve aktörle kaydedilir; restore aynı kaydı yeni version ile etkinleştirir. Lifecycle yazmaları ilgili `.lifecycle` iznini ve optimistic version eşleşmesini ister.
- Gider ve alacak düzeltmesi özgün kaydı silmez; kayıt gerekçeli `voided` duruma geçirilir. Tahsilat ile ortaklık katkı tahsilatı düzeltmesi özgün satırı değiştirmez; aynı tutarlı, özgün kayda bağlı ve tekil yeni `reversal` satırı ekler. Reversal forward-only'dir: özgün kayıt başına en fazla bir ters kayıt vardır ve ters kayıt yeniden ters çevrilemez.
- Finansal düzeltmeler modüle özel `.reverse` izni, zorunlu gerekçe, idempotency anahtarı veya optimistic version ve aynı transaction içindeki audit iziyle korunur. Permission veya lifecycle kontrolünün yalnız UI'da bulunması yeterli değildir; API aynı sınırı yeniden uygular.
- Kasa/banka hesap defteri `finance.accounts.read` ve `finance.accounts.write` sınırlarını ayrı uygular. Gelir, gider ve transfer immutable işlem/ledger satırlarıyla kaydedilir; düzeltme özgün satırı silmeden veya yerinde değiştirmeden ileri yönlü ters kayıt üretir. Transferin iki hesabı ve iki ledger tarafı aynı transaction içinde dengelenir.
- Günlük plan görev projeksiyonu `tasks.read`, ziyaret okuması `visits.read` ister. Ziyaret tamamlama sırasında yeni iş maddesi oluşturmak görev yazmasıdır ve ayrıca `tasks.write` olmadan kabul edilmez; yalnız istemcide buton gizlemek yetkilendirme sayılmaz.
- İşlem geçmişi `audit.read` ile birlikte ilgili varlığın okuma iznini ister. Özetler strict alan allowlist'iyle redakte edilir; sözleşme ücret/KDV/ödeme günü `contracts.billing.read` olmadan geçmiş yanıtına da girmez. Parola, token, connection string ve bilinmeyen/nested alanlar audit history yanıtına taşınmaz.

`0014_record_lifecycle` ve `0015_financial_reversals` tarihsel güvenlik temelidir. Güncel change window'un ön kabulü canlı journal'ın exact `0015` seviyesinde olması, ardından araya uygulama deploy edilmeden `0016_finance_accounts_ledger` → `0017_work_task_visit` uygulanmasıdır. Bu politikaların ve [hedefe bağlı runbook'un](./phpmyadmin-finance-calendar-incremental.md) kaynakta bulunması canlı artefakt, import, postflight veya deploy kanıtı değildir; bu kanıtlar alınana kadar canlı durum `UNKNOWN` kalır.

Korunan varlıklar server-side environment secret'ları, DB erişimi, migration bütünlüğü, job/outbox/audit kayıtları, iç endpoint'lerin varlık/çalışma ayrıntıları ve gelecekteki iş verisidir. Hostinger paneli, public internet/CDN, Node runtime, MariaDB, cron scheduler ve geliştirici çalışma alanı ayrı güven sınırlarıdır.

Kanıt belgesinde tutulan geçici `hostingersite.com` URL'si public operasyon endpoint'idir; secret, credential veya Hostinger hesap kimliği değildir. Yalnız HTTPS/SSR/CDN/PWA kanıtını tekrar doğrulama istisnasıdır; hesap sahipliği metadata'sı veya gerçek DB/kullanıcı tanımlayıcısı kaydedilmez.

## Secret ve yapılandırma politikası

Yalnız aşağıdaki environment **adları** geçerli mevcut sözleşmedir:

- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`;
- `READINESS_BEARER_TOKEN`;
- `CRON_ENDPOINT_ENABLED`, `CRON_BEARER_TOKEN`, `CRON_MIN_INTERVAL_SECONDS`;
- isteğe bağlı `LOG_LEVEL`.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`.
- isteğe bağlı `PORTAL_PUSULA_AUTH_STORAGE_MODE`; tanımsızsa ve canlıda `database`, yalnız veritabanısız uyumluluk/E2E koşusunda exact `environment`.

Gerçek değerler repoya, ZIP'e, checkpoint'e, belgeye, sohbete, CLI argümanına, URL'ye, loga, audit payload'ına veya hata metnine yazılmaz. Connection string üretilmez. Readiness ve cron token'ları farklı olmak zorundadır; cron minimum aralığı yalnız canonical `60..86400` saniye olabilir. Environment eksik veya biçim dışıysa davranış fail-closed'dur.

Kimlik depolama modu varsayılan olarak DB tabanlıdır. DB yapılandırması eksik veya erişilemez olduğunda environment kimliğine otomatik geri dönüş yapılmaz. Yalnız açıkça seçilen `environment` modu DB'ye dokunmadan eski v1 oturumunu kullanır; bu modda uygulama içi parola yönetimi kapalıdır ve Hostinger canlı ortamında kullanılmaz.

## Giriş denemesi sınırlaması

Canlı `database` auth yolu her parola doğrulamasını MariaDB'deki `login_attempt_throttle` tablosuyla korur. Zorunlu hesap bucket'ı normalize e-posta başına 15 dakikada 5 başarısız deneme, zorunlu global bucket tüm portal için 15 dakikada 100 başarısız deneme sınırıdır; eşik aşıldığında blok 15 dakika sürer. Sayaçlar DB transaction'ında ve satır kilidiyle güncellendiği için process restart'ı veya birden çok Node örneği korumayı sıfırlamaz. DB saati, kısa sorgu timeout'u ve fail-closed satır/invariant doğrulaması kullanılır; throttle tablosu, pool, transaction veya doğrulama kullanılamazsa parola kontrolüne güvenli biçimde devam edilmez.

Bucket anahtarları `SESSION_SECRET` ile HMAC-SHA-256 üzerinden türetilmiş sabit uzunluklu digest'lerdir; düz e-posta veya ağ kimliği throttle tablosuna yazılmaz. Parola, e-posta/PII, session secret, bucket digest'i, ham DB hatası ve sayaç/blok ayrıntısı response, log, audit veya correlation ID içine girmez. Geçersiz, bloklanmış ve altyapı nedeniyle fail-closed girişler aynı genel hata görünümüne, `303` yönlendirmesine ve `private, no-store` cache politikasına sahiptir.

Opsiyonel network bucket yalnız best-effort ek sinyaldir. Hostinger'ın istemci IP'sini taşıdığı iddia edilen proxy header'ları için resmî bir güven zinciri kanıtlanmadığından uygulama bu header'ları tek başına güvenlik kimliği kabul etmez; network sinyali yokken de hesap ve global bucket'lar zorunlu kalır. İleride network sinyali etkinleştirilirse hesap/global sınırların yerini alamaz ve header spoofing'e karşı sağlayıcı sözleşmesi ayrıca canlı kanıtlanır.

Canlı panelde secret gösteren rollback ekranı daha önce gözlendi; değerler kaydedilmeden ekrandan çıkıldı ve ilgili secret'lar kullanıcı tarafından rotasyonla geçersiz kılındı. `2026-09-04` tarihli manuel ZIP yeniden dağıtım akışındaki ayarlar ekranı da mevcut environment değerlerini maskesiz gösterdi. Değerler belgeye veya repoya alınmadı; yine de model-visible ekranda görünen ilgili secret'lar açığa çıkmış kabul edilir ve kullanıcı tarafından rotasyonla geçersiz kılınmadan güvenlik kabulü kapatılamaz. Güvenli, model-visible olmayan yöntem bulunana kadar rollback ve hPanel ayarlar ekranından manuel yeniden dağıtım `BLOCKED` kalır; Codex yalnız doğrulanmış artefaktı hazırlayıp kullanıcı tarafından model-visible olmayan oturumda yapılan yükleme sonrasını doğrular.

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
- Migration journal sırası ve SHA-256 bütünlüğü her koşuda fail-closed doğrulanır; uygulanan SQL değiştirilmez. Clean kaynak zinciri 18 migration, 18 journal kaydı ve journal dışında 28 uygulama tablosudur.
- Giriş denemesi sınırlaması DB tabanlı hesap/global bucket'larda transaction ve satır kilidi kullanır; limiter erişilemez veya kayıt invariant'ı bozuksa auth fail-closed kalır.
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
- Yazma gövdeleri `Content-Length` ve gerçek UTF-8 byte sayısıyla sınırlanır; chunked istek akış sırasında limit aşımında iptal edilir. Origin, media type ve strict şema kontrolleri limitten sonra da uygulanır.

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
| Güncel migration/ZIP | UNKNOWN | Onaylı change window, backup/restore; exact `0015` → `0016` → `0017` DB-first migration ve smoke kanıtı |
| Plan-geneli backup kapsamı | PANEL PASS | Portal Pusula spike DB özel yedekte doğrulandı; gerçek tanımlayıcılar redakte |
| Boş readiness kaynağının restore doğruluğu | PASS | İkinci disposable hedef; import hatasız, 0 tablo ve journal yok |
| Komut 3C şema/journal/veri restore doğruluğu | UNKNOWN | Toplam yedi tablo (altı teknik + journal), dört journal satırı ve kontrollü veri için ayrı tatbikat |
| Şifreli yerel kopya ve ciphertext checksum | PASS — yerel custody | Aynı makine/kullanıcı bağımlılığını giderecek escrow/off-site prosedürü |
| Secret-safe application rollback | BLOCKED | Secret göstermeyen ayrı staging/geri dönüş prosedürü |
| Manuel dead-letter/requeue ve production adapter | Yok | Ayrı auth, audit, idempotency ve operasyon tasarımı |
| Owner/member hesap ve 37 kodlu modül RBAC | Kaynakta mevcut; canlı UNKNOWN | Tarihsel `0012`/`0014` temeli + `0016`daki iki hesap izni; kullanıcı/alan redaksiyonu smoke ve owner koruma kanıtı |
| Hard-delete'siz lifecycle ve finansal ters kayıt | Kaynakta mevcut; canlı UNKNOWN | Exact `0014`/`0015` tarihsel zinciri ile `0016` hesap-ledger ters kayıtları; final 18 journal, lifecycle/reversal/audit smoke kanıtı |
| Görev–ziyaret ilişkisinde çift modül yetkisi | Kaynakta mevcut; canlı UNKNOWN | `0017` postflight; `tasks.read` projeksiyonu ve iş maddesinde `tasks.write` reddi için canlı smoke kanıtı |
| Organization/workspace izolasyonu | Yok | Çoklu-tenant gereksinimi doğarsa ayrı şema ve tehdit modeli |
| Kalıcı login brute-force/rate limit | Kaynakta DB tabanlı hesap/global sınır mevcut; canlı UNKNOWN | `0013` migration, 5/15 dk hesap ve 100/15 dk global davranışının generic 303/no-store ile canlı smoke kanıtı |

Bu blocker'lar kapanmadan cron etkinleştirilmez, canlı migration/deploy yapılmaz ve gerçek iş verisi alınmaz.

Bu belgenin güncellenmesi canlı migration/deploy kanıtı değildir; Dilim 0 GO verilmemiştir.
