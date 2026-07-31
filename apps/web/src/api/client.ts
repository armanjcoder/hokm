import { HokmRequestError, socketPayload, userMessage, type StoredSession } from '../lib.js';

/**
 * Thin HTTP client for the room endpoints.
 *
 * Every failure becomes a `HokmRequestError` carrying the machine-readable code
 * plus a Persian message, so callers never have to inspect raw responses.
 */

async function post(url: string, body: unknown, fallbackMessage: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new HokmRequestError('NETWORK_ERROR', 'ارتباط با سرور برقرار نشد. بک‌اند و آدرس API را چک کن.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HokmRequestError(data?.error ?? 'REQUEST_FAILED', userMessage(data, fallbackMessage));
  }
  return data;
}

export function createRoomRequest(apiUrl: string, hostName: string, initData: string, mode: string) {
  return post(
    `${apiUrl}/rooms`,
    { hostName, mode, ...(initData ? { initData } : {}) },
    'ساخت میز انجام نشد. بک‌اند یا آدرس API را چک کن.',
  );
}

export function joinRoomRequest(apiUrl: string, roomId: string, name: string, initData: string) {
  return post(
    `${apiUrl}/rooms/${roomId}/join`,
    { name, ...(initData ? { initData } : {}) },
    'اتصال به میز انجام نشد. آدرس API یا لینک میز را چک کن.',
  );
}

/** Session-authenticated lobby action (ready, add-bot, remove-bot, leave). */
export function lobbyActionRequest(
  apiUrl: string,
  roomId: string,
  path: string,
  session: StoredSession,
  extra: Record<string, unknown>,
  fallbackMessage: string,
) {
  return post(`${apiUrl}/rooms/${roomId}/${path}`, { ...socketPayload(session), ...extra }, fallbackMessage);
}
