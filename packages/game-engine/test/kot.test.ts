import { describe, expect, it } from 'vitest';
import { finishHand } from '../src/internal/state.js';
import { getModeConfig } from '../src/modes.js';
import type { GameMode, HokmGameState, Seat, TeamId } from '../src/types.js';

/**
 * Focused tests for the scoring rule:
 *   normal win      -> 1 point
 *   kot             -> 2 points (opponents took no trick)
 *   hakem kot       -> 3 points (the hakem's side was the one shut out)
 */

/** Builds the minimal state `finishHand` needs, with a given trick spread. */
function stateWith(mode: GameMode, hakemSeat: Seat, tricks: Record<TeamId, number>): HokmGameState {
  const config = getModeConfig(mode);
  const players = Array.from({ length: config.seats }, (_, i) => ({
    id: `p${i}`,
    name: `بازیکن ${i + 1}`,
    seat: i as Seat,
    team: config.teamPlay ? i % 2 : i,
  }));
  const matchScore = Object.fromEntries(
    Array.from({ length: config.teamPlay ? 2 : config.seats }, (_, i) => [i, 0]),
  );
  return {
    id: 'g1',
    mode,
    players,
    phase: 'playing',
    hakemSeat,
    currentTurnSeat: hakemSeat,
    trumpSuit: 'hearts',
    hands: { 0: [], 1: [], 2: [], 3: [] },
    currentTrick: { leaderSeat: hakemSeat, plays: [] },
    completedTricks: [],
    handScore: { tricks },
    matchScore,
    targetScore: 7,
    roundNumber: 1,
    rules: { lowHandRedeal: false, maxRedeals: 2 },
    redealCount: 0,
    canRequestRedeal: false,
  };
}

describe('four player kot scoring', () => {
  it('gives 1 point for a normal win', () => {
    // Hakem is seat 0 (team 0). Team 0 wins 7-6, so no kot.
    const result = finishHand(stateWith('classic4', 0, { 0: 7, 1: 6 }), 0);
    expect(result.handScore.kind).toBe('normal');
    expect(result.handScore.pointsAwarded).toBe(1);
    expect(result.matchScore[0]).toBe(1);
  });

  it('gives 2 points when the hakem team kots the opponents', () => {
    const result = finishHand(stateWith('classic4', 0, { 0: 7, 1: 0 }), 0);
    expect(result.handScore.kind).toBe('kot');
    expect(result.handScore.pointsAwarded).toBe(2);
    expect(result.matchScore[0]).toBe(2);
  });

  it('gives 3 points when the hakem team itself is kot (hakem kot)', () => {
    // Hakem is seat 0 (team 0) but team 1 shuts them out.
    const result = finishHand(stateWith('classic4', 0, { 0: 0, 1: 7 }), 1);
    expect(result.handScore.kind).toBe('hakem_kot');
    expect(result.handScore.pointsAwarded).toBe(3);
    expect(result.matchScore[1]).toBe(3);
    expect(result.matchScore[0]).toBe(0);
  });

  it('treats a kot by the hakem partner as a normal kot', () => {
    // Seat 2 is the hakem's partner, so team 0 is still the hakem team.
    const result = finishHand(stateWith('classic4', 2, { 0: 7, 1: 0 }), 0);
    expect(result.handScore.kind).toBe('kot');
    expect(result.handScore.pointsAwarded).toBe(2);
  });
});

describe('three player kot scoring', () => {
  it('needs every other player shut out to count as kot', () => {
    // One opponent took a trick, so this is only a normal win.
    const partial = finishHand(stateWith('solo3', 0, { 0: 7, 1: 1, 2: 0 }), 0);
    expect(partial.handScore.kind).toBe('normal');
    expect(partial.handScore.pointsAwarded).toBe(1);
  });

  it('gives the hakem 2 points for kotting both opponents', () => {
    const result = finishHand(stateWith('solo3', 0, { 0: 7, 1: 0, 2: 0 }), 0);
    expect(result.handScore.kind).toBe('kot');
    expect(result.handScore.pointsAwarded).toBe(2);
    expect(result.matchScore[0]).toBe(2);
  });

  it('gives a non-hakem player 3 points for kotting the hakem', () => {
    // Hakem is seat 0; seat 1 wins every trick.
    const result = finishHand(stateWith('solo3', 0, { 0: 0, 1: 7, 2: 0 }), 1);
    expect(result.handScore.kind).toBe('hakem_kot');
    expect(result.handScore.pointsAwarded).toBe(3);
    expect(result.matchScore[1]).toBe(3);
    // Scores stay individual in solo modes.
    expect(result.matchScore[0]).toBe(0);
    expect(result.matchScore[2]).toBe(0);
  });
});

describe('two player kot scoring', () => {
  it('gives the hakem 2 points for a kot', () => {
    const result = finishHand(stateWith('duel2', 0, { 0: 7, 1: 0 }), 0);
    expect(result.handScore.kind).toBe('kot');
    expect(result.handScore.pointsAwarded).toBe(2);
  });

  it('gives the opponent 3 points for kotting the hakem', () => {
    const result = finishHand(stateWith('duel2', 0, { 0: 0, 1: 7 }), 1);
    expect(result.handScore.kind).toBe('hakem_kot');
    expect(result.handScore.pointsAwarded).toBe(3);
    expect(result.matchScore[1]).toBe(3);
  });

  it('gives 1 point when both sides took tricks', () => {
    const result = finishHand(stateWith('duel2', 0, { 0: 7, 1: 5 }), 0);
    expect(result.handScore.kind).toBe('normal');
    expect(result.handScore.pointsAwarded).toBe(1);
  });
});

describe('match completion', () => {
  it('ends the match when a kot pushes a side past the target', () => {
    const state = stateWith('classic4', 0, { 0: 7, 1: 0 });
    state.matchScore = { 0: 6, 1: 0 };
    const result = finishHand(state, 0);
    expect(result.matchScore[0]).toBe(8);
    expect(result.phase).toBe('game_complete');
  });

  it('continues when the target is not reached yet', () => {
    const result = finishHand(stateWith('classic4', 0, { 0: 7, 1: 3 }), 0);
    expect(result.phase).toBe('hand_complete');
  });
});
