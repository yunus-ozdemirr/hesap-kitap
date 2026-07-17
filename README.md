# Ortak Kasa

## Google ile herkese açık kayıt

Uygulama Google OAuth ile yeni kullanıcı kaydı, bağımsız kasa oluşturma, birden fazla kasaya üyelik ve kasalar arasında geçişi destekler. Google sağlayıcısını bir kez yapılandırmak gerekir:

1. Google Cloud Console → **APIs & Services → OAuth consent screen** bölümünde uygulamayı oluşturun.
2. **Credentials → Create credentials → OAuth client ID → Web application** seçin.
3. Authorized JavaScript origin olarak `https://hdmnwcgispxcwkjpryxu.supabase.co` ekleyin.
4. Authorized redirect URI olarak `https://hdmnwcgispxcwkjpryxu.supabase.co/auth/v1/callback` ekleyin.
5. Supabase Dashboard → **Authentication → Providers → Google** bölümünü açın.
6. Google Client ID ve Client Secret değerlerini yalnız Supabase paneline girip sağlayıcıyı etkinleştirin.

Client Secret GitHub değişkenlerine, `.env` dosyasına veya tarayıcı koduna konmamalıdır. Google şifresi uygulamayla paylaşılmaz; kimlik doğrulama Google sayfasında gerçekleşir.

Öğrenci grupları, dernekler, küçük ekipler ve proje toplulukları için ortak kasa, gider ve belge takip uygulaması. Arayüz GitHub Pages'te, veriler Supabase PostgreSQL ve özel Storage alanında çalışır.

## Neler hazır?

- Davetli kullanıcı girişi, toplu davet ve `owner` / `editor` / `viewer` rolleri
- Kullanıcının belirlediği başlangıç bakiyesi, dinamik kalan yüzdesi, denetimli bakiye düzeltme, gelir, gider, üye ödemesi, geri ödeme ve transfer modeli
- Proje bütçeleri, belge eksik uyarıları, CSV ve yazdırılabilir aylık rapor
- PDF/JPG/PNG belge yükleme, 10 MB sınırı ve özel Storage bucket'ı
- PostgreSQL RLS politikaları ve değişiklik denetim günlüğü
- GitHub Actions ile test, derleme ve Pages dağıtımı
- Supabase ayarı olmadan otomatik demo modu

## Baştan sona canlıya alma

Bu bölüm boş bir Supabase/GitHub hesabından çalışan canlı siteye kadar gereken adımların tamamıdır.

### 1. Gerekenler

