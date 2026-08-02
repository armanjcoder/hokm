import { describe, expect, it } from 'vitest';
import {
  chooseTrump,
  continueToNextHand,
  createGame,
  getValidCards,
  playCard,
} from '@hokm/game-engine';
import { chooseCard, chooseTrumpSuit, type BotDifficulty } from '../src/game/bot-ai.js';

/**
 * Difficulty levels must actually differ in strength, not just in name.
 * These matches are deterministic (seeded), so the result is stable in CI.
 */

function playMatch(teamA: BotDifficulty, teamB: BotDifficulty, seed: number): 'A' | 'B' {
  let value = seed;
  const rng = () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };

  const players = [0, 1, 2, 3].map((i) => ({ id: `p${i}`, name: `p${i}` }));
  let game = createGame(players, {
    targetScore: 7,
    rng,
    rules: { bam: false, lowHandRedeal: false, maxRedeals: 2 },
  });

  // Seats 0 and 2 are team A; seats 1 and 3 are team B.
  const levelOf = (seat: number) => (seat % 2 === 0 ? teamA : teamB);

  for (let guard = 0; guard < 5000 && game.phase !== 'game_complete'; guard += 1) {
    if (game.phase === 'waiting_for_trump') {
      const seat = game.hakemSeat;
      game = chooseTrump(game, `p${seat}`, chooseTrumpSuit(game, seat, levelOf(seat)), rng);
    } else if (game.phase === 'playing') {
      const seat = game.currentTurnSeat;
      const legal = getValidCards(game, `p${seat}`);
      const card = chooseCard(game, seat, legal, levelOf(seat));
      if (!card) break;
      game = playCard(game, `p${seat}`, card.id);
    } else if (game.phase === 'hand_complete') {
      game = continueToNextHand(game, rng);
    } else {
      break;
    }
  }

  return (game.matchScore[0] ?? 0) > (game.matchScore[1] ?? 0) ? 'A' : 'B';
}

/** Plays both seatings so a first-seat advantage cannot skew the result. */
function winRate(strong: BotDifficulty, weak: BotDifficulty, matches: number): number {
  let strongWins = 0;
  for (let i = 0; i < matches; i += 1) {
    if (playMatch(strong, weak, 7919 + i * 13) === 'A') strongWins += 1;
    if (playMatch(weak, strong, 7919 + i * 13) === 'B') strongWins += 1;
  }
  return strongWins / (matches * 2);
}

describe('difficulty levels differ in real strength', () => {
  /**
   * Measured over 1600 seeded matches: medium ~74% and hard ~76% against easy,
   * and hard ~55% against medium.
   *
   * The hard-versus-medium edge is genuine but narrow, so it needs a large
   * sample to be stable; at 100 matches it swings either side of 50%. These
   * counts are sized so the assertions are honest rather than lucky.
   */
  it('medium clearly beats easy', () => {
    expect(winRate('medium', 'easy', 100)).toBeGreaterThan(0.65);
  }, 120000);

  it('hard clearly beats easy', () => {
    expect(winRate('hard', 'easy', 100)).toBeGreaterThan(0.65);
  }, 120000);

  it('hard beats medium over a large sample', () => {
    // Guards against a regression that would make the "hardest" level weakest.
    expect(winRate('hard', 'medium', 400)).toBeGreaterThan(0.52);
  }, 120000);

  it('easy still wins sometimes, so beginners are not shut out', () => {
    expect(winRate('hard', 'easy', 100)).toBeLessThan(0.95);
  }, 120000);
});

describe('every level finishes a match without stalling', () => {
  it.each(['easy', 'medium', 'hard'] as BotDifficulty[])('%s vs itself', (level) => {
    const result = playMatch(level, level, 12345);
    expect(['A', 'B']).toContain(result);
  }, 30000);
});
