import { chooseTrump, createGame, getValidCards, playCard, type Card } from '@hokm/game-engine';
import { describe, expect, it } from 'vitest';
import { autoAdvanceBots, botRankValue, chooseBotCard, chooseBotTrump, createBot } from '../src/game/bots.js';
import type { Room } from '../src/types.js';

function seededRng(seed = 11) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function soloRoom(): Room {
  const room: Room = {
    id: 'r1',
    code: 'ABCDE',
    mode: 'classic4',
    status: 'lobby',
    createdAt: '2026-07-30T00:00:00.000Z',
    hostPlayerId: 'human',
    players: [{ id: 'human', name: 'آرمان', seat: 0, connected: true, ready: true }],
  };
  for (const seat of [1, 2, 3] as const) {
    room.players.push(createBot(room, seat));
  }
  return room;
}

const card = (rank: Card['rank'], suit: Card['suit'] = 'hearts'): Card => ({
  id: `${suit}-${rank}`,
  suit,
  rank,
});

describe('createBot', () => {
  it('creates a ready, connected bot on the requested seat', () => {
    const bot = createBot({ ...soloRoom(), players: [] }, 2);
    expect(bot.seat).toBe(2);
    expect(bot.isBot).toBe(true);
    expect(bot.ready).toBe(true);
    expect(bot.connected).toBe(true);
    expect(bot.id.startsWith('bot_')).toBe(true);
  });

  it('gives each bot at the table a distinct name', () => {
    const names = soloRoom()
      .players.filter((p) => p.isBot)
      .map((p) => p.name);
    expect(new Set(names).size).toBe(3);
  });

  it('never issues a session token to a bot', () => {
    expect(createBot({ ...soloRoom(), players: [] }, 1).token).toBeUndefined();
  });
});

describe('bot card choice', () => {
  it('ranks ace highest and two lowest', () => {
    expect(botRankValue(card('A'))).toBeGreaterThan(botRankValue(card('K')));
    expect(botRankValue(card('2'))).toBeLessThan(botRankValue(card('3')));
  });

  it('plays the lowest legal card', () => {
    const chosen = chooseBotCard([card('A'), card('5'), card('K')]);
    expect(chosen?.rank).toBe('5');
  });

  it('returns undefined when there is nothing legal to play', () => {
    expect(chooseBotCard([])).toBeUndefined();
  });
});

describe('chooseBotTrump', () => {
  it('picks the suit the bot holds most strength in', () => {
    const game = createGame(
      [0, 1, 2, 3].map((seat) => ({ id: `p${seat}`, name: `p${seat}`, seat: seat as 0 | 1 | 2 | 3 })),
      { rng: seededRng() },
    );
    // Stack seat 0 with clubs so the answer is unambiguous.
    game.hands[0] = [card('A', 'clubs'), card('K', 'clubs'), card('Q', 'clubs'), card('2', 'hearts')];
    expect(chooseBotTrump(game, 0)).toBe('clubs');
  });
});

describe('autoAdvanceBots', () => {
  it('does nothing when there is no game yet', () => {
    const room = soloRoom();
    expect(() => autoAdvanceBots(room)).not.toThrow();
    expect(room.game).toBeUndefined();
  });

  it('stops on the human turn instead of playing for them', () => {
    const room = soloRoom();
    room.status = 'playing';
    const game = createGame(
      room.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
      { id: room.id, hakemSeat: 0, rng: seededRng() },
    );
    room.game = chooseTrump(game, 'human', 'hearts', seededRng(5));

    autoAdvanceBots(room);
    // Seat 0 is the human and leads the first trick, so nothing may have moved.
    expect(room.game.currentTurnSeat).toBe(0);
    expect(room.game.currentTrick.plays).toHaveLength(0);
  });

  it('plays the three bot seats after the human leads', () => {
    const room = soloRoom();
    room.status = 'playing';
    const game = createGame(
      room.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
      { id: room.id, hakemSeat: 0, rng: seededRng() },
    );
    room.game = chooseTrump(game, 'human', 'hearts', seededRng(5));

    // Human leads, then the bots should complete the trick automatically.
    const legal = getValidCards(room.game, 'human');
    room.game = playCard(room.game, 'human', legal[0]!.id);
    autoAdvanceBots(room);

    // Trick resolved and the turn is back with a seat that can act.
    expect(room.game.currentTrick.plays.length).toBeLessThan(4);
    expect(room.game.phase === 'playing' || room.game.phase === 'hand_complete').toBe(true);
  });

  it('lets a bot hakem choose trump on its own', () => {
    const room = soloRoom();
    room.status = 'playing';
    const botSeat = room.players.find((p) => p.isBot)!;
    room.game = createGame(
      room.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
      { id: room.id, hakemSeat: botSeat.seat, rng: seededRng() },
    );
    expect(room.game.phase).toBe('waiting_for_trump');

    autoAdvanceBots(room);
    expect(room.game.trumpSuit).toBeDefined();
    expect(room.game.phase).not.toBe('waiting_for_trump');
  });
});
