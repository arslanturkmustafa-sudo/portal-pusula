# Portal Pusula teknik mimarisi — Komut 3C sınırı

## Durum ve kapsam

Portal Pusula, Hostinger Business Node.js Web App üzerinde çalışmak üzere tasarlanan Next.js App Router tabanlı bir modüler monolittir. Bu belge Komut 3C sonunda yerelde bulunan platform temelini tarif eder; güncel kaynak/ZIP'in Hostinger'a dağıtıldığı, migration'ların canlı DB'ye uygulandığı veya cron'un canlı etkinleştirildiği anlamına gelmez.

Mevcut kapsam şunlarla sınırlıdır:

- public liveness, bearer korumalı readiness ve güvenli PWA kabuğu;
- migration runner ve Drizzle/MariaDB platform şeması;
- kısa ve bounded job, transactional outbox ve uygulama katmanı audit temeli;
- varsayılan kapalı, machine-to-machine cron dispatch adayı;
- deterministik production ZIP ve secretsız kaynak checkpoint'i.

Müşteri, proje, görev, finans, takvim, kullanıcı/auth, organization/workspace ve RBAC domain'leri henüz yoktur. Production job registry ile dış sistem adapter registry'si boştur. Komut 4/auth ve arayüz yeniden tasarımı bu belgenin kapsamı dışındadır.

## Çalışma zamanı ve dağıtım sınırı

Araç zinciri [ADR-0003](./adr/0003-node24-npm12-hostinger-webpack.md) ile bağlıdır:

- Node.js `>=24 <25`, npm `>=12 <13`;
- Next.js 16.3.x ve React 19.2.x;
- `next.config.mjs`;
- `next build --webpack` ve Hostinger tarafından yönetilen `next start`/port;
- kökünde `package.json` olan deterministik ZIP, çıktı dizini `.next`.

Node 24.x ve webpack yolu önceki canlı spike'ta kanıtlandı. Güncel Komut 3C ZIP deploy'u ile canlı migration `UNKNOWN`; secret-safe gerçek rollback ise `BLOCKED` durumundadır.

## Modüller ve bağımlılık yönü

| Katman | Mevcut sorumluluk | Yasaklanan bağımlılık/varsayım |
| --- | --- | --- |
| `src/app` ve `src/components` | Next route handler'ları, PWA shell'i ve iç endpoint adaptörleri | Route içinde iş kuralı, raw SQL, secret veya uzun iş yürütme |
| `src/platform/config` | Server-only environment parse ve fail-closed sözleşmeler | Client bundle'a env/secret taşıma; connection string |
| `src/platform/health` ve `database` | Liveness/readiness sınırı, sabit `SELECT 1`, küçük havuz ve timeout | Kullanıcı girdisinden SQL/identifier; ayrıntılı DB hatası |
| `src/platform/cron` | Exact request doğrulaması, iç yanıt politikası, bounded dispatch ve eşzamanlılık/frekans kapıları | Query/path/body token, sürekli worker, process-içi güvenilir scheduler varsayımı |
| `src/platform/jobs`, `outbox`, `audit` | Claim/lease/fencing, retry/dead-letter, transaction ve at-least-once teslim sözleşmesi | Exactly-once iddiası, transaction içinden dış servis çağrısı, keyfi job type çalıştırma |
| `src/platform/db/schema` ve `drizzle` | Sürümlü platform şeması ve forward-only migration | Domain/auth tablosu; uygulanmış migration'ı değiştirme; destructive DDL |
| `scripts` | Migration, paketleme, yerel test ve güvenli operasyon yardımcıları | Secret'ı CLI argümanı/log/dosyaya alma; canlı işlemi kullanıcı onayı olmadan başlatma |

Bağımlılık akışı giriş adaptöründen platform uygulama servisine, oradan repository/DB adaptörüne doğrudur. Repository ve platform servisleri React bileşenlerine veya Next request nesnelerine bağımlı olmaz. Dış sistem çağrısı gerektiğinde domain transaction'ı önce outbox kaydını commit eder; gerçek adapter daha sonra idempotent teslim yapar.

## HTTP sınırları

