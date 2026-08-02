import { describe, expect, it } from 'vitest';
import {
  chooseTrump,
  continueToNextHand,
  createGame,
  discardCards,
  drawCard,
  getModeConfig,
  getValidCards,
  HokmError,
  isGameMode,
  playCard,
  resolveDraw,
  toPublicView,
  type HokmGameState,
  type Seat,
} from '../src/index.js';

function seededRng(seed = 42) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

const names = ['آرمان', 'نیکا', 'آرش', 'سارا'];
const playersFor = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: names[i]! }));

function seatOf(state: HokmGameState, seat: Seat) {
  return state.players.find((p) => p.seat === seat)!;
}

/** Plays a full trick with the first legal card from each seat. */
function playTrick(state: HokmGameState): HokmGameState {
  let next = state;
  const seats = getModeConfig(next.mode).seats;
  for (let i = 0; i < seats; i += 1) {
    const player = seatOf(next, next.currentTurnSeat);
    const legal = getValidCards(next, player.id);
    next = playCard(next, player.id, legal[0]!.id);
  }
  return next;
}

/** Runs the two player discard and draw phases to reach the playing phase. */
function completeDuelSetup(state: HokmGameState): HokmGameState {
  let game = state;
  for (const seat of [0, 1] as Seat[]) {
    const player = seatOf(game, seat);
    const toBurn = game.hands[seat].slice(0, 2).map((c) => c.id);
    game = discardCards(game, player.id, toBurn);
  }
  expect(game.phase).toBe('drawing');

  let guard = 0;
  while (game.phase === 'drawing' && guard < 200) {
    const player = seatOf(game, game.currentTurnSeat);
    game = drawCard(game, player.id);
    game = resolveDraw(game, player.id, guard % 2 === 0);
    guard += 1;
  }
  return game;
}

describe('mode configuration', () => {
  it('describes each supported mode', () => {
    expect(getModeConfig('classic4').seats).toBe(4);
    expect(getModeConfig('classic4').teamPlay).toBe(true);
    expect(getModeConfig('solo3').seats).toBe(3);
    expect(getModeConfig('solo3').teamPlay).toBe(false);
    expect(getModeConfig('duel2').seats).toBe(2);
    expect(getModeConfig('duel2').usesDrawPhase).toBe(true);
  });

  it('defaults to the classic game for unknown input', () => {
    expect(getModeConfig(undefined).mode).toBe('classic4');
    expect(isGameMode('solo3')).toBe(true);
    expect(isGameMode('nope')).toBe(false);
  });
});

describe('four player classic mode', () => {
  it('keeps the original team pairing and 13 card hands', () => {
    let game = createGame(playersFor(4), { mode: 'classic4', rng: seededRng() });
    expect(game.mode).toBe('classic4');
    expect(game.players.map((p) => p.team)).toEqual([0, 1, 0, 1]);

    game = chooseTrump(game, 'p0', 'hearts', seededRng(2));
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      expect(game.hands[seat]).toHaveLength(13);
    }
    expect(game.removedCards).toEqual([]);
  });

  it('rejects the wrong number of players', () => {
    expect(() => createGame(playersFor(3), { mode: 'classic4' })).toThrow(HokmError);
  });
});

