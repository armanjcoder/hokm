import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verification of Telegram Mini App `initData`.
 *
 * The Mini App also exposes `initDataUnsafe`, which is named that way for a
 * reason: it is attacker-controlled. Only the raw signed `initData` string can
 * prove who the user is, because it is signed with the bot token.
 *
 * Algorithm (per Telegram docs):
 *   secret_key = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   data_check = all fields except `hash`, sorted by key, joined with "\n" as "key=value"
 *   valid      = HMAC_SHA256(key = secret_key, message = data_check) === hash
 */

export interface TelegramUser {
  id: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  /**
   * Public profile photo, present only when the user has one and their privacy
   * settings allow it. Telegram simply omits the field otherwise, so an absent
   * value is normal and must never be treated as an error.
   */
  photoUrl?: string;
}

/**
 * Hosts a Telegram profile photo may be served from.
 *
 * `photo_url` arrives inside signed data, so it cannot be forged by a random
 * client — but the bot token holder is not the only party who ever touches this
 * value (test fixtures, future stored snapshots, a leaked token). Restricting
 * the host means the avatar proxy can never be pointed at an internal address,
 * which turns a signature problem into an SSRF hole.
 */
const PHOTO_HOST_SUFFIXES = ['.telegram.org', '.cdn-telegram.org', '.telesco.pe'];
const PHOTO_HOSTS = ['telegram.org', 't.me', 'cdn.telesco.pe'];

/** True when a URL is an https Telegram-hosted image we are willing to fetch. */
export function isAllowedPhotoUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  // Credentials in the URL would let the host be spoofed past a naive reader.
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (PHOTO_HOSTS.includes(host)) return true;
  return PHOTO_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export type InitDataFailure =
  | 'MISSING_INIT_DATA'
  | 'MALFORMED_INIT_DATA'
  | 'MISSING_HASH'
  | 'BAD_SIGNATURE'
  | 'EXPIRED_INIT_DATA'
  | 'MISSING_USER';

export type InitDataResult =
  | { ok: true; user: TelegramUser; authDate: Date }
  | { ok: false; reason: InitDataFailure };

/** Telegram init data older than this is rejected, which limits replay attacks. */
export const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

export function verifyInitData(
  initData: string | undefined,
  botToken: string,
  options: { maxAgeSeconds?: number; now?: Date } = {},
): InitDataResult {
  if (!initData || initData.trim() === '') return { ok: false, reason: 'MISSING_INIT_DATA' };
  if (!botToken) return { ok: false, reason: 'BAD_SIGNATURE' };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'MALFORMED_INIT_DATA' };
  }

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'MISSING_HASH' };

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!safeEqualHex(expectedHash, hash)) return { ok: false, reason: 'BAD_SIGNATURE' };

  // Signature is valid from here on, so the remaining fields can be trusted.
  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const authDateRaw = Number(params.get('auth_date'));
  if (!Number.isFinite(authDateRaw) || authDateRaw <= 0) {
    return { ok: false, reason: 'MALFORMED_INIT_DATA' };
  }
  const authDate = new Date(authDateRaw * 1000);
  const nowMs = (options.now ?? new Date()).getTime();
  if (maxAgeSeconds > 0 && nowMs - authDate.getTime() > maxAgeSeconds * 1000) {
    return { ok: false, reason: 'EXPIRED_INIT_DATA' };
  }

  const user = parseUser(params.get('user'));
  if (!user) return { ok: false, reason: 'MISSING_USER' };

  return { ok: true, user, authDate };
}

function parseUser(raw: string | null): TelegramUser | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as {
      id?: unknown;
      first_name?: unknown;
      last_name?: unknown;
      username?: unknown;
      photo_url?: unknown;
    };
    if (typeof parsed.id !== 'number' || !Number.isFinite(parsed.id)) return undefined;
    const photoUrl =
      typeof parsed.photo_url === 'string' && isAllowedPhotoUrl(parsed.photo_url)
        ? parsed.photo_url
        : undefined;
    return {
      id: parsed.id,
      ...(typeof parsed.first_name === 'string' ? { firstName: parsed.first_name } : {}),
      ...(typeof parsed.last_name === 'string' ? { lastName: parsed.last_name } : {}),
      ...(typeof parsed.username === 'string' ? { username: parsed.username } : {}),
      ...(photoUrl ? { photoUrl } : {}),
    };
  } catch {
    return undefined;
  }
}

function safeEqualHex(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

/** Best display name available from a verified Telegram user. */
export function telegramDisplayName(user: TelegramUser): string | undefined {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full || user.username || undefined;
}
