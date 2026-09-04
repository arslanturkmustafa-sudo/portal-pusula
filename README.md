# Portal Pusula

Portal Pusula; Mühendis Kafası, ByPusula, OptiPusula ve 7 Emlak Ajansı çalışmalarını tek yerde yönetmek için geliştirilen responsive iç operasyon uygulamasıdır. Satış amaçlı bir SaaS arayüzü değil, sahibi ve ileride yetkilendirilecek ekip üyeleri için güvenli bir çalışma masasıdır.

## Kullanılabilir kapsam

Kaynakta çalışan ilk dikey dilim şunları içerir:

- Geist yazı ailesi, koyu lacivert uygulama rayı ve bilgi yoğun çalışma yüzeyleriyle masaüstü/mobil operasyon kabuğu;
- DB tabanlı owner/member hesapları, 8 saatlik imzalı oturum ve modül bazlı izin yönetimi;
- yetkisiz sayfa/API erişiminin engellenmesi ve müşteri iletişim, sözleşme finansı ile finans modüllerinde alan bazlı veri kesme;
- müşteri oluşturma, listeleme ve güncelleme API'leri;
- müşteri listesinde karta girmeden aylık ücret, ödeme günü ve sıradaki ziyaret özeti; izinsiz hesapta bu alanların DB sorgusundan itibaren çıkarılması;
- Türkçe metni koruyan MySQL/MariaDB müşteri tablosu;
- müşteri yazmalarıyla aynı transaction içinde denetim kaydı;
- müşteri bazlı yıllık danışmanlık sözleşmesi, aylık ücret, KDV biçimi ve ödeme günü kaydı;
- sabit haftalık gün dayatmayan, her ay tarih seçilen ziyaret planı;
- ziyaretin iç saat/süre planı ile tamamlandı, telafi bekliyor ve mutabakatla iptal durumları;
- sözleşme ve ziyaret yazmalarıyla aynı transaction içinde denetim kaydı;
- sözleşme ayından sınır aylarda gün oranlı ve idempotent alacak üretme, geçmiş alacak açılışı ve kısmi tahsilat;
- net/KDV/toplam tutar snapshot'ı, kalan bakiye ve vade durumunun finans ekranında hesaplanması;
- günlük ziyaret ve toplantıların tek akışta görüldüğü günlük plan;
- görev oluşturma, düzenleme, durum ve öncelik takibi yapılan Kanban çalışma alanı;
- Mühendis Kafası, ByPusula, OptiPusula ve 7 Emlak Ajansı için proje portföyü oluşturma ve düzenleme;
- müşterileri bir veya daha fazla projeye bağlama; sözleşme, alacak ve görevlerde yalnız müşterinin aktif proje bağlarını kullanma;
- görevleri projeye bağlama, proje rozetiyle gösterme ve projeye göre filtreleme;
- firma bazlı görev dökümü, tarih/durum filtresi ve Mühendis Kafası logolu tarayıcı yazdırma / “PDF olarak kaydet” görünümü;
- genel veya proje bağlantılı gider oluşturma, düzenleme, iptal etme ve ay/kategori/ödeme yöntemine göre filtreleme;
- kredi kartlarını yalnız tanımlayıcı son dört haneyle izleme, kart harcamasından ekstre ayı/vade tarihli kesin taksit planı üretme ve taksit ödeme durumunu yönetme;
- giderlerde net/KDV/toplam tutar snapshot'ı ile aktif gider, KDV ve kart harcaması özetlerini hesaplama;
- proje bazında tahakkuk, tahsilat, gider, açık/gecikmiş alacak ve vergi öncesi faaliyet farkı raporu;
- finans raporlarında gerçek, planlanan, gecikmiş ve tarihi belirsiz hareketleri ayıran aylık nakit akışı; kart ve ortaklık hareketlerinde çift sayım koruması;
- 7 Emlak için satış/kiralama komisyon matrahından katkı biçimine göre otomatik `%10`, `%25` veya `%50` pay; aylık ortak katkısı ve ayrı tahsilat defteri;
- owner tarafından kullanıcı oluşturma, hesabı devre dışı bırakma ve 35 allowlist izni modüler atama;
- müşteri, sözleşme, proje ve görevlerde gerekçeli arşivleme/geri alma; alacak ve giderlerde geçersiz kılma, tahsilat ile ortaklık tahsilatlarında ileri yönlü ters kayıt ve yetkili işlem geçmişi;
- PWA kabuğu, liveness/readiness ve mevcut güvenli platform altyapısı.