describe('three player mode', () => {
  it('removes exactly one low card so 51 cards split into 17 each', () => {
    let game = createGame(playersFor(3), { mode: 'solo3', rng: seededRng() });
    expect(game.players.map((p) => p.team)).toEqual([0, 1, 2]);
    expect(game.hands[0]).toHaveLength(5);

    game = chooseTrump(game, 'p0', 'hearts', seededRng(3));
    expect(game.removedCards).toHaveLength(1);
    expect(game.removedCards![0]!.rank).toBe('2');
    for (const seat of [0, 1, 2] as Seat[]) {
      expect(game.hands[seat]).toHaveLength(17);
    }
    // 17 * 3 = 51 unique cards in play.
    const all = [0, 1, 2].flatMap((s) => game.hands[s as Seat].map((c) => c.id));
    expect(new Set(all).size).toBe(51);
  });

  it('never removes a card of the trump suit', () => {
    for (const trump of ['spades', 'hearts', 'diamonds', 'clubs'] as const) {
      const base = createGame(playersFor(3), { mode: 'solo3', rng: seededRng(9) });
      const game = chooseTrump(base, 'p0', trump, seededRng(4));
      expect(game.removedCards![0]!.suit).not.toBe(trump);
    }
  });

  it('scores every player separately', () => {
    let game = createGame(playersFor(3), { mode: 'solo3', rng: seededRng(5) });
    game = chooseTrump(game, 'p0', 'hearts', seededRng(6));
    expect(Object.keys(game.handScore.tricks)).toEqual(['0', '1', '2']);
    expect(game.matchScore).toEqual({ 0: 0, 1: 0, 2: 0 });

    while (game.phase === 'playing') game = playTrick(game);
    const winner = game.handScore.winningTeam!;
    // A solo winner scores for themselves only.
    expect(game.matchScore[winner]).toBeGreaterThan(0);
    expect(['hand_complete', 'game_complete']).toContain(game.phase);
  });

  it('uses a three seat rotation', () => {
    let game = createGame(playersFor(3), { mode: 'solo3', rng: seededRng(8) });
    game = chooseTrump(game, 'p0', 'spades', seededRng(2));
    const lead = seatOf(game, game.currentTurnSeat);
    game = playCard(game, lead.id, getValidCards(game, lead.id)[0]!.id);
    expect(game.currentTurnSeat).toBe(1);
    const second = seatOf(game, 1);
    game = playCard(game, second.id, getValidCards(game, second.id)[0]!.id);
    expect(game.currentTurnSeat).toBe(2);
  });

  it('completes a trick with three cards, not four', () => {
    let game = createGame(playersFor(3), { mode: 'solo3', rng: seededRng(12) });
    game = chooseTrump(game, 'p0', 'clubs', seededRng(13));
    game = playTrick(game);
    expect(game.completedTricks).toHaveLength(1);
    expect(game.completedTricks[0]!.plays).toHaveLength(3);
  });
});

