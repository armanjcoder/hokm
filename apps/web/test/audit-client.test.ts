import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoomRequest, joinRoomRequest, lobbyActionRequest } from '../src/api/client.js';
import { HokmRequestError } from '../src/lib.js';

/**
 * HTTP client audit.
 *
 * Every network failure the player can hit goes through these three functions,
 * and until now only the happy path was exercised. What matters most is that a
 * failure never surfaces a raw English code or an unhandled rejection: the
 * player must always get Persian text and a machine-readable code.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn(impl as any);
  globalThis.fetch = spy as any;
  return spy;
}

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    json: async () => body,
  }) as Response;

describe('createRoomRequest', () => {
  it('posts the room settings and returns the parsed body', async () => {
    const spy = mockFetch(() => jsonResponse({ id: 'r1' }));
    const result = await createRoomRequest('https://api.test', 'آرمان', 'INIT', 'solo3', 5);
    expect(result).toEqual({ id: 'r1' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/rooms');
    expect(JSON.parse(init.body as string)).toEqual({
      hostName: 'آرمان',
      mode: 'solo3',
      targetScore: 5,
      initData: 'INIT',
    });
  });

  it('omits initData entirely when running outside Telegram', async () => {
    const spy = mockFetch(() => jsonResponse({ id: 'r1' }));
    await createRoomRequest('https://api.test', 'مهمان', '', 'classic4', 7);
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty('initData');
  });

  it('turns a network failure into a Persian NETWORK_ERROR', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(createRoomRequest('https://api.test', 'x', '', 'classic4', 7)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('keeps the server error code and its Persian message', async () => {
    mockFetch(() => jsonResponse({ error: 'TOO_MANY_ROOMS', message: 'میزهای فعال پر است.' }, false, 503));
    const error = await createRoomRequest('https://api.test', 'x', '', 'classic4', 7).catch((e) => e);
    expect(error).toBeInstanceOf(HokmRequestError);
    expect(error.code).toBe('TOO_MANY_ROOMS');
    expect(error.message).toBe('میزهای فعال پر است.');
  });

  it('never shows a raw English server message to the player', async () => {
    mockFetch(() => jsonResponse({ error: 'BOOM', message: 'Internal server error' }, false, 500));
    const error = await createRoomRequest('https://api.test', 'x', '', 'classic4', 7).catch((e) => e);
    expect(error.message).not.toContain('Internal server error');
    expect(error.message).toMatch(/[\u0600-\u06FF]/);
  });

  it('survives a body that is not JSON at all', async () => {
    mockFetch(
      () =>
        ({
          ok: false,
          status: 502,
          json: async () => {
            throw new SyntaxError('Unexpected token <');
          },
        }) as unknown as Response,
    );
    const error = await createRoomRequest('https://api.test', 'x', '', 'classic4', 7).catch((e) => e);
    expect(error).toBeInstanceOf(HokmRequestError);
    expect(error.code).toBe('REQUEST_FAILED');
  });
});

describe('joinRoomRequest', () => {
  it('targets the room join endpoint', async () => {
    const spy = mockFetch(() => jsonResponse({ room: {}, player: {} }));
    await joinRoomRequest('https://api.test', 'room-9', 'سارا', 'INIT');
    expect((spy.mock.calls[0] as [string, RequestInit])[0]).toBe('https://api.test/rooms/room-9/join');
  });

  it('reports a missing room with its code intact', async () => {
    mockFetch(() => jsonResponse({ error: 'ROOM_NOT_FOUND', message: 'میز پیدا نشد.' }, false, 404));
    const error = await joinRoomRequest('https://api.test', 'gone', 'x', '').catch((e) => e);
    expect(error.code).toBe('ROOM_NOT_FOUND');
  });
});

describe('lobbyActionRequest', () => {
  it('sends the session payload without leaking the api url', async () => {
    const spy = mockFetch(() => jsonResponse({ ok: true }));
    await lobbyActionRequest(
      'https://api.test',
      'r1',
      'ready',
      { roomId: 'r1', playerId: 'p1', apiUrl: 'https://api.test', token: 'secret' },
      { ready: true },
      'خطا',
    );
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/rooms/r1/ready');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ roomId: 'r1', playerId: 'p1', token: 'secret', ready: true });
    expect(body).not.toHaveProperty('apiUrl');
  });

  it('falls back to the caller message when the server sends none', async () => {
    mockFetch(() => jsonResponse({ error: 'NOT_HOST' }, false, 403));
    const error = await lobbyActionRequest(
      'https://api.test',
      'r1',
      'settings',
      { roomId: 'r1', playerId: 'p1', apiUrl: 'https://api.test' },
      {},
      'تغییر تنظیمات میز انجام نشد.',
    ).catch((e) => e);
    expect(error.code).toBe('NOT_HOST');
    expect(error.message).toBe('تغییر تنظیمات میز انجام نشد.');
  });
});