Nakit akışı bir banka/kasa ekstresi değildir: şemada açılış bakiye çıpası bulunmadığı için açılış/kapanış bakiyesi üretilmez. Resmi vergi tahmini ve otomatik aylık üretim sonraki iş dilimleridir. Proje raporundaki faaliyet farkı resmi kâr veya vergi beyanı değildir. Canlı ekranda henüz açılmayan alanlar veri varmış gibi gösterilmez.

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

Cron değişkenleri kaynakta varsayılan kapalı altyapı adayıdır; gerçek iş ve scheduler hazır olmadan Hostinger'da etkinleştirilmez.

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

Uygulanmış migration dosyası değiştirilmez; her düzeltme yeni ileri yönlü migration olur. `0011_customer_projects_partnership.sql` müşteri–proje ilişkisi ile ortaklık finans defterini, `0012_user_permissions.sql` `user_account` owner/member alanları ile ilk izin defterini, `0013_login_attempt_throttle.sql` DB tabanlı kalıcı giriş sınırlamasını ekler. `0014_record_lifecycle.sql` güncel allowlist'i 35 izin koduna genişletir ve müşteri/sözleşme/proje/görev kayıtlarına gerekçeli arşivleme, aktör, zaman ve optimistic version alanlarını ekler. `0015_financial_reversals.sql` alacak geçersiz kılma ile tahsilat/ortaklık tahsilatı ters kayıtlarını forward-only biçimde kurar. Kullanıcı tarafından oluşturulan ana kayıtlar hard-delete edilmez; düzeltmeler arşiv, void veya yeni ters kayıtla izlenir. Clean veritabanında zincir 16 migration (`0000`–`0015`) ve 16 journal kaydıdır.

Journal'ı bulunan mevcut Hostinger hedefinde clean-only paket tekrar yüklenmez. `0011`–`0013` için ilgili incremental runbook'lar korunur. Canlı journal son kaydı `0013_login_attempt_throttle` ise yeni uygulama dağıtılmadan önce DB-first sıra zorunlu olarak `0014_record_lifecycle` → `0015_financial_reversals` olmalıdır. İki yeni adımın hedefe bağlı paket üretim ve kontrol sözleşmesi [0014/0015 incremental runbook'unda](docs/phpmyadmin-lifecycle-reversals-incremental.md) tanımlıdır; artefaktlar canlı DB/server digest'lerine bağlanmadan kaynak SQL doğrudan canlıya uygulanmaz ve bu belge canlı başarı kanıtı sayılmaz.

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
2. Canlı veritabanının güncel yedeğini doğrula ve uygulama yazmalarını dondur. Bu değişiklik penceresinin ön kabulü journal'ın 14 kayıtla exact `0013_login_attempt_throttle` seviyesinde olmasıdır; daha eski hedef önce kendi mevcut incremental runbook'larıyla `0013` seviyesine getirilmeden ilerlemez.
3. [0014/0015 incremental runbook'unu](docs/phpmyadmin-lifecycle-reversals-incremental.md) izleyerek hedefe bağlı iki exact paket ve manifesti üretip onayla; araya uygulama deploy etmeden DB-first `0014_record_lifecycle` → `0015_financial_reversals` sırasını uygula. `0014` sonrasında 15 journal kaydı ile 35 izin kodu/lifecycle constraint'lerini; `0015` sonrasında 16 journal kaydı ile void/reversal FK, unique ve CHECK sözleşmelerini salt okunur doğrula. Exact başarı sonucu yoksa aynı paketi yeniden çalıştırma. Paketlerin kaynakta üretilebilir olması canlıda üretildiği veya uygulandığı anlamına gelmez.
4. PR'ı `main` dalına birleştir; bağlı Git dağıtımını bekle veya aynı kaynakla yeniden üretilmiş güncel ZIP'i dağıt ve build'in `Akım` olmasını bekle.
5. `/giris`, `/kullanicilar`, müşteri alan redaksiyonu, görev panosu ve `/gorevler/rapor` yazdırma önizlemesi, `/finans/nakit-akisi` ile diğer finans ekranlarını; ayrıca 360/390/430 px mobil menü ve tablo kartlaşmasını doğrula. Sonra yazma dondurmasını kaldır.
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
- [Backup/restore runbook'u](docs/backup-restore.md)

Public kaynak deposu: [arslanturkmustafa-sudo/portal-pusula](https://github.com/arslanturkmustafa-sudo/portal-pusula)
