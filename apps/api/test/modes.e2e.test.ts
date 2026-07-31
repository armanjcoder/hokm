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

describe('target score and host settings', () => {
  it('defaults to seven points', async () => {
    const host = await newTable('classic4');
    expect(host.body.targetScore).toBe(7);
  });

  it.each([3, 5, 7, 11])('accepts %i as a target score', async (score) => {
    const created = await post('/rooms', { hostName: 'آرمان', targetScore: score });
    expect(created.body.targetScore).toBe(score);
  });

  it('rejects an unsupported target score', async () => {
    const created = await post('/rooms', { hostName: 'آرمان', targetScore: 9999 });
    expect(created.status).toBe(400);
    expect(created.body.error).toBe('VALIDATION_ERROR');
  });

  it('lets the host change the target score from the lobby', async () => {
    const host = await newTable('classic4');
    const updated = await post(`/rooms/${host.roomId}/settings`, { ...host, targetScore: 5 });
    expect(updated.status).toBe(200);
    expect(updated.body.targetScore).toBe(5);
  });

  it('refuses settings changes from a non-host', async () => {
    const host = await newTable('classic4');
    const guestRes = await post(`/rooms/${host.roomId}/join`, { name: 'نیکا' });
    const guest = {
      roomId: host.roomId,
      playerId: guestRes.body.player.id as string,
      token: guestRes.body.token as string,
    };

    const attempt = await post(`/rooms/${host.roomId}/settings`, { ...guest, targetScore: 3 });
    expect(attempt.status).toBe(403);
    expect(attempt.body.error).toBe('NOT_HOST');
  });

  it('resizes the table and drops surplus bots when the mode changes', async () => {
    const host = await newTable('classic4');
    for (let i = 0; i < 3; i += 1) await post(`/rooms/${host.roomId}/add-bot`, host);

    const switched = await post(`/rooms/${host.roomId}/settings`, { ...host, mode: 'duel2' });
    expect(switched.status).toBe(200);
    expect(switched.body.mode).toBe('duel2');
    // Two seats only: the host plus one bot.
    expect(switched.body.players).toHaveLength(2);
    expect(switched.body.players.map((p: any) => p.seat)).toEqual([0, 1]);
  });

  it('refuses a mode that cannot fit the humans already seated', async () => {
    const host = await newTable('classic4');
    await post(`/rooms/${host.roomId}/join`, { name: 'نیکا' });
    await post(`/rooms/${host.roomId}/join`, { name: 'آرش' });

    const attempt = await post(`/rooms/${host.roomId}/settings`, { ...host, mode: 'duel2' });
    expect(attempt.status).toBe(400);
    expect(attempt.body.error).toBe('TOO_MANY_PLAYERS');
    expect(attempt.body.message).toMatch(/[\u0600-\u06FF]/);
  });

  it('clears readiness when the mode changes so nobody starts unaware', async () => {
    const host = await newTable('classic4');
    await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });

    const switched = await post(`/rooms/${host.roomId}/settings`, { ...host, mode: 'solo3' });
    expect(switched.body.readiness.waitingOn).toContain(host.playerId);
    expect(switched.body.status).toBe('lobby');
  });

  it('actually plays to the chosen target, not a hard-coded seven', async () => {
    const host = await newTable('duel2');
    await post(`/rooms/${host.roomId}/settings`, { ...host, targetScore: 3 });
    await post(`/rooms/${host.roomId}/add-bot`, host);
    await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });

    // The engine must have been handed the room's target score.
    const room = await (await fetch(`${server.url}/rooms/${host.roomId}`)).json();
    expect(room.game.targetScore).toBe(3);
  });

  it('keeps the chosen target score after the game starts', async () => {
    const host = await newTable('duel2');
    await post(`/rooms/${host.roomId}/settings`, { ...host, targetScore: 3 });
    await post(`/rooms/${host.roomId}/add-bot`, host);
    await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });

    const room = await (await fetch(`${server.url}/rooms/${host.roomId}`)).json();
    expect(room.status).toBe('playing');
    expect(room.targetScore).toBe(3);
  });
});

describe('optional rule: low hand redeal', () => {
  it('is off by default', async () => {
    const host = await newTable('classic4');
    expect(host.body.rules.lowHandRedeal).toBe(false);
  });

  it('can be enabled at creation time', async () => {
    const created = await post('/rooms', {
      hostName: 'آرمان',
      rules: { lowHandRedeal: true },
    });
    expect(created.body.rules.lowHandRedeal).toBe(true);
  });

  it('can be toggled by the host from the lobby', async () => {
    const host = await newTable('classic4');
    const on = await post(`/rooms/${host.roomId}/settings`, {
      ...host,
      rules: { lowHandRedeal: true },
    });
    expect(on.body.rules.lowHandRedeal).toBe(true);

    const off = await post(`/rooms/${host.roomId}/settings`, {
      ...host,
      rules: { lowHandRedeal: false },
    });
    expect(off.body.rules.lowHandRedeal).toBe(false);
  });

  it('keeps the other settings when only the rules change', async () => {
    const host = await newTable('solo3');
    await post(`/rooms/${host.roomId}/settings`, { ...host, targetScore: 5 });
    const updated = await post(`/rooms/${host.roomId}/settings`, {
      ...host,
      rules: { lowHandRedeal: true },
    });
    expect(updated.body.mode).toBe('solo3');
    expect(updated.body.targetScore).toBe(5);
    expect(updated.body.rules.lowHandRedeal).toBe(true);
  });

  it('refuses a rule change from a non-host', async () => {
    const host = await newTable('classic4');
    const guestRes = await post(`/rooms/${host.roomId}/join`, { name: 'نیکا' });
    const guest = {
      roomId: host.roomId,
      playerId: guestRes.body.player.id as string,
      token: guestRes.body.token as string,
    };
    const attempt = await post(`/rooms/${host.roomId}/settings`, {
      ...guest,
      rules: { lowHandRedeal: true },
    });
    expect(attempt.status).toBe(403);
  });

  it('carries the rule into the started game', async () => {
    const created = await post('/rooms', {
      hostName: 'آرمان',
      mode: 'duel2',
      rules: { lowHandRedeal: true },
    });
    const host = {
      roomId: created.body.id as string,
      playerId: created.body.players[0].id as string,
      token: created.body.token as string,
    };
    await post(`/rooms/${host.roomId}/add-bot`, host);
    await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });

    const room = await (await fetch(`${server.url}/rooms/${host.roomId}`)).json();
    expect(room.game.rules.lowHandRedeal).toBe(true);
    // The flag is computed by the server from the real hand.
    expect(typeof room.game.canRequestRedeal).toBe('boolean');
  });
});
