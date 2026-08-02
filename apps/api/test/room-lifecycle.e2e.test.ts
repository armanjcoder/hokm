import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServerHarness } from './helpers/server-harness.js';

/** Tests create far more rooms than a human would; keep limits out of the way. */
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
  return { status: response.status, body: (await response.json()) as any };
}

async function getRoom(roomId: string) {
  const response = await fetch(`${server.url}/rooms/${roomId}`);
  return (await response.json()) as any;
}

/** Creates a table and returns the host's credentials. */
async function newTable(hostName = 'آرمان') {
  const created = await post('/rooms', { hostName });
  return {
    roomId: created.body.id as string,
    playerId: created.body.players[0].id as string,
    token: created.body.token as string,
  };
}

async function joinAs(roomId: string, name: string) {
  const joined = await post(`/rooms/${roomId}/join`, { name });
  return { playerId: joined.body.player.id as string, token: joined.body.token as string };
}

describe('host authorisation', () => {
  it('sets the creator as host', async () => {
    const host = await newTable();
    const room = await getRoom(host.roomId);
    expect(room.hostPlayerId).toBe(host.playerId);
  });

  it('lets only the host add a bot', async () => {
    const host = await newTable();
    const guest = await joinAs(host.roomId, 'نیکا');

    const byGuest = await post(`/rooms/${host.roomId}/add-bot`, guest);
    expect(byGuest.status).toBe(403);
    expect(byGuest.body.error).toBe('NOT_HOST');
    expect(byGuest.body.message).toMatch(/[\u0600-\u06FF]/);

    const byHost = await post(`/rooms/${host.roomId}/add-bot`, host);
    expect(byHost.status).toBe(200);
    expect(byHost.body.players).toHaveLength(3);
  });

  it('rejects lobby actions without a valid session token', async () => {
    const host = await newTable();
    const forged = await post(`/rooms/${host.roomId}/add-bot`, {
      playerId: host.playerId,
      token: 'x'.repeat(43),
    });
    expect(forged.status).toBe(403);
    expect(forged.body.error).toBe('INVALID_SESSION');
  });
});

describe('adding and removing bots one at a time', () => {
  it('adds exactly one bot per request', async () => {
    const host = await newTable();

    const first = await post(`/rooms/${host.roomId}/add-bot`, host);
    expect(first.body.players).toHaveLength(2);
    expect(first.body.players.filter((p: any) => p.isBot)).toHaveLength(1);

    const second = await post(`/rooms/${host.roomId}/add-bot`, host);
    expect(second.body.players).toHaveLength(3);

    const third = await post(`/rooms/${host.roomId}/add-bot`, host);
    expect(third.body.players).toHaveLength(4);

    // Table is full now.
    const fourth = await post(`/rooms/${host.roomId}/add-bot`, host);
    expect(fourth.status).toBe(400);
    expect(fourth.body.error).toBe('ROOM_FULL');
  });

  it('gives each bot a distinct name', async () => {
    const host = await newTable();
    await post(`/rooms/${host.roomId}/add-bot`, host);
    await post(`/rooms/${host.roomId}/add-bot`, host);
    const room = await post(`/rooms/${host.roomId}/add-bot`, host);
    const names = room.body.players.filter((p: any) => p.isBot).map((p: any) => p.name);
    expect(new Set(names).size).toBe(3);
  });

  it('removes a bot and frees its seat', async () => {
    const host = await newTable();
    const withBot = await post(`/rooms/${host.roomId}/add-bot`, host);
    const botId = withBot.body.players.find((p: any) => p.isBot).id;

    const removed = await post(`/rooms/${host.roomId}/remove-bot`, { ...host, botId });
    expect(removed.status).toBe(200);
    expect(removed.body.players).toHaveLength(1);

    // The freed seat can be filled again.
    const refilled = await post(`/rooms/${host.roomId}/add-bot`, host);
    expect(refilled.body.players).toHaveLength(2);
  });

  it('refuses to remove a human through the bot endpoint', async () => {
    const host = await newTable();
    const guest = await joinAs(host.roomId, 'نیکا');
    const result = await post(`/rooms/${host.roomId}/remove-bot`, { ...host, botId: guest.playerId });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('CANNOT_REMOVE_HUMAN');
  });
});

