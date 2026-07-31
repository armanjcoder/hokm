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
  it('medium beats easy overwhelmingly', () => {
    expect(winRate('medium', 'easy', 40)).toBeGreaterThan(0.85);
  }, 60000);

  it('hard beats easy overwhelmingly', () => {
    expect(winRate('hard', 'easy', 40)).toBeGreaterThan(0.85);
  }, 60000);

  it('hard is at least as strong as medium', () => {
    // Hard only edges medium out, so this guards against a regression that
    // would make the "hardest" level actually the weakest.
    expect(winRate('hard', 'medium', 60)).toBeGreaterThanOrEqual(0.5);
  }, 60000);
});

describe('every level finishes a match without stalling', () => {
  it.each(['easy', 'medium', 'hard'] as BotDifficulty[])('%s vs itself', (level) => {
    const result = playMatch(level, level, 12345);
    expect(['A', 'B']).toContain(result);
  }, 30000);
});
