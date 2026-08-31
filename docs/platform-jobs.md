# Platform job/outbox/audit ve cron runbook'u — Komut 3C

Bu runbook yalnız Portal Pusula'nın platform iş yürütme temelini tanımlar. Gerçek müşteri, finans, görev, kullanıcı/auth, workspace/organization veya RBAC akışı içermez. Komut 3C, Komut 3B temeline yalnız DB'de kalıcı cross-process cron frekans kapısı ve bağlayıcı iç endpoint yanıt politikasını ekler. Bu turda canlı Hostinger environment değişikliği, migration, deploy, cron kurulumu, backup ya da restore çalıştırılmamıştır.

## Kalıcılık sınırları

| Tablo | Sorumluluğu | Bilinçli sınırı |
| --- | --- | --- |
| `scheduled_job` | Sürümlü JSON payload'a sahip işleri, uygunluk zamanını, deneme sayısını, durumunu ve lease/fencing alanlarını tutar. `(job_type, idempotency_key)` DB seviyesinde unique'tir. | Domain kaydı veya gerçek müşteri/finans verisinin kaynak tablosu değildir. Payload SQL/identifier seçemez. |
| `job_run` | Her iş denemesinin correlation ID, lease, başlangıç/bitiş, güvenli sonuç ve hata kodunu saklar. `(job_id, attempt_no)` unique'tir ve iş silme/güncelleme FK'de `RESTRICT`tir. | Operasyon geçmişidir; audit kaydının veya logun yerine geçmez. Uygulama sözleşmesinde geçmiş denemeler değiştirilmez. |
| `outbox_event` | Transaction ile oluşan, sürümlü payload taşıyan ve idempotent adapter tarafından teslim edilecek dayanıklı olayları tutar. `idempotency_key` DB seviyesinde unique'tir. | Message broker veya exactly-once teslim garantisi değildir. Bu dilimde production adapter yoktur. |
| `audit_event` | Aktör, eylem, varlık, kontrollü önce/sonra özeti, correlation ID ve UTC zamanı olan platform audit olaylarını ekler. | Compliance ledger değildir; append-only kuralı şimdilik uygulama katmanı sözleşmesidir. |
| `cron_dispatch_gate` | Sabit bir gate key için son izin verilen UTC dispatch zamanını DB transaction'ında tutar; process ve restart'lar arasında minimum aralığı zorlar. | Scheduler değildir, iş sonucu tutmaz ve job/outbox lease/fencing'in yerine geçmez. |

Komut 3B'nin dört tablosu InnoDB/`utf8mb4` migration'ında tanımlıdır. İleri yönlü `0002_platform_state_constraints.sql`, tablo veya kolon eklemeden durum/lease/attempt/outcome/actor ve canonical kimlik sözleşmelerini named `CHECK` constraint'leriyle sıkılaştırır. Komut 3C'nin ileri yönlü `0003_platform_cron_dispatch_gate.sql` migration'ı yalnız `cron_dispatch_gate` teknik tablosunu ekler. Kimlik, idempotency, lease ve gate key alanlarında binary-exact ASCII karşılaştırma kullanılır; tüm operasyon zamanları UTC'dir.

Uygulama katmanı `maxAttempts` değerini yalnız exact integer `1..65535` aralığında kabul eder; DB de `max_attempts >= 1` ve `attempt_count <= max_attempts` koşullarını zorlar. İş/olay/idempotency/correlation/worker anahtarları boş olmayan, boşluk içermeyen yazdırılabilir ASCII olmalıdır. Opsiyonel kimlikler canonical lower-case UUID olmalıdır; uppercase, bozuk, sonuna karakter eklenmiş veya Unicode biçimler hem uygulamada hem DB'de fail-closed reddedilir.

## Claim, lease ve fencing sözleşmesi

Bir job claim kısa bir `READ COMMITTED` DB transaction'ında yapılır:

1. Uygun `pending`/retry işi veya lease süresi dolmuş işi `SELECT ... FOR UPDATE` ile kilitle.
2. Yeni, öngörülemez bir `lease_token`, worker kimliği ve kısa `lease_expires_at_utc` üret.
3. Claim'i, okunan durum/lease koşullarını da `WHERE` bölümünde taşıyan conditional `UPDATE` ile yaz.
4. Yalnız `affectedRows === 1` ise claim sahibini kabul et; `0` ise yarış kaybedilmiş/stale sonuçtur ve handler çalıştırılmaz.
5. Transaction'ı hızla commit et; sıra kilidini handler süresince açık tutma.