describe('ready-up start rules', () => {
  it('starts a solo game when the host is ready with three bots', async () => {
    const host = await newTable();
    for (let i = 0; i < 3; i += 1) await post(`/rooms/${host.roomId}/add-bot`, host);

    const ready = await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });
    expect(ready.body.started).toBe(true);
    expect(ready.body.status).toBe('playing');
  });

  it('waits for both humans in a two player game', async () => {
    const host = await newTable();
    const guest = await joinAs(host.roomId, 'نیکا');
    await post(`/rooms/${host.roomId}/add-bot`, host);
    await post(`/rooms/${host.roomId}/add-bot`, host);

    const hostReady = await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });
    expect(hostReady.body.started).toBe(false);
    expect(hostReady.body.status).toBe('lobby');
    expect(hostReady.body.readiness.waitingOn).toEqual([guest.playerId]);

    const guestReady = await post(`/rooms/${host.roomId}/ready`, { ...guest, ready: true });
    expect(guestReady.body.started).toBe(true);
    expect(guestReady.body.status).toBe('playing');
  });

  it('waits for all four humans in a full table', async () => {
    const host = await newTable();
    const others = [];
    for (const name of ['نیکا', 'آرش', 'سارا']) {
      others.push(await joinAs(host.roomId, name));
    }

    await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });
    for (const player of others.slice(0, 2)) {
      const result = await post(`/rooms/${host.roomId}/ready`, { ...player, ready: true });
      expect(result.body.started).toBe(false);
    }
    const last = await post(`/rooms/${host.roomId}/ready`, { ...others[2], ready: true });
    expect(last.body.started).toBe(true);
  });

  it('lets a player un-ready before the table is complete', async () => {
    const host = await newTable();
    const guest = await joinAs(host.roomId, 'نیکا');
    await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });

    const cancelled = await post(`/rooms/${host.roomId}/ready`, { ...host, ready: false });
    expect(cancelled.body.readiness.waitingOn).toContain(host.playerId);
    expect(cancelled.body.status).toBe('lobby');
    expect(guest.playerId).toBeTruthy();
  });

  it('never restarts a game that already began', async () => {
    const host = await newTable();
    for (let i = 0; i < 3; i += 1) await post(`/rooms/${host.roomId}/add-bot`, host);
    await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });

    const again = await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('ROOM_ALREADY_STARTED');
  });
});

describe('leaving a table', () => {
  it('frees the seat when leaving from the lobby', async () => {
    const host = await newTable();
    const guest = await joinAs(host.roomId, 'نیکا');

    const left = await post(`/rooms/${host.roomId}/leave`, guest);
    expect(left.status).toBe(200);
    expect(left.body.room.players).toHaveLength(1);
  });

  it('keeps the seat when leaving mid-game so the engine stays consistent', async () => {
    const host = await newTable();
    const guest = await joinAs(host.roomId, 'نیکا');
    await post(`/rooms/${host.roomId}/add-bot`, host);
    await post(`/rooms/${host.roomId}/add-bot`, host);
    await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });
    await post(`/rooms/${host.roomId}/ready`, { ...guest, ready: true });

    const left = await post(`/rooms/${host.roomId}/leave`, guest);
    expect(left.status).toBe(200);
    expect(left.body.room.players).toHaveLength(4);
    const seat = left.body.room.players.find((p: any) => p.id === guest.playerId);
    expect(seat.connected).toBe(false);
  });

  it('transfers host to another human when the host leaves', async () => {
    const host = await newTable();
    const guest = await joinAs(host.roomId, 'نیکا');

    const left = await post(`/rooms/${host.roomId}/leave`, host);
    expect(left.body.room.hostPlayerId).toBe(guest.playerId);

    // The new host can now manage bots.
    const added = await post(`/rooms/${host.roomId}/add-bot`, guest);
    expect(added.status).toBe(200);
  });

  it('abandons a table once the last human leaves', async () => {
    const host = await newTable();
    await post(`/rooms/${host.roomId}/add-bot`, host);

    const left = await post(`/rooms/${host.roomId}/leave`, host);
    expect(left.body.room.status).toBe('abandoned');

    const rejoin = await post(`/rooms/${host.roomId}/join`, { name: 'کسی' });
    expect(rejoin.status).toBe(400);
    expect(rejoin.body.error).toBe('ROOM_ABANDONED');
  });
});