describe('two player duel mode', () => {
  it('deals five cards then waits for both players to discard', () => {
    let game = createGame(playersFor(2), { mode: 'duel2', rng: seededRng() });
    expect(game.players.map((p) => p.team)).toEqual([0, 1]);
    expect(game.hands[0]).toHaveLength(5);
    expect(game.hands[1]).toHaveLength(5);

    game = chooseTrump(game, 'p0', 'hearts', seededRng(2));
    expect(game.phase).toBe('discarding');
    expect(game.stock!.length).toBeGreaterThan(0);
  });

  it('requires exactly two discards from each player', () => {
    let game = createGame(playersFor(2), { mode: 'duel2', rng: seededRng(3) });
    game = chooseTrump(game, 'p0', 'hearts', seededRng(4));

    expect(() => discardCards(game, 'p0', [game.hands[0]![0]!.id])).toThrow(/2 cards/i);

    game = discardCards(game, 'p0', game.hands[0].slice(0, 2).map((c) => c.id));
    expect(game.hands[0]).toHaveLength(3);
    expect(game.phase).toBe('discarding');

    // The same player cannot discard twice.
    expect(() => discardCards(game, 'p0', game.hands[0].slice(0, 2).map((c) => c.id))).toThrow(HokmError);

    game = discardCards(game, 'p1', game.hands[1].slice(0, 2).map((c) => c.id));
    expect(game.phase).toBe('drawing');
    expect(game.currentTurnSeat).toBe(game.hakemSeat);
  });

  it('lets a player keep a revealed card, burning the next one unseen', () => {
    let game = createGame(playersFor(2), { mode: 'duel2', rng: seededRng(5) });
    game = chooseTrump(game, 'p0', 'spades', seededRng(6));
    game = discardCards(game, 'p0', game.hands[0].slice(0, 2).map((c) => c.id));
    game = discardCards(game, 'p1', game.hands[1].slice(0, 2).map((c) => c.id));

    const before = game.hands[0].length;
    const stockBefore = game.stock!.length;
    game = drawCard(game, 'p0');
    expect(game.pendingDraw).toBeDefined();
    const revealed = game.pendingDraw!.card;

    game = resolveDraw(game, 'p0', true);
    expect(game.hands[0]).toHaveLength(before + 1);
    expect(game.hands[0].some((c) => c.id === revealed.id)).toBe(true);
    // One kept plus one burned.
    expect(game.stock!.length).toBe(stockBefore - 2);
    expect(game.pendingDraw).toBeUndefined();
  });

  it('forces the next card when the revealed one is burned', () => {
    let game = createGame(playersFor(2), { mode: 'duel2', rng: seededRng(7) });
    game = chooseTrump(game, 'p0', 'clubs', seededRng(8));
    game = discardCards(game, 'p0', game.hands[0].slice(0, 2).map((c) => c.id));
    game = discardCards(game, 'p1', game.hands[1].slice(0, 2).map((c) => c.id));

    const before = game.hands[0].length;
    game = drawCard(game, 'p0');
    const revealed = game.pendingDraw!.card;
    game = resolveDraw(game, 'p0', false);

    expect(game.hands[0]).toHaveLength(before + 1);
    // The burned card must not be in hand; the forced one is.
    expect(game.hands[0].some((c) => c.id === revealed.id)).toBe(false);
  });

  it('rejects drawing out of turn or resolving nothing', () => {
    let game = createGame(playersFor(2), { mode: 'duel2', rng: seededRng(9) });
    game = chooseTrump(game, 'p0', 'hearts', seededRng(10));
    game = discardCards(game, 'p0', game.hands[0].slice(0, 2).map((c) => c.id));
    game = discardCards(game, 'p1', game.hands[1].slice(0, 2).map((c) => c.id));

    expect(() => drawCard(game, 'p1')).toThrow(/turn/i);
    expect(() => resolveDraw(game, 'p0', true)).toThrow(HokmError);

    game = drawCard(game, 'p0');
    // Cannot draw again while a card is revealed.
    expect(() => drawCard(game, 'p0')).toThrow(HokmError);
  });

  it('ends the draw phase with 13 cards each and starts play', () => {
    let game = createGame(playersFor(2), { mode: 'duel2', rng: seededRng(11) });
    game = chooseTrump(game, 'p0', 'diamonds', seededRng(12));
    game = completeDuelSetup(game);

    expect(game.phase).toBe('playing');
    expect(game.hands[0]).toHaveLength(13);
    expect(game.hands[1]).toHaveLength(13);
    expect(game.currentTurnSeat).toBe(game.hakemSeat);
  });

  it('plays a full duel hand to a winner', () => {
    let game = createGame(playersFor(2), { mode: 'duel2', rng: seededRng(13) });
    game = chooseTrump(game, 'p0', 'hearts', seededRng(14));
    game = completeDuelSetup(game);

    let guard = 0;
    while (game.phase === 'playing' && guard < 40) {
      game = playTrick(game);
      guard += 1;
    }
    expect(['hand_complete', 'game_complete']).toContain(game.phase);
    const winner = game.handScore.winningTeam!;
    expect(game.handScore.tricks[winner]).toBeGreaterThanOrEqual(7);
  });

  it('completes a trick with two cards', () => {
    let game = createGame(playersFor(2), { mode: 'duel2', rng: seededRng(15) });
    game = chooseTrump(game, 'p0', 'spades', seededRng(16));
    game = completeDuelSetup(game);
    game = playTrick(game);
    expect(game.completedTricks[0]!.plays).toHaveLength(2);
  });
});

