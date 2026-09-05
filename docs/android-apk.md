# Portal Pusula Android test APK

## Mevcut çıktı

Kurulabilir test APK'sı `dist/portal-pusula-test.apk` konumundadır.

- Paket kimliği: `tr.com.muhendiskafasi.portalpusula`
- Uygulama adı: `Portal Pusula`
- Başlatıcı adı: `Pusula`
- Sürüm: `1` (`versionCode: 1`)
- Minimum Android SDK: 21
- Hedef Android SDK: 36
- Canlı başlangıç adresi: `https://portal.muhendiskafasi.com.tr/`
- Dosya boyutu: 5.272.437 bayt
- APK SHA-256: `996B7644933A2439DDF55B56155F7C96325AF859F8E693116D2F7C8AEC8D1F6B`

Bu APK, canlı Portal Pusula PWA'sını açan bir **test TWA** paketidir. Uygulama verisi, parola veya oturum bilgisi APK'nın içine gömülmez; kimlik doğrulama ve yetki denetimleri web uygulamasında kalır. Bildirim ve konum yetkileri kapalıdır. Billing, dosya işleyici, protokol işleyici veya ek güvenilir origin tanımlanmamıştır.

## Test APK sınırı

Bu dosya Android'in yerel debug anahtarıyla imzalanmıştır. Anahtar ve keystore repoya eklenmemiştir. İmza APK'nın kurulabilir ve bütünlüğü doğrulanabilir olmasını sağlar; ancak üretim güncellemeleri veya Play Store yayını için kullanılmamalıdır.

Canlı domainde bu debug sertifikasıyla eşleşen `/.well-known/assetlinks.json` yayımlanmadı. Bu nedenle Android, alan adı ilişkisini doğrulayana kadar tam ekran Trusted Web Activity yerine adres çubuğu bulunan güvenli Custom Tab görünümüne düşebilir. Bu beklenen test davranışıdır; APK henüz doğrulanmış tam ekran TWA veya üretim paketi sayılmaz.

APK gerçek Android cihazında ya da emülatörde kurulup açılmadı. Bir cihaz testi yapılırken bilinmeyen kaynaklardan kurulum izni gerekebilir. Bağlı cihaz ve Android `platform-tools` bulunan bir makinede temel kurulum denemesi şöyledir:

```powershell
adb install -r .\dist\portal-pusula-test.apk
```

## Üretim ve kalıcı imza

Kalıcı Android yayını için sıralama şöyledir:

1. Kuruma ait, yedeklenmiş bir release keystore oluşturun ve repo dışında güvenli bir secret kasasında saklayın.
2. Aynı paket kimliğini koruyarak `versionCode` değerini her sürümde artırın ve release APK/AAB'yi bu kalıcı anahtarla imzalayın.
3. Release sertifikasının SHA-256 parmak izini `apksigner` ile alın.
4. Portal domaininde yalnız gerekli `delegate_permission/common.handle_all_urls` ilişkisini, paket kimliğini ve release sertifika parmak izini içeren `/.well-known/assetlinks.json` yayımlayın.
5. Digital Asset Links ilişkisini ve tam ekran davranışını gerçek cihazda doğrulayın.
6. Ancak bu doğrulamalardan sonra Play Store için imzalı AAB üretin ve mağaza sürecine geçin.

Parola, keystore veya imzalama anahtarı komut satırına, dokümana, Git geçmişine ya da CI loglarına yazılmamalıdır. CI kullanılacaksa imzalama değerleri platformun secret kasasından dosyaya aktarılmalı ve iş sonunda silinmelidir.

## Yeniden üretim

Bu test paketi aşağıdaki araç zinciriyle üretildi:

- Bubblewrap CLI 1.25.0
- Eclipse Temurin JDK 17.0.20.1+1, Windows x64
- Gradle 8.11.1
- Android Gradle Plugin 8.9.1
- Android build-tools 35.0.0
- compile/target SDK 36, min SDK 21

Canlı web manifestinden yeni bir geçici TWA projesi oluşturun:

```powershell
npx @bubblewrap/cli@1.25.0 init --manifest=https://portal.muhendiskafasi.com.tr/manifest.webmanifest
```

Başlatma sırasında şu sabitleri koruyun:

- package id: `tr.com.muhendiskafasi.portalpusula`
- host: `portal.muhendiskafasi.com.tr`
- start URL ve scope: `/`
- display: `standalone`
- orientation: `any`
- theme: `#101728`
- splash background: `#F4F6FA`
- version name/code: `1` / `1` (sonraki dağıtımda artırılmalı)
- notifications, geolocation ve Play Billing: kapalı
- fallback: `customtabs`
- additional trusted origins: boş

Hostinger hCDN eski istemci User-Agent'lerini engellerse TLS doğrulamasını veya CDN korumasını kapatmayın. Güncel bir Bubblewrap sürümü kullanın ya da yalnız manifest indirme katmanını modern Node `fetch` ile uyumlu hale getirin; indirilen manifestin URL'sini ve origin'ini değiştirmeyin.

Debug derlemesi için geçici ortamda:

```powershell
$env:JAVA_HOME = '<x64-jdk-17>'
$env:ANDROID_HOME = '<android-sdk>'
$env:ANDROID_SDK_ROOT = '<android-sdk>'
.\gradlew.bat :app:assembleDebug --no-daemon --max-workers=1
```

Üretilen `app/build/outputs/apk/debug/app-debug.apk` dosyasını `dist/portal-pusula-test.apk` olarak kopyaladıktan sonra doğrulayın:

```powershell
& '<android-sdk>\build-tools\35.0.0\apksigner.bat' verify --verbose --print-certs .\dist\portal-pusula-test.apk
& '<android-sdk>\build-tools\35.0.0\aapt.exe' dump badging .\dist\portal-pusula-test.apk
Get-FileHash -Algorithm SHA256 .\dist\portal-pusula-test.apk
```

Beklenen test imzası v1 ve v2 şemalarında doğrulanır. `aapt` çıktısında paket kimliği `tr.com.muhendiskafasi.portalpusula` ve başlatılabilir etkinlik `tr.com.muhendiskafasi.portalpusula.LauncherActivity` görünmelidir. Debug sertifikası makineye bağlı olduğu için sertifika ve APK SHA-256 değerlerinin başka bir makinedeki yeniden üretimde değişmesi normaldir.

`dist/` Git tarafından izlenmez ve Hostinger üretim ZIP'i allowlist ile oluşturulur; APK web dağıtım paketine dahil edilmez.