- [GitHub hesabı](https://github.com/)
- [Supabase hesabı](https://supabase.com/dashboard)
- Bilgisayarda Git ve Node.js 22 veya üzeri
- Terminalde bu proje klasörünün açık olması

Kurulumları doğrulayın:

```bash
git --version
node --version
npm --version
```

### 2. Önce yerel demoyu kontrol edin

```bash
npm install
npm test
npm run dev
```

`http://localhost:5173/` adresi Supabase ayarı olmadan demo verileriyle açılır. Test bitince terminalde `Ctrl+C` kullanın.

### 3. Boş GitHub deposu oluşturun

GitHub'da **New repository** ile örneğin `ortak-kasa` adında boş bir depo oluşturun. README, `.gitignore` veya lisans ekletmeyin. Henüz push yapmadan proje klasöründe çalıştırın:

```bash
git init
git add .
git commit -m "Ortak Kasa ilk sürüm"
git branch -M main
git remote add origin https://github.com/GITHUB_KULLANICI_ADINIZ/DEPO_ADINIZ.git
```

Canlı adresiniz şu biçimde olacak:

```text
https://GITHUB_KULLANICI_ADINIZ.github.io/DEPO_ADINIZ/
```

### 4. Supabase projesi oluşturun

1. [Supabase Dashboard](https://supabase.com/dashboard) → **New project** seçin.
2. Proje adı, güçlü veritabanı parolası ve yakın bir bölge seçin.
3. Proje açılınca **Connect** penceresinden şunları not edin:
   - Project URL: `https://PROJE_KODU.supabase.co`
   - Publishable key: `sb_publishable_...`
   - Project ref: URL içindeki `PROJE_KODU`

Publishable key tarayıcı uygulamalarında kullanılabilir. `secret` veya `service_role` anahtarını hiçbir zaman GitHub değişkenlerine, `.env` dosyasına ya da frontend koduna koymayın.

### 5. Veritabanını ve davet fonksiyonunu yayınlayın

Proje klasöründe sırasıyla çalıştırın:

```bash
npx supabase login
npx supabase link --project-ref PROJE_KODU
npx supabase db push
npx supabase functions deploy invite-user
npx supabase secrets set APP_URL=https://GITHUB_KULLANICI_ADINIZ.github.io/DEPO_ADINIZ/
```

`db push`, `supabase/migrations/` içindeki bütün migration dosyalarını tarih sırasıyla uygular. Edge Function'ın kullandığı yönetici anahtarı Supabase tarafından sunucu ortamına sağlanır ve tarayıcıya gönderilmez.

Komut sonunda migration ve function listelerini kontrol edin:

```bash
npx supabase migration list
npx supabase functions list
```

### 6. Supabase giriş adreslerini ayarlayın

Supabase Dashboard → **Authentication → URL Configuration** bölümünde:

- Site URL: `https://GITHUB_KULLANICI_ADINIZ.github.io/DEPO_ADINIZ/`
- Redirect URLs:
  - `https://GITHUB_KULLANICI_ADINIZ.github.io/DEPO_ADINIZ/**`
  - `http://localhost:5173/**`
  - `http://127.0.0.1:5173/**`

Authentication → Providers → Email bölümünde açık kullanıcı kaydını kapalı tutun. Kullanıcılar owner tarafından davet edilecek.

### 7. İsterseniz canlı Supabase'i yerelde deneyin

`.env.example` dosyasını `.env.local` adıyla kopyalayıp değerleri doldurun:

```env
VITE_SUPABASE_URL=https://PROJE_KODU.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Sonra `npm run dev` çalıştırın. `.env.local` Git tarafından yok sayılır.

### 8. GitHub Actions değişkenlerini ekleyin

GitHub deposunda **Settings → Secrets and variables → Actions → Variables → New repository variable** yolunu açın ve iki değişken oluşturun:

| Değişken | Değer |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://PROJE_KODU.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |

Bunlar hassas yönetici anahtarları değildir; erişim güvenliğini PostgreSQL RLS politikaları sağlar.

### 9. GitHub Pages'i açıp kodu gönderin

GitHub deposunda **Settings → Pages → Build and deployment → Source** alanını **GitHub Actions** olarak seçin. Ardından terminalde:

```bash
git push -u origin main
```

Repo → **Actions** bölümünde “GitHub Pages'e dağıt” iş akışının yeşil olmasını bekleyin. Başarılı olunca site şu adreste açılır:

```text
https://GITHUB_KULLANICI_ADINIZ.github.io/DEPO_ADINIZ/
```

Sonraki güncellemelerde yalnızca şunlar yeterlidir:

```bash
git add .
git commit -m "Güncelleme açıklaması"
git push
```

### 10. İlk owner hesabını oluşturun

1. Supabase Dashboard → **Authentication → Users → Invite user** seçin.
2. Kendi e-posta adresinizi davet edin.
3. E-postadaki bağlantıyı açın ve canlı siteye giriş yapın.
4. Kasa adını ve istediğiniz başlangıç bakiyesini yazın.
5. **Kasayı oluştur** düğmesine basın. İlk kullanıcı `owner` olur.

### 11. Başka kullanıcıları davet edin

1. Canlı uygulamada **Ekip → Kişi davet et** bölümünü açın.
2. E-postaları virgül, boşluk veya yeni satırla girin.
3. `viewer` veya `editor` rolünü seçip davetleri gönderin.
4. Kullanıcılar kendi e-postalarındaki bağlantıyla giriş yapar.

Tek gönderimde en fazla 50 adres kabul edilir; toplam üye sayısı sınırlı değildir.

### 12. Canlıya alma kontrol listesi

- GitHub Actions yeşil ve Pages adresi açılıyor.
- Davetsiz kullanıcı finansal verileri göremiyor.
- Owner, başlangıç bütçesini ve güncel bakiyeyi değiştirebiliyor.
- Editor gider/proje ekleyebiliyor ama kullanıcı rolü değiştiremiyor.
- Viewer yalnızca görüntüleyebiliyor ve fatura dosyasını açamıyor.
- Test PDF/JPG/PNG belgesi yüklenebiliyor.
- CSV, JSON yedeği ve yazdırma raporu çalışıyor.

## Hesaplama kuralları

- Açılış ve gelir kullanılabilir bakiyeyi artırır.
- Grup kasası/bankasıyla ödenen gider bakiyeyi azaltır.
- Üyenin cebinden ödediği gider proje maliyetini artırır, fakat kasa bakiyesini hemen azaltmaz.
- Üyeye geri ödeme kasayı azaltır ve üye alacağını kapatır; proje gideri ikinci kez artmaz.
- Kasa–banka transferi toplam bakiyeyi değiştirmez.
- `voided` kayıtlar hesaplara dahil edilmez.

## Kontroller

```bash
npm test
npm run build
```

RLS kabul senaryoları `supabase/tests/rls_checklist.sql` içinde listelenmiştir. Canlıya almadan önce owner/editor/viewer test hesaplarıyla Supabase projesinde doğrulanmalıdır.

Bu uygulama ekip içi takip aracıdır; resmî dernek defteri veya mali müşavir hizmetinin yerine geçmez.
