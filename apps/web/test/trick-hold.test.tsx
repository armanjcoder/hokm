import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicGameView } from '@hokm/game-engine';
import { TRICK_HOLD_MS, TRICK_SWEEP_MS, useTrickHold } from '../src/useTrickHold.js';

/** The hold clock starts only after the last card has landed. */
const LANDING_MS = 900;

afterEach(cleanup);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * Holding a finished trick on screen.
 *
 * The engine clears the trick the instant the last card lands. Reading which
 * cards were played is the core skill in Hokm, so the table has to keep them
 * visible for a moment rather than blanking mid-glance.
 */

const card = (id: string) => ({ id, suit: 'spades', rank: 'A' }) as never;

function view(overrides: Partial<PublicGameView> = {}): PublicGameView {
  return {
    currentTrick: { leaderSeat: 0, plays: [] },
    completedTricks: [],
    ...overrides,
  } as unknown as PublicGameView;
}

function finishedTrick(ids: string[], winnerSeat = 2) {
  return {
    leaderSeat: 0,
    winnerSeat,
    plays: ids.map((id, seat) => ({ seat, card: card(id) })),
  };
}

describe('useTrickHold', () => {
  it('keeps the finished trick visible instead of blanking the table', () => {
    const trick = finishedTrick(['a', 'b', 'c', 'd']);
    const { result } = renderHook(() =>
      useTrickHold(view({ completedTricks: [trick] } as unknown as Partial<PublicGameView>)),
    );
    expect(result.current.game.currentTrick.plays).toHaveLength(4);
  });

  it('carries the winner through so the seat can be highlighted', () => {
    const trick = finishedTrick(['a', 'b', 'c', 'd'], 3);
    const { result } = renderHook(() =>
      useTrickHold(view({ completedTricks: [trick] } as unknown as Partial<PublicGameView>)),
    );
    expect(result.current.game.currentTrick.winnerSeat).toBe(3);
  });

  it('clears the trick once the hold elapses', () => {
    const trick = finishedTrick(['a', 'b', 'c', 'd']);
    const { result } = renderHook(() =>
      useTrickHold(view({ completedTricks: [trick] } as unknown as Partial<PublicGameView>)),
    );
    expect(result.current.game.currentTrick.plays).toHaveLength(4);
    act(() => {
      vi.advanceTimersByTime(LANDING_MS + TRICK_HOLD_MS + TRICK_SWEEP_MS + 20);
    });
    expect(result.current.game.currentTrick.plays).toHaveLength(0);
  });

  it('gives players a real pause to read four cards', () => {
    // Long enough to take in four cards, short enough that the table does not
    // feel frozen between tricks.
    expect(TRICK_HOLD_MS).toBeGreaterThanOrEqual(2500);
    expect(TRICK_HOLD_MS).toBeLessThanOrEqual(4000);
  });

  it('does not clear early', () => {
    const trick = finishedTrick(['a', 'b', 'c', 'd']);
    const { result } = renderHook(() =>
      useTrickHold(view({ completedTricks: [trick] } as unknown as Partial<PublicGameView>)),
    );
    act(() => {
      vi.advanceTimersByTime(LANDING_MS + TRICK_HOLD_MS - 200);
    });
    expect(result.current.game.currentTrick.plays).toHaveLength(4);
  });

  it('drops the hold as soon as the next trick starts', () => {
    // A fast table must never be blocked waiting on the hold to expire.
    const trick = finishedTrick(['a', 'b', 'c', 'd']);
    const { result, rerender } = renderHook(
      ({ game }: { game: PublicGameView }) => useTrickHold(game),
      {
        initialProps: {
          game: view({ completedTricks: [trick] } as unknown as Partial<PublicGameView>),
        },
      },
    );
    expect(result.current.game.currentTrick.plays).toHaveLength(4);

    rerender({
      game: view({
        completedTricks: [trick],
        currentTrick: { leaderSeat: 2, plays: [{ seat: 2, card: card('next') }] },
      } as unknown as Partial<PublicGameView>),
    });
    expect(result.current.game.currentTrick.plays).toHaveLength(1);
    expect(result.current.game.currentTrick.plays[0]!.card.id).toBe('next');
  });

  it('holds each new trick in turn', () => {
    const first = finishedTrick(['a', 'b', 'c', 'd']);
    const second = finishedTrick(['e', 'f', 'g', 'h'], 1);
    const { result, rerender } = renderHook(
      ({ game }: { game: PublicGameView }) => useTrickHold(game),
      {
        initialProps: {
          game: view({ completedTricks: [first] } as unknown as Partial<PublicGameView>),
        },
      },
    );
    act(() => {
      vi.advanceTimersByTime(LANDING_MS + TRICK_HOLD_MS + TRICK_SWEEP_MS + 20);
    });
    expect(result.current.game.currentTrick.plays).toHaveLength(0);

    rerender({
      game: view({ completedTricks: [first, second] } as unknown as Partial<PublicGameView>),
    });
    expect(result.current.game.currentTrick.plays.map((p: any) => p.card.id)).toEqual([
      'e',
      'f',
      'g',
      'h',
    ]);
  });

  it('does not re-hold a trick that already expired', () => {
    const trick = finishedTrick(['a', 'b', 'c', 'd']);
    const game = view({ completedTricks: [trick] } as unknown as Partial<PublicGameView>);
    const { result, rerender } = renderHook(
      ({ g }: { g: PublicGameView }) => useTrickHold(g),
      { initialProps: { g: game } },
    );
    act(() => {
      vi.advanceTimersByTime(LANDING_MS + TRICK_HOLD_MS + TRICK_SWEEP_MS + 20);
    });
    rerender({ g: { ...game } as PublicGameView });
    expect(result.current.game.currentTrick.plays).toHaveLength(0);
  });

  it('passes a live trick straight through untouched', () => {
    const game = view({
      currentTrick: { leaderSeat: 0, plays: [{ seat: 0, card: card('live') }] },
    } as unknown as Partial<PublicGameView>);
    const { result } = renderHook(() => useTrickHold(game));
    expect(result.current.game).toBe(game);
  });

  it('ignores a trick with no recorded winner', () => {
    const game = view({
      completedTricks: [{ leaderSeat: 0, plays: [{ seat: 0, card: card('x') }] }],
    } as unknown as Partial<PublicGameView>);
    const { result } = renderHook(() => useTrickHold(game));
    expect(result.current.game.currentTrick.plays).toHaveLength(0);
  });
});

