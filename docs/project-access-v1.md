# Proje bazlı erişim — ilk sürüm

Kullanıcılar ekranında yeni ekip hesabı oluştururken veya mevcut hesabı düzenlerken
erişilecek projeler seçilir. **Tüm projeler** seçeneği mevcut ve gelecekteki tüm
projelere erişim verir; modül izinleri ayrıca gereklidir. Boş seçim hiçbir projeye
erişim vermez. Yeni hesaplar varsayılan olarak boş seçimle başlar. Mevcut hesapların
erişimi geçişte korunur; sahip hesaplarının erişimi daraltılmaz.

Seçili projelerle sınırlı hesaplarda:

- Projeler ve görevler sunucuda filtrelenir. Görev oluşturma, düzenleme, taşıma ve
  arşivleme hem mevcut hem hedef proje iznini kontrol eder. Proje oluşturma kapalıdır.
- İlişkili müşteri kartları yalnız izinli proje bağlantılarıyla gösterilir. Ortak
  müşteri notları, ziyaret ve finans özetleri gösterilmez. İletişim bilgileri için
  ayrıca mevcut iletişim izni gerekir. Müşteri düzenleme kapalıdır.
- Görev raporları ve Günüm özeti aynı proje sınırını uygular. Projesiz görevler
  görünmez. Günüm görevleri vade tarihine göre gösterir; ziyaret takvimine bağlamaz.
- Genel finans, sözleşmeler, ziyaretler, günlük planlama, denetim geçmişi, görev
  atama ve ByPusula aktarımı kapalıdır. Bu modüller ilk sürümde proje bazlı değildir.
- İzin değişiklikleri mevcut credential-version mekanizmasıyla eski oturumu
  geçersiz kılar; kullanıcı yeniden giriş yapar.

## Kurulum

Uygulamayı güncellemeden önce standart migration akışıyla
`0027_user_project_access.sql` uygulanmalıdır. `0025` ve `0026` dahil önceki
migration'lar sıralı olarak uygulanmış olmalıdır. Migration eski kayıtları değiştirmez;
yalnız `user_project_access` tablosunu ekler. Canlı ortama otomatik uygulanmaz.

Eksik erişim kaydı mevcut hesaplar için tüm projeler anlamına gelir; kayıt içindeki
boş JSON dizisi hiçbir proje anlamına gelir. Kimlik listesi en fazla 200 benzersiz
UUID içerir ve kayıt sırasında projelerin varlığı doğrulanır. Yazma ve kullanıcı
izin güncellemesi mevcut transaction ve audit mekanizmasını kullanır.

Canlı geçiş için [0027 kurulum adımları](./phpmyadmin-project-access-incremental.md)
izlenir. `npm run test:project-access:mariadb` gerçek MariaDB üzerinde altı
odaklı kontrol çalıştırır; 21 Eylül 2026 yerel çalıştırmasında tamamı geçti.
Üretim build'i de geçti. Bu sonuçlar canlı deployment veya gerçek bir kullanıcıya
erişim atandığı anlamına gelmez.
