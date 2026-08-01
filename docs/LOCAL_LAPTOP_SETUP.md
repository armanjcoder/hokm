# راه‌اندازی کامل روی لپتاپ، بدون دامنه و بدون Vercel

این راه برای زمانی است که می‌خواهید همه‌چیز روی لپتاپ خودتان اجرا شود و فقط یک لینک HTTPS موقت برای تلگرام بگیرید.

## نتیجه نهایی

فقط یک برنامه Node روی لپتاپ اجرا می‌شود و همزمان این کارها را انجام می‌دهد:

- بک‌اند بازی حکم
- Socket.IO برای بازی real-time
- ربات تلگرام با long polling
- سرو کردن فایل‌های Mini App

بعد با Cloudflare Tunnel، همین برنامه یک آدرس HTTPS رایگان می‌گیرد:

```text
https://random-name.trycloudflare.com
```

همین یک آدرس هم `WEB_APP_URL` است، هم `PUBLIC_API_URL`.

## چیزهایی که لازم دارید

1. Node.js نسخه ۲۰ یا بالاتر
2. npm
3. cloudflared برای ساخت تونل رایگان
4. توکن BotFather

## مرحله ۱: نصب Node.js

در ترمینال/Command Prompt بنویسید:

```bash
node -v
npm -v
```

اگر نسخه Node کمتر از ۲۰ بود یا دستور پیدا نشد، Node.js LTS را نصب کنید:

```text
https://nodejs.org
```

بعد دوباره `node -v` را چک کنید.

## مرحله ۲: نصب وابستگی‌های پروژه

در پوشه پروژه:

```bash
npm install
```

این دستور فقط یک بار لازم است، مگر اینکه بعدا وابستگی جدید اضافه شود.

## مرحله ۳: ساخت فایل تنظیمات محلی

در پوشه پروژه:

```bash
cp apps/api/.env.example apps/api/.env
```

اگر ویندوز هستید و `cp` کار نکرد، این کار را دستی انجام دهید:

1. بروید داخل `apps/api`
2. از فایل `.env.example` یک کپی بگیرید
3. اسم کپی را بگذارید `.env`

## مرحله ۴: توکن ربات را داخل `.env` بگذارید

فایل زیر را باز کنید:

```text
apps/api/.env
```

فعلا این شکلی باشد:

```env
PORT=4000
SERVE_WEB_DIST=true
WEB_APP_URL=http://localhost:4000
PUBLIC_API_URL=http://localhost:4000
CORS_ORIGIN=http://localhost:4000
TELEGRAM_BOT_TOKEN=توکن_بات_شما
```

توکن را فقط همین‌جا بگذارید و آن را در GitHub یا فایل‌های commit شده قرار ندهید.

## مرحله ۵: build پروژه

در پوشه پروژه:

```bash
npm run build
```

این دستور Mini App و بک‌اند را آماده اجرا می‌کند.

## مرحله ۶: اجرای پروژه روی لپتاپ

در همان ترمینال:

```bash
npm run start -w @hokm/api
```

اگر درست اجرا شود، باید چیزی شبیه این ببینید:

```text
Hokm API listening on http://localhost:4000
```

این ترمینال را باز نگه دارید. اگر ببندید، ربات و بازی خاموش می‌شوند.

## مرحله ۷: تست محلی در مرورگر

در مرورگر لپتاپ باز کنید:

```text
http://localhost:4000
```

باید صفحه Hokm Club را ببینید.

همچنین این آدرس را تست کنید:

```text
http://localhost:4000/health
```

باید جواب JSON بگیرید، مثلا:

```json
{ "ok": true }
```

## مرحله ۸: نصب cloudflared

Cloudflare Tunnel به شما یک لینک HTTPS رایگان و موقت می‌دهد.

### ویندوز

ساده‌ترین روش:

1. بروید به:

```text
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

2. نسخه Windows را دانلود کنید.
3. فایل `cloudflared.exe` را در یک پوشه ساده مثل `C:\cloudflared` بگذارید.
4. Command Prompt را در همان پوشه باز کنید.

### macOS

اگر Homebrew دارید:

```bash
brew install cloudflared
```

### Linux

از صفحه رسمی Cloudflare نسخه مناسب سیستم خودتان را نصب کنید:

```text
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

