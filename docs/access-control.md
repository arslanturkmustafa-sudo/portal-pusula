# Portal Pusula erişim kontrolü

Portal Pusula iki hesap rolü ve exact 37 kodlu izin allowlist'i kullanır: `owner` tüm izinlere sahiptir ve kullanıcı hesaplarını yönetir; `member` yalnız `user_permission` tablosunda kendisine atanmış izinleri kullanır. Hesabın devre dışı bırakılması veya parola değişikliği `credential_version` değerini artırır; eski imzalı oturumlar yeniden DB doğrulamasında geçersiz olur.

## Güvenlik sınırı

- Sayfa görünürlüğü tek güvenlik katmanı değildir. Her iş API'si oturumu ve ilgili izin kodunu server tarafında yeniden doğrular.
- Müşteri iletişim, ziyaret ve sözleşme finansı ayrı okunur. `customers.read` tek başına telefon/e-posta, ziyaret tarihi veya aylık ücret döndürmez.
- Müşteri liste sorgusu izinsiz alanları DB seçimi sırasında `NULL` projekte eder ve gereksiz billing/ziyaret join'lerini kurmaz.
- `contracts.read` sözleşmenin firma, proje, dönem, durum ve iç not alanlarını; `contracts.billing.read` ayrıca aylık ücret, para birimi, KDV ve ödeme gününü açar.
- Sözleşme create/update isteği bütün koşul belgesini taşıdığı için hem `contracts.write` hem `contracts.billing.write` ister.
- Finans alacak, gider, kart, kasa/banka hesabı, ortaklık ve rapor route'ları kendi read/write izinleriyle korunur. Nakit akışı `finance.reports.read`, hesap bakiyesi/defteri `finance.accounts.read`, hesap ve işlem yazmaları `finance.accounts.write`, firma görev raporu `tasks.reports.export` ister.
- Arşivleme/restore normal yazmadan ayrıdır: müşteri, sözleşme, proje ve görev için ilgili `.lifecycle` izni gerekir. Ana kayıt hard-delete edilmez; gerekçe ve version API'de doğrulanır.
- Alacak/gider void ile tahsilat/ortaklık tahsilatı ters kaydı normal finans yazmasından ayrıdır ve ilgili `.reverse` iznini ister. Özgün finans kaydı silinmez; düzeltme forward-only void veya yeni reversal satırı olarak kaydedilir.
- İşlem geçmişi için `audit.read` tek başına yeterli değildir; kullanıcı ayrıca ilgili müşteri/sözleşme/proje/görev/finans varlığının okuma iznine sahip olmalıdır. Finansal alanlar geçmiş yanıtında da alan bazlı redaksiyona tabidir.
- Göreve kullanıcı atamak veya atamayı kaldırmak, normal görev yazma iznine ek olarak `tasks.assign` ister.
- Günlük plan ziyaretleri `visits.read`, takvim kabuğu `daily-plan.read`, takvimdeki firma görevleri ayrıca `tasks.read` ister. Ziyaret tamamlama içindeki yeni iş maddeleri görev oluşturduğu için `visits.write` ile birlikte `tasks.write` olmadan kabul edilmez.
- Owner hesabı API üzerinden devre dışı bırakılamaz; kullanıcı yönetimi yalnız DB tabanlı hesap oturumunda ve `accounts.manage` ile açıktır.

İzin bağımlılıkları kullanıcı kaydında fail-closed doğrulanır. Yazma izni ilgili okuma iznini; lifecycle izni ilgili read+write çiftini; finansal reversal izni ilgili finance read+write çiftini; `finance.accounts.write` izni `finance.accounts.read` iznini; finansal sözleşme izni temel sözleşme iznini; görev atama izni görev yazma ve okuma izinlerini gerektirir. UI seçici bu bağımlılıkları transitif olarak ekler, API ise eksik kombinasyonu reddeder. `audit.read` atanabilir; ancak her audit isteğinde varlığın modül okuma izni ayrıca kontrol edilir.

## İzin grupları

| Alan | Okuma / dışa aktarma | Yazma / yönetim |
| --- | --- | --- |
| Hesaplar | — | `accounts.manage` |
| Müşteriler | `customers.read`, `customers.contact.read` | `customers.write`, `customers.lifecycle` |
| Sözleşmeler | `contracts.read`, `contracts.billing.read` | `contracts.write`, `contracts.billing.write`, `contracts.lifecycle` |
| Ziyaret / günlük plan | `visits.read`, `daily-plan.read` | `visits.write` |
| Projeler | `projects.read` | `projects.write`, `projects.lifecycle` |
| Görevler | `tasks.read`, `tasks.reports.export` | `tasks.write`, `tasks.assign`, `tasks.lifecycle` |
| Alacaklar | `finance.receivables.read` | `finance.receivables.write`, `finance.receivables.reverse` |
| Giderler | `finance.expenses.read` | `finance.expenses.write`, `finance.expenses.reverse` |
| Kartlar | `finance.cards.read` | `finance.cards.write` |
| Kasa/banka hesapları | `finance.accounts.read` | `finance.accounts.write` |
| Ortaklık | `finance.partnership.read` | `finance.partnership.write`, `finance.partnership.reverse` |
| Finans raporları | `finance.reports.read`, `finance.reports.export` | — |
| Denetim geçmişi | `audit.read` + ilgili varlığın okuma izni | — |

Tablodaki kodların toplamı exact 37'dir. `accounts.manage` owner yönetim sınırıdır ve member oluşturma formunda atanabilir iş izni değildir.

## Hesap operasyonu

1. İlk owner, yalnız bootstrap sırasında environment kimliğinden DB'ye geçirilir. Normal canlı mod `PORTAL_PUSULA_AUTH_STORAGE_MODE=database` değeridir.
2. Owner `/kullanicilar` ekranında ad, e-posta, ilk parola ve izinleri belirleyerek member oluşturur. Parola veya hash API yanıtına, loga ve audit özetine girmez.
3. Kullanıcıya yalnız işini yapması için gereken en dar izin seti verilir. Finans izinleri varsayılan seçilmez.
4. Ayrılan kullanıcı `disabled` yapılır. Bu değişiklik mevcut oturumu credential version ile keser; kullanıcı satırı ve audit ilişkisi silinmez.

## Açık operasyon riski

İstek gövdeleri declared ve gerçek byte sınırıyla stream okunurken kesilir; Origin, content type ve strict şema kontrolleri uygulanır. Kaynakta çoklu Node/process için MariaDB tabanlı account/global login sınırlaması vardır; bunun canlı davranışı `0013` migration ve generic yanıt smoke'u ile ayrıca kanıtlanmalıdır. Hostinger/hCDN istemci IP güven zinciri kanıtlanmadığından opsiyonel network sinyali hesap/global sınırların yerine geçmez. Yanıtlar kullanıcı varlığını ayırt etmeyen tek hata biçiminde kalır ve scrypt doğrulaması kullanılır.

Bu belge kaynak davranışını tarif eder. Clean zincir 18 migration, 18 journal kaydı ve journal dışında 28 uygulama tablosudur. Güncel canlı change window'un ön kabulü exact `0015_financial_reversals` seviyesidir; ardından araya uygulama deploy edilmeden DB-first `0016_finance_accounts_ledger` ve `0017_work_task_visit` gerekir. [Hedefe bağlı iki paketli runbook](./phpmyadmin-finance-calendar-incremental.md) kaynakta bulunsa da bu, artefaktların canlı hedef için üretildiği, import edildiği, postflight'ın geçtiği veya yeni build'in dağıtıldığı anlamına gelmez.
