# ByPusula → Portal Pusula görev aktarımı v1

> **Tarihsel aşama / veri sözleşmesi:** Aşağıdaki manuel dosya akışı ve 0.17.2-beta adayı artık hedef kullanıcı akışı değildir. Güncel uygulama [otomatik entegrasyon belgesinde](bypusula-auto-sync-v1.md) tanımlıdır: sunucular arası imzalı aktarım, aktif proje seçimi ve otomatik görev oluşturma. Önceki test kanıtları bu belgede tarihsel olarak korunmuştur; canlı dağıtım kanıtı sayılmaz.

Portal alıcısı, kalıcı bekleme listesi ve kullanıcı onaylı görev oluşturma yerel kaynakta hazırdır. ByPusula dışa aktarıcısı da ayrı kaynak görevinde tamamlandı; 0.17.2-beta kurulum adayı hazırdır. Migration ve görev aktarımı geçici MariaDB'de, gerçek WordPress indirme yolu ise kapalı yerel ortamda sentetik verilerle doğrulandı. Kullanıcının giriş yaptığı canlı test hesabında ekran salt okunur incelendi; aktarım düğmesi görünmüyor. Canlı migration, eklenti kurulumu ve deploy yapılmadı. Aktarım JSON dosyasıyla yapılır; otomatik arka plan gönderimi bu dilimde açık değildir.

## Salt okunur keşif ve kimlik kararı

İncelenen kaynak: `C:\Users\arsla\OneDrive\Belgeler\bypusula`, `mk-isoda/mk-isoda.php` sürüm `0.17.1-beta`. Bu depoda kök veya ilgili alt dizinlerde `AGENTS.md` bulunmadı. Portal kök `AGENTS.md`, yerel Next route/server-client rehberleri, mimari, erişim kontrolü ve migration belgeleri okundu. ByPusula program yol haritası, araç rehberi, modül navigasyonu belgesi ve güncel çalışma günlüğü incelendi. Hiçbir DB, secret, gerçek müşteri kaydı veya canlı API okunmadı.

| Kaynak | Otorite ve anlam |
| --- | --- |
| Firma hesabı | `analyses.customer_id`: ByPusula hesap kapsamı; analiz edilen firma kimliği yerine kullanılamaz. Enterprise hesap farklı firmaları analiz edebilir. |
| Analiz edilen firma | `analyses.subject_company_name`: serbest metin; bağımsız kararlı firma ID'si yok. v1 dış kimliği `analysis-subject:<analysis.id>`. Böylece aynı hesap altındaki firmalar karışmaz. Farklı analizler otomatik aynı firmaya bağlanmaz. |
| Analiz | `{$wpdb->prefix}mk_isoda_product_analyses.id`, hesap kapsamıyla birlikte; içerik sürümü `content_version_snapshot`. |
| Program | `...improvement_programs`: `(customer_id, analysis_id, root_program_code)` tekil; ayrıca programın DB `id` değeri korunur. |
| Uygulama adımı | `program_template_snapshot_json.implementation_sequence` → `MK_ISODA_Product_Repository::implementation_action_definitions()`. Çıktı `IMPLEMENTATION_ACTION_01…`, sıra, başlık ve talimat içerir. Aktif programlarda `program_checkpoints` içinde `checkpoint_type=implementation_action` ve program+checkpoint kodu tekildir. |
| Sıra ve aşama | `MK_ISODA_Program_Roadmap`, politika `2026.09.2`, 43 program ve 5 aşama. Katalog `sort_order` uygulama sırası değildir. |

JSON katalog (`data/product/v2.0.0/catalog.json`) şablon kaynağıdır; geçmiş analiz aktarımında güncel katalogdan yeniden içerik türetilmez. Öneri aşamasındaki program için henüz checkpoint satırı bulunmayabilir; snapshot tanımları esas alınır. Legacy ve Pilot/Turizm analizleri bu v1 kapsamına girmez.

