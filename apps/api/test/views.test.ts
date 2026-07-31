import { chooseTrump, createGame } from '@hokm/game-engine';
import { describe, expect, it } from 'vitest';
import { sanitizeRoom, viewFor } from '../src/game/views.js';
import type { Room } from '../src/types.js';

function seededRng(seed = 7) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function lobbyRoom(): Room {
  return {
    id: 'room1',
    code: 'ABCDE',
    status: 'lobby',
    createdAt: '2026-07-30T00:00:00.000Z',
    hostPlayerId: 'p0',
    players: [
      { id: 'p0', token: 'secret-host-token', name: 'آرمان', seat: 0, connected: true, ready: true },
      { id: 'p1', token: 'secret-guest-token', name: 'نیکا', seat: 1, connected: true, ready: false },
    ],
  };
}

function playingRoom(): Room {
  const room = lobbyRoom();
  room.players = [0, 1, 2, 3].map((seat) => ({
    id: `p${seat}`,
    token: `secret-${seat}`,
    name: `بازیکن ${seat}`,
    seat: seat as 0 | 1 | 2 | 3,
    connected: true,
    ready: true,
  }));
  room.status = 'playing';
  const game = createGame(
    room.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
    { id: room.id, rng: seededRng() },
  );
  room.game = chooseTrump(game, 'p0', 'hearts', seededRng(3));
  return room;
}

describe('sanitizeRoom', () => {
  it('strips every player token', () => {
    const view = sanitizeRoom(lobbyRoom());
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('secret-host-token');
    expect(serialised).not.toContain('secret-guest-token');
    for (const player of view.players) {
      expect(player).not.toHaveProperty('token');
    }
  });

  it('summarises readiness for the lobby UI', () => {
    const view = sanitizeRoom(lobbyRoom());
    expect(view.readiness).toEqual({
      waitingOn: ['p1'],
      humanCount: 2,
      botCount: 0,
      canStart: false,
    });
  });

  it('never exposes any hand, not even to a spectator', () => {
    const view = sanitizeRoom(playingRoom());
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('"hands"');
    expect(serialised).not.toContain('myHand');
  });

  it('keeps the public game summary intact', () => {
    const view = sanitizeRoom(playingRoom());
    expect(view.game?.trumpSuit).toBe('hearts');
    expect(view.game?.phase).toBe('playing');
    expect(view.game?.matchScore).toBeDefined();
  });
});

describe('viewFor', () => {
  it('gives a player their own hand and nobody else\'s', () => {
    const room = playingRoom();
    const view = viewFor(room, 'p2') as any;

    expect(view.game.myHand).toHaveLength(13);
    expect(view.game.hands).toBeUndefined();

    const serialised = JSON.stringify(view);
    // Cards belonging to the other three seats must not appear anywhere.
    for (const seat of [0, 1, 3] as const) {
      for (const card of room.game!.hands[seat]) {
        expect(serialised).not.toContain(`"${card.id}"`);
      }
    }
  });

  it('includes the legal moves for the player whose turn it is', () => {
    const room = playingRoom();
    const onTurn = viewFor(room, 'p0') as any;
    const offTurn = viewFor(room, 'p1') as any;
    expect(onTurn.game.validCardIds.length).toBeGreaterThan(0);
    expect(offTurn.game.validCardIds).toHaveLength(0);
  });

  it('falls back to the public view without a player id', () => {
    const view = viewFor(playingRoom()) as any;
    expect(view.game.myHand).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('"hands"');
  });

  it('still hides tokens in the personalised view', () => {
    const view = viewFor(playingRoom(), 'p1');
    expect(JSON.stringify(view)).not.toContain('secret-');
  });
});