| Sınır | Sözleşme | Mevcut durum |
| --- | --- | --- |
| `GET /api/health/live` | DB'ye dokunmadan minimal `200 {"status":"ok"}` | Önceki canlı spike'ta PASS |
| `GET /api/internal/readiness` | Exact Bearer; yetkisiz generic 404, DB hazır 200, altyapı sorunu generic 503 | Önceki canlı spike'ta gerçek `SELECT 1` PASS |
| `POST /api/internal/cron/dispatch` | Exact Bearer; kapalı/yetkisiz generic 404; güvenli kabul veya suppression generic 202; altyapı arızası generic 503 | Yalnız yerel aday, varsayılan kapalı; canlı cron UNKNOWN |
| `GET /sw.js` | Node Route Handler, JS MIME, `private, no-store`, scope `/` | Önceki canlı spike'ta PASS |

Machine-to-machine response davranışı [ADR-0002](./adr/0002-internal-endpoint-response-policy.md) ile bağlıdır. Bu politika gelecekteki kullanıcı auth/UI semantiği değildir.

## Veri ve iş yürütme modeli

Migration'lar yalnız teknik doğrulama ile platform job/outbox/audit nesnelerini oluşturur. Gerçek müşteri/finans/domain verisi yoktur. Para hassasiyeti için sentetik `DECIMAL(19,4)` doğrulaması yapılır; JavaScript `number` dönüşümü kullanılmaz. Operasyon zamanları UTC, kimlik ve idempotency alanları binary-exact/canonical sözleşmelidir.

Job yürütme kısa ve tekrar çalıştırılabilir batch'lere ayrılır:

1. Dispatch çağrısı exact auth ve configuration kontrolünden geçer.
2. Dayanıklı frekans/eşzamanlılık kapıları uygun değilse çağrı iç ayrıntı vermeden güvenli no-op kabul edilir.
3. Uygun iş DB transaction'ında claim edilir; lease token conditional update için fencing değeridir.
4. Handler sonucu, audit append'i, outbox insert'i ve finalize aynı transaction sınırında tamamlanır.
5. Dış etki transaction sonrasında outbox adapter'ıyla at-least-once teslim edilir; hedef idempotent olmalıdır.

Sabit process belleği, `setInterval`, `node-cron`, Redis veya sürekli worker varsayılmaz. Advisory lock ve dayanıklı DB kapısı satır lease/fencing'in yerine geçmez.

## Güvenlik ve operasyonel sınırlar

- Secret değerleri yalnız server-side environment'ta tutulur; adlar [security runbook'unda](./security.md) kayıtlıdır.
- Dynamic/internal yanıtlar `private, no-store` ve correlation ID taşır; cache ve PWA allowlist'i iş/auth verisini saklamaz.
- Production ZIP ve kaynak checkpoint sabit allowlist ile oluşturulur; test/build çıktısı ve secret-benzeri dosya yolları dışlanır veya fail-closed reddedilir.
- Migration forward-only'dir. Uygulama rollback'i ile DB restore aynı işlem değildir.
- Boş readiness backup'ının ayrı hedef restore'u ve yerel şifreli recovery kopyası kanıtlanmıştır; bu, Komut 3C şema/journal/veri restore kapısını karşılamaz. Güncel şema restore'u ile rollback kanıtı [backup/restore runbook'unda](./backup-restore.md) tamamlanmadan canlı migration/deploy yapılmaz.

## Kanıt matrisi

| Alan | Yerel | Canlı Hostinger |
| --- | --- | --- |
| Node 24.x, webpack build, ZIP deploy, liveness/readiness/PWA | Güncel kapılar çalıştırılır | Önceki spike PASS |
| Güncel migration ve platform job/outbox/audit | Disposable MariaDB PASS | UNKNOWN — uygulanmadı |
| Cron exact method/header, suppression, overlap ve frekans | Unit/non-DB ve disposable MariaDB PASS | UNKNOWN — cron oluşturulmadı |
| Güncel production ZIP deploy | Deterministik üretim kapısı | UNKNOWN — dağıtılmadı |
| Plan-geneli backup kapsamı | Runbook + panel özel yedek kaydı | PANEL PASS |
| Boş readiness kaynağının ayrı hedef restore'u | Secretsız olay/runbook kaydı | PASS — disposable hedef |
| Yerel şifreli recovery kopyası ve ciphertext checksum | AES-256-GCM/ayrı DPAPI anahtarı | PASS — aynı Windows makinesi/kullanıcı sınırıyla |
| Komut 3C şema/journal/veri restore'u | Runbook mevcut | UNKNOWN |
| Güvenli application rollback | Tasarım sınırı mevcut | BLOCKED |
| Kullanıcı auth/RBAC ve domain izolasyonu | Yok | Yok |

Komut 4 / auth için henüz HAZIR DEĞİL; Dilim 0 GO değildir.