Portal `customer`, `project`, `customer_project`, `work_task`, `work_task_project` modellerini kullanır. Proje müşteriyle aktif bağlı, müşteri aktif ve arşivlenmemiş, proje açık ve arşivlenmemiş olmalıdır. Mevcut görev oluşturma servisi ve transaction/audit altyapısı kullanılır. Kaynak için yalnız iki ek tablo eklenir: `bypusula_analysis` ve `bypusula_task_link`.

## Taşıma ve yetkilendirme

En kısa secretsız yol: ByPusula'nın ürettiği v1 JSON dosyası, Portal `/gorevler/bypusula` ekranında hesap oturumuyla yüklenir. Bu dosya imzalı bir kaynak kanıtı değildir; Portal'da yetkili kullanıcının incelediği aktarım girdisidir. Sunucu dış URL'ye istek atmaz. M2M bearer, WordPress cookie paylaşımı, CORS açma veya yeni secret yoktur.

`/api/integrations/bypusula` GET ve POST için DB tabanlı `account` oturumu ve birlikte `tasks.read`, `tasks.write`, `customers.read`, `projects.read` gerekir. Development/legacy bypass kabul edilmez. POST ayrıca same-origin, JSON, strict şema ve gerçek stream byte sınırı uygular. Yetki ve altyapı hataları fail-closed olur; yanıtlar no-store'dur. Proje yaratma ve müşteri–proje bağlama mevcut ekranlarda kendi `projects.write` / `customers.write` izinlerini korur. Kullanıcı adına başkasına görev ataması yapılmaz; mevcut servis görevleri işlem yapan hesaba atar.

## Küçük sözleşme

Çalışan örnek: [bypusula-transfer-v1.example.json](bypusula-transfer-v1.example.json). Tek dosya bir analizin önerilen programlarının **tam uygulama adımı snapshot'ını** içerir. Kullanıcı seçimleri bu dosyayı keserek yapılmaz; Portal önizlemesinde yapılır.

- `schemaVersion=1`, `source=bypusula`.
- `instanceId`: her ByPusula kurulumuna bir defa atanıp kalıcı tutulan canonical UUID; secret değildir. Backup restore aynı kimliği korur, bağımsız test/kopya kurulum farklı kimlik alır. Alan adı veya her ihracatta yeni UUID kullanılmaz.
- `accountId`, `analysis.id`, `programs[].id`: ondalık **string** DB kimlikleri; JavaScript sayı dönüşümü yapılmaz.
- `company.externalId=analysis-subject:<analysis.id>`, `company.name`: analiz konusu.
- `analysis.url`: HTTPS, kimlik bilgisi/fragment/nonce/token olmadan yalnız `mk_tab=report|improvements` ve eşleşen `analysis_id` query parametreleri; oturum gerektiren normal kaynak sayfası.
- `analysis.contentVersion`, `roadmapVersion`; program `code/title/phase/order`; adım `code/sequence/title/description/priority`.
- Öncelik: `low|normal|high|urgent`. ByPusula export adapter'ı kaynak önceliğini açık bir eşleme tablosuyla çevirmeli; bilinmeyen değeri sessizce tahmin etmemeli. Adım bazında ayrı öncelik yoksa programın önerilen önceliği kullanılır.
- En fazla 43 program, programda en fazla 100, dosyada toplam 500 adım ve 512 KiB; başlık 191, adım açıklaması 2500 karakter. Taşan içerik kesilmez, açıklanabilir hata verilir. Sürüm/ek alan/farklı kimlik/hatalı sıra reddedilir. Finans, skor, cevaplar, iletişim bilgileri veya erişim bilgileri taşınmaz.

Başlık kaynağı, ByPusula'nın mevcut `implementation_action_definitions()` çıktısındaki en fazla 191 karakterlik kısa başlıktır. Ham uygulama metninin ilk satırı daha uzun olabilir; bu satır yeniden başlık sayılıp reddedilmez. Ayrıştırıcının tam `instructions` çıktısı açıklamada korunur. Aktarıcı yeni bir kırpma eklemez; gerçek açıklama sınır aşımı hata verir. Yerel v2 katalog incelemesinde 324 adımın 55'inin ham başlığı 191 karakteri aştığı için bu ayrım gereklidir.

## Önizleme, eşleme ve tekrar deneme

