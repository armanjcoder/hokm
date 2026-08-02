import { describe, expect, it } from 'vitest';
import { createGame, drawForHakem, finishHakemDraw } from '../src/index.js';
import type { GameMode, Seat } from '../src/types.js';

/**
 * Choosing the hakem by turning cards.
 *
 * The result decides who names trump, so it has to be produced on the server,
 * be genuinely fair, and always terminate. A draw that could loop or that
 * favoured a seat would be a real defect, not a cosmetic one.
 */

function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const players = (count: number) =>
  Array.from({ length: count }, (_, seat) => ({
    id: `p${seat}`,
    name: `P${seat}`,
    seat: seat as Seat,
  }));

describe('drawForHakem', () => {
  it.each(['classic4', 'solo3', 'duel2'] as GameMode[])('always ends with an ace in %s', (mode) => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const { cards, hakemSeat } = drawForHakem(mode, seededRng(seed * 977));
      const last = cards[cards.length - 1]!;
      expect(last.isAce).toBe(true);
      expect(last.card.rank).toBe('A');
      expect(last.seat).toBe(hakemSeat);
    }
  });

  it('marks only the final card as the winning ace', () => {
    const { cards } = drawForHakem('classic4', seededRng(7));
    expect(cards.filter((entry) => entry.isAce)).toHaveLength(1);
  });

  it('deals round the table in order', () => {
    const { cards } = drawForHakem('classic4', seededRng(11));
    cards.forEach((entry, index) => {
      expect(entry.seat).toBe(index % 4);
    });
  });

  it('never turns the same card twice', () => {
    const { cards } = drawForHakem('classic4', seededRng(23));
    const ids = cards.map((entry) => entry.card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only ever names a real seat', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const { hakemSeat } = drawForHakem('solo3', seededRng(seed * 31));
      expect(hakemSeat).toBeGreaterThanOrEqual(0);
      expect(hakemSeat).toBeLessThan(3);
    }
  });

  it('is fair: every seat wins a reasonable share over many draws', () => {
    // With four aces in a shuffled deck no seat should be systematically
    // favoured. A biased implementation shows up immediately here.
    const wins = [0, 0, 0, 0];
    const rounds = 2000;
    for (let seed = 1; seed <= rounds; seed += 1) {
      const { hakemSeat } = drawForHakem('classic4', seededRng(seed * 7919));
      wins[hakemSeat] = (wins[hakemSeat] ?? 0) + 1;
    }
    const expected = rounds / 4;
    for (const count of wins) {
      expect(count).toBeGreaterThan(expected * 0.6);
      expect(count).toBeLessThan(expected * 1.4);
    }
  });

  it('can start the rotation from any seat', () => {
    const { cards } = drawForHakem('classic4', seededRng(5), 2);
    expect(cards[0]!.seat).toBe(2);
    expect(cards[1]!.seat).toBe(3);
    expect(cards[2]!.seat).toBe(0);
  });
});

describe('createGame with a draw', () => {
  it('starts in the draw phase and carries the turned cards', () => {
    const game = createGame(players(4), { drawHakem: true, rng: seededRng(3) });
    expect(game.phase).toBe('choosing_hakem');
    expect(game.hakemDraw?.length).toBeGreaterThan(0);
  });

  it('makes the ace winner the hakem', () => {
    const game = createGame(players(4), { drawHakem: true, rng: seededRng(3) });
    const ace = game.hakemDraw!.find((entry) => entry.isAce)!;
    expect(game.hakemSeat).toBe(ace.seat);
  });

  it('still deals the opening hand from that hakem', () => {
    const game = createGame(players(4), { drawHakem: true, rng: seededRng(3) });
    expect(game.hands[game.hakemSeat]).toHaveLength(5);
  });

  it('skips the draw when a seat is pinned, so tests stay deterministic', () => {
    const game = createGame(players(4), { hakemSeat: 2, rng: seededRng(3) });
    expect(game.phase).toBe('waiting_for_trump');
    expect(game.hakemDraw).toBeUndefined();
    expect(game.hakemSeat).toBe(2);
  });

  it('does not draw unless asked', () => {
    const game = createGame(players(4), { rng: seededRng(3) });
    expect(game.phase).toBe('waiting_for_trump');
  });
});

describe('finishHakemDraw', () => {
  it('moves on to naming trump', () => {
    const game = createGame(players(4), { drawHakem: true, rng: seededRng(9) });
    const next = finishHakemDraw(game);
    expect(next.phase).toBe('waiting_for_trump');
  });

  it('keeps the hakem the draw chose', () => {
    const game = createGame(players(4), { drawHakem: true, rng: seededRng(9) });
    expect(finishHakemDraw(game).hakemSeat).toBe(game.hakemSeat);
  });

  it('drops the draw cards once they are no longer needed', () => {
    const game = createGame(players(4), { drawHakem: true, rng: seededRng(9) });
    expect(finishHakemDraw(game).hakemDraw).toBeUndefined();
  });

  it('is idempotent, because every client reports in', () => {
    const game = createGame(players(4), { drawHakem: true, rng: seededRng(9) });
    const once = finishHakemDraw(game);
    expect(finishHakemDraw(once)).toBe(once);
  });

  it('leaves the dealt hands untouched', () => {
    const game = createGame(players(4), { drawHakem: true, rng: seededRng(9) });
    const next = finishHakemDraw(game);
    expect(next.hands).toEqual(game.hands);
  });
});
