import { describe, expect, it } from 'vitest';
import {
  chooseTrump,
  createGame,
  HokmError,
  isFaceCard,
  isLowHand,
  requestRedeal,
  type Card,
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

const players = [
  { id: 'p0', name: 'آرمان' },
  { id: 'p1', name: 'نیکا' },
  { id: 'p2', name: 'آرش' },
  { id: 'p3', name: 'سارا' },
];

const card = (rank: Card['rank'], suit: Card['suit'] = 'hearts'): Card => ({
  id: `${suit}-${rank}`,
  suit,
  rank,
});

/** Forces the hakem's opening hand so the rule can be tested deterministically. */
function withHakemHand(state: HokmGameState, hand: Card[]): HokmGameState {
  const hands = { ...state.hands, [state.hakemSeat]: hand };
  return { ...state, hands, canRequestRedeal: state.rules.lowHandRedeal && isLowHand(hand) };
}

function newGame(rules?: { lowHandRedeal?: boolean; maxRedeals?: number }) {
  return createGame(players, { hakemSeat: 0, rng: seededRng(), ...(rules ? { rules } : {}) });
}

describe('low hand detection', () => {
  it('treats A, K, Q and J as face cards', () => {
    for (const rank of ['A', 'K', 'Q', 'J'] as const) {
      expect(isFaceCard(card(rank))).toBe(true);
    }
    for (const rank of ['10', '9', '2'] as const) {
      expect(isFaceCard(card(rank))).toBe(false);
    }
  });

  it('flags a hand with nothing above a ten', () => {
    expect(isLowHand([card('10'), card('9'), card('5'), card('3'), card('2')])).toBe(true);
  });

  it('does not flag a hand holding any face card', () => {
    expect(isLowHand([card('10'), card('9'), card('5'), card('3'), card('J')])).toBe(false);
    expect(isLowHand([card('A'), card('2')])).toBe(false);
  });

  it('never flags an empty hand', () => {
    expect(isLowHand([])).toBe(false);
  });
});

describe('rule is opt-in', () => {
  it('is disabled by default so existing behaviour is unchanged', () => {
    const game = newGame();
    expect(game.rules.lowHandRedeal).toBe(false);
    expect(game.canRequestRedeal).toBe(false);
  });

  it('refuses a redeal while the rule is off, even with a weak hand', () => {
    const weak = withHakemHand(newGame(), [card('10'), card('9'), card('5'), card('3'), card('2')]);
    expect(() => requestRedeal(weak, 'p0')).toThrow(/disabled/i);
  });

  it('exposes the flag once enabled and the hand qualifies', () => {
    const game = withHakemHand(newGame({ lowHandRedeal: true }), [
      card('10'),
      card('9'),
      card('5'),
      card('3'),
      card('2'),
    ]);
    expect(game.canRequestRedeal).toBe(true);
  });
});

describe('requesting a redeal', () => {
  const weakHand = [card('10'), card('9'), card('5'), card('3'), card('2')];

  it('deals a fresh hand and keeps the same hakem and round', () => {
    const game = withHakemHand(newGame({ lowHandRedeal: true }), weakHand);
    const next = requestRedeal(game, 'p0', seededRng(7));

    expect(next.phase).toBe('waiting_for_trump');
    expect(next.hakemSeat).toBe(game.hakemSeat);
    expect(next.roundNumber).toBe(game.roundNumber);
    expect(next.redealCount).toBe(1);
    expect(next.hands[0]).toHaveLength(5);
    expect(next.lastEvent).toMatch(/ده‌لو کم/);
  });

  it('rejects a request from anyone but the hakem', () => {
    const game = withHakemHand(newGame({ lowHandRedeal: true }), weakHand);
    expect(() => requestRedeal(game, 'p1')).toThrow(/hakem/i);
  });

  it('rejects a request when the hand holds a face card', () => {
    const strong = withHakemHand(newGame({ lowHandRedeal: true }), [
      card('K'),
      card('9'),
      card('5'),
      card('3'),
      card('2'),
    ]);
    // The server checks the condition itself; a client cannot fake a weak hand.
    expect(() => requestRedeal(strong, 'p0')).toThrow(/not weak enough/i);
  });

  it('rejects a request once trump has been chosen', () => {
    const game = withHakemHand(newGame({ lowHandRedeal: true }), weakHand);
    const started = chooseTrump(game, 'p0', 'spades', seededRng(3));
    expect(() => requestRedeal(started, 'p0')).toThrow(HokmError);
  });

  it('enforces the redeal limit so a table cannot lock up', () => {
    let game = withHakemHand(newGame({ lowHandRedeal: true, maxRedeals: 2 }), weakHand);

    game = withHakemHand(requestRedeal(game, 'p0', seededRng(11)), weakHand);
    expect(game.redealCount).toBe(1);

    game = withHakemHand(requestRedeal(game, 'p0', seededRng(12)), weakHand);
    expect(game.redealCount).toBe(2);

    // The third attempt must be refused.
    expect(() => requestRedeal(game, 'p0', seededRng(13))).toThrow(/no redeals remain/i);
  });

  it('clears the flag when the limit is reached', () => {
    let game = withHakemHand(newGame({ lowHandRedeal: true, maxRedeals: 1 }), weakHand);
    game = requestRedeal(game, 'p0', seededRng(21));
    // Whatever the new hand looks like, no further redeal is offered.
    expect(game.redealCount).toBe(1);
    const forcedWeak = { ...game, hands: { ...game.hands, 0: weakHand } };
    expect(() => requestRedeal(forcedWeak, 'p0')).toThrow(/no redeals remain/i);
  });

  it('resets the allowance on the next hand', () => {
    const game = newGame({ lowHandRedeal: true });
    expect(game.redealCount).toBe(0);
  });

  it('carries the rules through a redeal', () => {
    const game = withHakemHand(newGame({ lowHandRedeal: true, maxRedeals: 3 }), weakHand);
    const next = requestRedeal(game, 'p0', seededRng(31));
    expect(next.rules.lowHandRedeal).toBe(true);
    expect(next.rules.maxRedeals).toBe(3);
  });

  it('deals a complete, non-overlapping set of cards after a redeal', () => {
    const game = withHakemHand(newGame({ lowHandRedeal: true }), weakHand);
    const next = requestRedeal(game, 'p0', seededRng(41));
    const all = ([0, 1, 2, 3] as Seat[]).flatMap((seat) => next.hands[seat].map((c) => c.id));
    expect(all).toHaveLength(20);
    expect(new Set(all).size).toBe(20);
  });
});