## مرحله ۹: ساخت تونل HTTPS

یک ترمینال/Command Prompt دوم باز کنید. ترمینال اول که پروژه در آن اجراست را نبندید.

در ترمینال دوم:

```bash
cloudflared tunnel --url http://localhost:4000
```

بعد از چند ثانیه یک آدرس شبیه این می‌بینید:

```text
https://something-random.trycloudflare.com
```

این آدرس را کپی کنید.

## مرحله ۱۰: تنظیم آدرس HTTPS داخل `.env`

حالا فایل زیر را دوباره باز کنید:

```text
apps/api/.env
```

مقدارهای `WEB_APP_URL`، `PUBLIC_API_URL` و `CORS_ORIGIN` را همان آدرس Cloudflare بگذارید:

```env
PORT=4000
SERVE_WEB_DIST=true
WEB_APP_URL=https://something-random.trycloudflare.com
PUBLIC_API_URL=https://something-random.trycloudflare.com
CORS_ORIGIN=https://something-random.trycloudflare.com
TELEGRAM_BOT_TOKEN=توکن_بات_شما
```

## مرحله ۱۱: restart پروژه

ترمینال اول را که پروژه در آن اجراست متوقف کنید:

- در ویندوز/مک/لینوکس معمولا با `Ctrl + C`

بعد دوباره اجرا کنید:

```bash
npm run start -w @hokm/api
```

Cloudflare Tunnel در ترمینال دوم باید همچنان باز بماند.

## مرحله ۱۲: تست لینک HTTPS

در مرورگر یا موبایل باز کنید:

```text
https://something-random.trycloudflare.com
```

باید Mini App را ببینید.

تست health:

```text
https://something-random.trycloudflare.com/health
```

باید JSON جواب بدهد.

## مرحله ۱۳: تست ربات تلگرام

در تلگرام به ربات خودتان پیام دهید:

```text
/start
```

یا:

```text
/newgame
```

ربات باید دکمه باز کردن Mini App بدهد.

## هر بار که بعدا خواستید بازی کنید

چون Cloudflare Tunnel رایگان آدرس موقت می‌دهد، هر بار مراحل زیر را انجام دهید:

1. پروژه را اجرا کنید:

```bash
npm run start -w @hokm/api
```

2. در ترمینال دوم تونل بزنید:

```bash
cloudflared tunnel --url http://localhost:4000
```

3. آدرس جدید `https://...trycloudflare.com` را کپی کنید.
4. داخل `apps/api/.env` این سه مقدار را آپدیت کنید:

```env
WEB_APP_URL=https://new-random.trycloudflare.com
PUBLIC_API_URL=https://new-random.trycloudflare.com
CORS_ORIGIN=https://new-random.trycloudflare.com
```

5. پروژه را با `Ctrl + C` خاموش و دوباره روشن کنید:

```bash
npm run start -w @hokm/api
```

6. در تلگرام `/newgame` بزنید.

## خاموش کردن بازی

برای پایان فاز تست یا خاموش کردن بازی:

1. در ترمینالی که پروژه اجراست، `Ctrl + C` بزنید.
2. در ترمینالی که Cloudflare Tunnel اجراست، `Ctrl + C` بزنید.

بعد از این، لینک Mini App دیگر کار نمی‌کند تا دوباره پروژه و تونل را روشن کنید.

## خطاهای رایج

### Cloudflare Tunnel لینک نمی‌دهد و `context deadline exceeded` می‌بینید

این خطا معمولا مشکل پروژه نیست. یعنی برنامه `cloudflared` نتوانسته از شبکه شما به سرویس `api.trycloudflare.com` وصل شود یا جواب را به‌موقع بگیرد.

اول مطمئن شوید دستور را بدون براکت و بدون Markdown می‌زنید:

```bash
cloudflared tunnel --url http://localhost:4000
```

در PowerShell اگر فایل exe اسم دیگری دارد:

```powershell
.\cloudflared-windows-amd64.exe tunnel --url http://localhost:4000
```

