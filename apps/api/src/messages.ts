/**
 * Persian (fa-IR) user-facing messages for API/socket error codes.
 *
 * Error codes stay in English (they are a machine contract), but every message
 * that can reach the player is Persian. Technical terms such as API / Telegram
 * are kept as-is on purpose.
 */

export const DEFAULT_ERROR_MESSAGE = 'خطای نامشخصی رخ داد. لطفاً دوباره تلاش کن.';

export const ERROR_MESSAGES_FA: Record<string, string> = {
  VALIDATION_ERROR: 'اطلاعات ارسالی معتبر نیست. لطفاً دوباره تلاش کن.',
  INTERNAL_SERVER_ERROR: 'خطای داخلی سرور رخ داد. چند لحظه بعد دوباره تلاش کن.',
  ROOM_NOT_FOUND: 'میز پیدا نشد. اگر لینک قدیمی است، در ربات دوباره /newgame بزن.',
  ROOM_NOT_FULL: 'برای شروع بازی باید هر ۴ بازیکن داخل میز باشند.',
  ROOM_ALREADY_STARTED: 'این میز قبلاً شروع شده و دیگر نمی‌شود بازیکن جدید اضافه کرد.',
  ROOM_FULL: 'ظرفیت این میز تکمیل شده است.',
  GAME_NOT_STARTED: 'بازی هنوز شروع نشده است.',
  INVALID_PLAYER_COUNT: 'برای بازی حکم دقیقاً به ۴ بازیکن نیاز داریم.',
  DUPLICATE_PLAYER: 'بازیکن تکراری در میز وجود دارد.',
  DUPLICATE_SEAT: 'صندلی تکراری در میز وجود دارد.',
  INVALID_PHASE: 'در این مرحله از بازی انجام این کار ممکن نیست.',
  NOT_HAKEM: 'فقط حاکم می‌تواند حکم را انتخاب کند.',
  INVALID_TRUMP: 'خال حکم معتبر نیست.',
  NO_TRUMP: 'هنوز خال حکم انتخاب نشده است.',
  NOT_YOUR_TURN: 'الان نوبت تو نیست.',
  ILLEGAL_CARD: 'این کارت را نمی‌توانی در این نوبت بازی کنی.',
  CARD_NOT_FOUND: 'این کارت در دست بازیکن پیدا نشد.',
  NO_HAND_WINNER: 'هنوز برنده این راند مشخص نشده است.',
  EMPTY_TRICK: 'دست خالی قابل بررسی نیست.',
  INVALID_DEAL: 'پخش کارت‌ها نامعتبر است؛ تعداد کارت‌ها درست نیست.',
  INVALID_SESSION: 'نشست تو معتبر نیست. لطفاً دوباره وارد میز شو.',
  PLAYER_NOT_FOUND: 'بازیکن در این میز پیدا نشد.',
  SEAT_NOT_FOUND: 'این صندلی در میز پیدا نشد.',
  NOT_FOUND: 'آدرس درخواستی روی سرور پیدا نشد.',
};

/** Returns the Persian message for an error code, falling back to a Persian default. */
export function localizeErrorCode(code: string, fallback = DEFAULT_ERROR_MESSAGE): string {
  const message = ERROR_MESSAGES_FA[code];
  if (message) return message;
  // Never leak an English engine message to the user when we have no translation.
  return isPersian(fallback) ? fallback : DEFAULT_ERROR_MESSAGE;
}

function isPersian(value: string): boolean {
  return /[\u0600-\u06FF]/.test(value);
}

/** Standard JSON error body: machine-readable code + Persian message. */
export function errorBody(code: string, fallbackMessage?: string) {
  return { error: code, message: localizeErrorCode(code, fallbackMessage) };
}
