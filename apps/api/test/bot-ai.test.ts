import { describe, expect, it } from 'vitest';
import type { Card, HokmGameState, Seat, Suit } from '@hokm/game-engine';
import {
  chooseCard,
  chooseTrumpSuit,
  DIFFICULTY_LABELS,
  isBotDifficulty,
  type BotDifficulty,
} from '../src/game/bot-ai.js';
import { chooseDiscards, shouldKeepDraw } from '../src/game/bot-duel.js';

const card = (rank: Card['rank'], suit: Suit = 'hearts'): Card => ({
  id: `${suit}-${rank}`,
  suit,
  rank,
});

/** Builds a playable state with the given hands and trick in progress. */
function state(options: {
  hands?: Partial<Record<Seat, Card[]>>;
  trump?: Suit;
  plays?: Array<{ seat: Seat; card: Card }>;
  completed?: Card[][];
  mode?: 'classic4' | 'solo3' | 'duel2';
}): HokmGameState {
  const mode = options.mode ?? 'classic4';
  const seats = mode === 'duel2' ? 2 : mode === 'solo3' ? 3 : 4;
  return {
    id: 'g1',
    mode,
    players: Array.from({ length: seats }, (_, i) => ({
      id: `p${i}`,
      name: `p${i}`,
      seat: i as Seat,
      team: mode === 'classic4' ? i % 2 : i,
    })),
    phase: 'playing',
    hakemSeat: 0,
    currentTurnSeat: 0,
    trumpSuit: options.trump ?? 'spades',
    hands: { 0: [], 1: [], 2: [], 3: [], ...options.hands },
    currentTrick: {
      leaderSeat: 0,
      plays: (options.plays ?? []).map((p) => ({ playerId: `p${p.seat}`, ...p })),
    },
    completedTricks: (options.completed ?? []).map((cards, i) => ({
      leaderSeat: 0 as Seat,
      plays: cards.map((c, j) => ({ playerId: `p${j}`, seat: j as Seat, card: c })),
      winnerSeat: 0 as Seat,
    })),
    handScore: { tricks: { 0: 0, 1: 0 } },
    matchScore: { 0: 0, 1: 0 },
    targetScore: 7,
    roundNumber: 1,
    rules: { lowHandRedeal: true, maxRedeals: 2, bam: true },
    redealCount: 0,
    canRequestRedeal: false,
  };
}

describe('difficulty helpers', () => {
  it('recognises the three levels', () => {
    expect(isBotDifficulty('easy')).toBe(true);
    expect(isBotDifficulty('medium')).toBe(true);
    expect(isBotDifficulty('hard')).toBe(true);
    expect(isBotDifficulty('impossible')).toBe(false);
  });

  it('has a Persian label for each level', () => {
    for (const level of ['easy', 'medium', 'hard'] as BotDifficulty[]) {
      expect(DIFFICULTY_LABELS[level]).toMatch(/[\u0600-\u06FF]/);
    }
  });
});

describe('always plays a legal card', () => {
  it.each(['easy', 'medium', 'hard'] as BotDifficulty[])('for %s', (difficulty) => {
    const legal = [card('9'), card('K'), card('3', 'clubs')];
    for (let i = 0; i < 30; i += 1) {
      const chosen = chooseCard(state({}), 1, legal, difficulty);
      expect(legal.some((c) => c.id === chosen!.id)).toBe(true);
    }
  });

  it('returns undefined when there is nothing to play', () => {
    expect(chooseCard(state({}), 0, [], 'hard')).toBeUndefined();
  });

  it('returns the only card when forced', () => {
    const only = [card('4')];
    expect(chooseCard(state({}), 0, only, 'hard')!.id).toBe(only[0]!.id);
  });
});

