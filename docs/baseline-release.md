# Portal Pusula Yerel Baseline Sürümü

Bu kayıt, yeni bağlayıcı şartnamedeki **Komut 0 — proje tabanı ve izlenebilirlik** için ilk yerel dilimi tanımlar. Yerel baseline, mevcut platform yatırımını kayıpsız korur; private remote, branch protection ve uzaktaki yeşil CI ayrıca tamamlanmadan Komut 0 bütünüyle kapanmış sayılmaz.

## Baseline kimliği

- Dal: `main`
- Açıklamalı etiket: `baseline-platform-v0.1`
- Kimlik biçimi: commit ve tag nesne kimlikleri `outputs/portal-pusula-baseline-v0.1-evidence.txt` dosyasına yerel olarak yazılır.
- Hostinger artefaktı: `dist/portal-pusula-hostinger.zip`
- Dosya sayısı: `80`
- Açılmış içerik: `626878` byte
- ZIP boyutu: `638222` byte
- SHA-256: `88428e0ed92b1e70cdd83e635d1717218870b1e88951093186df9d87cbfeb991`
- Canlı durumu: bu artefakt henüz Hostinger staging'e dağıtılmamıştır.

## Takip edilen sınıflar

- Uygulama ve platform kaynakları: `src/`
- Migration ve şema snapshot'ları: `drizzle/`
- Testler: `tests/` ve kaynak yanındaki `*.test.ts(x)` dosyaları
- Güvenli otomasyonlar: `scripts/`
- PWA statik varlıkları: `public/`
- Teknik kararlar ve runbook'lar: `docs/`
- CI tanımı: `.github/workflows/ci.yml`
- Kök toolchain, paket kilidi ve yapılandırma dosyaları

## Bilinçli olarak takip edilmeyen sınıflar

- Kullanıcıya ait planlama ve teslim artefaktları: `outputs/`
- Geçici çalışma, belge üretim ve Hostinger spike paketleri: `work/`
- Bağımlılık, build, log ve test çıktıları: `node_modules/`, `.next/`, `dist/`, `.logs/`, `coverage/`, `playwright-report/`, `test-results/`
- `.env.example` dışındaki tüm `.env*` dosyaları
- Codex/agent yerel metadata klasörleri

Bu dosyalar silinmez veya taşınmaz; Git kapsamı dışında yerel olarak korunur.

## Yerel kabul kanıtı — 31 Ağustos 2026

- Secret taraması: sıfır bulgu
- Lint: PASS
- TypeScript typecheck: PASS
- Unit/policy: 174/174 PASS
- Secretsız integration: 15/15 PASS; gerçek DB isteyen 33 senaryo bu pakette bilinçli olarak skipped
- Disposable MariaDB migration: 15/15 PASS
- Disposable MariaDB job/outbox/audit: 12/12 PASS
- Disposable MariaDB cron gate: 6/6 PASS
- Next.js production build: PASS
- Masaüstü/mobil E2E: 12/12 PASS
- Hostinger paketi iki ardışık üretimde aynı SHA-256: PASS

## Kalan Komut 0 kapıları

1. Ürün sahibine ait private Git remote oluşturmak ve baseline'ı push etmek.
2. `main` için branch protection, zorunlu PR/CI ve force-push engelini açmak.
3. Uzak CI çalışmasını yeşil kanıtlamak.
4. Aynı release kimliğiyle staging deploy, güncel yedi tabloluk şema/journal restore, güvenli rollback ve cron davranışını tamamlamak.

Bu dört kapı tamamlanmadan gerçek müşteri/finans verisi veya kullanıcı auth geliştirmesi production'a açılmaz.
