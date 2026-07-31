import { describe, expect, it } from 'vitest';
import {
  cleanupAction,
  DEFAULT_CLEANUP_POLICY,
  evaluateReadiness,
  hasNoHumans,
  nextFreeSeat,
  pickNextHost,
  type LifecycleRoom,
} from '../src/room-lifecycle.js';

function room(overrides: Partial<LifecycleRoom> = {}): LifecycleRoom {
  return {
    id: 'r1',
    status: 'lobby',
    createdAt: '2026-07-30T00:00:00.000Z',
    players: [],
    ...overrides,
  };
}

const human = (id: string, seat: number, ready = false) => ({ id, seat, ready });
const bot = (id: string, seat: number) => ({ id, seat, isBot: true, ready: true });

describe('evaluateReadiness', () => {
  it('blocks a table that is not full yet', () => {
    const result = evaluateReadiness(room({ players: [human('a', 0, true)] }));
    expect(result.canStart).toBe(false);
    expect(result.blockedBy).toBe('ROOM_NOT_FULL');
  });

  it('starts a solo game once the host is ready and three bots fill the table', () => {
    const result = evaluateReadiness(
      room({ players: [human('a', 0, true), bot('b1', 1), bot('b2', 2), bot('b3', 3)] }),
    );
    expect(result.canStart).toBe(true);
    expect(result.humanCount).toBe(1);
    expect(result.botCount).toBe(3);
  });

  it('waits for the second human in a two player game', () => {
    const players = [human('a', 0, true), human('b', 1, false), bot('b1', 2), bot('b2', 3)];
    const result = evaluateReadiness(room({ players }));
    expect(result.canStart).toBe(false);
    expect(result.blockedBy).toBe('PLAYERS_NOT_READY');
    expect(result.waitingOn).toEqual(['b']);
  });

  it('starts a three player game when all humans are ready', () => {
    const players = [human('a', 0, true), human('b', 1, true), human('c', 2, true), bot('b1', 3)];
    expect(evaluateReadiness(room({ players })).canStart).toBe(true);
  });

  it('starts a four player game only when every human is ready', () => {
    const notAll = [human('a', 0, true), human('b', 1, true), human('c', 2, true), human('d', 3, false)];
    expect(evaluateReadiness(room({ players: notAll })).canStart).toBe(false);

    const all = notAll.map((player) => ({ ...player, ready: true }));
    expect(evaluateReadiness(room({ players: all })).canStart).toBe(true);
  });

  it('never restarts a game that is already running', () => {
    const players = [human('a', 0, true), bot('b1', 1), bot('b2', 2), bot('b3', 3)];
    const result = evaluateReadiness(room({ status: 'playing', players }));
    expect(result.canStart).toBe(false);
    expect(result.blockedBy).toBe('ROOM_ALREADY_STARTED');
  });
});

describe('nextFreeSeat', () => {
  it('returns the lowest free seat and undefined when full', () => {
    expect(nextFreeSeat(room({ players: [human('a', 0)] }))).toBe(1);
    expect(nextFreeSeat(room({ players: [human('a', 0), bot('b', 2)] }))).toBe(1);
    const full = [human('a', 0), bot('b', 1), bot('c', 2), bot('d', 3)];
    expect(nextFreeSeat(room({ players: full }))).toBeUndefined();
  });
});

describe('pickNextHost', () => {
  it('prefers a connected human by seat order and never a bot', () => {
    const players = [
      { id: 'a', seat: 0, connected: false },
      { id: 'bot', seat: 1, isBot: true, connected: true },
      { id: 'c', seat: 2, connected: true },
      { id: 'd', seat: 3, connected: false },
    ];
    expect(pickNextHost(room({ players }), 'a')).toBe('c');
  });

  it('returns undefined when only bots remain', () => {
    expect(pickNextHost(room({ players: [bot('b1', 1)] }), 'a')).toBeUndefined();
  });
});

describe('hasNoHumans', () => {
  it('detects bot-only and empty tables', () => {
    expect(hasNoHumans(room({ players: [bot('b1', 0)] }))).toBe(true);
    expect(hasNoHumans(room({ players: [] }))).toBe(true);
    expect(hasNoHumans(room({ players: [human('a', 0), bot('b1', 1)] }))).toBe(false);
  });
});

describe('cleanupAction', () => {
  const base = Date.parse('2026-07-30T00:00:00.000Z');
  const hours = (n: number) => n * 60 * 60 * 1000;

  it('keeps fresh rooms in every state', () => {
    for (const status of ['lobby', 'playing', 'finished', 'abandoned'] as const) {
      const target = room({ status, lastActivityAt: new Date(base).toISOString() });
      expect(cleanupAction(target, base + hours(1))).toBe('keep');
    }
  });

  it('deletes stale lobbies', () => {
    const target = room({ status: 'lobby', lastActivityAt: new Date(base).toISOString() });
    expect(cleanupAction(target, base + hours(7))).toBe('delete');
  });

  it('abandons stalled games rather than deleting them', () => {
    const target = room({ status: 'playing', lastActivityAt: new Date(base).toISOString() });
    expect(cleanupAction(target, base + hours(13))).toBe('abandon');
  });

  it('deletes finished and abandoned rooms after a day', () => {
    for (const status of ['finished', 'abandoned'] as const) {
      const target = room({ status, lastActivityAt: new Date(base).toISOString() });
      expect(cleanupAction(target, base + hours(25))).toBe('delete');
    }
  });

  it('falls back to createdAt when there is no activity timestamp', () => {
    const target = room({ status: 'lobby', createdAt: new Date(base).toISOString() });
    expect(cleanupAction(target, base + hours(7))).toBe('delete');
  });

  it('honours a custom policy', () => {
    const target = room({ status: 'lobby', lastActivityAt: new Date(base).toISOString() });
    const policy = { ...DEFAULT_CLEANUP_POLICY, lobbyIdleMs: hours(1) };
    expect(cleanupAction(target, base + hours(2), policy)).toBe('delete');
  });
});