Ready/reclaim satırları önce, exhausted-expired sweep en son alınarak lock sırası kararlı tutulur. MariaDB yine deadlock kurbanı seçerse yalnız claim transaction'ı baştan, en fazla üç kez denenir; son sonuç ham DB metni içermeyen generic bir hatadır. Handler veya dış etki transaction'ı otomatik tekrar edilmez. Aynı kurallar outbox claim için de geçerlidir.

Süresi dolmuş lease son izinli denemeyi tüketmişse iş doğrudan ve geçmişsiz biçimde dead-letter yapılmaz. Aynı transaction içinde önce tam olarak o `job_id` + `attempt_no` + `lease_token` ile eşleşen açık `job_run`, `lease_expired` sonucu ve completion zamanı ile kapatılır; ardından aynı fenced iş satırı dead-letter yapılır. Eşleşen tek açık run yoksa veya iki güncellemeden biri tam bir satırı etkilemezse transaction rollback olur ve durum fail-closed korunur.

Tamamlama, retry ve dead-letter güncellemeleri de iş kimliği + aktif durum + aynı `lease_token` ile fence edilir ve yine tam bir affected-row sonucu ister. Lease dolduktan sonra başka worker aynı satırı yeni token ile geri alabilir; eski worker'ın geç tamamlaması `affectedRows === 0` ile reddedilir. Unique lease token constraint'i ek DB korumasıdır; tek başına conditional update'in yerini almaz.

## Retry, dead-letter ve bounded catch-up

- Handler hatası ham exception veya payload yerine allowlist'teki güvenli hata koduna çevrilir.
- `attempt_count < max_attempts` iken iş exponential backoff ile yeniden uygun hale gelir. Mevcut varsayılan 1 saniyeden başlar ve 60 saniyede sınırlandırılır.
- Son izinli deneme de başarısızsa durum `dead_letter` olur; otomatik sonsuz retry yapılmaz.
- Her deneme ayrı `job_run` kaydı üretir. Attempt numarası DB unique constraint'iyle korunur.
- Her dispatch en fazla 10 işi alır ve toplam 4 saniyelik deadline'a uyar. Kuyruk boşalana kadar sınırsız `while` veya tek çağrıda sınırsız catch-up yoktur.
- Kaçırılmış periyotlar, her mantıksal zaman dilimi için kararlı bir idempotency key üretilerek küçük batch'ler halinde yeniden kuyruğa alınır. Aynı dilimin tekrar planlanması DB unique constraint'i tarafından reddedilir.
- Retry ve catch-up nedeniyle handler idempotent olmak zorundadır. Domain handler'ları bu dilimde kayıtlı değildir.

Dead-letter kaydını elle yeniden kuyruğa alma aracı henüz yoktur. Gelecekteki requeue işlemi ayrı yetki, yeni idempotency kararı ve audit kaydı gerektirir; doğrudan SQL ile durum değiştirmek operasyon prosedürü değildir.

## Transaction ve kontrollü rollback

Başarılı iş tamamlama sözleşmesinde aşağıdakiler aynı DB bağlantısı ve aynı transaction içinde yapılır:

1. handler'ın kalıcı DB yazıları;
2. `audit_event` append'i;
3. `outbox_event` insert'i;
4. fenced `scheduled_job` finalize güncellemesi ve `job_run` sonucu.

Her adımın affected-row/constraint sonucu doğrulanır. Finalize öncesi veya sırasında kontrollü hata enjekte edildiğinde transaction bütünüyle rollback olur; yarım audit, outbox ya da başarılı job sonucu kalmaz. Daha önce commit edilmiş claim satırı lease dolana kadar `running` kalabilir ve sonra expired-reclaim yoluyla güvenle alınır. Transaction içinden doğrudan dış servise çağrı yapılmaz; dış etki commit'ten sonra outbox adapter'ına bırakılır.

Entegrasyon testlerindeki doğrulama handler'ı yalnız bu atomiklik, başarı ve kontrollü rollback davranışını kanıtlamak içindir. `productionJobRegistry` bilinçli olarak boştur. Production'da kayıtlı olmayan `job_type` keyfi kod/SQL çalıştırmaz; güvenli `handler_not_registered` sonucu üzerinden bounded retry/dead-letter politikasına girerek fail-closed kalır.

