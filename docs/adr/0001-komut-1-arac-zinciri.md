# ADR-0001 — Komut 1 yerel araç zinciri

- **Durum:** Kabul edildi
- **Tarih:** 29 Ağustos 2026
- **Kapsam:** Yalnız yerel nötr iskelet; üretim runtime kararı değildir

## Bağlam

Portal Pusula yerelde Node.js 24 LTS adayıyla, npm ve repoya alınmış `package-lock.json` ile çalışmalıdır. Kurulum anındaki güncel paketler arasında iki önemli uyumluluk ayrımı bulundu:

1. TypeScript 7 güncel `latest` sürümdür fakat programatik Compiler API kullanan lint araçları için henüz uygun değildir. `typescript-eslint` destek aralığı TypeScript 6 çizgisindedir.
2. Next.js 16.3.3, peer sınırını ESLint `>=9` olarak bildirirken paketlediği `eslint-plugin-react`, `eslint-plugin-import` ve `eslint-plugin-jsx-a11y` sürümleri peer metadata'sında henüz ESLint 10'u ilan etmez. Eklenti kuralları uyumluluk katmanı olmadan ESLint 10'da eski context API'si nedeniyle çalışmaz.

## Karar

- Yerel Node adayı `.nvmrc` ile yalnız ana sürüm `24` olarak kaydedilir; `package.json.engines` Hostinger canlı spike'ına kadar eklenmez.
- Next.js `16.3.x` ve React `19.2.x` aynı uyumlu çizgide kilitlenir.
- TypeScript `6.0.x` kullanılır; TypeScript 7 araç ekosistemi desteklediğinde ayrıca değerlendirilir.
- Destek dışı duruma düşen ESLint 9'a dönülmez. ESLint `10.9.x`, ESLint'in resmî `@eslint/compat` paketiyle Next'in mevcut flat config kurallarına uygulanır.
- npm peer metadata uyarısı bilinen ve geçici bir upstream uyumsuzluğu olarak kabul edilir. `npm ci --dry-run`, gerçek lint, typecheck, test, build ve Playwright sonuçlarıyla davranış doğrulanır.
- npm 12'nin engellediği `unrs-resolver` postinstall betiğine gereksiz güven verilmez; platform binding'i optional dependency üzerinden bulunur ve çalışan lint/build ile kanıtlanır.

## Sonuçlar

- Güncel ve desteklenen ESLint ana sürümü korunurken eski plugin API çağrıları resmî compatibility wrapper ile çalışır.
- Clean install sırasında peer metadata uyarısı görülebilir; bu bir test başarısızlığı veya güvenlik açığı değildir.
- Next.js lint bağımlılıkları ESLint 10 desteğini ilan ettiğinde `@eslint/compat` kaldırılmalı ve bu ADR güncellenmelidir.
- Üretim Node sürümü, Hostinger build/start/runtime kanıtından önce bu kararla kesinleşmiş sayılmaz.

