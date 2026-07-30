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