## Audit append-only sınırı

Uygulama yalnız `appendAuditEvent` insert API'sini sunar; audit update/delete repository'si yoktur. Audit özetleri serileştirilebilir ve hassas veri içermeyen kontrollü alanlarla sınırlı olmalıdır. Raw payload, parola, token, Authorization, connection string veya DB hata metni audit'e/loga konmaz.

DB trigger'ı bilinçli olarak eklenmemiştir: Hostinger hesabında trigger oluşturma ve işletme privilege'ı canlı kanıtlanmadı. Bu nedenle DB sahibi ayrı bir istemci teknik olarak update/delete yapabilir; append-only şu aşamada uygulama sözleşmesidir ve olduğundan güçlü bir garanti olarak raporlanmaz. Trigger ancak privilege, migration ve restore davranışı ayrı canlı olmayan provada kanıtlandıktan sonra değerlendirilebilir.

## Outbox teslim sözleşmesi

Outbox at-least-once çalışır. Adapter bir olayı lease/fencing ile claim eder, dış hedefe iletir ve ardından aynı lease token ile `delivered` olarak finalize eder. Dış hedef ile DB arasında ortak transaction bulunmadığı için şu crash window kaçınılmazdır:

1. dış hedef olayı kabul eder;
2. worker, `delivered` DB commit'inden önce durur;
3. lease süresi dolar ve olay yeniden teslim edilir.

Bu yüzden her production adapter, outbox `id`/`idempotency_key` değerini hedefe taşımalı ve hedef tarafında tekrar teslimi etkisiz hale getirmelidir. Lease veya retry exactly-once sağlamaz. Bu dilimde gerçek dış sistem adapter'ı, bağlantısı veya credential'ı yoktur.

## Varsayılan kapalı cron adayı

Yerel aday sınır `/api/internal/cron/dispatch` sözleşmesini kullanır; canlı route/Hostinger cron kurulumu olarak kabul edilmez.

- Yalnız exact `POST /api/internal/cron/dispatch` kabul edilir; query/hash, body ve cookie bulunamaz. Taşınan payload/metadata reddedilir.
- Yetki yalnız exact `Authorization: Bearer <CRON_BEARER_TOKEN>` header'ıdır; query, path, cookie veya body içindeki değer kabul edilmez.
- `CRON_ENDPOINT_ENABLED` eksik/boş/`false` iken özellik kapalıdır ve generic 404 verir. Etkinleştirme için ayrı cron token gerekir; readiness token ile aynı değer fail-closed'dur.
- Etkin adayda `CRON_MIN_INTERVAL_SECONDS` canonical decimal tam sayı olarak zorunludur; yalnız `60..86400` aralığı kabul edilir. Leading zero, işaret, ondalık/exponent, whitespace, tab ve Unicode rakamlar fail-closed reddedilir. Devre dışıyken token ve interval canlı davranışa dönüştürülmez.
- Yanlış yöntem, kapalı özellik veya yetkisiz istek generic 404; geçersiz yapılandırma/gate/DB/dispatch hatası generic 503; dispatch izni veya güvenli suppression aynı generic 202 verir. Yanıtlar `private, no-store` ve correlation ID taşır. İlk plandaki `401` kararı [ADR-0002](./adr/0002-internal-endpoint-response-policy.md) ile geçersiz kılınmıştır.
- Dispatch batch limiti 10, deadline 4 saniyedir. Deadline dolunca çağrı iptal sinyali alır; endpoint uzun süreli worker değildir.
- Dispatch başlamadan DB advisory lock alınır; lock alınamazsa aynı anda ikinci dispatcher çalışmaz. Lock aynı bağlantıda tutulur ve `finally` yolunda bırakılır/bağlantı kapanışıyla düşürülür. Advisory lock, satır lease/fencing kontrollerinin yerine geçmez.

## Dayanıklı frekans kapısı ve suppression

Process-içi/in-memory rate limiter kullanılmaz. `cron_dispatch_gate` satırı aynı DB'yi kullanan Node process'leri ve restart'lar arasında kalıcıdır:

