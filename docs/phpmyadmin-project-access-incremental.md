# 0027 — proje erişimi canlı geçişi

Hedef uygulama `portal.muhendiskafasi.com.tr`; veritabanı hedefi panelden ve
salt okunur journal sorgusundan doğrulanır. 17 Eylül kaydı son geçişi `0026`
olarak gösterir; bu tarihsel kayıt güncel doğrulama veya yedek yerine geçmez.

## Hazırlık

1. Kaynak sürümünün zorunlu CI/dağıtım kapıları korunur. Proje erişimi için
   `npm run test:project-access:mariadb` geçici MariaDB 11.4.8 üzerinde altı
   senaryo çalıştırır: migration/FK, veri ayrımı, yazma sınırı, hatalı atamanın
   geri alınması, oturum iptali ve yeni hesabın varsayılan erişimi.
2. Üretim build'i ve `npm run package:verify` tamamlanır; ZIP hash'i ve kaynak
   kimliği release kaydına yazılır. Mevcut ByPusula kaynak değişiklikleri paketin
   bağımlılığıdır; paketten çıkarılmaz. Paket `0000–0027` zincirini içerir.
3. Yazmaların ve otomatik ByPusula tesliminin durumu belirlenir. Bakım penceresinde
   yazmalar durdurulur. Güncel kaynak DB yedeği ayrı, geçici bir hedefe geri
   yüklenir; journal ve kontrollü satır/şema doğrulaması yapılır.

## DB önce

- Başlangıç: 27 journal kaydı, son migration `0026_bypusula_auto_sync`.
  Sıra, timestamp ve hash'ler kaynak zinciriyle eşleşmeli; `user_project_access`
  tablosu henüz bulunmamalı. Fark varsa SQL uygulanmaz.
- Panelde doğrulanan DB ve MariaDB sürümünün SHA-256 değerleriyle standart
  incremental builder çalıştırılır:

```text
PHPMYADMIN_INCREMENTAL_MIGRATION_TAG=0027_user_project_access
PHPMYADMIN_TARGET_DB_SHA256=<doğrulanan DB hash'i>
PHPMYADMIN_SERVER_VERSION_SHA256=<doğrulanan sunucu sürümü hash'i>
npm run db:bundle:phpmyadmin:incremental
```

Bu değerler shell'e uygun process environment alanlarında ayarlanır; örnek
yer tutucularıyla oluşturulan paket canlıya uygulanmaz. Builder manifestinde
`expectedJournalCount=27`, önceki migration `0026_bypusula_auto_sync`, yeni
migration `0027_user_project_access` ve iki DDL ifadesi bulunmalı.

- Yalnız hedefe bağlı `dist/portal-pusula-incremental-0027_user_project_access.sql`
  bir kez uygulanır. Başarısız veya belirsiz sonuçta aynı paket tekrarlanmaz.
- Sonuç: 28 journal kaydı; journal dışında 36 tablo; `user_project_access`
  içinde `user_account_id` ASCII/binary PK, `project_ids` geçerli JSON,
  kullanıcı tablosuna `fk_user_project_access_account` isimli RESTRICT FK.
  Eski hesaplar ve proje/görev kayıtları değişmemeli; yeni tablo başlangıçta boştur.

## Uygulama ve kabul

DB doğrulanınca canonical Hostinger ZIP yüklenir. Mevcut Node 24, webpack build,
ortam değişkenleri, kimlik doğrulama ve entegrasyon ayarları korunur. Uygulama
başlangıcına migration eklenmez. Panelde dağıtım tamamlandıktan sonra liveness,
giriş ve kullanıcı ekranı kontrol edilir.

Bir ekip hesabının adı, erişeceği proje ve modül izinleri kullanıcı tarafından
belirlenir; gerçek hesabın erişimi tahmin edilerek değiştirilmez. Parola girişi
kullanıcıya aittir. Seçili projede okuma/düzenleme, başka projeye erişim reddi ve
yetki kaldırma sonrası yeniden giriş doğrulanır. İlk sürümün kapalı modülleri
[proje erişimi kapsam belgesinde](./project-access-v1.md) listelenmiştir.

Şema veya deployment hatasında güncel yedek/restore prosedürü izlenir. Canlı
SQL üzerinde otomatik DROP veya geri yükleme yapılmaz.
