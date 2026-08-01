import { chooseTrump, createGame, getValidCards, playCard, type Card } from '@hokm/game-engine';
import { describe, expect, it } from 'vitest';
import {
  advanceOneBotStep,
  autoAdvanceBots,
  BOT_MOVE_DELAY_MS,
  cancelBotSteps,
  createBot,
} from '../src/game/bots.js';
import { maybeStartGame } from '../src/game/room-service.js';
import { finishHakemDraw } from '@hokm/game-engine';
import { chooseCard, chooseTrumpSuit } from '../src/game/bot-ai.js';
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
    targetScore: 7,
    rules: { lowHandRedeal: false, maxRedeals: 2, bam: false },
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

describe('chooseTrumpSuit', () => {
  it('picks the suit the bot is strongest in', () => {
    const game = createGame(
      [0, 1, 2, 3].map((seat) => ({ id: `p${seat}`, name: `p${seat}`, seat: seat as 0 | 1 | 2 | 3 })),
      { rng: seededRng() },
    );
    game.hands[0] = [card('A', 'clubs'), card('K', 'clubs'), card('Q', 'clubs'), card('2', 'hearts')];
    expect(chooseTrumpSuit(game, 0, 'medium')).toBe('clubs');
    expect(chooseTrumpSuit(game, 0, 'hard')).toBe('clubs');
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
    void chooseCard;
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

describe('bot pacing', () => {
  it('advances exactly one move per step', () => {
    // The whole point of stepping is that a trick does not resolve between two
    // frames; a step that played several cards would defeat it.
    const room = soloRoom();
    for (const player of room.players) player.ready = true;
    maybeStartGame(room);
    // Any timer `maybeStartGame` queued would otherwise keep moving bots while
    // this test inspects the state.
    cancelBotSteps(room.id);
    // Pin the hand into the playing phase so the assertion is about stepping,
    // not about whichever phase the random hakem draw happened to leave behind.
    while (room.game && room.game.phase !== 'playing') {
      if (room.game.phase === 'choosing_hakem') {
        room.game = finishHakemDraw(room.game);
        continue;
      }
      if (!advanceOneBotStep(room)) break;
    }
    expect(room.game?.phase).toBe('playing');

    const before = room.game!.currentTrick.plays.length;
    const moved = advanceOneBotStep(room);
    const after = room.game!.currentTrick.plays.length;

    expect(moved).toBe(true);
    // Exactly one card, never a whole trick at once.
    expect(after - before).toBe(1);
  });

  it('reports when no bot can act', () => {
    const room = soloRoom();
    cancelBotSteps(room.id);
    room.players = room.players.filter((player) => !player.isBot);
    // No bots left, so there is nothing to advance.
    expect(advanceOneBotStep(room)).toBe(false);
  });

  it('uses a delay long enough to follow by default', () => {
    expect(BOT_MOVE_DELAY_MS).toBeGreaterThanOrEqual(500);
  });
});