describe('the finished trick is collected by its winner', () => {
  const trick = finishedTrick(['a', 'b', 'c', 'd'], 3);
  const held = () => view({ completedTricks: [trick] } as unknown as Partial<PublicGameView>);

  it('does not sweep while players are still reading the cards', () => {
    const { result } = renderHook(() => useTrickHold(held()));
    act(() => {
      vi.advanceTimersByTime(LANDING_MS + TRICK_HOLD_MS - 200);
    });
    expect(result.current.sweepingTo).toBeUndefined();
    expect(result.current.game.currentTrick.plays).toHaveLength(4);
  });

  it('sweeps towards the winning seat once the hold is over', () => {
    const { result } = renderHook(() => useTrickHold(held()));
    act(() => {
      vi.advanceTimersByTime(LANDING_MS + TRICK_HOLD_MS + 20);
    });
    expect(result.current.sweepingTo).toBe(3);
    // The cards are still on screen while they travel.
    expect(result.current.game.currentTrick.plays).toHaveLength(4);
  });

  it('clears the cards only after they have finished travelling', () => {
    const { result } = renderHook(() => useTrickHold(held()));
    act(() => {
      vi.advanceTimersByTime(LANDING_MS + TRICK_HOLD_MS + 20);
    });
    expect(result.current.game.currentTrick.plays).toHaveLength(4);
    act(() => {
      vi.advanceTimersByTime(TRICK_SWEEP_MS + 20);
    });
    expect(result.current.game.currentTrick.plays).toHaveLength(0);
    expect(result.current.sweepingTo).toBeUndefined();
  });

  it('gives players at least two and a half seconds to read the cards', () => {
    expect(TRICK_HOLD_MS).toBeGreaterThanOrEqual(2500);
  });

  it('measures the reading time from after the last card lands', () => {
    // Otherwise most of the hold is spent watching the fourth card fly in.
    const { result } = renderHook(() => useTrickHold(held()));
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(result.current.sweepingTo).toBeUndefined();
  });

  it('abandons the sweep if the next trick starts first', () => {
    const { result, rerender } = renderHook(
      ({ g }: { g: PublicGameView }) => useTrickHold(g),
      { initialProps: { g: held() } },
    );
    act(() => {
      vi.advanceTimersByTime(LANDING_MS + TRICK_HOLD_MS + 20);
    });
    expect(result.current.sweepingTo).toBe(3);
    rerender({
      g: view({
        completedTricks: [trick],
        currentTrick: { leaderSeat: 3, plays: [{ seat: 3, card: card('next') }] },
      } as unknown as Partial<PublicGameView>),
    });
    expect(result.current.sweepingTo).toBeUndefined();
  });
});

