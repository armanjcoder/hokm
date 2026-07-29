import { describe, expect, it } from 'vitest';
import { chooseTrump, createGame, evaluateTrickWinner, HokmError, playCard, type Card, type Trick } from '../src/index.js';

const players = [
  { id: 'p0', name: 'آرمان' },
  { id: 'p1', name: 'سارا' },
  { id: 'p2', name: 'علی' },
  { id: 'p3', name: 'نیکا' },
];

function predictableRng() {
  return 0.42;
}

function c(suit: Card['suit'], rank: Card['rank']): Card {
  return { id: `${suit}-${rank}`, suit, rank };
}

describe('Hokm game engine', () => {
  it('creates a four player game and waits for hakem to select trump', () => {
    const game = createGame(players, { rng: predictableRng, hakemSeat: 0 });

    expect(game.phase).toBe('waiting_for_trump');
    expect(game.hakemSeat).toBe(0);
    expect(game.hands[0]).toHaveLength(5);
    expect(game.hands[1]).toHaveLength(5);
  });

  it('lets only hakem choose trump and completes the deal', () => {
    const game = createGame(players, { rng: predictableRng, hakemSeat: 0 });

    expect(() => chooseTrump(game, 'p1', 'spades', predictableRng)).toThrow(HokmError);

    const playing = chooseTrump(game, 'p0', 'spades', predictableRng);
    expect(playing.phase).toBe('playing');
    expect(playing.trumpSuit).toBe('spades');
    expect(playing.hands[0]).toHaveLength(13);
    expect(playing.currentTurnSeat).toBe(0);
  });

  it('evaluates trump as stronger than lead suit', () => {
    const trick: Trick = {
      leaderSeat: 0,
      plays: [
        { playerId: 'p0', seat: 0, card: c('hearts', 'A') },
        { playerId: 'p1', seat: 1, card: c('hearts', '2') },
        { playerId: 'p2', seat: 2, card: c('spades', '3') },
        { playerId: 'p3', seat: 3, card: c('hearts', 'K') },
      ],
    };

    expect(evaluateTrickWinner(trick, 'spades')).toBe(2);
  });

  it('enforces following the lead suit', () => {
    const initial = createGame(players, { rng: predictableRng, hakemSeat: 0 });
    let game = chooseTrump(initial, 'p0', 'spades', predictableRng);

    const p0Card = game.hands[0][0]!;
    game = playCard(game, 'p0', p0Card.id);

    const leadSuit = p0Card.suit;
    const p1SameSuit = game.hands[1].find((card) => card.suit === leadSuit);
    const p1OtherSuit = game.hands[1].find((card) => card.suit !== leadSuit);

    if (p1SameSuit && p1OtherSuit) {
      expect(() => playCard(game, 'p1', p1OtherSuit.id)).toThrow(HokmError);
      expect(() => playCard(game, 'p1', p1SameSuit.id)).not.toThrow();
    }
  });
});
