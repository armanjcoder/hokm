import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServerHarness, waitFor } from './helpers/server-harness.js';

let server: ServerHarness;
const openSockets: Socket[] = [];

beforeAll(async () => {
  server = await ServerHarness.create({
    RATE_LIMIT_CREATE_PER_MIN: '5',
    RATE_LIMIT_ACTIONS_PER_MIN: '200',
  });
  await server.start();
}, 60000);

afterAll(async () => {
  for (const socket of openSockets) socket.close();
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

describe('rate limiting', () => {
  it('blocks a burst of room creation with a Persian message', async () => {
    const results = [];
    for (let i = 0; i < 9; i += 1) {
      results.push(await post('/rooms', { hostName: 'آرمان' }));
    }

    const blocked = results.filter((result) => result.status === 429);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0]!.body.error).toBe('RATE_LIMITED');
    expect(blocked[0]!.body.message).toMatch(/[\u0600-\u06FF]/);
  });
});

describe('request hardening', () => {
  it('rejects an oversized body instead of buffering it', async () => {
    const response = await fetch(`${server.url}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostName: 'x'.repeat(200_000) }),
    });
    expect([413, 429]).toContain(response.status);
  });

  it('rejects malformed JSON without crashing the server', async () => {
    const response = await fetch(`${server.url}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ this is not json',
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    // The server must still be alive.
    expect((await fetch(`${server.url}/health`)).ok).toBe(true);
  });
});

describe('display name sanitisation end to end', () => {
  let clean: ServerHarness;

  beforeAll(async () => {
    clean = await ServerHarness.create({ RATE_LIMIT_CREATE_PER_MIN: '200' });
    await clean.start();
  }, 60000);

  afterAll(async () => {
    await clean?.dispose();
  });

  async function createWith(hostName: unknown) {
    const response = await fetch(`${clean.url}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostName }),
    });
    return (await response.json()) as any;
  }

  it('strips bidi overrides from a name before other players see it', async () => {
    const room = await createWith('\u202Eآرمان\u202C');
    expect(room.players[0].name).toBe('آرمان');
    expect(room.players[0].name).not.toContain('\u202E');
  });

  it('replaces a whitespace-only name with a readable fallback', async () => {
    const room = await createWith('     ');
    expect(room.players[0].name.trim().length).toBeGreaterThan(0);
  });

  it('collapses newlines that would break the lobby layout', async () => {
    const room = await createWith('آرمان\n\n\nحکم');
    expect(room.players[0].name).toBe('آرمان حکم');
  });
});

describe('a full game can be played to completion', () => {
  let game: ServerHarness;

  beforeAll(async () => {
    game = await ServerHarness.create({ RATE_LIMIT_CREATE_PER_MIN: '200' });
    await game.start();
  }, 60000);

  afterAll(async () => {
    await game?.dispose();
  });

  it('plays a solo game against three bots until someone wins the match', async () => {
    const created = await (
      await fetch(`${game.url}/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hostName: 'آرمان' }),
      })
    ).json();

    const session = {
      roomId: created.id as string,
      playerId: created.players[0].id as string,
      token: created.token as string,
    };

    const call = async (path: string, extra: object = {}) =>
      (
        await fetch(`${game.url}/rooms/${session.roomId}/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...session, ...extra }),
        })
      ).json();

    for (let i = 0; i < 3; i += 1) await call('add-bot');
    await call('ready', { ready: true });

    const socket = io(game.url, { transports: ['websocket'] });
    openSockets.push(socket);
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));

    let view: any;
    const join = () =>
      new Promise<any>((resolve) => socket.emit('room:join', session, (ack: any) => resolve(ack)));
    const emit = (event: string, payload: object) =>
      new Promise<any>((resolve) => socket.emit(event, { ...session, ...payload }, (ack: any) => resolve(ack)));

    const ack = await join();
    expect(ack.ok).toBe(true);
    view = ack.room;

    socket.on('room:update', (next: any) => {
      view = next;
    });

    // Drive the game: choose trump when we are hakem, play a legal card on our
    // turn, and continue between hands. Bots handle their own seats.
    for (let step = 0; step < 400; step += 1) {
      if (view?.status === 'finished' || view?.game?.phase === 'game_complete') break;
      const g = view?.game;
      if (!g) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        continue;
      }

      if (g.phase === 'choosing_hakem') {
        // A real client reports in once it has finished showing the draw.
        await emit('game:hakem_draw_done', {});
      } else if (g.phase === 'hand_complete') {
        await emit('game:next_hand', {});
      } else if (g.phase === 'waiting_for_trump' && g.hakemSeat === 0) {
        await emit('game:choose_trump', { suit: 'hearts' });
      } else if (g.phase === 'playing' && g.currentTurnSeat === 0) {
        const cardId = g.validCardIds?.[0];
        if (cardId) await emit('game:play_card', { cardId });
        else await new Promise((resolve) => setTimeout(resolve, 40));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }

    await waitFor(() => view?.status === 'finished' || view?.game?.phase === 'game_complete', {
      timeoutMs: 30000,
      label: 'the match to finish',
    });

    const finalState = await (await fetch(`${game.url}/rooms/${session.roomId}`)).json();
    expect(finalState.status).toBe('finished');
    const scores = Object.values(finalState.game.matchScore) as number[];
    expect(Math.max(...scores)).toBeGreaterThanOrEqual(7);
    socket.close();
  }, 120000);
});

describe('concurrent joins cannot oversubscribe a table', () => {
  let busy: ServerHarness;

  beforeAll(async () => {
    busy = await ServerHarness.create({
      RATE_LIMIT_CREATE_PER_MIN: '200',
      RATE_LIMIT_ACTIONS_PER_MIN: '500',
    });
    await busy.start();
  }, 60000);

  afterAll(async () => {
    await busy?.dispose();
  });

  it('never seats more than four players', async () => {
    const created = await (
      await fetch(`${busy.url}/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hostName: 'آرمان' }),
      })
    ).json();

    // Ten clients race for the three remaining seats.
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        fetch(`${busy.url}/rooms/${created.id}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: `بازیکن ${index}` }),
        }).catch(() => undefined),
      ),
    );

    const room = await (await fetch(`${busy.url}/rooms/${created.id}`)).json();
    expect(room.players.length).toBeLessThanOrEqual(4);
    const seats = room.players.map((player: any) => player.seat);
    expect(new Set(seats).size).toBe(seats.length);
  }, 60000);
});

describe('no player can see another player\'s cards', () => {
  let table: ServerHarness;

  beforeAll(async () => {
    table = await ServerHarness.create({
      RATE_LIMIT_CREATE_PER_MIN: '200',
      RATE_LIMIT_ACTIONS_PER_MIN: '500',
    });
    await table.start();
  }, 60000);

  afterAll(async () => {
    await table?.dispose();
  });

  it('never sends the full hands map to a client', async () => {
    const created = await (
      await fetch(`${table.url}/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hostName: 'آرمان' }),
      })
    ).json();

    const host = {
      roomId: created.id as string,
      playerId: created.players[0].id as string,
      token: created.token as string,
    };
    const guestRes = await (
      await fetch(`${table.url}/rooms/${host.roomId}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'نیکا' }),
      })
    ).json();
    const guest = {
      roomId: host.roomId,
      playerId: guestRes.player.id as string,
      token: guestRes.token as string,
    };

    const call = (session: object, path: string, extra: object = {}) =>
      fetch(`${table.url}/rooms/${host.roomId}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...session, ...extra }),
      });

    await call(host, 'add-bot');
    await call(host, 'add-bot');
    await call(host, 'ready', { ready: true });
    await call(guest, 'ready', { ready: true });

    const socket = io(table.url, { transports: ['websocket'] });
    openSockets.push(socket);
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
    const ack = await new Promise<any>((resolve) =>
      socket.emit('room:join', guest, (response: any) => resolve(response)),
    );

    expect(ack.ok).toBe(true);
    const game = ack.room.game;
    expect(game).toBeTruthy();
    // The private state must not travel to the client under any key.
    expect(game.hands).toBeUndefined();
    expect(JSON.stringify(ack.room)).not.toContain('"hands"');

    // The player still receives their own cards (5 before trump is chosen).
    expect(game.myHand.length).toBeGreaterThan(0);
    const myIds = new Set(game.myHand.map((card: any) => card.id));
    expect(myIds.size).toBe(game.myHand.length);
    socket.close();
  }, 60000);
});

