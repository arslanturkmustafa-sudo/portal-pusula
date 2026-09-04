# Portal Pusula erişim kontrolü

Portal Pusula iki hesap rolü ve exact 35 kodlu izin allowlist'i kullanır: `owner` tüm izinlere sahiptir ve kullanıcı hesaplarını yönetir; `member` yalnız `user_permission` tablosunda kendisine atanmış izinleri kullanır. Hesabın devre dışı bırakılması veya parola değişikliği `credential_version` değerini artırır; eski imzalı oturumlar yeniden DB doğrulamasında geçersiz olur.

## Güvenlik sınırı

- Sayfa görünürlüğü tek güvenlik katmanı değildir. Her iş API'si oturumu ve ilgili izin kodunu server tarafında yeniden doğrular.
- Müşteri iletişim, ziyaret ve sözleşme finansı ayrı okunur. `customers.read` tek başına telefon/e-posta, ziyaret tarihi veya aylık ücret döndürmez.
- Müşteri liste sorgusu izinsiz alanları DB seçimi sırasında `NULL` projekte eder ve gereksiz billing/ziyaret join'lerini kurmaz.
- `contracts.read` sözleşmenin firma, proje, dönem, durum ve iç not alanlarını; `contracts.billing.read` ayrıca aylık ücret, para birimi, KDV ve ödeme gününü açar.
- Sözleşme create/update isteği bütün koşul belgesini taşıdığı için hem `contracts.write` hem `contracts.billing.write` ister.
- Finans alacak, gider, kart, ortaklık ve rapor route'ları kendi read/write izinleriyle korunur. Nakit akışı `finance.reports.read`, firma görev raporu `tasks.reports.export` ister.
- Arşivleme/restore normal yazmadan ayrıdır: müşteri, sözleşme, proje ve görev için ilgili `.lifecycle` izni gerekir. Ana kayıt hard-delete edilmez; gerekçe ve version API'de doğrulanır.
- Alacak/gider void ile tahsilat/ortaklık tahsilatı ters kaydı normal finans yazmasından ayrıdır ve ilgili `.reverse` iznini ister. Özgün finans kaydı silinmez; düzeltme forward-only void veya yeni reversal satırı olarak kaydedilir.
- İşlem geçmişi için `audit.read` tek başına yeterli değildir; kullanıcı ayrıca ilgili müşteri/sözleşme/proje/görev/finans varlığının okuma iznine sahip olmalıdır. Finansal alanlar geçmiş yanıtında da alan bazlı redaksiyona tabidir.
- Göreve kullanıcı atamak veya atamayı kaldırmak, normal görev yazma iznine ek olarak `tasks.assign` ister.
- Owner hesabı API üzerinden devre dışı bırakılamaz; kullanıcı yönetimi yalnız DB tabanlı hesap oturumunda ve `accounts.manage` ile açıktır.

İzin bağımlılıkları kullanıcı kaydında fail-closed doğrulanır. Yazma izni ilgili okuma iznini; lifecycle izni ilgili read+write çiftini; finansal reversal izni ilgili finance read+write çiftini; finansal sözleşme izni temel sözleşme iznini; görev atama izni görev yazma ve okuma izinlerini gerektirir. UI seçici bu bağımlılıkları transitif olarak ekler, API ise eksik kombinasyonu reddeder. `audit.read` atanabilir; ancak her audit isteğinde varlığın modül okuma izni ayrıca kontrol edilir.

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
| Ortaklık | `finance.partnership.read` | `finance.partnership.write`, `finance.partnership.reverse` |
| Finans raporları | `finance.reports.read`, `finance.reports.export` | — |
| Denetim geçmişi | `audit.read` + ilgili varlığın okuma izni | — |

Tablodaki kodların toplamı exact 35'tir. `accounts.manage` owner yönetim sınırıdır ve member oluşturma formunda atanabilir iş izni değildir.

## Hesap operasyonu

1. İlk owner, yalnız bootstrap sırasında environment kimliğinden DB'ye geçirilir. Normal canlı mod `PORTAL_PUSULA_AUTH_STORAGE_MODE=database` değeridir.
2. Owner `/kullanicilar` ekranında ad, e-posta, ilk parola ve izinleri belirleyerek member oluşturur. Parola veya hash API yanıtına, loga ve audit özetine girmez.
3. Kullanıcıya yalnız işini yapması için gereken en dar izin seti verilir. Finans izinleri varsayılan seçilmez.
4. Ayrılan kullanıcı `disabled` yapılır. Bu değişiklik mevcut oturumu credential version ile keser; kullanıcı satırı ve audit ilişkisi silinmez.

## Açık operasyon riski

İstek gövdeleri declared ve gerçek byte sınırıyla stream okunurken kesilir; Origin, content type ve strict şema kontrolleri uygulanır. Kaynakta çoklu Node/process için MariaDB tabanlı account/global login sınırlaması vardır; bunun canlı davranışı `0013` migration ve generic yanıt smoke'u ile ayrıca kanıtlanmalıdır. Hostinger/hCDN istemci IP güven zinciri kanıtlanmadığından opsiyonel network sinyali hesap/global sınırların yerine geçmez. Yanıtlar kullanıcı varlığını ayırt etmeyen tek hata biçiminde kalır ve scrypt doğrulaması kullanılır.

Bu belge kaynak davranışını tarif eder. Clean zincir 16 migration/16 journal kaydıdır; mevcut canlı hedef exact `0013` seviyesindeyse DB-first `0014_record_lifecycle` ve ardından `0015_financial_reversals` gerekir. İki adım için hedefe bağlı paket üretim/kontrol runbook'u kaynakta bulunsa da canlı artefaktlar henüz üretilip uygulanmadığından bu belge, migration'ların canlı DB'ye uygulandığı veya yeni build'in dağıtıldığı anlamına gelmez.
