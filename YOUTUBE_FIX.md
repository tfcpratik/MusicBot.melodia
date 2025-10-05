# YouTube Bot Algılama Hatası Çözümü

## Sorun Nedir?

Bazı kullanıcılarda şu hata mesajını görebilirsiniz:

```
ERROR: [youtube] Sign in to confirm you're not a bot. 
Use --cookies-from-browser or --cookies for the authentication.
```

Bu hata, YouTube'un bot koruması nedeniyle yt-dlp'nin engellemesidir. YouTube, yoğun kullanımlarda veya belirli IP'lerden gelen istekleri bot olarak algılayabilir ve cookie doğrulaması isteyebilir.

## Çözüm Yöntemleri

### Yöntem 1: Tarayıcı Cookie'lerini Kullanma (Önerilen)

Bu yöntem en kolay ve otomatik güncellenen çözümdür.

1. `.env` dosyanızı açın
2. Kullandığınız tarayıcıya göre aşağıdaki satırlardan birini ekleyin:

```env
# Chrome kullanıyorsanız
COOKIES_FROM_BROWSER=chrome

# Firefox kullanıyorsanız
COOKIES_FROM_BROWSER=firefox

# Edge kullanıyorsanız
COOKIES_FROM_BROWSER=edge

# Safari kullanıyorsanız (Mac)
COOKIES_FROM_BROWSER=safari
```

3. Belirttiğiniz tarayıcıda YouTube'a giriş yapmış olduğunuzdan emin olun
4. Botu yeniden başlatın

**Önemli:** Bu yöntemde belirttiğiniz tarayıcıda YouTube'a giriş yapmış olmanız gerekir. Bot, tarayıcınızdan otomatik olarak cookie'leri alacaktır.

### Yöntem 2: cookies.txt Dosyası Kullanma

Bu yöntem daha manuel ama bazı durumlarda daha güvenilir olabilir.

#### Adım 1: Cookie Dışa Aktarma Eklentisi Kurun

**Chrome/Edge için:**
1. [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) eklentisini kurun

**Firefox için:**
1. [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/) eklentisini kurun

#### Adım 2: Cookie'leri Dışa Aktarın

1. YouTube'a giriş yapın (herhangi bir Google hesabıyla)
2. YouTube.com sayfasındayken eklentiye tıklayın
3. "Export" veya "Download" butonuna tıklayın
4. `cookies.txt` dosyasını indirin

#### Adım 3: Dosyayı Botun Klasörüne Koyun

1. İndirdiğiniz `cookies.txt` dosyasını botun ana klasörüne kopyalayın (index.js dosyasının olduğu yer)

#### Adım 4: .env Dosyasını Güncelleyin

`.env` dosyanıza şunu ekleyin:

```env
COOKIES_FILE=./cookies.txt
```

#### Adım 5: Botu Yeniden Başlatın

```bash
npm start
```

## Hangi Yöntemi Kullanmalıyım?

| Yöntem | Avantajlar | Dezavantajlar |
|--------|-----------|---------------|
| **Tarayıcı Cookie'leri (Yöntem 1)** | ✅ Otomatik güncellenir<br>✅ Kurulumu kolay<br>✅ Dosya yönetimi gerektirmez | ❌ Tarayıcıda giriş yapmış olmalısınız<br>❌ Tarayıcı kapandığında sorun olabilir |
| **cookies.txt (Yöntem 2)** | ✅ Daha güvenilir<br>✅ Sunucularda kullanılabilir<br>✅ Tarayıcı açık olmasa da çalışır | ❌ Manuel güncelleme gerekir<br>❌ Cookie'ler zaman aşımına uğrayabilir (yenilemeniz gerekir) |

### Öneriler:

- **Kişisel bilgisayarda çalıştırıyorsanız:** Yöntem 1 (Tarayıcı Cookie'leri)
- **VPS/Sunucuda çalıştırıyorsanız:** Yöntem 2 (cookies.txt dosyası)

## Doğrulama

Kurulumu tamamladıktan sonra botu test edin:

```bash
npm start
```

Ardından Discord'da bir müzik çalmayı deneyin:
```
/play Despacito
```

## Sorun Devam Ediyorsa

Eğer hata devam ederse:

1. ✅ YouTube'a giriş yaptığınızdan emin olun
2. ✅ Tarayıcı cookie'lerini temizleyip tekrar giriş yapın
3. ✅ Farklı bir tarayıcı deneyin
4. ✅ cookies.txt dosyasını yeniden oluşturun
5. ✅ Botu tamamen kapatıp yeniden başlatın

## Güvenlik Notu

⚠️ **ÖNEMLİ:** 
- `cookies.txt` dosyanız YouTube oturum bilgilerinizi içerir
- Bu dosyayı kimseyle paylaşmayın
- `.gitignore` dosyasına `cookies.txt` eklenmiş olduğundan emin olun
- Dosyayı GitHub'a yüklemeyin

## Yardım

Sorunuz devam ediyorsa:
- [Discord Destek Sunucusu](https://discord.gg/ACJQzJuckW) - Canlı destek
- [GitHub Issues](https://github.com/umutxyp/musicbot/issues) - Hata bildirimi

---

**Not:** Cookie'ler periyodik olarak süresi dolabilir (genelde 1-2 ay). Hatayı tekrar görürseniz, cookie'leri yeniden dışa aktarmanız gerekebilir.