describe('health exposes the built bundle name', () => {
  it('lets a stale deployment be spotted in one request', async () => {
    // `dist/` is gitignored, so pulling new code without rebuilding leaves the
    // old bundle in place. Reporting the filename makes that visible instead of
    // looking like the change silently failed to apply.
    const response = await fetch(`${server.url}/health`);
    const body = (await response.json()) as { ok: boolean; bundle: string | null };
    expect(body.ok).toBe(true);
    expect('bundle' in body).toBe(true);
    if (body.bundle !== null) expect(body.bundle).toMatch(/\.css$/);
  });
});

describe('the hakem draw cannot freeze a table', () => {
  it('starts the hand even when no client ever reports the draw finished', async () => {
    // An old client, a closed app or a dropped message must not strand the
    // table in `choosing_hakem` forever.
    const server = await ServerHarness.create({ HOKM_HAKEM_DRAW_TIMEOUT_MS: '300' });
    await server.start();
    try {
      const created = await (
        await fetch(`${server.url}/rooms`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ hostName: 'آرمان' }),
        })
      ).json();

      const session = {
        roomId: created.id as string,
        playerId: created.players[0].id as string,
        token: created.token as string,
      };
      const call = (path: string, extra: object = {}) =>
        fetch(`${server.url}/rooms/${session.roomId}/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...session, ...extra }),
        });

      for (let i = 0; i < 3; i += 1) await call('add-bot');
      const started = await (await call('ready', { ready: true })).json();
      expect(started.game.phase).toBe('choosing_hakem');

      // Deliberately never emit `game:hakem_draw_done`.
      await waitFor(async () => {
        const room = await (await fetch(`${server.url}/rooms/${session.roomId}`)).json();
        return room.game?.phase !== 'choosing_hakem';
      }, { timeoutMs: 5000 });

      const room = await (await fetch(`${server.url}/rooms/${session.roomId}`)).json();
      expect(room.game.phase).not.toBe('choosing_hakem');
    } finally {
      await server.stop();
    }
  });
});
