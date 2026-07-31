# Hokm Club — Context Handoff

> این فایل برای ادامه‌دادن کار در یک session جدید است. کل محتوای فایل را کپی کن
> و به‌عنوان اولین پیام به agent جدید بده. هیچ توضیح اضافه‌ای لازم نیست.

---

## ۰) دستور به Agent

تو یک coding agent روی Arena.ai هستی که روی مخزن `armanjcoder/hokm` کار می‌کنی،
روی برنچ `arena/019fb173-hokm` (PR باز: https://github.com/armanjcoder/hokm/pull/2 با base `main`).
این سند کل تاریخچه‌ی کار تا امروز است. آن را به‌عنوان حقیقت پایه بپذیر، تکرارش نکن،
و دقیقاً با همان قواعد زیر ادامه بده.

---

## ۱) قواعد همکاری (سخت‌گیرانه رعایت شود)

**زبان**
- کاربر فارسی می‌نویسد. توضیح‌ها، گزارش‌ها و نقدها **به فارسی**.
- کد، کامنت‌های داخل کد، نام متغیرها و پیام‌های commit **به انگلیسی**.
- تمام متن‌هایی که کاربر نهایی می‌بیند **فارسی**؛ فقط کدهای ماشین‌خوان خطا
  (مثل `ROOM_NOT_FOUND`) انگلیسی می‌مانند.

**روش کار — مهم‌ترین قاعده**
1. هر فاز را به زیرمرحله‌های کوچک بشکن.
2. **در هر نوبت فقط یک زیرمرحله** را پیاده کن.
3. اجرا کن: `npm run build` · `npm run test` · `npm run typecheck`.
4. بعد **در نقش یک منتقد بسیار سخت‌گیر** خودت را از ۰ تا ۱۰ نقد کن، در همه‌ی
   ابعاد فنی **و بصری**.
5. نمره باید **واقعی** باشد. چون خودت کد را نوشته‌ای یا چون نسبت به قبل بهتر
   شده، نمره را بالا نبر. جمله‌ی خود کاربر:
   > «ممکنه یک بخش رو بهبود داده باشی ولی هنوزم میتونسته خیلی خیلی بهتر بوده باشه»
6. **هر بُعدی که زیر ۹.۵ شد، همان را اصلاح/بازطراحی کن و دوباره نقد کن.**
   این حلقه را تا بالای ۹.۵ تکرار کن.
7. تازه بعد از آن گزارش بده و منتظر تأیید کاربر بمان.

**اثبات کن، فرض نکن**
- ادعاها باید با اندازه‌گیری یا regression probe ثابت شوند: عمداً باگ تزریق کن،
  ببین تست قرمز می‌شود، بعد برگردان.
- اگر چیزی را نتوانستی واقعاً اثبات کنی، **صریح بگو نتوانستی**. اثبات جعلی ممنوع.
  (سابقه: یک بار هارنس jsdom ساخته شد که `type="module"` را اجرا نمی‌کرد و
  نتیجه‌اش بی‌اعتبار بود؛ همان‌جا صادقانه اعلام شد.)

**امنیت**
- هرگز secret را commit نکن. `.env` در gitignore بماند.
- کاربر توکن ربات را چند بار در چت paste کرده. بارها به او گفته شده در BotFather
  `/revoke` بزند — **هنوز تأیید نکرده که انجام داده**. در فرصت مناسب یادآوری کن.

**گیت**
- فقط روی `arena/019fb173-hokm` کار کن و فقط به همان push کن.
- **خطر محیطی مکرر:** workspace چند بار وسط کار re-clone شده و تاریخچه‌ی محلی
  یتیم شده (یک بار کار commit‌نشده هم پرید). الگوی بازیابی:
  `git stash -u` → `git fetch origin <branch>` → `git reset --hard FETCH_HEAD`
  → `git stash pop` → **حتماً بررسی کن فایل‌ها سر جایشان هستند** → rebuild.
  نشانه‌اش: `tsc: not found` یا ناپدیدشدن `node_modules`.

---

## ۲) تصمیم‌های محصولی که کاربر گرفته (تکرار نکن، نقض نکن)

| موضوع | تصمیم |
|---|---|
| فاز ۳.۲.۴ (امتیاز کوت قابل تنظیم) | **رد شد** — «اصلا خوب نیست» |
| فاز ۳.۲.۵ (لاگ رخدادهای بازی) | **رد شد** — «قشنگی بازی حکم به اینه که آدم حواسش باشه چه کارت‌هایی تا حالا بازی شده و طبق اون استراتژی بچینه» |
| آیکن میزبان | **تاج (👑) ممنوع** — با «حاکم» اشتباه می‌شود |
| قوانین اختیاری (ده‌لو کم / بام) | پیش‌فرض **روشن** — «چون تو بازی واقعی هم همینجوریه معمولا» |
| هدف طراحی UI | مدرن، مینیمال، جوان‌پسند، جذاب، RTL فارسی، موبایل‌محور برای تلگرام |

---

## ۳) وضعیت فعلی پروژه

**تست‌ها: ۴۲۳ تست، همه سبز** — game-engine ۱۰۰ · api ۲۱۷ · web ۱۰۶
`npm run build` ✅ · `npm run typecheck` ✅

**فازهای تمام‌شده**

- **فاز ۱** — MVP: monorepo، موتور بازی، Express+Socket.IO+grammY، مینی‌اپ React/Vite.
- **فاز ۲.۱** — پایداری SQLite با `sql.js`.
- **فاز ۲.۲** — پیام‌های خطای فارسی (`messages.ts` + `errorBody()`)؛ `.npmrc`؛
  `playerToken` مخفی با `timingSafeEqual`؛ reconnect خودکار Socket.IO
  (rejoin در هر `connect`، backoff ۰.۵–۵ ثانیه با jitter) و ردیابی disconnect
  با محافظت از race چندتبی؛ UX صریح «ادامه‌ی میز» (`idle`/`resuming`/`active`)؛
  تست‌های e2e واقعی restart/reconnect با سرور spawn‌شده.
- **فاز ۲.۳** — اعتبارسنجی HMAC روی `initData`
  (`secret_key = HMAC_SHA256("WebAppData", bot_token)`)، انقضای ۲۴ ساعته‌ی
  `auth_date`، پس‌گرفتن صندلی برای کاربر تأییدشده، حالت سخت‌گیر وقتی توکن هست.
- **فاز ۲.۴** — چرخه‌ی عمر میز: میزبان واقعی + انتقال خودکار، ready-up به‌جای
  دکمه‌ی start (ربات‌ها همیشه ready ⇒ ۱ تا ۴ انسان کار می‌کند)، هر کلیک یک ربات،
  حذف ربات، ترک میز (در لابی صندلی آزاد می‌شود / وسط بازی صندلی می‌ماند)،
  وضعیت `abandoned`، job پاک‌سازی خودکار، انیمیشن تمام‌صفحه‌ی شروع برای همه.
- **فاز ۲.۵** — سخت‌سازی: rate limiter پنجره‌ی لغزان در حافظه، پاک‌سازی نام نمایشی
  (حذف control chars، bidi override‌های `U+202A`–`U+202E`/`U+2066`–`U+2069`،
  zero-width)، نوشتن اتمی DB (temp+rename)، بازیابی DB خراب،
  خاموشی تمیز SIGINT/SIGTERM، سقف ۳۲kb برای body.
- **فاز ۲.۶** — ماژولارسازی کامل (`server.ts` از ۸۶۸ به ۷۷ خط؛ همه‌ی فایل‌ها ≤۲۵۰ خط).
- **فاز ۳.۱** — سه حالت بازی با `ModeConfig`؛ `TeamId` به `number` تعمیم یافت؛
  فازهای جدید `discarding`/`drawing`؛ انتخابگر حالت + راهنمای قوانین هر حالت.
- **فاز ۳.۲.۱** — امتیاز هدف قابل تنظیم (۳/۵/۷/۱۱) + `POST /settings` مخصوص میزبان
  (تغییر حالت، میز را resize می‌کند، ربات‌های اضافه را حذف و readiness را ریست می‌کند).
- **فاز ۳.۲.۲** — ده‌لو کم (اعتبارسنجی سمت سرور، حداکثر ۲ بار، ربات‌ها هم استفاده می‌کنند).
- **فاز ۳.۲.۳** — بام.
- **فاز ۳.۲.۶** — سه سطح ربات واقعاً متفاوت، انتخاب سطح هنگام افزودن و تغییر آن در لابی،
  امکان ترکیب سطوح مختلف سر یک میز.
- **ممیزی کامل** — ۳۰ بررسی امنیتی/fuzzing (همه پاس)، هارنس ۷۲۰ مسابقه‌ای برای
  بررسی invariantها (باگ hang سه‌نفره را پیدا کرد)، ۲۷ تست جدید کامپوننت/هوک.

**کارهای اخیر (این session)**
- پروکسی اختصاصی تلگرام (`TELEGRAM_PROXY_URL`) — چون VPN سیستمی تونل Cloudflare را
  قطع می‌کرد ولی بدون VPN `api.telegram.org` فیلتر بود.
- رفع کرش startup ناشی از temporal dead zone در `PROXY_SCHEMES`.
- رفع صفحه‌ی سفید مینی‌اپ: اسکریپت SDK تلگرام از `index.html` حذف شد و با
  `loadTelegramSdk()` به‌صورت async با مهلت ۲.۵ ثانیه بارگذاری می‌شود + splash.

---

## ۴) معماری

```text
apps/api/src/
  server.ts (۷۷ خط، فقط composition root)
  config.ts  types.ts  errors.ts  state.ts  schemas.ts  auth.ts
  messages.ts  session.ts  rate-limit.ts  sanitize.ts  storage.ts
  telegram-auth.ts  room-lifecycle.ts
  game/      bots.ts  bot-ai.ts  bot-memory.ts  bot-duel.ts  room-service.ts  views.ts
  http/      app.ts  middleware.ts  rooms.routes.ts
  realtime/  broadcast.ts  handlers.ts
  telegram/  bot.ts  proxy.ts
  jobs/      cleanup.ts

apps/web/src/
  main.tsx  App.tsx  lib.ts  types.ts
  api/         client.ts  socket.ts  session-storage.ts  share.ts  telegram-sdk.ts
  hooks/       useSession.ts  useRoomConnection.ts  useGameActions.ts  useLobbyActions.ts
  components/  Landing  Lobby  GameTable  DuelPhasePanels  PlayingCard  Score
               TopBar  StartOverlay  Toast  AbandonedNotice  ResumingScreen
               RulesGuide  TableScreen  EntryScreen
  styles.css (فقط @import) + styles/{base,shell,landing,lobby,table,overlay,responsive}.css

packages/game-engine/src/
  index.ts (barrel)  types.ts  cards.ts  modes.ts  rules.ts (۲۵۱ خط)
  duel.ts  redeal.ts  trick.ts  hand-flow.ts  legal-moves.ts  public-view.ts
  internal/state.ts
```

قاعده: هر فایل حدود ≤۲۵۰ خط. (`rules.ts` با ۲۵۱ خط کمی بالاتر است.)

**HTTP**
`GET /health` · `GET /rooms/:roomId` · `POST /rooms` ·
`POST /rooms/:roomId/{join,settings,add-bot,bot-difficulty,remove-bot,ready,leave}`

**Socket.IO — کلاینت به سرور**
`room:join` · `game:choose_trump` · `game:play_card` · `game:next_hand` ·
`game:redeal` · `game:discard` · `game:draw` · `game:resolve_draw` · `disconnect`
**سرور به کلاینت:** `room:update` (snapshot اختصاصی هر بازیکن)

---

## ۵) قوانین بازی که پیاده شده

| حالت | صندلی | تیم‌بندی | کارت | پخش | ویژگی خاص |
|---|---|---|---|---|---|
| `classic4` | ۴ | ۰و۲ مقابل ۱و۳ | ۱۳ | ۵+۴+۴ | — |
| `solo3` | ۳ | انفرادی | ۱۷ | ۵+۴+۴+۴ | یک `2` حذف می‌شود (هرگز خال حکم نیست) |
| `duel2` | ۲ | انفرادی | ۱۳ | ۵، سپس دور انداختن ۲ و برداشتن یک‌درمیان | نگه‌داری ⇒ بعدی نادیده سوزانده می‌شود؛ سوزاندن ⇒ باید بعدی را نادیده برداری |

**امتیازدهی** (۱۲ تست اختصاصی): عادی = ۱ · **کوت** = ۲ (همه‌ی حریفان صفر دست) ·
**حاکم‌کوت** = ۳ (تیم حاکم شات‌اوت شود) · **بام**/**حاکم‌بام** = ۳ و کل مسابقه
بلافاصله تمام می‌شود.

**قوانین اختیاری (هر دو پیش‌فرض روشن)**
- `lowHandRedeal` (ده‌لو کم): اگر ۵ کارت اول حاکم هیچ A/K/Q/J نداشت، می‌تواند
  درخواست پخش مجدد کند. سرور اعتبارسنجی می‌کند؛ حداکثر ۲ بار پشت‌سرهم (`maxRedeals`).
- `bam`: بازی بعد از ۷ دست ادامه پیدا می‌کند؛ بردن همه‌ی دست‌ها کل مسابقه را می‌برد.
  بهینه‌سازی: به‌محض اینکه حریف یک دست ببرد، sweep غیرممکن می‌شود و دست تمام می‌شود.

---

## ۶) ربات‌ها (اندازه‌گیری‌شده روی بیش از ۱۰۰۰ مسابقه‌ی seed‌دار با جابه‌جایی صندلی)

- **easy** — منطق درست ولی ۲۵٪ اشتباه تصادفی (`EASY_MISTAKE_RATE = 0.25`)
- **medium** — هیچ‌وقت اشتباه نمی‌کند، ارزان‌ترین برد را می‌گیرد، هرگز روی یار خودش
  نمی‌زند، بلندترین خال کناری را لید می‌کند
- **hard** — شمارش کارت، نقد کردن برنده‌های قطعی، کشیدن حکم از `DRAW_TRUMPS_FROM = 5`،
  خالی‌کردن خال، پرهیز از لید به خالی که می‌داند حریف ندارد

نتایج: medium مقابل easy **۷۴٪** · hard مقابل easy **۷۷٪** · hard مقابل medium **۵۵.۵٪**
هر سطح نسخه‌ی قبلی خودش را هم برد: easy ۹۹٪ · medium ۵۱٪ · hard ۵۲٪

⚠️ **یافته‌ی منفی مهم:** نسخه‌ای از hard که برای ذخیره‌ی حکم، برش ارزان را رد می‌کرد
از medium **ضعیف‌تر** بود (۲۷ از ۱۰۰). حذف شد — **دوباره اضافه نکن.**
برتری hard بر medium زیر حدود ۲۰۰ جفت مسابقه نویزی است (۴۷–۵۵٪)؛ تست از ۴۰۰ جفت استفاده می‌کند.

---

## ۷) باگ‌های بحرانی که پیدا و رفع شده‌اند (مراقب برگشتشان باش)

1. **نشت دست بازیکنان** — `toPublicView` کل `...state` را spread می‌کرد و دست همه را
   برای همه می‌فرستاد (بازی کاملاً قابل تقلب). با destructure کردن
   `hands`/`players`/`stock` رفع شد.
2. **هنگ سه‌نفره** — ۱۷ دست می‌تواند ۶-۶-۵ تقسیم شود و کسی به ۷ نرسد. رفع: وقتی
   همه‌ی دست‌ها بازی شد، به بیشترین دست داده می‌شود.
3. **راهنمای قوانین غیرقابل‌دسترس** پیش از ورود به میز. با `rulesOverlay` مشترک رفع شد.
4. **جعل `telegramId`** — کلاینت می‌توانست صندلی بدزدد. فقط `initData` تأییدشده.
5. **کرش ربات تلگرام** — rejection مدیریت‌نشده‌ی `setMyCommands` کل API را می‌کشت.
6. **readiness دوباره ارزیابی نمی‌شد** وقتی ربات آخرین صندلی را پر می‌کرد.
7. **ربات‌ها یار خودشان را می‌بردند** — در medium/hard رفع شد.
8. **temporal dead zone روی `requireConnection`** در App.tsx.
9. نوشتن غیراتمی DB و حلقه‌ی کرش با DB خراب.
10. **temporal dead zone روی `PROXY_SCHEMES`** در `config.ts` — `const` پایین فایل
    ولی مصرف بالای فایل. تست `config-init.test.ts` با `vi.resetModules()` نگهبانش است.
11. **صفحه‌ی سفید مینی‌اپ** — اسکریپت مسدودکننده‌ی `telegram.org` قبل از باندل
    `type="module"`؛ روی شبکه‌ی فیلترشده معلق می‌ماند و برنامه هرگز اجرا نمی‌شد.

---

## ۸) پیکربندی

```env
PORT=4000
DB_PATH=./data/hokm.sqlite
SERVE_WEB_DIST=true
WEB_APP_URL=          # هر سه، همان آدرس دامنه/تونل
PUBLIC_API_URL=
CORS_ORIGIN=
TELEGRAM_BOT_TOKEN=
TELEGRAM_PROXY_URL=   # فقط برای ترافیک Bot API. مثال: socks5://127.0.0.1:10808
ALLOW_UNVERIFIED_TELEGRAM=false
ROOM_LOBBY_TTL_HOURS=6
ROOM_PLAYING_TTL_HOURS=12
ROOM_FINISHED_TTL_HOURS=24
ROOM_CLEANUP_INTERVAL_HOURS=1
ROOM_CLEANUP_MIN_INTERVAL_MS   # فقط برای تست
RATE_LIMIT_CREATE_PER_MIN=6
RATE_LIMIT_ACTIONS_PER_MIN=60
MAX_ROOMS=500
```

`app.set('trust proxy', true)` قبلاً ست شده و پشت nginx درست کار می‌کند.
آدرس‌ها باید خام باشند (نه داخل `[]()`)؛ `normalizeEnvUrl` هم markdown را پاک می‌کند.

---

## ۹) محیط کاربر

- لپ‌تاپ ویندوز، پروژه در `C:\Users\arman\Desktop\hokm`
- اجرا: `cd C:\Users\arman\Desktop\hokm` → `git pull origin arena/019fb173-hokm`
  → `npm install` → `npm run build` → `npm run start -w @hokm/api`
- **هرگز `npm audit fix --force` نزن** — یک بار vite را به ۸.۱.۵ برد و
  `@vitejs/plugin-react@4.7.0` شکست (peer نیاز دارد `^4|^5|^6|^7`).
  رفع: `git restore .` + حذف کامل node_modules + نصب دوباره.
- `.npmrc` با `package-lock=false` در ریشه هست تا lockfile مدام تغییر نکند.
- یک بار untracked بودن `.npmrc` مانع switch برنچ شد؛ با `Remove-Item .npmrc` حل شد.

---

## ۱۰) وضعیت دامنه و شبکه

**دامنه `arman-jafari.ir`** — NS با موفقیت به Cloudflare منتقل شد
(`eleanor.ns.cloudflare.com`). قبلاً روی ArvanCloud بود؛ **آروان دیگر بی‌ربط است.**

**رکورد DNS** — `hokm` از نوع CNAME به
`a909fe96-ed01-4cf5-84ec-eec3048c641c.cfargotunnel.com` با Proxy روشن. ✅ درست است.

**تونل Cloudflare** — ابتدا شکست خورد چون ISP پورت ۷۸۴۴ را بسته بود. با
`protocol: http2` حل شد (QUIC/UDP هنوز بسته است ولی TCP کار می‌کند).
تونل با موفقیت وصل می‌شود: `Registered tunnel connection ... protocol=http2`.
`tunnelID = a909fe96-ed01-4cf5-84ec-eec3048c641c`

فایل `C:\Users\arman\.cloudflared\config.yml`:
```yaml
tunnel: a909fe96-ed01-4cf5-84ec-eec3048c641c
credentials-file: C:\Users\arman\.cloudflared\a909fe96-ed01-4cf5-84ec-eec3048c641c.json
protocol: http2
ingress:
  - hostname: hokm.arman-jafari.ir
    service: http://localhost:4000
  - service: http_status:404
```

**تضاد VPN** — با VPN سیستمی تونل قطع می‌شود؛ بدون VPN تلگرام فیلتر است.
حل شد با `TELEGRAM_PROXY_URL` که فقط ترافیک Bot API را پروکسی می‌کند.
کاربر باید کلاینت VPN را باز نگه دارد ولی حالت TUN/System-Proxy/Global را **خاموش** کند.

**اجرا:** دو ترمینال — یکی `npm run start -w @hokm/api`، یکی `cloudflared tunnel run hokm`.

---

## ۱۱) کارهای حل‌نشده

- **تأیید نهایی رفع صفحه‌ی سفید** — کاربر قرار است تست کند و نتیجه را بگوید.
  اگر هنوز مشکل بود: در تلگرام دسکتاپ DevTools را باز کند و Console/Network را بفرستد.
- **باطل‌کردن توکن ربات** — کاربر هنوز تأیید نکرده `/revoke` را زده.
- **hard مقابل medium فقط ~۵۵٪** — بهترشدنش نیاز به جست‌وجوی درختی دارد که برای یک
  Mini App تلگرام سنگین است. به‌عنوان محدودیت پذیرفته و صادقانه اعلام شده.
- **بدون focus trap و کلید Escape** در دیالوگ `RulesGuide` — به فاز ۴ موکول شد.
- یک flake نادر دیده شد: یک بار ۱ تست از ۲۱۷ زیر فشار CPU افتاد، ولی ۶ اجرای کامل
  بعدی سبز بود و قابل بازتولید نبود. اگر دوباره دیدی، ریشه‌یابی کن.
- `packages/game-engine/src/rules.ts` با ۲۵۱ خط کمی از هدف ۲۵۰ بالاتر است.

---

## ۱۲) قدم بعدی: فاز ۴ — بازطراحی UI/UX

کاربر تأیید کرده که بعد از حل‌شدن موضوع دامنه، فاز بعدی این است:

- میز بازی واقع‌گرایانه‌تر و جذاب‌تر
- انیمیشن پخش و بازی کارت‌ها
- انتخابگر حکم به‌صورت bottom-sheet
- haptic feedback تلگرام
- RTL بهتر
- کارت‌ها و لابی زیباتر
- (بدهی فنی) focus trap و کلید Escape در `RulesGuide`

**گزینه‌ی بلندمدت:** انتقال به VPS تا بازی همیشه در دسترس باشد و ربات بدون پروکسی
به تلگرام برسد. راهنمای ۱۱ مرحله‌ای قبلاً داده شده: Ubuntu 22.04 → رکورد A برای
`hokm` به IP (**حالت پروکسی/ابری خاموش** وگرنه WebSocket می‌شکند) → Node 20 + git +
nginx + pm2 → کلون در `/opt/hokm` → `.env` با `https://hokm.arman-jafari.ir` برای هر
سه متغیر → `pm2 start "npm run start -w @hokm/api" --name hokm` → reverse proxy با
`Upgrade`/`Connection: upgrade`/`proxy_read_timeout 86400` برای Socket.IO →
`certbot --nginx` → در BotFather دستور `/setdomain`.
به‌روزرسانی: `git pull && npm install && npm run build && pm2 restart hokm`.
هیچ تغییری در کد لازم نیست.
