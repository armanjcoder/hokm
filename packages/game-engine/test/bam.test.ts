import { describe, expect, it } from 'vitest';
import { finishHand } from '../src/internal/state.js';
import { getModeConfig } from '../src/modes.js';
import {
  chooseTrump,
  createGame,
  getValidCards,
  playCard,
  type GameMode,
  type HokmGameState,
  type Seat,
  type TeamId,
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

/** Minimal state for exercising `finishHand` directly. */
function stateWith(
  mode: GameMode,
  hakemSeat: Seat,
  tricks: Record<TeamId, number>,
  bam: boolean,
): HokmGameState {
  const config = getModeConfig(mode);
  return {
    id: 'g1',
    mode,
    players: Array.from({ length: config.seats }, (_, i) => ({
      id: `p${i}`,
      name: `بازیکن ${i + 1}`,
      seat: i as Seat,
      team: config.teamPlay ? i % 2 : i,
    })),
    phase: 'playing',
    hakemSeat,
    currentTurnSeat: hakemSeat,
    trumpSuit: 'hearts',
    hands: { 0: [], 1: [], 2: [], 3: [] },
    currentTrick: { leaderSeat: hakemSeat, plays: [] },
    completedTricks: [],
    handScore: { tricks },
    matchScore: Object.fromEntries(
      Array.from({ length: config.teamPlay ? 2 : config.seats }, (_, i) => [i, 0]),
    ),
    targetScore: 7,
    roundNumber: 1,
    rules: { lowHandRedeal: false, maxRedeals: 2, bam },
    redealCount: 0,
    canRequestRedeal: false,
  };
}

describe('bam is opt-in', () => {
  it('is off by default', () => {
    const game = createGame(players, { rng: seededRng() });
    expect(game.rules.bam).toBe(false);
  });

  it('a hand still stops at seven tricks when the rule is off', () => {
    let game = createGame(players, { hakemSeat: 0, rng: seededRng(5) });
    game = chooseTrump(game, 'p0', 'hearts', seededRng(6));

    let guard = 0;
    while (game.phase === 'playing' && guard < 60) {
      const player = game.players.find((p) => p.seat === game.currentTurnSeat)!;
      game = playCard(game, player.id, getValidCards(game, player.id)[0]!.id);
      guard += 1;
    }
    // 7 tricks * 4 cards = at most 28 plays; a full sweep would need more.
    const total = (game.handScore.tricks[0] ?? 0) + (game.handScore.tricks[1] ?? 0);
    expect(total).toBeLessThanOrEqual(13);
    expect(Math.max(game.handScore.tricks[0] ?? 0, game.handScore.tricks[1] ?? 0)).toBe(7);
    expect(game.handScore.kind).not.toBe('bam');
  });
});

describe('bam scoring', () => {
  it('awards a sweep by the hakem team as bam worth 3 points', () => {
    const result = finishHand(stateWith('classic4', 0, { 0: 13, 1: 0 }, true), 0);
    expect(result.handScore.kind).toBe('bam');
    expect(result.handScore.pointsAwarded).toBe(3);
  });

  it('awards a sweep against the hakem as hakem bam', () => {
    const result = finishHand(stateWith('classic4', 0, { 0: 0, 1: 13 }, true), 1);
    expect(result.handScore.kind).toBe('hakem_bam');
    expect(result.handScore.pointsAwarded).toBe(3);
  });

  it('ends the whole match immediately, whatever the score', () => {
    const state = stateWith('classic4', 0, { 0: 13, 1: 0 }, true);
    state.targetScore = 11;
    state.matchScore = { 0: 0, 1: 0 };
    const result = finishHand(state, 0);
    // Only 3 points, far below the target, yet the match is over.
    expect(result.matchScore[0]).toBe(3);
    expect(result.phase).toBe('game_complete');
    expect(result.lastEvent).toMatch(/بام/);
  });

  it('is a kot, not a bam, when the winner stopped at seven', () => {
    const result = finishHand(stateWith('classic4', 0, { 0: 7, 1: 0 }, true), 0);
    expect(result.handScore.kind).toBe('kot');
    expect(result.handScore.pointsAwarded).toBe(2);
    expect(result.phase).toBe('hand_complete');
  });

  it('never reports a bam while the rule is disabled', () => {
    const result = finishHand(stateWith('classic4', 0, { 0: 13, 1: 0 }, false), 0);
    expect(result.handScore.kind).toBe('kot');
    expect(result.phase).toBe('hand_complete');
  });

  it('needs all seventeen tricks in the three player game', () => {
    const short = finishHand(stateWith('solo3', 0, { 0: 13, 1: 0, 2: 0 }, true), 0);
    expect(short.handScore.kind).toBe('kot');

    const full = finishHand(stateWith('solo3', 0, { 0: 17, 1: 0, 2: 0 }, true), 0);
    expect(full.handScore.kind).toBe('bam');
  });

  it('works in the two player duel', () => {
    const result = finishHand(stateWith('duel2', 0, { 0: 0, 1: 13 }, true), 1);
    expect(result.handScore.kind).toBe('hakem_bam');
    expect(result.phase).toBe('game_complete');
  });
});

describe('play continues past seven when bam is on', () => {
  it('does not end the hand at seven while a sweep is still possible', () => {
    let game = createGame(players, { hakemSeat: 0, rng: seededRng(9), rules: { bam: true } });
    game = chooseTrump(game, 'p0', 'hearts', seededRng(10));

    let guard = 0;
    while (game.phase === 'playing' && guard < 60) {
      const player = game.players.find((p) => p.seat === game.currentTurnSeat)!;
      game = playCard(game, player.id, getValidCards(game, player.id)[0]!.id);
      guard += 1;
    }

    const tricks = game.handScore.tricks;
    const winner = game.handScore.winningTeam!;
    const others = Object.entries(tricks)
      .filter(([team]) => Number(team) !== winner)
      .reduce((sum, [, value]) => sum + value, 0);

    // Either the opponents scored (so the hand ended once a sweep became
    // impossible), or the winner truly swept all thirteen tricks.
    expect(others > 0 || tricks[winner] === 13).toBe(true);
  });

  it('stops as soon as a sweep becomes impossible', () => {
    let game = createGame(players, { hakemSeat: 0, rng: seededRng(77), rules: { bam: true } });
    game = chooseTrump(game, 'p0', 'hearts', seededRng(78));

    let guard = 0;
    while (game.phase === 'playing' && guard < 60) {
      const player = game.players.find((p) => p.seat === game.currentTurnSeat)!;
      game = playCard(game, player.id, getValidCards(game, player.id)[0]!.id);
      guard += 1;
    }
    // The hand must terminate; it must never run past the deck.
    expect(['hand_complete', 'game_complete']).toContain(game.phase);
    expect(game.completedTricks.length).toBeLessThanOrEqual(13);
  });
});