بعد این نسخه مقاوم‌تر را امتحان کنید:

```powershell
.\cloudflared-windows-amd64.exe tunnel --edge-ip-version 4 --protocol http2 --url http://localhost:4000
```

اگر باز هم timeout شد:

1. اینترنت یا Wi‑Fi دیگری را امتحان کنید؛ مثلا hotspot موبایل.
2. VPN را روشن کنید و دوباره دستور را بزنید.
3. اگر VPN دارید ولی کار نمی‌کند، split tunneling را خاموش کنید تا `cloudflared` هم از VPN رد شود.
4. فایروال/آنتی‌ویروس را چک کنید که جلوی `cloudflared.exe` را نگرفته باشد.
5. نسخه جدید `cloudflared` را از سایت Cloudflare دانلود کنید.

برای تست اتصال به Cloudflare در PowerShell:

```powershell
Test-NetConnection api.trycloudflare.com -Port 443
```

اگر `TcpTestSucceeded` برابر `False` بود، شبکه شما اتصال به Cloudflare را بسته یا دچار اختلال است.

اگر Cloudflare با شبکه شما کار نکرد، می‌توانید موقتا از Pinggy استفاده کنید. اول بررسی کنید SSH نصب است:

```powershell
ssh -V
```

بعد این دستور را بزنید:

```powershell
ssh -p 443 -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 0:127.0.0.1:4000 free@a.pinggy.io
```

اگر پرسید ادامه می‌دهید، `yes` بزنید. اگر از شما password خواست، پسورد نزنید؛ `Ctrl + C` بزنید و یک SSH key بسازید:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh"
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519"
```

وقتی پرسید `Enter passphrase` فقط Enter بزنید. وقتی دوباره پرسید `Enter same passphrase again` باز هم فقط Enter بزنید. اگر گفت فایل از قبل وجود دارد، `n` بزنید تا کلید قبلی overwrite نشود. سپس دوباره Pinggy را با public-key اجرا کنید:

```powershell
ssh -p 443 -i "$env:USERPROFILE\.ssh\id_ed25519" -o PasswordAuthentication=no -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 0:127.0.0.1:4000 free@a.pinggy.io
```

خروجی باید یک لینک HTTPS شبیه این بدهد:

```text
https://something.a.free.pinggy.link
```

این لینک را دقیقا مثل لینک Cloudflare در `.env` برای `WEB_APP_URL`، `PUBLIC_API_URL` و `CORS_ORIGIN` بگذارید.

### Mini App باز نمی‌شود

احتمالا Tunnel بسته شده یا آدرس `.env` قدیمی است.

### ربات جواب نمی‌دهد

بررسی کنید:

- `TELEGRAM_BOT_TOKEN` داخل `.env` درست باشد.
- پروژه با `npm run start -w @hokm/api` روشن باشد.
- اینترنت لپتاپ وصل باشد.

### داخل Mini App خطای اتصال می‌گیرید

بررسی کنید:

- آدرس `PUBLIC_API_URL` و `WEB_APP_URL` یکی باشند.
- هر دو با `https://` شروع شوند.
- تونل Cloudflare هنوز روشن باشد.

### بعد از restart میزها پاک شدند

طبیعی است. در فاز اول دیتابیس نداریم و میزها داخل حافظه نگهداری می‌شوند. در فاز دوم دیتابیس اضافه می‌کنیم.

## وقتی VPN تونل را قطع می‌کند: پروکسی فقط برای تلگرام

روی شبکه‌های فیلترشده دو نیاز با هم تضاد پیدا می‌کنند:

- `api.telegram.org` بدون VPN در دسترس نیست، پس ربات بالا نمی‌آید
  (`connect ETIMEDOUT 10.10.34.36:443`).
- با VPN سیستمی، Cloudflare Tunnel قطع می‌شود.

راه حل: VPN سیستمی را روشن نکنید و به‌جایش **فقط** ترافیک Bot API را از یک
پروکسی محلی عبور دهید. بقیه‌ی فرایند (تونل، وب‌سوکت بازیکنان) مستقیم می‌ماند.

در `apps/api/.env`:

```env
TELEGRAM_PROXY_URL=socks5://127.0.0.1:10808
```

مقدار درست بستگی به کلاینت شما دارد؛ پورت SOCKS محلی همان است که در تنظیمات
کلاینت می‌بینید (نمونه‌های رایج: v2rayN روی `10808`، Nekoray روی `2080`).
پروکسی HTTP هم پشتیبانی می‌شود: `http://127.0.0.1:8080`.
اگر پروکسی نام کاربری/رمز دارد: `socks5://user:pass@127.0.0.1:1080`.

هنگام اجرا این خط در لاگ چاپ می‌شود (رمز عبور هرگز چاپ نمی‌شود):

```
Telegram bot network: socks5://127.0.0.1:10808.
```

اگر مقدار نامعتبر باشد فقط یک هشدار چاپ می‌شود و API سالم بالا می‌آید؛ نبود
پروکسی هیچ‌وقت باعث کرش سرور بازی نمی‌شود.

## صفحه‌ی سفید در مینی‌اپ (اسکریپت تلگرام بلاک شده)

نشانه: مینی‌اپ باز می‌شود ولی فقط پس‌زمینه‌ی گرادیانی دیده می‌شود و هیچ‌وقت
چیزی لود نمی‌شود.

علت: `index.html` اسکریپت SDK را از `telegram.org` می‌گرفت. روی شبکه‌های
فیلترشده این درخواست به‌جای رد شدن سریع، «بلعیده» می‌شود و تا تایم‌اوت مرورگر
باز می‌ماند. چون اسکریپت باندل از نوع `type="module"` است و ماژول‌ها همیشه
تا بعد از پارس کامل سند به تعویق می‌افتند، اجرای برنامه پشت آن درخواست
گیر می‌کرد.

رفع: اسکریپت از `index.html` حذف شد و حالا `loadTelegramSdk()` آن را با
مهلت ۲.۵ ثانیه تزریق می‌کند. اگر SDK نیامد، برنامه به‌هر‌حال رندر می‌شود و
هویت به حالت مهمان برمی‌گردد. تا آن لحظه هم یک اسپلش («در حال بارگذاری حکم…»)
نمایش داده می‌شود تا کاربر هیچ‌وقت صفحه‌ی خالی نبیند.


## تغییرات ظاهری اعمال نمی‌شود (مهم)

اگر `git pull` زدی ولی هیچ تغییری در ظاهر ندیدی، تقریباً همیشه یک دلیل دارد:
**پوشه‌ی `dist` در `.gitignore` است و داخل مخزن نیست.**

یعنی `git pull` فقط کد منبع را به‌روز می‌کند؛ فایل‌هایی که مرورگر واقعاً
بارگذاری می‌کند تا وقتی `npm run build` نزنی، همان نسخه‌ی قدیمی می‌مانند.

ترتیب درست:

```powershell
cd C:\Users\arman\Desktop\hokm
git pull origin arena/019fb173-hokm
npm install
npm run build          # <-- بدون این، هیچ تغییری دیده نمی‌شود
npm run start -w @hokm/api
```

### چطور مطمئن شویم نسخه‌ی تازه سرو می‌شود؟

آدرس `/health` حالا نام فایل استایل ساخته‌شده را برمی‌گرداند:

```json
{ "ok": true, "service": "hokm-api", "bundle": "index-BRCGvOPm.css" }
```

در مرورگر (یا DevTools تلگرام دسکتاپ) ببین صفحه چه فایلی را لود کرده است.
اگر آن نام با مقدار `bundle` یکی بود، جدیدترین نسخه در حال اجراست؛ اگر فرق
داشت، یا build نزده‌ای یا مرورگر نسخه‌ی کش‌شده را نگه داشته است.

### پاک‌کردن کش مینی‌اپ در تلگرام

سرور هدر `no-store` می‌فرستد، ولی WebView تلگرام گاهی سرسختی می‌کند:

- تلگرام دسکتاپ: روی مینی‌اپ راست‌کلیک → Reload
- موبایل: مینی‌اپ را کامل ببند (از لیست اپ‌های باز هم) و دوباره باز کن
