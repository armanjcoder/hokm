import { describe, expect, it } from 'vitest';
import { createRoom, joinRoom } from '../src/game/room-service.js';
import { sanitizeRoom, viewFor } from '../src/game/views.js';
import { createBot } from '../src/game/bots.js';
import { maybeStartGame } from '../src/game/room-service.js';
import { nextFreeSeat } from '../src/room-lifecycle.js';

/**
 * Privacy audit for everything that leaves the server.
 *
 * `sanitizeRoom` spreads `...room`, so any field added to `Room` in future is
 * exposed by default. These tests pin exactly which fields are allowed out and
 * fail loudly when a new one appears, rather than waiting for a leak to be
 * noticed in production.
 */

const ALLOWED_ROOM_KEYS = new Set([
  'id',
  'code',
  'mode',
  'targetScore',
  'rules',
  'status',
  'createdAt',
  'lastActivityAt',
  'hostPlayerId',
  'players',
  'game',
  'readiness',
]);

const ALLOWED_PLAYER_KEYS = new Set([
  'id',
  'name',
  'seat',
  'connected',
  'ready',
  'isBot',
  'difficulty',
  'telegramId',
]);

function tableOfTwo() {
  const room = createRoom('Host', 111111);
  joinRoom(room, 'Guest', 222222);
  return room;
}

describe('sanitizeRoom exposes only known fields', () => {
  it('never adds an unreviewed top-level field', () => {
    const view = sanitizeRoom(tableOfTwo()) as Record<string, unknown>;
    const unexpected = Object.keys(view).filter((key) => !ALLOWED_ROOM_KEYS.has(key));
    expect(unexpected).toEqual([]);
  });

  it('never adds an unreviewed player field', () => {
    const view = sanitizeRoom(tableOfTwo()) as any;
    for (const player of view.players) {
      const unexpected = Object.keys(player).filter((key) => !ALLOWED_PLAYER_KEYS.has(key));
      expect(unexpected).toEqual([]);
    }
  });

  it('strips every session token', () => {
    const view = sanitizeRoom(tableOfTwo()) as any;
    expect(view.players.every((p: any) => p.token === undefined)).toBe(true);
    expect(JSON.stringify(view)).not.toContain('token');
  });
});

describe('game state never leaks private cards', () => {
  function playingRoom() {
    const room = createRoom('Host', 111111);
    joinRoom(room, 'Guest', 222222);
    for (let i = 0; i < 2; i += 1) {
      const seat = nextFreeSeat(room);
      if (seat !== undefined) room.players.push(createBot(room, seat as any));
    }
    for (const player of room.players) player.ready = true;
    maybeStartGame(room);
    return room;
  }

  it('hides other players hands from a personalised view', () => {
    const room = playingRoom();
    expect(room.game).toBeDefined();
    const first = room.players[0];
    expect(first).toBeDefined();
    const view = viewFor(room, first!.id) as any;
    expect(view.game.hands).toBeUndefined();
    expect(view.game.stock).toBeUndefined();
  });

  it('never exposes hands or stock through the plain room view', () => {
    const room = playingRoom();
    const view = sanitizeRoom(room) as any;
    expect(view.game?.hands).toBeUndefined();
    expect(view.game?.stock).toBeUndefined();
  });
});
