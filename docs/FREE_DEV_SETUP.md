# راه‌اندازی رایگان: Mini App روی Vercel، بک‌اند روی لپتاپ

این مسیر برای زمانی است که دامنه ندارید، نمی‌خواهید هزینه کنید و استفاده سبک است؛ مثلا حدود ۲۰ نفر همزمان.

## معماری پیشنهادی

```text
Telegram Bot long polling  ─┐
                            │ روی لپتاپ شما
Hokm API + Socket.IO        ─┘  http://localhost:4000
          │
          │ Cloudflare Tunnel رایگان
          ▼
https://something.trycloudflare.com
          ▲
          │
Telegram Mini App روی Vercel رایگان
https://your-project.vercel.app
```

- دامنه اختصاصی لازم نیست.
- Mini App باید HTTPS داشته باشد؛ آدرس رایگان `vercel.app` کافی است.
- بک‌اند می‌تواند روی لپتاپ اجرا شود، ولی باید با HTTPS عمومی در دسترس موبایل‌ها باشد؛ Cloudflare Tunnel این کار را رایگان انجام می‌دهد.
- ربات در حالت long polling کار می‌کند، پس برای خود ربات webhook/domain لازم نیست.

## چرا این گزینه؟

برای استفاده سبک، فشار اصلی روی لپتاپ فقط بک‌اند Node و WebSocket چند نفر است؛ فرانت‌اند از Vercel لود می‌شود و روی لپتاپ شما serve نمی‌شود. Cloudflare فقط ترافیک را به لپتاپ tunnel می‌کند.

## قدم ۱: Deploy رایگان Mini App روی Vercel

1. ریپو را به GitHub push کنید.
2. در Vercel یک پروژه جدید از همین ریپو بسازید.
3. اگر Vercel تنظیمات را خواست، این‌ها را بدهید:
   - Framework: `Vite`
   - Build Command: `npm run build -w @hokm/web`
   - Output Directory: `apps/web/dist`
   - Install Command: `npm install`
4. بعد از deploy، یک URL شبیه این می‌گیرید:

```text
https://your-project.vercel.app
```

این می‌شود `WEB_APP_URL`.

## قدم ۲: اجرای بک‌اند روی لپتاپ

در ریشه پروژه:

```bash
npm install
cp apps/api/.env.example apps/api/.env
```

فعلا مقدارهای اصلی فایل `apps/api/.env` را بعد از گرفتن tunnel پر می‌کنیم.

## قدم ۳: Cloudflare Tunnel برای بک‌اند

اگر `cloudflared` نصب ندارید، نصبش کنید. بعد بک‌اند را اجرا کنید:

```bash
npm run dev -w @hokm/api
```

در ترمینال دوم:

```bash
cloudflared tunnel --url http://localhost:4000
```

یک URL شبیه این می‌گیرید:

```text
https://random-name.trycloudflare.com
```

این می‌شود `PUBLIC_API_URL`.

## قدم ۴: تنظیم env بک‌اند

فایل `apps/api/.env`:

```env
PORT=4000
WEB_APP_URL=https://your-project.vercel.app
PUBLIC_API_URL=https://random-name.trycloudflare.com
CORS_ORIGIN=https://your-project.vercel.app
TELEGRAM_BOT_TOKEN=توکن_بات_خودتان
```

سپس بک‌اند را restart کنید:

```bash
npm run dev -w @hokm/api
```

## قدم ۵: تست بات

در تلگرام به بات پیام دهید:

```text
/start
```

یا:

```text
/newgame
```

بات لینکی می‌دهد که داخلش دو پارامتر هست:

```text
?room=...&api=https%3A%2F%2Frandom-name.trycloudflare.com
```

مینی‌اپ از همین پارامتر `api` متوجه می‌شود باید به کدام بک‌اند وصل شود. بنابراین لازم نیست با تغییر آدرس tunnel، فرانت‌اند را دوباره deploy کنید.

## هر بار که خواستید بازی کنید

1. لپتاپ روشن باشد.
2. بک‌اند را اجرا کنید:

```bash
npm run dev -w @hokm/api
```

3. Cloudflare Tunnel را اجرا کنید:

```bash
cloudflared tunnel --url http://localhost:4000
```

4. آدرس جدید tunnel را در `apps/api/.env` به عنوان `PUBLIC_API_URL` بگذارید.
5. بک‌اند را restart کنید.
6. در تلگرام `/newgame` بزنید.

## نکته امنیتی مهم

توکن بات را در کد، README، GitHub، چت عمومی یا فایل commit شده نگذارید. فقط داخل `apps/api/.env` محلی باشد. اگر توکن جایی لو رفت، از BotFather گزینه revoke/regenerate را بزنید.

## محدودیت‌های این روش

- اگر لپتاپ خاموش شود یا اینترنت قطع شود، بازی قطع می‌شود.
- اگر بک‌اند restart شود، چون فعلا دیتابیس نداریم، میزها پاک می‌شوند.
- آدرس رایگان Cloudflare Tunnel معمولا هر بار عوض می‌شود؛ برای همین `PUBLIC_API_URL` باید آپدیت شود.
- برای ۲۰ نفر همزمان مناسب است، ولی برای انتشار عمومی باید دیتابیس و deploy پایدار اضافه شود.
