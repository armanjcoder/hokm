import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PublicGameView } from '@hokm/game-engine';
import { useTrickWonHaptic } from '../src/useTrickWonHaptic.js';

let calls: string[] = [];

beforeEach(() => {
  calls = [];
  (window as unknown as { Telegram: unknown }).Telegram = {
    WebApp: {
      ready() {},
      expand() {},
      HapticFeedback: { notificationOccurred: (t: string) => calls.push(t) },
    },
  };
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { Telegram?: unknown }).Telegram;
});

const card = (id: string) => ({ id, suit: 'spades', rank: 'A' }) as never;

function trickView(winnerSeat: number | undefined, ids = ['a', 'b', 'c', 'd']): PublicGameView {
  return {
    currentTrick: {
      leaderSeat: 0,
      ...(winnerSeat === undefined ? {} : { winnerSeat }),
      plays: ids.map((id, seat) => ({ seat, card: card(id) })),
    },
    completedTricks: [],
  } as unknown as PublicGameView;
}

describe('winning a trick is felt, not just seen', () => {
  it('buzzes when you take the trick', () => {
    renderHook(() => useTrickWonHaptic(trickView(0), 0, true));
    expect(calls).toEqual(['success']);
  });

  it('buzzes when your partner takes it', () => {
    // In team play the partner sits opposite; the point is your side won.
    renderHook(() => useTrickWonHaptic(trickView(2), 0, true));
    expect(calls).toEqual(['success']);
  });

  it('stays quiet when an opponent takes it', () => {
    renderHook(() => useTrickWonHaptic(trickView(1), 0, true));
    expect(calls).toEqual([]);
  });

  it('counts only your own seat in solo modes', () => {
    renderHook(() => useTrickWonHaptic(trickView(2), 0, false));
    expect(calls).toEqual([]);
    renderHook(() => useTrickWonHaptic(trickView(0), 0, false));
    expect(calls).toEqual(['success']);
  });

  it('fires once per trick, however often it re-renders', () => {
    const { rerender } = renderHook(
      ({ g }: { g: PublicGameView }) => useTrickWonHaptic(g, 0, true),
      { initialProps: { g: trickView(0) } },
    );
    rerender({ g: trickView(0) });
    rerender({ g: trickView(0) });
    expect(calls).toEqual(['success']);
  });

  it('fires again for the next trick you win', () => {
    const { rerender } = renderHook(
      ({ g }: { g: PublicGameView }) => useTrickWonHaptic(g, 0, true),
      { initialProps: { g: trickView(0) } },
    );
    rerender({ g: trickView(0, ['e', 'f', 'g', 'h']) });
    expect(calls).toEqual(['success', 'success']);
  });

  it('stays quiet while the trick is still being played', () => {
    renderHook(() => useTrickWonHaptic(trickView(undefined), 0, true));
    expect(calls).toEqual([]);
  });

  it('does nothing for a spectator with no seat', () => {
    renderHook(() => useTrickWonHaptic(trickView(0), undefined, true));
    expect(calls).toEqual([]);
  });
});
