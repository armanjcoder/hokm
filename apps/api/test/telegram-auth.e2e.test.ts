import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServerHarness } from './helpers/server-harness.js';

const BOT_TOKEN = '123456:E2E-TEST-TOKEN';

function signInitData(user: object, botToken = BOT_TOKEN, authDate = Math.floor(Date.now() / 1000)) {
  const fields: Record<string, string> = {
    auth_date: String(authDate),
    user: JSON.stringify(user),
  };
  const dataCheckString = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const params = new URLSearchParams(fields);
  params.set('hash', createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));
  return params.toString();
}

const VICTIM = { id: 111111, first_name: 'آرمان' };
const ATTACKER = { id: 222222, first_name: 'مهاجم' };

/** Tests create far more rooms than a human would; keep limits out of the way. */
const TEST_LIMITS = { RATE_LIMIT_CREATE_PER_MIN: '10000', RATE_LIMIT_ACTIONS_PER_MIN: '10000' };

let server: ServerHarness;

beforeAll(async () => {
  server = await ServerHarness.create({ TELEGRAM_BOT_TOKEN: BOT_TOKEN, ...TEST_LIMITS });
  await server.start();
}, 60000);

afterAll(async () => {
  await server?.dispose();
});

async function post(pathname: string, body: unknown) {
  const response = await fetch(`${server.url}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

describe('Telegram auth enforcement', () => {
  it('creates a room for a verified Telegram user and uses their real name', async () => {
    const result = await post('/rooms', {
      hostName: 'اسم جعلی',
      initData: signInitData(VICTIM),
    });
    expect(result.status).toBe(201);
    // The verified Telegram name wins over whatever the client claimed.
    expect(result.body.players[0].name).toBe('آرمان');
    expect(result.body.players[0].telegramId).toBe(VICTIM.id);
  });

  it('refuses requests with no initData once auth is enabled', async () => {
    const result = await post('/rooms', { hostName: 'مهمان' });
    expect(result.status).toBe(401);
    expect(result.body.error).toBe('TELEGRAM_AUTH_REQUIRED');
    expect(result.body.message).toMatch(/[\u0600-\u06FF]/);
  });

  it('refuses initData signed with the wrong bot token', async () => {
    const result = await post('/rooms', {
      hostName: 'مهاجم',
      initData: signInitData(ATTACKER, 'wrong-token'),
    });
    expect(result.status).toBe(401);
    expect(result.body.error).toBe('TELEGRAM_AUTH_FAILED');
  });

  it('refuses expired initData', async () => {
    const twoDaysAgo = Math.floor(Date.now() / 1000) - 48 * 60 * 60;
    const result = await post('/rooms', {
      hostName: 'آرمان',
      initData: signInitData(VICTIM, BOT_TOKEN, twoDaysAgo),
    });
    expect(result.status).toBe(401);
    expect(result.body.error).toBe('TELEGRAM_AUTH_EXPIRED');
  });

  it('blocks the seat-stealing attack that a raw telegramId allowed', async () => {
    const created = await post('/rooms', { hostName: 'آرمان', initData: signInitData(VICTIM) });
    const roomId = created.body.id as string;
    const victimToken = created.body.token as string;

    // Old attack: post the victim's telegramId directly. It must not be trusted.
    const spoofed = await post(`/rooms/${roomId}/join`, {
      name: 'مهاجم',
      telegramId: VICTIM.id,
    });
    expect(spoofed.status).toBe(401);
    expect(spoofed.body.token).toBeUndefined();

    // Even with valid initData of their own, the attacker gets a new seat, not the victim's.
    const honest = await post(`/rooms/${roomId}/join`, {
      name: 'مهاجم',
      initData: signInitData(ATTACKER),
    });
    expect(honest.status).toBe(200);
    expect(honest.body.player.telegramId).toBe(ATTACKER.id);
    expect(honest.body.player.seat).not.toBe(0);
    expect(honest.body.token).not.toBe(victimToken);
  });

  it('gives a verified user their original seat back from a new device', async () => {
    const created = await post('/rooms', { hostName: 'آرمان', initData: signInitData(VICTIM) });
    const roomId = created.body.id as string;
    const originalPlayerId = created.body.players[0].id as string;
    const originalToken = created.body.token as string;

    // Same Telegram user, brand new client with no stored session.
    const rejoined = await post(`/rooms/${roomId}/join`, {
      name: 'هرچی',
      initData: signInitData(VICTIM),
    });

    expect(rejoined.status).toBe(200);
    expect(rejoined.body.player.id).toBe(originalPlayerId);
    expect(rejoined.body.player.seat).toBe(0);
    // A fresh token is issued so the new device can actually control the seat.
    expect(rejoined.body.token).toBeTruthy();
    expect(rejoined.body.token).not.toBe(originalToken);
  });

  it('never exposes tokens or lets tokens leak through the public room view', async () => {
    const created = await post('/rooms', { hostName: 'آرمان', initData: signInitData(VICTIM) });
    const response = await fetch(`${server.url}/rooms/${created.body.id}`);
    const publicView = await response.text();
    expect(publicView).not.toContain(created.body.token);
  });
});

describe('guest mode when no bot token is configured', () => {
  let guestServer: ServerHarness;

  beforeAll(async () => {
    guestServer = await ServerHarness.create(TEST_LIMITS);
    await guestServer.start();
  }, 60000);

  afterAll(async () => {
    await guestServer?.dispose();
  });

  it('still allows creating a room without initData', async () => {
    const response = await fetch(`${guestServer.url}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostName: 'مهمان' }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as any;
    expect(body.players[0].name).toBe('مهمان');
    expect(body.players[0].telegramId).toBeUndefined();
  });
});

