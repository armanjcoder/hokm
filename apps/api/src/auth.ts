import { config } from './config.js';
import { HttpError } from './errors.js';
import { localizeErrorCode } from './messages.js';
import { telegramDisplayName, verifyInitData, type TelegramUser } from './telegram-auth.js';
import type { Identity } from './types.js';

/**
 * Turns raw `initData` into a trusted identity.
 *
 * When Telegram auth is enabled the signature must verify, so a client can no
 * longer simply post someone else's telegramId to steal their seat.
 */
export function authenticate(initData: string | undefined): Identity {
  if (!config.telegramAuthEnabled) return {};

  const result = verifyInitData(initData, config.botToken);
  if (!result.ok) {
    if (result.reason === 'MISSING_INIT_DATA') {
      throw new HttpError(401, 'TELEGRAM_AUTH_REQUIRED', localizeErrorCode('TELEGRAM_AUTH_REQUIRED'));
    }
    if (result.reason === 'EXPIRED_INIT_DATA') {
      throw new HttpError(401, 'TELEGRAM_AUTH_EXPIRED', localizeErrorCode('TELEGRAM_AUTH_EXPIRED'));
    }
    throw new HttpError(401, 'TELEGRAM_AUTH_FAILED', localizeErrorCode('TELEGRAM_AUTH_FAILED'));
  }
  return identityFromUser(result.user);
}

export function identityFromUser(user: TelegramUser): Identity {
  const name = telegramDisplayName(user);
  return {
    telegramId: user.id,
    ...(name ? { name } : {}),
    ...(user.photoUrl ? { photoUrl: user.photoUrl } : {}),
  };
}
