# Güvenlik

## Uygulanan korumalar

- Tüm finansal tablolar ve özel Storage alanı Supabase Row Level Security ile korunur.
- `viewer` yalnız kasa verilerini görür; finansal kayıt veya belge oluşturamaz.
- `editor` finansal kayıt oluşturabilir ancak rol, üyelik veya kasa sahipliği değiştiremez.
- Üye çıkarma ve sahiplik devri yalnız owner tarafından, denetlenen RPC üzerinden yapılır.
- Kayıtlar başka bir kasaya taşınamaz; proje, hesap, üye ve belge referansları aynı kasaya ait olmak zorundadır.
- Kesinleşmiş finansal kayıtlar silinemez veya mali alanları değiştirilemez.
- Rol ve sahiplik değişiklikleri dahil önemli işlemler denetim günlüğüne yazılır.
- Davet bağlantıları yalnız projenin HTTPS Supabase alan adından kabul edilir, tek kullanımlıdır ve kısa sürede geçersiz olur.
- Davet Edge Function'ları yalnız production/localhost originlerinden çağrılabilir, owner rolünü sunucuda doğrular ve istek boyutunu sınırlar.
- Storage'a doğrudan dosya yükleme kapalıdır. Dosyalar yetki, boyut, MIME ve gerçek dosya imzasını sunucuda kontrol eden Edge Function üzerinden yüklenir.
- Belgeler kısa süreli imzalı URL ile ve indirme eki olarak sunulur; viewer belgeye erişemez.
- CSV hücreleri formül enjeksiyonuna karşı etkisizleştirilir.
- Content Security Policy; yabancı script, object/embed, güvensiz form hedefi ve bilinmeyen API bağlantılarını engeller.
- Uygulamanın başka bir site içinde çerçevelenmesi engellenerek clickjacking riski azaltılır.
- Şifreler en az 10 karakterdir; açık kullanıcı kaydı ve anonim giriş kapalıdır.
- GitHub Actions her yayında test ve üretim derlemesi çalıştırır. `npm audit` sonucu sıfır bilinen açıktır.

## Kullanıcıların dikkat etmesi gerekenler

- Davet bağlantısını yalnız ilgili kişiye özel ve güvenilir bir kanaldan gönderin.
- Adres çubuğunda davet doğrulama alan adı `hdmnwcgispxcwkjpryxu.supabase.co`, uygulama alan adı `yunus-ozdemirr.github.io` olmalıdır.
- Başka sitelerde kullandığınız şifreyi burada tekrar kullanmayın; mümkünse parola yöneticisi kullanın.
- Tanımadığınız kişilerden gelen belgeyi indirmeyin veya açmayın.
- Owner ayrılmadan önce sahipliği güvenilir bir üyeye devretmelidir.

## Sınırlar

Hiçbir web uygulaması cihazın virüs kapmayacağını mutlak olarak garanti edemez. Dosya imzası kontrolü çalıştırılabilir dosyanın PDF/görsel gibi gösterilmesini engeller; fakat geçerli biçimde hazırlanmış kötü amaçlı bir PDF için tam antivirüs taramasının yerini tutmaz. Uygulama belgeleri tarayıcıda otomatik çalıştırmaz ve indirme olarak sunar. Daha yüksek güvence gereken kullanımda harici antivirüs/CDR servisi ve özel alan adı üzerinden HTTP güvenlik başlıkları önerilir.

Bir güvenlik problemi bulursanız herkese açık issue içinde gerçek finansal veri, davet bağlantısı veya anahtar paylaşmayın.
