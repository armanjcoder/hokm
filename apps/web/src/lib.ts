/**
 * Pure helpers used by the Mini App.
 *
 * Kept free of React and browser globals so they can be unit tested directly.
 */

export interface StoredSession {
  roomId: string;
  playerId: string;
  apiUrl: string;
  token?: string;
}

export class HokmRequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HokmRequestError';
  }
}

const PERSIAN = /[\u0600-\u06FF]/;

/**
 * Only shows a server message when it is actually Persian; otherwise falls back
 * to our own Persian text so raw English codes never reach the player.
 */
export function userMessage(payload: unknown, fallback: string): string {
  const raw = (payload as { message?: unknown } | null | undefined)?.message;
  const message = typeof raw === 'string' ? raw.trim() : '';
  return message && PERSIAN.test(message) ? message : fallback;
}

export function normalizeApiUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Only the fields the server expects; never leaks apiUrl into the payload. */
export function socketPayload(session: StoredSession) {
  return {
    roomId: session.roomId,
    playerId: session.playerId,
    ...(session.token ? { token: session.token } : {}),
  };
}

/**
 * Accepts either a bare room code or a full invite link, so a player can paste
 * whatever the bot gave them.
 */
export function parseJoinInput(input: string): { roomId: string; apiUrl?: string } {
  const trimmed = input.trim();
  if (!trimmed) return { roomId: '' };
  try {
    const url = new URL(trimmed);
    const apiUrl = url.searchParams.get('api') ?? undefined;
    const roomId = url.searchParams.get('room') ?? trimmed;
    return { roomId, ...(apiUrl ? { apiUrl: normalizeApiUrl(apiUrl) } : {}) };
  } catch {
    return { roomId: trimmed };
  }
}

/** Parses a persisted session, tolerating corrupt or partial storage. */
export function parseStoredSession(raw: string | null, fallbackApiUrl: string): StoredSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession> | null;
    if (!parsed || typeof parsed.roomId !== 'string' || typeof parsed.playerId !== 'string') {
      return null;
    }
    if (parsed.roomId === '' || parsed.playerId === '') return null;
    return {
      roomId: parsed.roomId,
      playerId: parsed.playerId,
      apiUrl: parsed.apiUrl || fallbackApiUrl,
      ...(typeof parsed.token === 'string' && parsed.token ? { token: parsed.token } : {}),
    };
  } catch {
    return null;
  }
}

export function buildInviteLink(origin: string, pathname: string, roomId: string, apiUrl: string): string {
  return `${origin}${pathname}?room=${encodeURIComponent(roomId)}&api=${encodeURIComponent(apiUrl)}`;
}

/**
 * Where to fetch a player's Telegram profile photo.
 *
 * The API proxies the image, because Telegram's photo CDN is blocked on many of
 * the networks this game is played on and a direct `<img src>` would just show a
 * broken avatar. Returns undefined when the player has no public photo, which is
 * the normal case for guests and bots.
 */
export function avatarUrl(
  apiUrl: string,
  roomId: string,
  player: { id: string; hasPhoto?: boolean | undefined; isBot?: boolean | undefined } | undefined,
): string | undefined {
  if (!player?.hasPhoto || player.isBot) return undefined;
  if (!apiUrl || !roomId) return undefined;
  return `${normalizeApiUrl(apiUrl)}/rooms/${encodeURIComponent(roomId)}/players/${encodeURIComponent(player.id)}/avatar`;
}
