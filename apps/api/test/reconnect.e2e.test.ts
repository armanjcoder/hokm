import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { delay, ServerHarness, waitFor } from './helpers/server-harness.js';

interface JoinAck {
  ok: boolean;
  error?: string;
  message?: string;
  token?: string;
  room?: { id: string; players: Array<{ id: string; seat: number; connected: boolean }> };
}

let server: ServerHarness;
const openSockets: Socket[] = [];

beforeAll(async () => {
  server = await ServerHarness.create();
  await server.start();
}, 60000);

afterAll(async () => {
  for (const socket of openSockets) socket.close();
  await server?.dispose();
});

async function createRoom(hostName = 'آرمان') {
  const response = await fetch(`${server.url}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hostName }),
  });
  return (await response.json()) as {
    id: string;
    token: string;
    players: Array<{ id: string; seat: number }>;
  };
}

async function fetchRoom(roomId: string) {
  const response = await fetch(`${server.url}/rooms/${roomId}`);
  return (await response.json()) as {
    players: Array<{ id: string; name: string; connected: boolean; token?: string }>;
  };
}

function connect(options: { reconnection: boolean }): Socket {
  const socket = io(server.url, {
    reconnection: options.reconnection,
    reconnectionDelay: 200,
    reconnectionDelayMax: 800,
    transports: ['websocket'],
  });
  openSockets.push(socket);
  return socket;
}

function joinOnce(socket: Socket, payload: Record<string, unknown>): Promise<JoinAck> {
  return new Promise((resolve) => socket.emit('room:join', payload, (ack: JoinAck) => resolve(ack)));
}

function onceConnected(socket: Socket): Promise<void> {
  return new Promise((resolve) => socket.on('connect', () => resolve()));
}

describe('session persistence across a server restart', () => {
  it('lets a player re-take the same seat after the backend is restarted', async () => {
    const room = await createRoom();
    const session = { roomId: room.id, playerId: room.players[0]!.id, token: room.token };

    const before = connect({ reconnection: false });
    await onceConnected(before);
    expect((await joinOnce(before, session)).ok).toBe(true);
    before.close();

    await server.restart();

    const after = connect({ reconnection: false });
    await onceConnected(after);
    const ack = await joinOnce(after, session);

    expect(ack.ok).toBe(true);
    expect(ack.room?.id).toBe(room.id);
    const me = ack.room?.players.find((player) => player.id === session.playerId);
    expect(me?.seat).toBe(0);
    after.close();
  }, 90000);

  it('rejects a tampered token after a restart, so seats cannot be stolen', async () => {
    const room = await createRoom();
    await server.restart();

    const socket = connect({ reconnection: false });
    await onceConnected(socket);
    const ack = await joinOnce(socket, {
      roomId: room.id,
      playerId: room.players[0]!.id,
      token: 'x'.repeat(43),
    });

    expect(ack.ok).toBe(false);
    expect(ack.error).toBe('INVALID_SESSION');
    expect(ack.message).toMatch(/[\u0600-\u06FF]/);
    socket.close();
  }, 90000);

  it('reports ROOM_NOT_FOUND for a session whose table no longer exists', async () => {
    const socket = connect({ reconnection: false });
    await onceConnected(socket);
    const ack = await joinOnce(socket, { roomId: 'missingroom', playerId: 'p1', token: 'tok' });

    expect(ack.ok).toBe(false);
    expect(ack.error).toBe('ROOM_NOT_FOUND');
    expect(ack.message).toMatch(/[\u0600-\u06FF]/);
    socket.close();
  }, 60000);
});

describe('automatic reconnect', () => {
  it('rejoins the table automatically after the connection drops', async () => {
    const room = await createRoom();
    const session = { roomId: room.id, playerId: room.players[0]!.id, token: room.token };

    const socket = connect({ reconnection: true });
    let joinCount = 0;
    let sawDisconnect = false;

    // Mirrors the Mini App: re-join on *every* connect, not just the first.
    socket.on('connect', () => {
      void joinOnce(socket, session).then((ack) => {
        if (ack.ok) joinCount += 1;
      });
    });
    socket.on('disconnect', () => {
      sawDisconnect = true;
    });

    await waitFor(() => joinCount === 1, { label: 'initial join' });

    await server.restart();

    await waitFor(() => sawDisconnect, { label: 'client to notice the drop' });
    await waitFor(() => joinCount >= 2, { timeoutMs: 30000, label: 'automatic re-join' });

    expect(socket.connected).toBe(true);
    const state = await fetchRoom(room.id);
    expect(state.players[0]?.connected).toBe(true);
    socket.close();
  }, 120000);
});

describe('disconnect tracking', () => {
  it('marks a player offline only once their last socket is gone', async () => {
    const room = await createRoom();
    const session = { roomId: room.id, playerId: room.players[0]!.id, token: room.token };

    const tabOne = connect({ reconnection: false });
    await onceConnected(tabOne);
    await joinOnce(tabOne, session);

    const tabTwo = connect({ reconnection: false });
    await onceConnected(tabTwo);
    await joinOnce(tabTwo, session);

    await waitFor(async () => (await fetchRoom(room.id)).players[0]!.connected, {
      label: 'player to be online',
    });

    tabOne.close();
    // The seat must stay online because a second tab still holds it.
    await delay(800);
    expect((await fetchRoom(room.id)).players[0]?.connected).toBe(true);

    tabTwo.close();
    await waitFor(async () => !(await fetchRoom(room.id)).players[0]!.connected, {
      label: 'player to go offline',
    });
  }, 90000);

  it('never exposes another player token over the public room endpoint', async () => {
    const room = await createRoom();
    const state = await fetchRoom(room.id);
    expect(JSON.stringify(state)).not.toContain(room.token);
    for (const player of state.players) expect(player.token).toBeUndefined();
  }, 60000);
});