1. `POST {action:"preview", envelope}` doğrulanmış dosyayı kalıcı kaydeder ve önizleme döndürür; görev oluşturmaz. `GET` son 100 kaydı, `POST {action:"open", id}` kayıtlı önizlemeyi verir. Kaynak kimliğini içeren dosya tekrar açılarak eski kayıt bulunabilir.
2. Kaynak anahtarı SHA-256(JSON array `["bypusula", instanceId, accountId, analysis.id]`). Snapshot strict şema ile kanonikleştirilir, program/adım sırası normalize edilir ve digest saklanır. İlk snapshot değişmezdir. Aynı analiz kimliğine farklı içerik gelirse `409 snapshot_conflict`; mevcut görev ve önizleme değiştirilmez. Bu v1 create-only sözleşmedir: sessiz içerik güncellemesi yoktur. Düzeltme/güncel snapshot için gelecekte açık revizyon sözleşmesi gerekir; kaynak kimliğini değiştirip çakışmayı aşmak yasaktır.
3. Güvenilir otomatik eşleme yalnız bu analiz için önceden kullanıcı tarafından doğrulanan ve halen geçerli müşteri–proje çiftidir. İsim eşleştirme, tek aday bulunması veya aynı ByPusula hesabı yeterli sayılmaz; durum `pending_mapping` olur. Arayüz “Eşleştirme bekliyor” gösterir. Yeni analiz yeni manuel eşleme gerektirir; bağımsız firma ID'si olmadan analizler arasında otomatik bağ kurulmaz.
4. Kullanıcı mevcut müşteri ve aktif projeyi seçer. Gerekirse ayrı Projeler ekranında bilinçli olarak yeni proje yaratıp Müşteriler ekranında bağlar, ardından önizlemeyi yeniler. İlk görev oluşunca analiz eşlemesi kilitlenir; sonradan farklı projelere sessiz bölünme engellenir. İlişki kapatılırsa tekrar geçerli hale gelene kadar yeni adımlar bekler.
5. `POST {action:"import", id, digest, customerId, projectId, selected:["PRG-GOV-01/IMPLEMENTATION_ACTION_01"]}` en fazla 25 seçili adımı işler; UI büyük seçimi ardışık 25'lik parçalara böler. Seçim kayıtlı snapshot'a karşı doğrulanır. Sıra yönlendiricidir, başka adım seçmek engellenmez.
6. Her adım kendi transaction'ında analiz satırını `FOR UPDATE` kilitler, mevcut kaynak bağına bakar, müşteri–proje bağını yeniden doğrular, görev+proje bağı+audit+kaynak bağını beraber commit eder. Adım kaynak anahtarı SHA-256(JSON array `[analysisKey, program.code, step.code]`); unique/PK kısıtları ve satır kilidi eşzamanlı tekrarlarda ikinci görevi engeller.
7. Yanıt her adım için `created|existing|failed` içerir. Başarılı adımlar korunur; başarısızlar tekrar seçili kalır. Bağlantı/yanıt kaybından sonra aynı seçimi yeniden göndermek güvenlidir. Ham hata, kaynak metni, finans bilgisi ve secret loglanmaz.
8. Oluşan görev `backlog` ve önerilen öncelikle açılır. Açıklamada firma/analiz, program kodu/başlığı, aşama/program/adım sırası ve kaynak URL vardır; değişmez kaynak snapshot ve görev bağlantısı ayrıca DB'de korunur. Sonraki aktarım mevcut göreve **hiçbir update** yapmaz: done/cancelled/archived, açıklama, atama, öncelik ve elle değişen diğer alanlar korunur. Kaynakta silinen adım Portal görevini silmez.

## Migration ve doğrulama sınırı

`0025_bypusula_transfer.sql` + Drizzle schema/snapshot/journal ileri yönlü eklemedir. Çalışma başındaki kaynak son migration'ı `0024_partial_card_payments` idi; eski README'deki 0018 seviyesi bu değişiklik için temel alınmadı. Migration zinciri yalnız geçici yerel MariaDB'de uygulandı. Canlı DB-first kapıları aynen geçerlidir; bu çalışma canlı migration/import/deploy izni vermez.