1. Exact auth ve enabled/config kontrolünden sonra sabit `platform-cron-dispatch` gate key'i `SELECT ... FOR UPDATE` ile transaction içinde okunur.
2. İlk çağrı satırı oluşturup aynı transaction'da readback doğrulamasıyla permit alır. Eşzamanlı genesis unique yarışında kaybeden yalnız bir kez yeniden okur ve minimum aralık içinde `suppressed` kalır.
3. Son izin zamanından `CRON_MIN_INTERVAL_SECONDS` geçmemişse transaction veri değiştirmeden `suppressed` sonucu verir. Aralık dolduysa `last_permitted_at_utc` ve `updated_at_utc` aynı UTC değere exact önceki değerlerle fenced/conditional update edilir; tam bir affected-row sonucu zorunludur.
4. Gelecekte/bozuk zaman, beklenmeyen veya write sonrası kayıp satır, geçersiz outcome ya da DB/constraint/query hatası generic gate hatasına çevrilir ve HTTP sınırında generic 503 olur.
5. Permit alındıktan sonra advisory lock ve bounded dispatch çalışır. Gate aralığı ardışık çağrıları, advisory lock eşzamanlı çağrıları, job/outbox lease ise tekil kaydı korur; hiçbiri diğerinin yerine geçmez.

Yetkili bir suppression ve izin verilen dispatch dışarıdan aynı `202 {"status":"accepted"}` olarak görünür. Yanıt gate zamanı, lock durumu, iş sayısı veya suppression nedenini açıklamaz. `202`, işlerin tamamlandığı garantisi değildir. Permit sonrasında lock/dispatch arızası oluşabilir; gerçek hata generic 503 olur ve otomatik tekrar kararı dış scheduler'ın canlıda ayrıca kanıtlanacak davranışına bağlıdır.

Canlı cron etkinleştirmeden önce aşağıdakilerin her biri blocker'dır ve ayrıca kanıtlanmalıdır:

- yerelde tasarlanan dayanıklı DB frekans kapısının Hostinger MariaDB üzerinde migration, transaction, saat ve yük davranışının kanıtlanması;
- Hostinger cron'un exact `POST`, custom `Authorization` header'ı ve secret saklama yeteneklerinin gerçek panelde doğrulanması;
- Portal Pusula için güvenli çağrı sıklığının belirlenmesi; bu aralığın batch/deadline, bounded catch-up ve DB kapasitesiyle birlikte yük testinde doğrulanması;
- cron token üretme, devreye alma, rotasyon, iptal ve hata halinde geri dönüş prosedürünün değer açığa çıkarmadan prova edilmesi.

Bu blocker'lar kapanmadan endpoint canlıda etkinleştirilmez, cron tanımlanmaz ve token değeri hiçbir doküman, CLI argümanı, log veya sohbete yazılmaz. UI, auth, GET fallback, tokenlı URL veya public tetikleme eklenmez; canlı Hostinger environment/deploy değişikliği yapılmaz.

## Yerel doğrulama ve production kapısı

Disposable gerçek MariaDB doğrulaması canlı bilgi istemeden çalışır:

```bash
npm run test:mariadb
```

Unit/policy kapıları ayrıca `npm test`, `npm run lint` ve `npm run typecheck` ile çalıştırılır. Bu testler; claim yarışını, stale token fencing'i, expired reclaim'i, retry/dead-letter'ı, bounded batch'i, aynı transaction başarı/rollback'ini, audit append-only API yüzeyini, outbox crash-window/idempotency sözleşmesini, cron fail-closed sınırını ve aynı generic 202 ile suppression davranışını kanıtlamalıdır. Gerçek MariaDB kapısı `0003` şeması ile permit/suppression/concurrency/time-regression/rollback davranışını da kapsamalıdır. Test-only handler ve yerel test credential'ları production registry/runtime'a taşınmaz.

Production'a geçmeden önce [migration runbook'undaki](./migrations.md) ve [backup/restore runbook'undaki](./backup-restore.md) tüm kapılar uygulanır. Özellikle doğrulanmış backup + ayrı hedefte restore kanıtı, migration/hash incelemesi ve geri dönüş penceresi zorunludur. Mimari ve tehdit sınırı [architecture.md](./architecture.md) ile [security.md](./security.md) içinde kayıtlıdır. Manuel rollback/requeue prosedürü, gerçek adapter davranışı ve Hostinger cron yetenekleri hâlâ açıktır; bunlar PASS sayılmaz.

Komut 4 / auth için henüz HAZIR DEĞİL; Dilim 0 GO değildir.
