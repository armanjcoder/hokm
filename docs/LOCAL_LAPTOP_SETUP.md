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

### Mini App باز نمی‌شود

احتمالا Cloudflare Tunnel بسته شده یا آدرس `.env` قدیمی است.

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