İlk dar kontroller: sözleşme ve URL reddi, kimlik kapsamı, manuel/doğrulanmış eşleme, stale snapshot/seçim, model transaction rollback ile kısmi hata, eşzamanlı tekrar ve terminal görev koruması, API izin/same-origin/body/error sınırları. Typecheck ve yalnız değişen TS/TSX dosyalarının lint'i. Ardından yalnız ByPusula için dört gerçek MariaDB testi eklendi ve çalıştırıldı. Tam test paketi, E2E, build veya önceki başarılı testler tekrar çalıştırılmadı.

İlk yerel sonuç (2026-09-17): 3 dosyada **9 odaklı test geçti**; `tsc --noEmit --incremental false`, değişen TS/TSX dosyalarında ESLint ve `git diff --check` geçti. Test fixture'ındaki eksik principal alanları typecheck bulgusundan sonra tamamlandı. Üretilen yeni SQL, deponun mevcut migration kalıbıyla ASCII binary kimlik/FK kolonları ve InnoDB/utf8mb4 tablo politikası için düzenlendi; salt okunur statik kontrol geçti. Sonraki gerçek DB doğrulaması aşağıda kayıtlıdır.

### Geçici MariaDB kanıtı — 2026-09-17

`npm run test:bypusula:mariadb` yalnız `tests/integration/mariadb-bypusula-transfer.test.ts` dosyasını çalıştırır. Çalıştırıcı boş Docker yapılandırması, sabit sentetik test kimlik bilgileri, rastgele proje adı, loopback üzerinde dinamik port ve ayrı volume kullanır; uygulama `.env` dosyalarını veya Docker giriş bilgilerini okumaz. Test kurulumu gerçek migration runner'ıyla `0000`–`0025` zincirini bir defa uygular; geniş migration test paketini çalıştırmaz.

MariaDB **11.4.8** üzerinde dört testin tamamı geçti:

1. 26 migration kaydı ve yeni kimlik kolonlarının `ascii_bin` collation'ı; eşzamanlı ilk teslimde tek analiz, farklı snapshot'ın reddi ve ilk digest'in korunması.
2. İlişkisiz veya pasif müşteri–proje eşlemesinin görev oluşturmadan reddi.
3. Eşzamanlı iki aktarımda üç adım için toplam üç görev ve üç oluşturma audit kaydı; tekrarda tamamlanmış, iptal edilmiş, arşivlenmiş ve elle düzenlenmiş görevlerin tüm alanlarının korunması.
4. Kaynak bağı eklenirken sentetik DB hatasıyla görev/proje bağı/audit işlemlerinin birlikte geri alınması; başarılı adımlar korunurken tekrarda yalnız eksik adımın oluşturulması.

Servis, repository ve transaction katmanları gerçek DB ile çalıştırıldı. Sonuç: **4/4 geçti** (testler 5,94 saniye, toplam 7,91 saniye). Çalıştırıcı container, ağ ve volume temizliğini tamamlayıp `0` koduyla çıktı. Eklenen test ve çalıştırıcı için typecheck ile ilgili ESLint kontrolleri de geçti. Uygulama kodunda bu doğrulama için düzeltme gerekmedi. Bu kanıt temiz yerel şema içindir; mevcut canlı veritabanının sürümü ve incremental geçişi doğrulanmış değildir. Sonraki WordPress kontrolü aşağıdadır.

### WordPress indirme yolu ve kurulum adayı — 2026-09-17

Kullanıcı kaynak sayfayı `https://muhendiskafasi.com.tr/index.php/pusula-platform/` olarak bildirdi ve sentetik verili test hesabına kendisi giriş yaptı. İyileştirmeler ekranında Enterprise hesap ve rapor/program listesi açıldı; **Portal Pusula aktarım dosyası** düğmesi görünmedi. Canlı form gönderimi, program güncellemesi, eklenti yüklemesi veya veri aktarımı yapılmadı. Bu gözlem tek başına kurulu PHP dosyalarının bire bir sürüm kanıtı değildir.

