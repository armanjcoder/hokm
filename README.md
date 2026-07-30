# Hokm Club

ربات تلگرام و Telegram Mini App برای بازی حکم ایرانی؛ با بک‌اند Real-time و موتور قوانین مستقل.

## وضعیت فعلی

فاز اول پروژه پیاده‌سازی شده است:

- Monorepo با npm workspaces
- موتور بازی حکم در `packages/game-engine`
- API با Express و Socket.IO در `apps/api`
- ربات تلگرام پایه با grammY
- مینی‌اپ React/Vite با UI مدرن، RTL و موبایل‌محور در `apps/web`
- تست‌های اولیه برای قوانین اصلی حکم

## اجرای محلی

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run dev
```

سرویس‌ها:

- Mini App: `http://localhost:5173`
- API: `http://localhost:4000`
- Health: `http://localhost:4000/health`

برای فعال کردن ربات تلگرام، مقدارهای `TELEGRAM_BOT_TOKEN`، `WEB_APP_URL`، `PUBLIC_API_URL` و `CORS_ORIGIN` را در `apps/api/.env` تنظیم کنید.

اگر دامنه و Vercel ندارید و می‌خواهید همه‌چیز روی لپتاپ اجرا شود، راهنمای [`docs/LOCAL_LAPTOP_SETUP.md`](docs/LOCAL_LAPTOP_SETUP.md) را ببینید. اگر بعدا خواستید Mini App را رایگان روی Vercel بگذارید، راهنمای [`docs/FREE_DEV_SETUP.md`](docs/FREE_DEV_SETUP.md) هم موجود است.

## اسکریپت‌ها

```bash
npm run build      # build همه پکیج‌ها
npm run test       # اجرای تست‌ها
npm run typecheck  # بررسی TypeScript
npm run dev        # اجرای dev همه اپ‌ها
```

## معماری

جزئیات معماری و نقشه راه در [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) آمده است.

## گرفتن آخرین تغییرات روی لپتاپ (Workflow ثابت)

بعد از merge شدن هر PR، فقط این چند دستور را در PowerShell بزنید:

```powershell
cd C:\Users\arman\Desktop\hokm
git pull origin main
npm install
npm run build
npm run start -w @hokm/api
```

نکته: فایل `.npmrc` در ریشه پروژه مقدار `package-lock=false` دارد، بنابراین `npm install`
دیگر `package-lock.json` را بازنویسی نمی‌کند و `git pull` روی این فایل conflict نمی‌دهد.

اگر به هر دلیل باز هم پیام زیر را دیدید:

```text
error: Your local changes to the following files would be overwritten by merge: package-lock.json
```

یک بار این را بزنید و دوباره pull کنید:

```powershell
git restore package-lock.json
git pull origin main
```

## پیام‌های خطا

کدهای خطا (مثل `ROOM_NOT_FOUND`) انگلیسی می‌مانند چون قرارداد ماشینی بین API و Mini App هستند،
اما هر پیامی که به بازیکن نمایش داده می‌شود فارسی است. ترجمه‌ها در
[`apps/api/src/messages.ts`](apps/api/src/messages.ts) نگهداری می‌شوند و Mini App هم اگر پیام
سرور فارسی نباشد، متن فارسی جایگزین خودش را نشان می‌دهد.

## نشست بازیکن (Player Session)

`playerId` عمومی است و در snapshot میز برای همه صندلی‌ها ارسال می‌شود، پس به‌تنهایی هویت را ثابت نمی‌کند.
به همین دلیل هر بازیکن یک `token` سری هم می‌گیرد:

- توکن فقط یک‌بار و فقط به صاحبش برگردانده می‌شود (پاسخ `POST /rooms` و `POST /rooms/:id/join`).
- `sanitizeRoom` توکن را از همه‌ی broadcastها حذف می‌کند.
- همه‌ی اکشن‌های Socket.IO (`room:join`، `choose_trump`، `play_card`، `next_hand`) توکن را با
  مقایسه زمان‌ثابت بررسی می‌کنند؛ در غیر این صورت خطای `INVALID_SESSION` برمی‌گردد.
- Mini App توکن را در `localStorage` کنار session نگه می‌دارد، پس بعد از restart بک‌اند هم به همان صندلی برمی‌گردد.
- میزهایی که قبل از این قابلیت ذخیره شده‌اند توکن ندارند؛ اولین بازیکنی که آن صندلی را claim کند
  توکن جدید می‌گیرد و از آن به بعد صندلی قفل می‌شود.
