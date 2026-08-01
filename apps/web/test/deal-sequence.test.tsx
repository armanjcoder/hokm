import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicGameView } from '@hokm/game-engine';
import { DEAL_CARD_MS, seatDealDelay, useDealSequence } from '../src/useDealSequence.js';
import { DRAW_SETTLE_MS, DRAW_STEP_MS, useHakemDraw } from '../src/useHakemDraw.js';

afterEach(cleanup);
beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => vi.useRealTimers());

const card = (id: string) => ({ id, suit: 'spades', rank: 'A' }) as never;

function view(overrides: Partial<PublicGameView> = {}): PublicGameView {
  return {
    mode: 'classic4',
    phase: 'waiting_for_trump',
    hakemSeat: 0,
    myHand: [],
    currentTrick: { leaderSeat: 0, plays: [] },
    completedTricks: [],
    ...overrides,
  } as unknown as PublicGameView;
}

describe('seatDealDelay', () => {
  it('starts the hakem immediately', () => {
    expect(seatDealDelay(2, 2, 4, 5)).toBe(0);
  });

  it('makes each later seat wait a full batch longer', () => {
    const first = seatDealDelay(1, 0, 4, 5);
    const second = seatDealDelay(2, 0, 4, 5);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(first * 2);
  });

  it('wraps around the table', () => {
    // Seat 0 sits one place after seat 3 when seat 3 deals.
    expect(seatDealDelay(0, 3, 4, 5)).toBe(seatDealDelay(1, 0, 4, 5));
  });
});

describe('useDealSequence', () => {
  it('releases the opening hand one card at a time', () => {
    const { result, rerender } = renderHook(
      ({ game }: { game: PublicGameView }) => useDealSequence(game, 0),
      { initialProps: { game: view() } },
    );
    rerender({ game: view({ myHand: ['a', 'b', 'c', 'd', 'e'].map(card) } as Partial<PublicGameView>) });
    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(DEAL_CARD_MS + 5);
    });
    expect(result.current).toBe(1);

    act(() => {
      vi.advanceTimersByTime(DEAL_CARD_MS * 4);
    });
    expect(result.current).toBe(5);
  });

  it('makes a later seat wait its turn before any card appears', () => {
    const { result, rerender } = renderHook(
      ({ game }: { game: PublicGameView }) => useDealSequence(game, 2),
      { initialProps: { game: view() } },
    );
    rerender({ game: view({ myHand: ['a', 'b', 'c', 'd', 'e'].map(card) } as Partial<PublicGameView>) });
    act(() => {
      vi.advanceTimersByTime(DEAL_CARD_MS * 2);
    });
    // Two seats deal before this one, so nothing has arrived yet.
    expect(result.current).toBe(0);
  });

  it('animates the second deal too, without replaying the first five', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map(card);
    const { result, rerender } = renderHook(
      ({ game }: { game: PublicGameView }) => useDealSequence(game, 0),
      { initialProps: { game: view({ myHand: five } as Partial<PublicGameView>) } },
    );
    act(() => {
      vi.advanceTimersByTime(DEAL_CARD_MS * 6);
    });
    expect(result.current).toBe(5);

    rerender({
      game: view({ myHand: [...five, ...['f', 'g', 'h', 'i'].map(card)] } as Partial<PublicGameView>),
    });
    // The five already in hand stay put while the new four arrive.
    expect(result.current).toBe(5);
    act(() => {
      vi.advanceTimersByTime(DEAL_CARD_MS * 5);
    });
    expect(result.current).toBe(9);
  });

  it('never hides a card that was played rather than dealt', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map(card);
    const { result, rerender } = renderHook(
      ({ game }: { game: PublicGameView }) => useDealSequence(game, 0),
      { initialProps: { game: view({ myHand: five } as Partial<PublicGameView>) } },
    );
    act(() => {
      vi.advanceTimersByTime(DEAL_CARD_MS * 6);
    });
    rerender({ game: view({ myHand: five.slice(1) } as Partial<PublicGameView>) });
    expect(result.current).toBe(4);
  });

  it('shows everything at once when motion is reduced', () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    const { result, rerender } = renderHook(
      ({ game }: { game: PublicGameView }) => useDealSequence(game, 0),
      { initialProps: { game: view() } },
    );
    rerender({ game: view({ myHand: ['a', 'b', 'c'].map(card) } as Partial<PublicGameView>) });
    expect(result.current).toBe(3);
  });
});

describe('useHakemDraw', () => {
  const drawCards = [
    { seat: 0, card: card('c0'), isAce: false },
    { seat: 1, card: card('c1'), isAce: false },
    { seat: 2, card: card('c2'), isAce: true },
  ];

  const drawing = () =>
    view({ phase: 'choosing_hakem', hakemDraw: drawCards } as unknown as Partial<PublicGameView>);

  it('reveals the turned cards one at a time', () => {
    const { result } = renderHook(() => useHakemDraw(drawing()));
    expect(result.current.revealed).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(DRAW_STEP_MS + 5);
    });
    expect(result.current.revealed).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(DRAW_STEP_MS * 2);
    });
    expect(result.current.revealed).toHaveLength(3);
  });

  it('names the hakem only once the ace has been turned', () => {
    const { result } = renderHook(() => useHakemDraw(drawing()));
    act(() => {
      vi.advanceTimersByTime(DRAW_STEP_MS * 2 + 5);
    });
    expect(result.current.hakemSeat).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(DRAW_STEP_MS);
    });
    expect(result.current.hakemSeat).toBe(2);
  });

  it('reports back only after the winner has been shown for a moment', () => {
    const onFinished = vi.fn();
    renderHook(() => useHakemDraw(drawing(), { onFinished }));
    act(() => {
      vi.advanceTimersByTime(DRAW_STEP_MS * 3 + 10);
    });
    expect(onFinished).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(DRAW_SETTLE_MS);
    });
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it('is idle outside the draw phase', () => {
    const { result } = renderHook(() => useHakemDraw(view()));
    expect(result.current.running).toBe(false);
    expect(result.current.revealed).toHaveLength(0);
  });

  it('paces the reveal slowly enough to follow', () => {
    expect(DRAW_STEP_MS).toBeGreaterThanOrEqual(400);
  });

  it('shows the whole draw at once when motion is reduced', () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useHakemDraw(drawing()));
    expect(result.current.revealed).toHaveLength(3);
    expect(result.current.hakemSeat).toBe(2);
  });

  it('still reports back when motion is reduced', () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    const onFinished = vi.fn();
    renderHook(() => useHakemDraw(drawing(), { onFinished }));
    act(() => {
      vi.advanceTimersByTime(DRAW_SETTLE_MS + 10);
    });
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it('reports back exactly once, however often it re-renders', () => {
    const onFinished = vi.fn();
    const { rerender } = renderHook(
      ({ g }: { g: PublicGameView }) => useHakemDraw(g, { onFinished }),
      { initialProps: { g: drawing() } },
    );
    act(() => {
      vi.advanceTimersByTime(DRAW_STEP_MS * 3 + DRAW_SETTLE_MS + 50);
    });
    rerender({ g: drawing() });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onFinished).toHaveBeenCalledOnce();
  });
});
