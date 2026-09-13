# Portal Pusula

Portal Pusula; Mühendis Kafası, ByPusula, OptiPusula ve 7 Emlak Ajansı çalışmalarını tek yerde yönetmek için geliştirilen responsive iç operasyon uygulamasıdır. Satış amaçlı bir SaaS arayüzü değil, sahibi ve ileride yetkilendirilecek ekip üyeleri için güvenli bir çalışma masasıdır.

## Kullanılabilir kapsam

Kaynakta çalışan ilk dikey dilim şunları içerir:

- Geist yazı ailesi, koyu lacivert uygulama rayı ve bilgi yoğun çalışma yüzeyleriyle masaüstü/mobil operasyon kabuğu;
- DB tabanlı owner/member hesapları, 8 saatlik imzalı oturum ve modül bazlı izin yönetimi;
- yetkisiz sayfa/API erişiminin engellenmesi ve müşteri iletişim, sözleşme finansı ile finans modüllerinde alan bazlı veri kesme;
- müşteri oluşturma, listeleme ve güncelleme API'leri;
- müşteri listesinde karta girmeden aylık ücret, ödeme günü, sıradaki ziyaret, açık/gecikmiş alacak ve İstanbul iş gününe göre bugünkü ziyaret özeti; izinsiz hesapta hassas alanların DB sorgusundan itibaren çıkarılması;
- Türkçe metni koruyan MySQL/MariaDB müşteri tablosu;
- müşteri yazmalarıyla aynı transaction içinde denetim kaydı;
- müşteri bazlı yıllık danışmanlık sözleşmesi, aylık ücret, KDV biçimi ve ödeme günü kaydı;
- sabit haftalık gün dayatmayan, her ay tarih seçilen ziyaret planı;
- ziyaretin iç saat/süre planı ile tamamlandı, telafi bekliyor ve mutabakatla iptal durumları;
- sözleşme ve ziyaret yazmalarıyla aynı transaction içinde denetim kaydı;
- sözleşme ayından sınır aylarda gün oranlı ve idempotent alacak üretme, geçmiş alacak açılışı ve kısmi tahsilat;
- net/KDV/toplam tutar snapshot'ı, kalan bakiye ve vade durumunun finans ekranında hesaplanması;
- ziyaretlerin günlük, Pazartesi–Pazar haftalık veya aylık raporlandığı; müşteri ve konum tanımıyla filtrelenebildiği; yetkili hesabın müşteri ekranına geçmeden gerçekleşme günü ve notla tamamlayabildiği plan çalışma alanı;
- müşteriyle paylaşım için yalnız seçilen müşterinin planlı/telafi ziyaretlerini içeren, görevleri ve iç saat/süre bilgisini dışarıda bırakan kimlik doğrulamalı takvim/yazdırma dışa aktarımı;
- görev oluşturma, düzenleme, durum ve öncelik takibi yapılan Kanban çalışma alanı;
- Mühendis Kafası, ByPusula, OptiPusula ve 7 Emlak Ajansı için proje portföyü oluşturma ve düzenleme;
- müşterileri bir veya daha fazla projeye bağlama; sözleşme, alacak ve görevlerde yalnız müşterinin aktif proje bağlarını kullanma;
- görevleri projeye bağlama, proje rozetiyle gösterme ve projeye göre filtreleme;
- firma bazlı görev dökümü, tarih/durum filtresi ve Mühendis Kafası logolu tarayıcı yazdırma / “PDF olarak kaydet” görünümü;
- genel veya proje bağlantılı gider oluşturma, düzenleme, iptal etme, manuel gider kategorisi ekleme ve ay/kategori/ödeme yöntemine göre filtreleme;
- kredi kartlarını yalnız tanımlayıcı son dört haneyle izleme, kart harcamasından ekstre ayı/vade tarihli kesin taksit planı üretme, borçları kart bazında toplu görme ve seçili açık taksitleri kontrollü biçimde ödendi işaretleme;
- giderlerde net/KDV/toplam tutar snapshot'ı ile aktif gider, KDV ve kart harcaması özetlerini hesaplama;
- proje bazında tahakkuk, tahsilat, gider, açık/gecikmiş alacak ve vergi öncesi faaliyet farkı raporu;
- finans raporlarında gerçek, planlanan, gecikmiş ve tarihi belirsiz hareketleri ayıran haftalık veya aylık nakit akışı; kart ve ortaklık hareketlerinde çift sayım koruması;
- kasa ve banka hesaplarında açılış bakiyesi, hesap açılış gününden önceye hareket girişini engelleyen gelir/gider/transfer akışı ve silmeden ters kayıt üreten çift taraflı hesap defteri;
- 7 Emlak için satış/kiralama komisyon matrahından katkı biçimine göre otomatik `%10`, `%25` veya `%50` pay; aylık ortak katkısı ve ayrı tahsilat defteri;
- owner tarafından kullanıcı oluşturma, hesabı devre dışı bırakma ve 37 allowlist izni modüler atama;
- müşteri, sözleşme, proje ve görevlerde gerekçeli arşivleme/geri alma; alacak ve giderlerde geçersiz kılma, tahsilat ile ortaklık tahsilatlarında ileri yönlü ters kayıt ve yetkili işlem geçmişi;
- PWA kabuğu, liveness/readiness ve mevcut güvenli platform altyapısı.