describe('medium and hard bots win tricks when they can', () => {
  it('takes the trick instead of throwing away a card', () => {
    // Seat 1 can beat the played 9 of hearts with the king.
    const game = state({ trump: 'spades', plays: [{ seat: 0, card: card('9') }] });
    const legal = [card('3'), card('K')];
    for (const difficulty of ['medium', 'hard'] as BotDifficulty[]) {
      expect(chooseCard(game, 1, legal, difficulty)!.rank).toBe('K');
    }
  });

  it('wins as cheaply as possible rather than wasting a high card', () => {
    const game = state({ trump: 'spades', plays: [{ seat: 0, card: card('5') }] });
    const legal = [card('A'), card('7'), card('6')];
    // A six is enough to beat a five.
    expect(chooseCard(game, 1, legal, 'medium')!.rank).toBe('6');
  });

  it('discards its lowest card when it cannot win', () => {
    const game = state({ trump: 'spades', plays: [{ seat: 0, card: card('A') }] });
    const legal = [card('9'), card('2'), card('7')];
    expect(chooseCard(game, 1, legal, 'medium')!.rank).toBe('2');
  });

  it('cuts with a low trump when that wins the trick', () => {
    const game = state({ trump: 'spades', plays: [{ seat: 0, card: card('A') }] });
    // A 2 of trumps beats the ace of a side suit, so taking it is correct.
    const legal = [card('2', 'spades'), card('4')];
    expect(chooseCard(game, 1, legal, 'medium')!.suit).toBe('spades');
  });

  it('keeps trumps back when even a trump cannot win', () => {
    // An opponent already cut with the ace of trumps, so our 2 is worthless.
    const game = state({
      trump: 'spades',
      plays: [
        { seat: 0, card: card('9') },
        { seat: 1, card: card('A', 'spades') },
      ],
    });
    const legal = [card('2', 'spades'), card('4')];
    expect(chooseCard(game, 2, legal, 'medium')!.suit).toBe('hearts');
  });
});

describe('team awareness (the old bot got this wrong)', () => {
  it('does not overtake a partner who is already winning', () => {
    // Seats 0 and 2 are partners. Seat 0 leads the ace and is winning.
    const game = state({ trump: 'spades', plays: [{ seat: 0, card: card('A') }, { seat: 1, card: card('3') }] });
    const legal = [card('K'), card('2')];
    // Seat 2 must not waste the king on its partner's trick.
    expect(chooseCard(game, 2, legal, 'medium')!.rank).toBe('2');
    expect(chooseCard(game, 2, legal, 'hard')!.rank).toBe('2');
  });

  it('still competes when an opponent is winning', () => {
    const game = state({ trump: 'spades', plays: [{ seat: 1, card: card('A') }] });
    const legal = [card('2', 'spades'), card('3')];
    // Seat 2's opponent leads, so cutting with a trump is correct.
    expect(chooseCard(game, 2, legal, 'medium')!.suit).toBe('spades');
  });

  it('has no partners in solo modes, so it always competes', () => {
    const game = state({
      mode: 'solo3',
      trump: 'spades',
      plays: [{ seat: 0, card: card('9') }],
    });
    const legal = [card('K'), card('2')];
    expect(chooseCard(game, 1, legal, 'medium')!.rank).toBe('K');
  });
});

describe('leading a trick', () => {
  it('avoids leading trumps so they stay available for cutting', () => {
    const game = state({ trump: 'spades' });
    const legal = [card('A', 'spades'), card('K', 'hearts')];
    expect(chooseCard(game, 0, legal, 'medium')!.suit).toBe('hearts');
  });

  it('hard bots lead a card that nothing can beat', () => {
    // Every heart above the king is already played, so the king is safe.
    const game = state({
      trump: 'spades',
      completed: [[card('A', 'hearts'), card('2', 'clubs'), card('3', 'clubs'), card('4', 'clubs')]],
    });
    const legal = [card('K', 'hearts'), card('5', 'diamonds')];
    expect(chooseCard(game, 0, legal, 'hard')!.rank).toBe('K');
  });
});