describe('avatar endpoint end to end', () => {
  const PHOTO_USER = { id: 333333, first_name: 'عکس‌دار', photo_url: 'https://t.me/i/userpic/320/z.jpg' };
  const SPOOF_USER = { id: 444444, first_name: 'جعلی', photo_url: 'http://127.0.0.1:9/secret' };

  it('advertises hasPhoto without ever revealing the CDN url', async () => {
    const created = await post('/rooms', { hostName: 'x', initData: signInitData(PHOTO_USER) });
    expect(created.status).toBe(201);
    expect(created.body.players[0].hasPhoto).toBe(true);
    expect(JSON.stringify(created.body)).not.toContain('userpic');

    // The join response returns the player object directly; it must be sanitised too.
    const joined = await post(`/rooms/${created.body.id}/join`, {
      name: 'x',
      initData: signInitData(PHOTO_USER),
    });
    expect(JSON.stringify(joined.body)).not.toContain('userpic');
  });

  it('refuses a photo url that is not Telegram-hosted, even when signed', async () => {
    const created = await post('/rooms', { hostName: 'x', initData: signInitData(SPOOF_USER) });
    expect(created.status).toBe(201);
    // Signature was valid, so the seat exists; the URL was still thrown away.
    expect(created.body.players[0].hasPhoto).toBeUndefined();

    const playerId = created.body.players[0].id;
    const response = await fetch(`${server.url}/rooms/${created.body.id}/players/${playerId}/avatar`);
    expect(response.status).toBe(404);
  });

  it('404s for an unknown room or player instead of erroring', async () => {
    const missingRoom = await fetch(`${server.url}/rooms/nope/players/nobody/avatar`);
    expect(missingRoom.status).toBe(404);
    expect((await missingRoom.json()).error).toBe('AVATAR_NOT_FOUND');
  });

  it('404s rather than hanging when the Telegram CDN is unreachable', async () => {
    const created = await post('/rooms', { hostName: 'x', initData: signInitData(PHOTO_USER) });
    const playerId = created.body.players[0].id;
    const response = await fetch(`${server.url}/rooms/${created.body.id}/players/${playerId}/avatar`);
    // The sandbox cannot reach t.me, which is exactly the censored-network case:
    // the endpoint must answer, not stall the request.
    expect(response.status).toBe(404);
  }, 30000);
});

describe('room-free avatar endpoint for the landing screen', () => {
  const PHOTO_USER = { id: 555555, first_name: 'لندینگ', photo_url: 'https://t.me/i/userpic/320/q.jpg' };

  it('rejects an unsigned request instead of serving anything', async () => {
    const response = await fetch(`${server.url}/me/avatar`);
    expect(response.status).toBe(401);
  });

  it('rejects a forged initData', async () => {
    const forged = 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=deadbeef';
    const response = await fetch(`${server.url}/me/avatar?initData=${encodeURIComponent(forged)}`);
    expect(response.status).toBe(401);
  });

  it('accepts a valid signature and answers rather than hanging', async () => {
    const signed = signInitData(PHOTO_USER);
    const response = await fetch(`${server.url}/me/avatar?initData=${encodeURIComponent(signed)}`);
    // t.me is unreachable from the sandbox, so a 404 is the correct, prompt
    // answer. What matters is that authentication passed and it did not stall.
    expect([200, 404]).toContain(response.status);
  }, 30000);

  it('404s for a verified user who has no public photo', async () => {
    const signed = signInitData({ id: 666666, first_name: 'بی‌عکس' });
    const response = await fetch(`${server.url}/me/avatar?initData=${encodeURIComponent(signed)}`);
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('AVATAR_NOT_FOUND');
  });

  it('never echoes the CDN url back in the error body', async () => {
    const signed = signInitData(PHOTO_USER);
    const response = await fetch(`${server.url}/me/avatar?initData=${encodeURIComponent(signed)}`);
    if (response.status === 404) {
      expect(JSON.stringify(await response.json())).not.toContain('userpic');
    }
  }, 30000);
});
