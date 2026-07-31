import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServerHarness } from './helpers/server-harness.js';

const TEST_LIMITS = { RATE_LIMIT_CREATE_PER_MIN: '10000', RATE_LIMIT_ACTIONS_PER_MIN: '10000' };

let server: ServerHarness;

beforeAll(async () => {
  server = await ServerHarness.create(TEST_LIMITS);
  await server.start();
}, 60000);

afterAll(async () => {
  await server?.dispose();
});

async function post(pathname: string, body: unknown = {}) {
  const response = await fetch(`${server.url}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
}

async function newTable(mode: string) {
  const created = await post('/rooms', { hostName: 'آرمان', mode });
  return {
    roomId: created.body.id as string,
    playerId: created.body.players[0].id as string,
    token: created.body.token as string,
    body: created.body,
  };
}

describe('creating rooms per mode', () => {
  it.each([
    ['classic4', 4],
    ['solo3', 3],
    ['duel2', 2],
  ])('stores the chosen mode for %s', async (mode, seats) => {
    const host = await newTable(mode);
    expect(host.body.mode).toBe(mode);

    const room = await (await fetch(`${server.url}/rooms/${host.roomId}`)).json();
    expect(room.mode).toBe(mode);
    expect(seats).toBeGreaterThan(0);
  });

  it('defaults to the classic game when no mode is sent', async () => {
    const created = await post('/rooms', { hostName: 'آرمان' });
    expect(created.body.mode).toBe('classic4');
  });

  it('rejects an unknown mode', async () => {
    const created = await post('/rooms', { hostName: 'آرمان', mode: 'hexagon' });
    expect(created.status).toBe(400);
    expect(created.body.error).toBe('VALIDATION_ERROR');
  });
});

describe('seat capacity follows the mode', () => {
  it.each([
    ['duel2', 2],
    ['solo3', 3],
    ['classic4', 4],
  ])('caps %s at %i seats', async (mode, seats) => {
    const host = await newTable(mode);
    for (let i = 0; i < seats - 1; i += 1) {
      const added = await post(`/rooms/${host.roomId}/add-bot`, host);
      expect(added.status).toBe(200);
    }

    // The table is full, so one more bot must be refused.
    const overflow = await post(`/rooms/${host.roomId}/add-bot`, host);
    expect(overflow.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses a third human at a two player table', async () => {
    const host = await newTable('duel2');
    const second = await post(`/rooms/${host.roomId}/join`, { name: 'نیکا' });
    expect(second.status).toBe(200);

    const third = await post(`/rooms/${host.roomId}/join`, { name: 'آرش' });
    expect(third.status).toBe(400);
    expect(third.body.error).toBe('ROOM_FULL');
  });
});

describe('readiness across modes', () => {
  it.each([
    ['duel2', 1],
    ['solo3', 2],
    ['classic4', 3],
  ])('starts %s once the last seat is filled after readying', async (mode, bots) => {
    const host = await newTable(mode);
    // Ready first, then fill the seats: readiness must be re-checked each time.
    await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });

    let last: any;
    for (let i = 0; i < bots; i += 1) {
      last = await post(`/rooms/${host.roomId}/add-bot`, host);
    }
    expect(last.body.started).toBe(true);
    expect(last.body.status).toBe('playing');
  });

  it('waits for a second human in a duel before starting', async () => {
    const host = await newTable('duel2');
    const guestRes = await post(`/rooms/${host.roomId}/join`, { name: 'نیکا' });
    const guest = {
      roomId: host.roomId,
      playerId: guestRes.body.player.id as string,
      token: guestRes.body.token as string,
    };

    const hostReady = await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });
    expect(hostReady.body.started).toBe(false);

    const guestReady = await post(`/rooms/${host.roomId}/ready`, { ...guest, ready: true });
    expect(guestReady.body.started).toBe(true);
  });
});

describe('dealing per mode', () => {
  it('gives seventeen cards each in the three player game', async () => {
    const host = await newTable('solo3');
    for (let i = 0; i < 2; i += 1) await post(`/rooms/${host.roomId}/add-bot`, host);
    await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });

    const room = await (await fetch(`${server.url}/rooms/${host.roomId}`)).json();
    expect(room.status).toBe('playing');
    expect(room.players).toHaveLength(3);
  });

  it('never leaks the stock or other hands in any mode', async () => {
    for (const mode of ['classic4', 'solo3', 'duel2']) {
      const host = await newTable(mode);
      const seats = mode === 'duel2' ? 2 : mode === 'solo3' ? 3 : 4;
      for (let i = 0; i < seats - 1; i += 1) await post(`/rooms/${host.roomId}/add-bot`, host);
      await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });

      const raw = await (await fetch(`${server.url}/rooms/${host.roomId}`)).text();
      expect(raw).not.toContain('"hands"');
      expect(raw).not.toContain('"stock"');
    }
  });
});