`/finans/nakit-akisi` operasyon tahmin raporudur; kasa/banka hesap bakiyeleri ve açılış bakiye çıpası ayrı `/finans/hesaplar` defterinde tutulur. Resmi vergi tahmini ve otomatik aylık üretim sonraki iş dilimleridir. Proje raporundaki faaliyet farkı resmi kâr veya vergi beyanı değildir. Canlı ekranda henüz açılmayan alanlar veri varmış gibi gösterilmez.

## Teknik temel

| Alan | Karar |
|---|---|
| Uygulama | Next.js 16.3 App Router, React 19, TypeScript |
| Runtime | Node.js 24, npm 12 |
| Veritabanı | Hostinger MySQL / MariaDB uyumlu şema, Drizzle migration |
| Dağıtım | Hostinger Business Node.js Web App, webpack production build |
| Mobil kullanım | Responsive web + PWA; mağaza kurulumu zorunlu değil |
| Mimari | Server-side DB erişimli modüler monolit |

Hostinger uyumluluğu için production build `next build --webpack` kullanır. `next.config.mjs`, Node 24 ve npm 12 sözleşmesi korunmalıdır.

## Güvenlik

Ana sayfa ve iş API'leri oturum olmadan kullanılamaz. `owner` tüm izinlere sahiptir; `member` yalnız kendisine atanmış allowlist izinlerini kullanır. Hassas tutarlar yalnız UI'da gizlenmez: müşteri listesi sorgusunda billing kolonları izinsiz hesap için `NULL` projekte edilir, sözleşme yanıtında aylık ücret/KDV/ödeme günü çıkarılır ve finans route'ları ayrı izin ister. Ayrıntı ve bağımlılıklar [erişim kontrolü belgesindedir](docs/access-control.md).

Canlı üretim kimliği yalnız `database` modunda çalışır. Başarısız girişler MariaDB'deki dayanıklı `login_attempt_throttle` defterinde hesap başına 15 dakikada 5 ve portal genelinde 15 dakikada 100 deneme sınırıyla tutulur; süreç yeniden başlasa veya birden fazla Node örneği çalışsa da sayaç kaybolmaz. Opsiyonel ağ sinyali yalnız ek savunmadır: Hostinger proxy/IP header'larının güven zinciri resmî olarak kanıtlanmadığı için hesap ve global sınırların yerine geçmez. Reddedilen, bloklanan veya throttle altyapısı kullanılamayan giriş aynı ayrıntısız `303` + `private, no-store` akışına döner; altyapı arızasında doğrulama fail-closed kalır. Parola, e-posta/PII, secret veya bucket digest'i loglanmaz.

Parolalar düz metin saklanmaz. İlk owner hesabını bootstrap etmek veya yalnız açık `environment` uyumluluk modunu hazırlamak için etkileşimli üretici yerel terminalde çalıştırılır:

```bash
npm run auth:generate
```

Komut parolayı gizli girişle alır; `scrypt:32768:8:1:<salt>:<key>` biçiminde `ADMIN_PASSWORD_HASH` ve tam 16 ASCII alfanümerik karakterlik `SESSION_SECRET` üretir. Normal canlı kullanım `database` modudur; ilk owner güvenli geçişten sonra `user_account` içinde tutulur, ek hesaplar `/kullanicilar` ekranından oluşturulur. Gerçek e-posta, hash, secret, DB parolası ve bearer token yalnız `.env.local` veya Hostinger environment alanında tutulur; repoya, ZIP'e, loga, belgeye ya da sohbete yazılmaz.

Gerekli environment adları:

| Değişken | Kullanım |
|---|---|
| `DB_HOST` | Boşsa `localhost` |
| `DB_PORT` | Boşsa `3306` |
| `DB_NAME` | MySQL veritabanı adı |
| `DB_USER` | MySQL kullanıcısı |
| `DB_PASSWORD` | MySQL parolası |
| `READINESS_BEARER_TOKEN` | Tam 16 ASCII alfanümerik readiness anahtarı |
| `ADMIN_EMAIL` | Yönetici giriş e-postası |
| `ADMIN_PASSWORD_HASH` | `auth:generate` çıktısı |
| `SESSION_SECRET` | `auth:generate` çıktısı; tam 16 ASCII alfanümerik |
| `PORTAL_PUSULA_AUTH_STORAGE_MODE` | İsteğe bağlı; varsayılan ve canlı değer `database`. `environment` yalnız veritabanısız uyumluluk/E2E koşuları içindir ve parola yönetimini kapatır. |
| `LOG_LEVEL` | İsteğe bağlı; varsayılan `info` |
| `CRON_ENDPOINT_ENABLED`, `CRON_BEARER_TOKEN`, `CRON_MIN_INTERVAL_SECONDS` | Günlük e-posta tetikleyicisi; bearer token readiness token'dan farklıdır |
| `EMAIL_NOTIFICATIONS_ENABLED` | E-posta gönderimini yalnız exact `true` ile açar |
| `RESEND_API_KEY` | Resend API anahtarı; yalnız server environment içinde tutulur |
| `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | Doğrulanmış gönderen adresi ve isteğe bağlı görünen adı |

E-posta bildirimleri varsayılan kapalıdır. Etkin olduğunda yeni gider kaydı aktif owner hesaplarına dayanıklı outbox üzerinden bildirilir; her gün 09.00'da (Europe/Istanbul) planlı ziyaretler, tamamlanmamış günlük işler ve vadesi gelmiş açık alacak/ödemeler için tek özet hazırlanır. Finans bölümleri yalnız finans raporu erişimi olan alıcılara eklenir; günlük çalışma veya açık finans kalemi yoksa özet gönderilmez. GitHub Actions 09.00 günlük tetikleyicisine ek olarak kuyruğu her saatin 10. dakikasında güvenli biçimde boşaltır. Çağrılar yalnız bearer header kullanır; tekrarlar DB ve Resend idempotency anahtarlarıyla etkisizleştirilir.

## Migration sırası

- `0000_platform_migration_verification.sql`
- `0001_platform_job_outbox_audit.sql`
- `0002_platform_state_constraints.sql`
- `0003_platform_cron_dispatch_gate.sql`
- `0004_customer.sql`
- `0005_consulting_contract_visits.sql`
- `0006_receivables.sql`
- `0007_user_account.sql`
- `0008_work_tasks.sql`
- `0009_projects.sql`
- `0010_expenses_cards.sql`
- `0011_customer_projects_partnership.sql`
- `0012_user_permissions.sql`
- `0013_login_attempt_throttle.sql`
- `0014_record_lifecycle.sql`
- `0015_financial_reversals.sql`
- `0016_finance_accounts_ledger.sql`
- `0017_work_task_visit.sql`
- `0018_planning_expense_categories.sql`

Uygulanmış migration dosyası değiştirilmez; her düzeltme yeni ileri yönlü migration olur. `0011_customer_projects_partnership.sql` müşteri–proje ilişkisi ile ortaklık finans defterini, `0012_user_permissions.sql` `user_account` owner/member alanları ile ilk izin defterini, `0013_login_attempt_throttle.sql` DB tabanlı kalıcı giriş sınırlamasını ekler. `0014_record_lifecycle.sql` kendi dönemindeki allowlist'i 35 izin koduna genişletir ve müşteri/sözleşme/proje/görev kayıtlarına gerekçeli arşivleme, aktör, zaman ve optimistic version alanlarını ekler. `0015_financial_reversals.sql` alacak geçersiz kılma ile tahsilat/ortaklık tahsilatı ters kayıtlarını forward-only biçimde kurar. `0016_finance_accounts_ledger.sql` kasa/banka hesapları ile gelir, gider, transfer ve ters kayıtların ledger temelini kurup güncel allowlist'i 37 koda çıkarır. `0017_work_task_visit.sql` ziyaret sırasında tamamlanan iş maddelerini göreve bağlayan kısıtlı ilişki tablosunu ekler. `0018_planning_expense_categories.sql` ziyaretlere konum tanımı ekler ve eski gider kategori kodlarını koruyarak manuel kategoriler için referans tablosu/FK sözleşmesini kurar. Kullanıcı tarafından oluşturulan ana kayıtlar hard-delete edilmez; düzeltmeler arşiv, void veya yeni ters kayıtla izlenir. Clean veritabanında zincir 19 migration (`0000`–`0018`), 19 journal kaydı, journal dışında 29 uygulama tablosu ve journal ile toplam 30 fiziksel tablodur.

Journal'ı bulunan mevcut Hostinger hedefinde clean-only paket tekrar yüklenmez. Daha eski hedefler korunmuş incremental runbook zinciriyle önce exact `0017_work_task_visit` seviyesine getirilir. Güncel canlı değişiklik penceresinin ön kabulü exact 18 journal kaydı ve son kayıt `0017_work_task_visit` olmasıdır; ardından uygulama deploy edilmeden DB-first yalnız `0018_planning_expense_categories` uygulanır. Hedefe bağlı paket ve kontrol sözleşmesi [0018 planlama/gider kategorileri incremental runbook'unda](docs/phpmyadmin-planning-expense-categories-incremental.md) tanımlıdır. Kaynakta paket üretilebilmesi veya bu belgenin güncel olması, canlı artefakt/import/postflight kanıtı değildir.

## Yerel geliştirme

```bash
npm ci
npm run dev
```

Kalite ve üretim komutları:

```bash
npm run typecheck
npm test
npm run build
npm run package:hostinger
```

Geniş gerçek-MariaDB ve E2E paketleri gerektiğinde ayrıca çalıştırılır; günlük geliştirmede önce görünür iş sonucu, ardından değişen kritik sınır için hedefli kontrol esastır.

## Hostinger paketi

```bash
npm run package:hostinger
```

Çıktı: `dist/portal-pusula-hostinger.zip`. Paket kökünde `package.json` bulunur; testler, yerel secret dosyaları, `.next`, `node_modules`, çalışma çıktıları ve Git verisi pakete girmez.

Canlı kabul sırası:

1. Proje dalının kalite kapılarını ve PR CI sonucunu doğrula; otomatik Hostinger dağıtımını tetikleyebilecek `main` birleştirmesini henüz yapma.
2. Canlı veritabanının güncel yedeğini doğrula, ayrı disposable hedefte restore kanıtını tamamla ve uygulama yazmalarını dondur. Bu pencerenin ön kabulü journal'ın exact 18 kayıtla `0017_work_task_visit` seviyesinde olmasıdır; farklı durumda dur ve hedefi korunmuş tarihsel runbook zinciriyle exact `0017`ye getirmeden ilerleme.
3. [0018 incremental runbook'unu](docs/phpmyadmin-planning-expense-categories-incremental.md) izleyerek canlı DB/server digest'lerine bağlı paket ve manifesti onayla. `0018_planning_expense_categories` paketini yalnız bir kez uygula; exact başarıdan sonra final 19 journal kaydını, 29 uygulama tablosunu, kategori referans/FK bütünlüğünü ve ziyaret konum alanını salt okunur doğrula. Exact başarı sonucu yoksa aynı paketi yeniden çalıştırma.
4. PR'ı `main` dalına birleştir; bağlı Git dağıtımını bekle veya aynı kaynakla yeniden üretilmiş güncel ZIP'i dağıt ve build'in `Akım` olmasını bekle.
5. `/giris`, `/kullanicilar`, doğru müşteri özeti/alan redaksiyonu, görev panosu ve `/gorevler/rapor` yazdırma önizlemesi, kart bazlı borçlar, manuel gider kategorileri, `/finans/hesaplar`, haftalık/aylık `/finans/nakit-akisi`, müşteri/konum filtreli plan ve güvenli müşteri takvim dışa aktarımını; ayrıca 360/390/430 px mobil menü ve takvim/tablo davranışını doğrula. Sonra yazma dondurmasını kaldır.
6. Sorun çıkarsa yalnız ilgili sınırda hedefli test ve log incelemesi yap; migration başarı satırı yoksa aynı paketi yeniden çalıştırma.

Bu hazırlık ve yerel kanıtlar tek başına canlı kabul veya Dilim 0 GO değildir.

## Belgeler

- [Teknik mimari](docs/architecture.md)
- [Güvenlik sınırı](docs/security.md)
- [Rol ve alan bazlı erişim kontrolü](docs/access-control.md)
- [Migration runbook'u](docs/migrations.md)
- [Hostinger deploy runbook'u](docs/hostinger-deploy.md)
- [0013 giriş sınırlama incremental runbook'u](docs/phpmyadmin-login-throttle-incremental.md)
- [0014/0015 yaşam döngüsü ve ters kayıt incremental runbook'u](docs/phpmyadmin-lifecycle-reversals-incremental.md)
- [0016/0017 finans hesabı ve görev–ziyaret incremental runbook'u](docs/phpmyadmin-finance-calendar-incremental.md)
- [0018 planlama ve gider kategorileri incremental runbook'u](docs/phpmyadmin-planning-expense-categories-incremental.md)
- [Backup/restore runbook'u](docs/backup-restore.md)

Public kaynak deposu: [arslanturkmustafa-sudo/portal-pusula](https://github.com/arslanturkmustafa-sudo/portal-pusula)
