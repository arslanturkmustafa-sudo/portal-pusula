# Portal Pusula Baseline Sürümü

Bu kayıt, yeni bağlayıcı şartnamedeki **Komut 0 — proje tabanı ve izlenebilirlik** için kaynak baseline'ını tanımlar. Yerel baseline public GitHub deposuna gönderilmiş; uzak CI ve korumalı `main` akışıyla birlikte doğrulanmıştır.

## Baseline kimliği

- Dal: `main`
- Açıklamalı etiket: `baseline-platform-v0.1`
- Baseline commit: `aea2ec0690b96fe579549e6d718c0dafb98a76ad`
- Açıklamalı tag nesnesi: `89441c9e622ae999cfcf8161738be83168023ae4`
- Remote: `https://github.com/arslanturkmustafa-sudo/portal-pusula.git`
- Görünürlük: public; secret/env/backup/çıktı sınıfları Git kapsamı dışındadır
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

## Uzak kabul kanıtı — 31 Ağustos 2026

- Baseline `main` ve `baseline-platform-v0.1` etiketi `origin` deposuna gönderildi: PASS
- GitHub Actions `quality` çalışması: [run 33419687742](https://github.com/arslanturkmustafa-sudo/portal-pusula/actions/runs/33419687742), 2 dakika 2 saniye, PASS
- Aktif `protect-main` ruleset: varsayılan dal hedefi, bypass yok, PR zorunlu ve onay sayısı `0`
- Zorunlu `quality` kontrolü ve hedef dalın güncel olması: etkin
- Konuşma çözümü, doğrusal geçmiş, yalnız squash birleştirme, silme ve force-push engeli: etkin

## Kalan Komut 0 kapısı

1. Aynı release kimliğiyle staging deploy, güncel yedi tabloluk şema/journal restore, güvenli rollback ve cron davranışını tamamlamak.

Bu kapı tamamlanmadan gerçek müşteri/finans verisi veya kullanıcı auth geliştirmesi production'a açılmaz.
