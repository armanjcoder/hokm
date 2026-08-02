import { describe, expect, it } from 'vitest';
import {
  chooseTrump,
  continueToNextHand,
  createGame,
  discardCards,
  drawCard,
  getValidCards,
  playCard,
  resolveDraw,
  toPublicView,
  type GameMode,
  type HokmGameState,
} from '../src/index.js';
import { getModeConfig } from '../src/modes.js';
import type { Seat } from '../src/types.js';

/**
 * Randomised invariant sweep across every mode.
 *
 * Instead of asserting one scripted scenario, this plays thousands of full
 * matches with seeded randomness and checks after *every* move that the rules
 * of the game still hold. Anything that can only be reached through an unusual
 * sequence of moves shows up here rather than in production.
 */

/** Deterministic PRNG so a failure can be replayed from its seed. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function playersFor(mode: GameMode) {
  const { seats } = getModeConfig(mode);
  return Array.from({ length: seats }, (_, seat) => ({
    id: `p${seat}`,
    name: `Player ${seat}`,
    seat: seat as Seat,
  }));
}

interface Invariant {
  name: string;
  check: (state: HokmGameState) => boolean;
}

function invariantsFor(mode: GameMode): Invariant[] {
  const config = getModeConfig(mode);
  return [
    {
      name: 'no duplicate card anywhere in play',
      check: (s) => {
        const ids = [
          ...Object.values(s.hands).flat().map((c) => c.id),
          ...(s.stock ?? []).map((c) => c.id),
          ...s.currentTrick.plays.map((p) => p.card.id),
        ];
        return new Set(ids).size === ids.length;
      },
    },
    {
      name: 'turn seat is always a real seat',
      check: (s) => s.currentTurnSeat >= 0 && s.currentTurnSeat < config.seats,
    },
    {
      name: 'hakem seat is always a real seat',
      check: (s) => s.hakemSeat >= 0 && s.hakemSeat < config.seats,
    },
    {
      name: 'a trick never holds more plays than there are seats',
      check: (s) => s.currentTrick.plays.length <= config.seats,
    },
    {
      name: 'no seat plays twice in the same trick',
      check: (s) => {
        const seats = s.currentTrick.plays.map((p) => p.seat);
        return new Set(seats).size === seats.length;
      },
    },
    {
      name: 'trick counts never exceed the tricks available',
      check: (s) => {
        const total = Object.values(s.handScore.tricks ?? {}).reduce<number>((a, b) => a + Number(b), 0);
        return total <= config.handSize;
      },
    },
    {
      name: 'match score never goes negative',
      check: (s) => Object.values(s.matchScore ?? {}).every((v) => Number(v) >= 0),
    },
    {
      name: 'trump is only set after the trump phase',
      check: (s) => (s.phase === 'waiting_for_trump' ? s.trumpSuit === undefined : true),
    },
    {
      name: 'during play every hand holds a sane number of cards',
      check: (s) =>
        s.phase === 'playing'
          ? Object.values(s.hands).every((h) => h.length <= config.handSize)
          : true,
    },
  ];
}

/** Plays one full match, asserting invariants after every single mutation. */
function playMatch(mode: GameMode, seed: number): { finished: boolean; moves: number } {
  const rng = makeRng(seed);
  const invariants = invariantsFor(mode);
  const config = getModeConfig(mode);
  let state = createGame(playersFor(mode), { mode, rng });

  const verify = (label: string) => {
    for (const inv of invariants) {
      if (!inv.check(state)) {
        throw new Error(`[${mode} seed=${seed}] invariant broken after ${label}: ${inv.name}`);
      }
    }
    // Privacy invariant: a public view must never carry another player's cards.
    const first = state.players[0];
    if (!first) throw new Error(`[${mode} seed=${seed}] game has no players`);
    const view = toPublicView(state, first.id) as unknown as Record<string, unknown>;
    if ('hands' in view || 'stock' in view) {
      throw new Error(`[${mode} seed=${seed}] public view leaked private data after ${label}`);
    }
  };

  verify('deal');

  let moves = 0;
  const MAX_MOVES = 4000;

  while (state.phase !== 'game_complete' && moves < MAX_MOVES) {
    moves += 1;

    if (state.phase === 'waiting_for_trump') {
      const hakem = state.players.find((p) => p.seat === state.hakemSeat)!;
      const hand = state.hands[state.hakemSeat] ?? [];
      const picked = hand[Math.floor(rng() * hand.length)];
      if (!picked) throw new Error(`[${mode} seed=${seed}] hakem has no card to name trump with`);
      const suit = picked.suit;
      state = chooseTrump(state, hakem.id, suit, rng);
      verify('chooseTrump');
      continue;
    }

    if (state.phase === 'discarding') {
      // Every seat that still holds more than the post-discard size must discard.
      let acted = false;
      for (const player of state.players) {
        const hand = state.hands[player.seat] ?? [];
        if (hand.length > 5 - config.discardCount!) {
          const ids = hand.slice(0, config.discardCount!).map((c) => c.id);
          state = discardCards(state, player.id, ids);
          verify('discard');
          acted = true;
          break;
        }
      }
      if (!acted) throw new Error(`[${mode} seed=${seed}] stuck in discarding phase`);
      continue;
    }

    if (state.phase === 'drawing') {
      const seat = state.pendingDraw?.seat ?? state.currentTurnSeat;
      const player = state.players.find((p) => p.seat === seat)!;
      state = state.pendingDraw
        ? resolveDraw(state, player.id, rng() < 0.5)
        : drawCard(state, player.id);
      verify('draw');
      continue;
    }

    if (state.phase === 'playing') {
      const player = state.players.find((p) => p.seat === state.currentTurnSeat)!;
      const valid = getValidCards(state, player.id);
      if (valid.length === 0) throw new Error(`[${mode} seed=${seed}] no legal move available`);
      const card = valid[Math.floor(rng() * valid.length)];
      if (!card) throw new Error(`[${mode} seed=${seed}] random pick fell outside the legal moves`);
      state = playCard(state, player.id, card.id);
      verify('playCard');
      continue;
    }

    if (state.phase === 'hand_complete') {
      state = continueToNextHand(state, rng);
      verify('nextHand');
      continue;
    }

    throw new Error(`[${mode} seed=${seed}] unexpected phase ${state.phase}`);
  }

  return { finished: state.phase === 'game_complete', moves };
}

describe('randomised invariant sweep', () => {
  for (const mode of ['classic4', 'solo3', 'duel2'] as GameMode[]) {
    it(`${mode}: 150 full matches keep every rule invariant`, () => {
      let totalMoves = 0;
      for (let seed = 1; seed <= 150; seed += 1) {
        const result = playMatch(mode, seed * 7919);
        expect(result.finished, `${mode} seed ${seed} never reached game_complete`).toBe(true);
        totalMoves += result.moves;
      }
      expect(totalMoves).toBeGreaterThan(0);
    });
  }
});
