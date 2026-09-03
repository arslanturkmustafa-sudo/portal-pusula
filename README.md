# Portal Pusula

Portal Pusula; Mühendis Kafası, ByPusula, OptiPusula ve 7 Emlak Ajansı çalışmalarını tek yerde yönetmek için geliştirilen responsive iç operasyon uygulamasıdır. Satış amaçlı bir SaaS arayüzü değil, sahibi ve ileride yetkilendirilecek ekip üyeleri için güvenli bir çalışma masasıdır.

## Kullanılabilir kapsam

Kaynakta çalışan ilk dikey dilim şunları içerir:

- masaüstü ve mobil tarayıcıya uyumlu “müşteri kayıt defteri” arayüzü;
- güvenli yönetici girişi ve 8 saatlik imzalı oturum;
- yetkisiz sayfa ve müşteri API erişiminin engellenmesi;
- müşteri oluşturma, listeleme ve güncelleme API'leri;
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
- görevleri projeye bağlama, proje rozetiyle gösterme ve projeye göre filtreleme;
- PWA kabuğu, liveness/readiness ve mevcut güvenli platform altyapısı.

Gider/kart, vergi tahmini ve otomatik aylık üretim sıradaki iş dilimleridir. Canlı ekranda henüz açılmayan alanlar veri varmış gibi gösterilmez.

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

Ana sayfa ve iş API'leri oturum olmadan kullanılamaz. Production'da auth değişkenlerinden biri eksik veya geçersizse sistem fail-closed davranır ve giriş vermez.

Yönetici parolası düz metin saklanmaz. Etkileşimli üretici yerel terminalde çalıştırılır:

```bash
npm run auth:generate
```

Komut parolayı gizli girişle alır; Hostinger ortam değişkenlerinde güvenle taşınan `scrypt:32768:8:1:<salt>:<key>` biçiminde `ADMIN_PASSWORD_HASH` ve tam 16 ASCII alfanümerik karakterlik `SESSION_SECRET` üretir. Eski `$` ayraçlı scrypt kayıtları yalnız geriye uyumluluk için okunur; yeni veya yenilenen hash'ler üreticiyle oluşturulmalıdır. Gerçek e-posta, hash, secret, DB parolası ve bearer token yalnız `.env.local` veya Hostinger environment alanında tutulur; repoya, ZIP'e, loga, belgeye ya da sohbete yazılmaz.

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

Uygulanmış migration dosyası değiştirilmez; her düzeltme yeni ileri yönlü migration olur. `0004_customer.sql` müşteri tablosunu, `0005_consulting_contract_visits.sql` sözleşme ve aylık ziyaret tablolarını, `0006_receivables.sql` alacak ve tahsilat tablolarını, `0007_user_account.sql` uygulama içinden parola yönetilebilen yönetici hesabını, `0008_work_tasks.sql` Kanban görevlerini, `0009_projects.sql` ise proje portföyü ile görev-proje bağını ekler. Mevcut Hostinger veritabanına clean-only phpMyAdmin paketi tekrar yüklenmez; journal'ı bulunan ve SSH/npm erişimi olmayan hedefte [seçili incremental phpMyAdmin paketi](docs/phpmyadmin-incremental-migration.md) yalnız sıradaki migration'ı uygular.

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
2. Canlı veritabanının güncel yedeğini doğrula; ardından yalnız `0009_projects` için üretilen hedefe bağlı incremental phpMyAdmin paketini bir kez uygula.
3. Exact `PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK` / `0009_projects` sonucunu, on journal satırını ve iki yeni tabloyu salt okunur doğrula.
4. PR'ı `main` dalına birleştir; bağlı Git dağıtımını bekle veya aynı kaynakla yeniden üretilmiş güncel ZIP'i dağıt ve build'in `Akım` olmasını bekle.
5. `/giris`, müşteri/sözleşme düzenleme, `/projeler` ve görev-proje seçme/filtreleme akışlarını doğrula.
6. Sorun çıkarsa yalnız ilgili sınırda hedefli test ve log incelemesi yap; migration başarı satırı yoksa aynı paketi yeniden çalıştırma.

## Belgeler

- [Teknik mimari](docs/architecture.md)
- [Güvenlik sınırı](docs/security.md)
- [Migration runbook'u](docs/migrations.md)
- [Hostinger deploy runbook'u](docs/hostinger-deploy.md)
- [Backup/restore runbook'u](docs/backup-restore.md)

Public kaynak deposu: [arslanturkmustafa-sudo/portal-pusula](https://github.com/arslanturkmustafa-sudo/portal-pusula)
