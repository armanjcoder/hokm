import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicGameView } from '@hokm/game-engine';
import { TRICK_HOLD_MS, useTrickHold } from '../src/useTrickHold.js';

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
    expect(result.current.currentTrick.plays).toHaveLength(4);
  });

  it('carries the winner through so the seat can be highlighted', () => {
    const trick = finishedTrick(['a', 'b', 'c', 'd'], 3);
    const { result } = renderHook(() =>
      useTrickHold(view({ completedTricks: [trick] } as unknown as Partial<PublicGameView>)),
    );
    expect(result.current.currentTrick.winnerSeat).toBe(3);
  });

  it('clears the trick once the hold elapses', () => {
    const trick = finishedTrick(['a', 'b', 'c', 'd']);
    const { result } = renderHook(() =>
      useTrickHold(view({ completedTricks: [trick] } as unknown as Partial<PublicGameView>)),
    );
    expect(result.current.currentTrick.plays).toHaveLength(4);
    act(() => {
      vi.advanceTimersByTime(TRICK_HOLD_MS + 10);
    });
    expect(result.current.currentTrick.plays).toHaveLength(0);
  });

  it('holds for about three seconds, long enough to read four cards', () => {
    expect(TRICK_HOLD_MS).toBeGreaterThanOrEqual(2500);
    expect(TRICK_HOLD_MS).toBeLessThanOrEqual(4000);
  });

  it('does not clear early', () => {
    const trick = finishedTrick(['a', 'b', 'c', 'd']);
    const { result } = renderHook(() =>
      useTrickHold(view({ completedTricks: [trick] } as unknown as Partial<PublicGameView>)),
    );
    act(() => {
      vi.advanceTimersByTime(TRICK_HOLD_MS - 200);
    });
    expect(result.current.currentTrick.plays).toHaveLength(4);
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
    expect(result.current.currentTrick.plays).toHaveLength(4);

    rerender({
      game: view({
        completedTricks: [trick],
        currentTrick: { leaderSeat: 2, plays: [{ seat: 2, card: card('next') }] },
      } as unknown as Partial<PublicGameView>),
    });
    expect(result.current.currentTrick.plays).toHaveLength(1);
    expect(result.current.currentTrick.plays[0]!.card.id).toBe('next');
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
      vi.advanceTimersByTime(TRICK_HOLD_MS + 10);
    });
    expect(result.current.currentTrick.plays).toHaveLength(0);

    rerender({
      game: view({ completedTricks: [first, second] } as unknown as Partial<PublicGameView>),
    });
    expect(result.current.currentTrick.plays.map((p: any) => p.card.id)).toEqual([
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
      vi.advanceTimersByTime(TRICK_HOLD_MS + 10);
    });
    rerender({ g: { ...game } as PublicGameView });
    expect(result.current.currentTrick.plays).toHaveLength(0);
  });

  it('passes a live trick straight through untouched', () => {
    const game = view({
      currentTrick: { leaderSeat: 0, plays: [{ seat: 0, card: card('live') }] },
    } as unknown as Partial<PublicGameView>);
    const { result } = renderHook(() => useTrickHold(game));
    expect(result.current).toBe(game);
  });

  it('ignores a trick with no recorded winner', () => {
    const game = view({
      completedTricks: [{ leaderSeat: 0, plays: [{ seat: 0, card: card('x') }] }],
    } as unknown as Partial<PublicGameView>);
    const { result } = renderHook(() => useTrickHold(game));
    expect(result.current.currentTrick.plays).toHaveLength(0);
  });
});