describe('privacy across all modes', () => {
  it('never exposes the stock or another player\'s hand', () => {
    let game = createGame(playersFor(2), { mode: 'duel2', rng: seededRng(17) });
    game = chooseTrump(game, 'p0', 'hearts', seededRng(18));

    const view = toPublicView(game, 'p1') as any;
    expect(view.hands).toBeUndefined();
    expect(view.stock).toBeUndefined();
    expect(view.stockCount).toBeGreaterThan(0);

    const serialised = JSON.stringify(view);
    for (const card of game.hands[0]) {
      expect(serialised).not.toContain(`"${card.id}"`);
    }
  });

  it('shows a revealed draw only to the drawing player', () => {
    let game = createGame(playersFor(2), { mode: 'duel2', rng: seededRng(19) });
    game = chooseTrump(game, 'p0', 'hearts', seededRng(20));
    game = discardCards(game, 'p0', game.hands[0].slice(0, 2).map((c) => c.id));
    game = discardCards(game, 'p1', game.hands[1].slice(0, 2).map((c) => c.id));
    game = drawCard(game, 'p0');

    expect((toPublicView(game, 'p0') as any).pendingDraw).toBeDefined();
    expect((toPublicView(game, 'p1') as any).pendingDraw).toBeUndefined();
  });
});

describe('hand rotation per mode', () => {
  it('passes hakem within the seats of a three player game', () => {
    let game = createGame(playersFor(3), { mode: 'solo3', rng: seededRng(21) });
    game = chooseTrump(game, 'p0', 'hearts', seededRng(22));
    while (game.phase === 'playing') game = playTrick(game);
    if (game.phase !== 'hand_complete') return;

    const next = continueToNextHand(game, seededRng(23));
    expect(next.hakemSeat).toBeLessThan(3);
    expect(next.mode).toBe('solo3');
    expect(next.phase).toBe('waiting_for_trump');
  });
});

describe('a hand always terminates, even without a clear winner', () => {
  /**
   * Regression: three players share 17 tricks, so a hand can end 6-6-5 with
   * nobody reaching the seven-trick target. The hand used to stay in `playing`
   * with every hand empty, hanging the table forever.
   */
  function playSoloHand(seed: number, hands: number) {
    let game = createGame(playersFor(3), { mode: 'solo3', rng: seededRng(seed) });
    for (let i = 0; i < hands; i += 1) {
      if (game.phase === 'waiting_for_trump') {
        game = chooseTrump(game, seatOf(game, game.hakemSeat).id, 'hearts', seededRng(seed + i));
      }
      // Play until the phase moves on, or the cards genuinely run out.
      while (game.phase === 'playing') {
        const cardsLeft = ([0, 1, 2] as Seat[]).reduce<number>((n, s) => n + game.hands[s].length, 0);
        if (cardsLeft === 0) break;
        game = playTrick(game);
      }
      if (game.phase !== 'hand_complete') break;
      game = continueToNextHand(game, seededRng(seed + 500 + i));
    }
    return game;
  }

  it('never strands a hand in the playing phase with no cards left', () => {
    // Several consecutive hands, so a 6-6-5 split is certain to occur.
    for (const seed of [1000, 1037, 1074]) {
      const game = playSoloHand(seed, 16);
      const cardsLeft = ([0, 1, 2] as Seat[]).reduce<number>((n, s) => n + game.hands[s].length, 0);
      const stuck = game.phase === 'playing' && cardsLeft === 0;
      expect(stuck).toBe(false);
    }
  });

  it('awards a fully played hand to whoever took the most tricks', () => {
    let game = createGame(playersFor(3), { mode: 'solo3', rng: seededRng(1000) });
    game = chooseTrump(game, seatOf(game, game.hakemSeat).id, 'hearts', seededRng(1000));

    // Advance to a hand that uses all seventeen tricks.
    for (let i = 0; i < 16; i += 1) {
      while (game.phase === 'playing') {
        const left = ([0, 1, 2] as Seat[]).reduce<number>((n, s) => n + game.hands[s].length, 0);
        if (left === 0) break;
        game = playTrick(game);
      }
      if (game.phase !== 'hand_complete') break;
      if (game.completedTricks.length === 17) {
        const winner = game.handScore.winningTeam!;
        for (const count of Object.values(game.handScore.tricks)) {
          expect(game.handScore.tricks[winner]).toBeGreaterThanOrEqual(count);
        }
        return;
      }
      game = continueToNextHand(game, seededRng(2000 + i));
      if (game.phase === 'waiting_for_trump') {
        game = chooseTrump(game, seatOf(game, game.hakemSeat).id, 'hearts', seededRng(3000 + i));
      }
    }
  });
});
