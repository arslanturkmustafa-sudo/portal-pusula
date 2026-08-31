# ADR-0002 — İç endpoint yanıt gizleme ve cron kabul semantiği

- **Durum:** Kabul edildi
- **Tarih:** 30 Ağustos 2026
- **Kapsam:** Machine-to-machine readiness ve varsayılan kapalı cron sınırı; kullanıcı oturumu/auth kapsam dışıdır

## Bağlam

İlk Dilim 0 planında eksik veya geçersiz cron kimliği için HTTP `401` öngörülüyordu. Canlı Hostinger spike'ı ve sonraki tehdit incelemesi, public internete ulaşabilen iç endpoint'lerde `401`/`403` ayrımının route varlığı, auth şeması ve yapılandırma durumu hakkında gereksiz bir oracle oluşturduğunu gösterdi. Readiness sınırı canlıda generic `404` ile güvenli biçimde doğrulandı.

Cron tarafında ayrıca geçerli bir çağrının işi gerçekten yürüttüğünü, başka dispatcher nedeniyle no-op kaldığını veya dayanıklı frekans kapısı tarafından bastırıldığını yanıtta ayırmak; kuyruk etkinliği, çalışma zamanı ve kilit durumu hakkında dışarıdan gözlenebilir bir kanal oluşturur. Çağıran scheduler'ın görevi işi tetiklemeyi denemektir; iç iş sayısını veya bastırma nedenini öğrenmek değildir.

## Karar

1. `/api/internal/readiness` ile `/api/internal/cron/dispatch` gibi machine-to-machine iç sınırlar, eksik/yanlış kimlik, kapalı özellik ve kabul edilmeyen yöntem için aynı generic `404 {"status":"not_found"}` yanıtını verir. `WWW-Authenticate`, auth türü, token biçimi veya yapılandırma ayrıntısı açığa çıkarılmaz.
2. Cron yalnız exact `POST /api/internal/cron/dispatch` ve exact `Authorization: Bearer <token>` kabul eder. Query/hash, body ve cookie tümüyle reddedilir; query string, path, body, cookie veya farklı header biçimi kimlik taşıma yolu değildir.
3. Geçerli kimlik ve geçerli yapılandırma sonrasında çağrı güvenle kabul edildiğinde, ister bounded dispatch çalışsın ister dayanıklı frekans kapısı nedeniyle advisory lock/dispatch'e girmeden güvenli no-op olsun, aynı generic `202 {"status":"accepted"}` döner. Yanıt iş sayısı, kuyruk derinliği, lock sahibi, bastırma nedeni, son çalışma zamanı veya bir sonraki uygun zamanı içermez.
4. Gerçek yapılandırma, DB veya dispatch arızası generic `503 {"status":"unavailable"}` olarak kalır. Ham hata, bağlantı bilgisi veya secret yanıta/loga taşınmaz. Güvenli no-op ile altyapı arızası birbirine eşitlenmez.
5. Tüm iç endpoint yanıtları `private, no-store` ve güvenli correlation ID taşır. Correlation ID auth/lock/rate durumunu kodlamaz.
6. İlk plandaki cron `401` maddesi bu ADR ile bilinçli olarak geçersiz kılınmıştır. Bu karar gelecekteki insan kullanıcısı auth/UI akışının `401`/`403` semantiğini belirlemez; kullanıcı auth tasarımı Komut 4'te ayrıca kararlaştırılacaktır.

## Gerekçeler

- Generic `404`, yetkisiz istemciye route ve auth durumu hakkında daha az bilgi verir.
- Aynı `202`, scheduler retry davranışını iç uygulama ayrıntılarından ayırır ve suppression/lock durumunu oracle olmaktan çıkarır.
- `503` korunarak gerçek operasyon arızaları izlenebilir kalır; fakat yalnız yetkili çağıran generic sonucu ve correlation ID'yi görür.
- Yanıt gizleme tek başına rate limit değildir. Dayanıklı DB kapısı, advisory lock, bounded batch/deadline, token rotasyonu ve canlı scheduler kanıtı ayrı kontrollerdir.

## Sonuçlar

- Testler `401`, `403`, `429` veya suppression'a özel body/header beklememelidir.
- Operasyon ayrıntısı HTTP yanıtıyla değil, secret-safe ve erişimi sınırlı gözlem kanalıyla izlenmelidir; bu kanal henüz canlı kanıtlanmamıştır.
- Hostinger cron'un exact `POST` ve sabit özel `Authorization` header desteği canlı doğrulanana kadar endpoint varsayılan kapalı kalır.
- Bu ADR cron'u canlıya açmaz, production handler/adapter eklemez ve Dilim 0 `GO` vermez.