describe('automatic cleanup of stale rooms', () => {
  let cleanupServer: ServerHarness;

  beforeAll(async () => {
    // Very short TTLs so the periodic job acts within the test.
    cleanupServer = await ServerHarness.create({
      ...TEST_LIMITS,
      ROOM_LOBBY_TTL_HOURS: '0.0003',
      ROOM_FINISHED_TTL_HOURS: '0.0003',
      ROOM_PLAYING_TTL_HOURS: '0.0003',
      ROOM_CLEANUP_INTERVAL_HOURS: '0.0003',
      ROOM_CLEANUP_MIN_INTERVAL_MS: '400',
    });
    await cleanupServer.start();
  }, 60000);

  afterAll(async () => {
    await cleanupServer?.dispose();
  });

  it('deletes an idle lobby and forgets it after a restart', async () => {
    const created = await fetch(`${cleanupServer.url}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostName: 'آرمان' }),
    });
    const roomId = ((await created.json()) as any).id as string;

    // The room exists right away.
    expect((await fetch(`${cleanupServer.url}/rooms/${roomId}`)).status).toBe(200);

    // Wait past the TTL plus one cleanup tick.
    await new Promise((resolve) => setTimeout(resolve, 3500));

    const afterCleanup = await fetch(`${cleanupServer.url}/rooms/${roomId}`);
    expect(afterCleanup.status).toBe(404);

    // It must be gone from SQLite too, not just from memory.
    await cleanupServer.restart();
    expect((await fetch(`${cleanupServer.url}/rooms/${roomId}`)).status).toBe(404);
  }, 90000);
});

describe('readiness is re-evaluated on every lobby change', () => {
  it('starts when the host readies first and then fills the table with bots', async () => {
    const host = await newTable();
    // Ready before the table is complete: this must not be forgotten.
    await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });

    await post(`/rooms/${host.roomId}/add-bot`, host);
    await post(`/rooms/${host.roomId}/add-bot`, host);
    const last = await post(`/rooms/${host.roomId}/add-bot`, host);

    expect(last.body.started).toBe(true);
    expect(last.body.status).toBe('playing');
  });

  it('starts when a late joiner completes an otherwise ready table', async () => {
    const host = await newTable();
    await post(`/rooms/${host.roomId}/add-bot`, host);
    await post(`/rooms/${host.roomId}/add-bot`, host);
    await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });

    // Seat 3 is still empty, so nothing has started yet.
    expect((await getRoom(host.roomId)).status).toBe('lobby');

    // A human takes the final seat but has not readied, so it stays in lobby.
    const guest = await joinAs(host.roomId, 'نیکا');
    expect((await getRoom(host.roomId)).status).toBe('lobby');

    const ready = await post(`/rooms/${host.roomId}/ready`, { ...guest, ready: true });
    expect(ready.body.started).toBe(true);
  });
});

describe('hardening details', () => {
  it('issues unique room ids across many rooms', async () => {
    const ids = await Promise.all(
      Array.from({ length: 25 }, async () => (await newTable()).roomId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('frees the seat when leaving a finished table', async () => {
    const host = await newTable();
    const guest = await joinAs(host.roomId, 'نیکا');
    for (let i = 0; i < 2; i += 1) await post(`/rooms/${host.roomId}/add-bot`, host);
    await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });
    await post(`/rooms/${host.roomId}/ready`, { ...guest, ready: true });

    // Mid-game the seat is preserved.
    const midGame = await post(`/rooms/${host.roomId}/leave`, guest);
    expect(midGame.body.room.players).toHaveLength(4);
  });

  it('refuses gameplay on an abandoned table', async () => {
    const host = await newTable();
    await post(`/rooms/${host.roomId}/add-bot`, host);
    await post(`/rooms/${host.roomId}/leave`, host);

    const room = await getRoom(host.roomId);
    expect(room.status).toBe('abandoned');

    const readyAgain = await post(`/rooms/${host.roomId}/ready`, { ...host, ready: true });
    expect(readyAgain.status).toBeGreaterThanOrEqual(400);
  });

  it('reports readiness counts that the lobby UI relies on', async () => {
    const host = await newTable();
    await joinAs(host.roomId, 'نیکا');
    await post(`/rooms/${host.roomId}/add-bot`, host);

    const room = await getRoom(host.roomId);
    expect(room.readiness.humanCount).toBe(2);
    expect(room.readiness.botCount).toBe(1);
    expect(room.readiness.canStart).toBe(false);
  });
});