Yeni kaynak, önceki `bypusula-v0.17.1-beta-wordpress.zip` ile karşılaştırıldı: yalnız `mk-isoda.php` ve `includes/product/class-mk-isoda-product-module.php` değişmiş, `includes/product/class-mk-isoda-portal-task-export.php` eklenmişti. Ayrı ByPusula görevi sürüm alanlarını **0.17.2-beta** olarak güncelleyip aday ZIP'i hazırladı. Önceki pakete göre diğer **51 dosya aynı**, silinen dosya yoktur; şema ve katalog dosyaları değişmedi. CRC, tek `mk-isoda/` kökü, 54 dosyanın ZIP–kaynak byte eşliği ve değişen iki PHP dosyasının syntax kontrolü geçti.

| Yerel paket | SHA-256 |
| --- | --- |
| `C:\Users\arsla\OneDrive\Belgeler\bypusula\bypusula-v0.17.2-beta-wordpress.zip` | `32752d58116f5e624f9ca545a41959ce04c5b6aa91baa9b59803dd1c114a7b9e` |
| Korunan `bypusula-v0.17.1-beta-wordpress.zip` | `d60ad0ebb8718621b6e25f87309819154a7b737c6b89265248293a978ea4c487` |

Ardından gerçek **WordPress 7.1 / PHP 8.4.25 / MariaDB 11.4.8** ile 0.17.2-beta kaynak kodu çalıştırıldı. Bu tek HTTP indirme kontrolü için ayrı Docker ağı ve volume'leri oluşturuldu; host portu açılmadı, dış ağ ve e-posta gönderimi kapatıldı, kaynak plugin salt okunur bağlandı. Yalnız sentetik hesap/analiz/program satırları ve gerçek ürün metoduyla verilen yerel test oturumu kullanıldı. HTTPS sertifikası yalnız container içindeki test istemcisine tanıtıldı; bilgisayarın güven deposu değiştirilmedi.

Başarılı kontrol:

- Gerçek `/index.php/pusula-platform/` sayfasında aktarım formu üretildi.
- Oturumsuz indirme `401`, bozuk nonce `403` döndü; hatalar da `no-store` taşıdı.
- Yetkili POST `200`, JSON attachment ve `no-store` döndü.
- İndirilen **2056 byte / 2 program / 4 adım** dosyası Portal'ın gerçek `commandSchema` doğrulamasından geçti; kaynak URL aynı kalıcı bağlantı yapısını korudu.
- Tekrar indirme byte düzeyinde aynı sonucu verdi. ByPusula kaynak tablolarının checksum'ları ve kalıcı kurulum UUID'si isteklerden önce/sonra aynı kaldı.
- Container, ağ ve volume temizliği tamamlandı; çalıştırıcı `0` koduyla çıktı.

Kanıt: bu Portal çalışma alanında `outputs/bypusula-wordpress-check/result.json`; sentetik dosya `outputs/bypusula-wordpress-check/portal-transfer.synthetic.json`. Aynı klasörde tek kullanımlık doğrulama betikleri bulunur. İlk kurulum denemelerinde test ortamının port erişimi ve permalink başlangıç ayarı düzeltildi; uygulama kodunda hata veya değişiklik gerekmedi. Önceki başarılı PHP/Portal/MariaDB paketleri tekrar çalıştırılmadı; Portal build veya E2E paketi çalıştırılmadı.

Kalan sınır canlı kurulumdur. Mevcut çalışma kapsamı dağıtımı içermediğinden ayrı kullanıcı onayı ve geri alınabilir yedek doğrulaması gerekir. Yeni eklentinin normal açılışı mevcut upgrade/backfill yollarını ve eksikse kalıcı UUID oluşturmayı çalıştırabilir. Eski ZIP yalnız kodu geri alır; UUID veya analiz/müşteri verisi sıfırlanmamalıdır. Portal canlı migration/deploy'u ayrıca ele alınmalıdır; ByPusula paketi tek başına Portal'ı yayına almaz.

## ByPusula kaynak görevi ve dosya kapsamı

Portal görevi ByPusula deposuna yazmadı. Kullanıcının devam onayından sonra `01a0ae23-9541-7a31-a2ab-f9a2ce89bf60` numaralı ayrı ByPusula görevi yerel dışa aktarıcıyı tamamladı. Uygulama kapsamı aşağıdadır:

1. **Yeni** `mk-isoda/includes/product/class-mk-isoda-portal-task-export.php`: salt okunur v1 serializer; kurulum kimliği, hesap/analiz/program/adım kapsam doğrulaması; snapshot/roadmap eşlemesi, açık öncelik dönüşümü, normal kaynak linki. Analiz finalized/immutable ve erişilebilir olmalı; yalnız Product analizi kabul edilmeli. Snapshot, adım ve firma hesabı uyuşmazlığında fail-closed.
2. `mk-isoda/includes/product/class-mk-isoda-product-module.php`: iyileştirme ekranına “Portal Pusula aktarım dosyası” işlemi; mevcut hesap/paket/analiz erişimi + nonce kontrolü, JSON attachment + no-store. Program başlatma, backfill veya kaynak DB yazması export sırasında yapılmamalı. Aktarıcıyı mevcut modül yüklemesiyle bağla.
3. `mk-isoda/mk-isoda.php`: yalnız gerekiyorsa yeni sınıf yükleme ve bir defalık kalıcı, secret olmayan `instanceId` kurulum ayarı. Secret veya Portal parolası eklenmemeli; export sırasında her seferinde UUID üretilmemeli. Kaynak snapshot'a elle kimlik eklenmemeli.
4. **Yeni** `tests/portal-task-export-test.php`: az sayıda sentetik fixture ile stable kimlik, enterprise firma ayrımı, kapsam/nonce reddi ve snapshot adımı eşlemesi; Portal'daki testleri tekrarlama.
5. **Yeni** `docs/portal-pusula-task-export-v1.md`: bu sözleşmenin alan eşlemesi, kullanım ve sınırlar. `docs/bypusula-worklog.md`: kısa devir kaydı.

Bu ayrı iş canlı kurulum, ZIP deploy veya otomatik arka plan gönderimi içermemelidir. İleride tam otomatik ByPusula → Portal teslimat istenirse, taşıma için ayrı kimlik doğrulama/provisioning ve kaynak firma kimliği kararı gerekir; mevcut oturum çerezlerini dış sistemle paylaşarak çözülmez.

## İki tarafın yerel tamamlanma kanıtı — 2026-09-17

- ByPusula: 6 odaklı test grubu ve değişen 4 PHP dosyasında syntax kontrolü geçti. İndirme, mevcut nonce/oturum/paket/rapor yetkilerini kullanır. Export isteği eklenti açılışındaki migration/seed/checkpoint backfill işlemlerini atlar. Kalıcı kurulum kimliği indirme sırasında üretilmez.
- Kaynak aktarıcının ürettiği sentetik dosya: `C:\Users\arsla\OneDrive\Belgeler\bypusula\outputs\portal-pusula-task-export-v1.synthetic.json` (2230 byte, 2 program, 4 adım). Kullanım belgesi aynı deponun `docs/portal-pusula-task-export-v1.md` dosyasındadır.
- Portal'da bu dosya doğrudan mevcut `src/features/bypusula/contract.ts` içindeki `commandSchema` ile `action: preview` biçiminde doğrulandı. Sonuç **PASS**: 2 program, 4 adım, 1342 byte istek gövdesi; açıklama metinleri değiştirilmeden korundu. Bu tek sınır kontrolü için önceki test paketleri tekrar çalıştırılmadı.
- Portal'ın önceki 9 odaklı test sonucu geçerlidir; ek olarak yukarıdaki dört gerçek MariaDB testi geçti. Aktarım uygulama kodunda değişiklik gerekmedi; test, çalıştırıcı ve devir belgeleri güncellendi.
- Sentetik dosya iki yerel uygulama arasındaki sözleşme uyumunu; geçici MariaDB testi DDL, kilitleme ve transaction davranışını; kapalı WordPress kontrolü gerçek HTTP indirme yolunu doğrular. Canlı indirme, Portal'a canlı müşteri aktarımı ve dağıtım henüz yapılmadı. Kullanıcının test hesabında yaptığı giriş dışında kimlik bilgisi okunmadı veya kaydedilmedi.