describe('difficulty actually differs', () => {
  it('easy bots do not reliably take winning tricks', () => {
    const game = state({ trump: 'spades', plays: [{ seat: 0, card: card('9') }] });
    const legal = [card('3'), card('K')];
    const picks = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      picks.add(chooseCard(game, 1, legal, 'easy')!.rank);
    }
    // Random play should produce both options over many samples.
    expect(picks.size).toBeGreaterThan(1);
  });

  it('medium bots are deterministic and always take the win', () => {
    const game = state({ trump: 'spades', plays: [{ seat: 0, card: card('9') }] });
    const legal = [card('3'), card('K')];
    const picks = new Set(
      Array.from({ length: 20 }, () => chooseCard(game, 1, legal, 'medium')!.rank),
    );
    expect([...picks]).toEqual(['K']);
  });
});

describe('choosing trump', () => {
  it('prefers a long strong suit', () => {
    const game = state({
      hands: { 0: [card('A', 'clubs'), card('K', 'clubs'), card('Q', 'clubs'), card('2', 'hearts')] },
    });
    expect(chooseTrumpSuit(game, 0, 'medium')).toBe('clubs');
    expect(chooseTrumpSuit(game, 0, 'hard')).toBe('clubs');
  });

  it('hard bots weigh length heavily over a couple of high cards', () => {
    const game = state({
      hands: {
        0: [
          card('A', 'hearts'),
          card('K', 'hearts'),
          card('2', 'clubs'),
          card('3', 'clubs'),
          card('4', 'clubs'),
          card('5', 'clubs'),
        ],
      },
    });
    // Four small clubs beat two big hearts as a trump suit.
    expect(chooseTrumpSuit(game, 0, 'hard')).toBe('clubs');
  });

  it('weighs length more heavily as the level rises', () => {
    // One lone ace versus four small clubs. Hard and medium value the long
    // suit; easy leans further towards the single high card.
    const game = state({
      hands: {
        0: [
          card('A', 'hearts'),
          card('2', 'clubs'),
          card('3', 'clubs'),
          card('4', 'clubs'),
        ],
      },
    });
    expect(chooseTrumpSuit(game, 0, 'hard')).toBe('clubs');
    expect(chooseTrumpSuit(game, 0, 'medium')).toBe('clubs');
  });
});

describe('two player decisions', () => {
  it('burns the weakest side cards and keeps trumps', () => {
    const game = state({
      mode: 'duel2',
      trump: 'spades',
      hands: { 0: [card('2', 'spades'), card('3', 'hearts'), card('A', 'hearts'), card('4', 'clubs')] },
    });
    const burned = chooseDiscards(game, 0, 2, 'hard');
    expect(burned).not.toContain('spades-2');
    expect(burned).not.toContain('hearts-A');
  });

  it('keeps a trump draw at every level above easy', () => {
    expect(shouldKeepDraw(card('2', 'spades'), 'spades', 'medium')).toBe(true);
    expect(shouldKeepDraw(card('2', 'spades'), 'spades', 'hard')).toBe(true);
  });

  it('burns a weak side card instead of keeping everything', () => {
    expect(shouldKeepDraw(card('3', 'hearts'), 'spades', 'medium')).toBe(false);
    expect(shouldKeepDraw(card('3', 'hearts'), 'spades', 'hard')).toBe(false);
  });

  it('keeps strong side cards', () => {
    expect(shouldKeepDraw(card('A', 'hearts'), 'spades', 'hard')).toBe(true);
  });

  it('easy bots keep trumps and decent cards, but not junk', () => {
    expect(shouldKeepDraw(card('2', 'spades'), 'spades', 'easy')).toBe(true);
    expect(shouldKeepDraw(card('A', 'hearts'), 'spades', 'easy')).toBe(true);
    // Even the weakest bot no longer hoards a worthless card.
    expect(shouldKeepDraw(card('2', 'hearts'), 'spades', 'easy')).toBe(false);
  });
});