describe('a completing trick never blinks out', () => {
  const trick = finishedTrick(['a', 'b', 'c', 'd'], 2);

  it('holds the cards in the very same render the server clears them', () => {
    // Deciding this in an effect left one painted frame with no cards at all,
    // so the whole trick vanished and then re-entered together.
    const live = view({
      currentTrick: {
        leaderSeat: 0,
        plays: trick.plays.slice(0, 3),
      },
    } as unknown as Partial<PublicGameView>);

    const { result, rerender } = renderHook(
      ({ g }: { g: PublicGameView }) => useTrickHold(g),
      { initialProps: { g: live } },
    );
    expect(result.current.game.currentTrick.plays).toHaveLength(3);

    // The fourth card lands: the engine moves the trick to completedTricks and
    // empties currentTrick in the same update.
    rerender({
      g: view({ completedTricks: [trick] } as unknown as Partial<PublicGameView>),
    });

    // No intermediate empty state: the cards are already held.
    expect(result.current.game.currentTrick.plays).toHaveLength(4);
  });

  it('keeps the identical card objects, so nothing remounts', () => {
    const held = view({ completedTricks: [trick] } as unknown as Partial<PublicGameView>);
    const { result, rerender } = renderHook(
      ({ g }: { g: PublicGameView }) => useTrickHold(g),
      { initialProps: { g: held } },
    );
    const before = result.current.game.currentTrick.plays.map((p: any) => p.card);
    rerender({ g: { ...held } as PublicGameView });
    const after = result.current.game.currentTrick.plays.map((p: any) => p.card);
    // Same object identities means React reuses the nodes and no entrance
    // animation is replayed.
    before.forEach((card: unknown, i: number) => expect(after[i]).toBe(card));
  });

  it('does not re-hold a trick once it has been released', () => {
    const held = view({ completedTricks: [trick] } as unknown as Partial<PublicGameView>);
    const { result, rerender } = renderHook(
      ({ g }: { g: PublicGameView }) => useTrickHold(g),
      { initialProps: { g: held } },
    );
    act(() => {
      vi.advanceTimersByTime(LANDING_MS + TRICK_HOLD_MS + TRICK_SWEEP_MS + 50);
    });
    expect(result.current.game.currentTrick.plays).toHaveLength(0);
    rerender({ g: { ...held } as PublicGameView });
    expect(result.current.game.currentTrick.plays).toHaveLength(0);
  });
});
