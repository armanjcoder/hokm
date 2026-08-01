import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayingCard } from '../src/components/PlayingCard.js';
import { TableSeat } from '../src/components/TableSeat.js';
import type { SeatView } from '../src/table-seats.js';

/**
 * Card entrance animation.
 *
 * These tests assert that an animation is *actually started on the element*,
 * not merely that a class name is present. Earlier versions of this suite
 * checked for a CSS class and passed happily while nothing moved on screen,
 * because a CSS mount animation never replays when React reuses a DOM node.
 *
 * jsdom has no Web Animations implementation, so `Element.animate` is stubbed
 * and the calls are inspected directly. That is the behaviour that matters:
 * did we ask the browser to animate this element, with what, and for how long.
 */

interface AnimateCall {
  element: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

let calls: AnimateCall[] = [];
let cancelled = 0;

beforeEach(() => {
  calls = [];
  cancelled = 0;
  // jsdom does not implement animate(); the component feature-detects it, so a
  // stub is required for the animation path to be exercised at all.
  (Element.prototype as unknown as { animate: unknown }).animate = function (
    this: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    calls.push({ element: this, keyframes, options });
    return { cancel: () => { cancelled += 1; } } as unknown as Animation;
  };
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const card = (id: string) => ({ id, suit: 'spades', rank: 'A' }) as never;

function seatView(playedId: string | undefined): SeatView {
  return {
    seat: 1,
    position: 'left',
    player: { id: 'p1', name: 'حریف', seat: 1, connected: true },
    isSelf: false,
    isPartner: false,
    isMyTeam: false,
    team: 1,
    isHakem: false,
    isTurn: false,
    cardCount: 5,
    playedCard: playedId ? card(playedId) : undefined,
    wonTrick: false,
    isOffline: false,
  } as SeatView;
}

describe('a dealt card really animates', () => {
  it('starts an animation on the card element', () => {
    const { container } = render(<PlayingCard card={card('c1')} index={0} />);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.element).toBe(container.querySelector('.card'));
  });

  it('moves and fades in, rather than just appearing', () => {
    render(<PlayingCard card={card('c1')} index={0} />);
    const [from, to] = calls[0]!.keyframes;
    expect(from!.opacity).toBe(0);
    expect(String(from!.transform)).toMatch(/translateY/);
    expect(to!.opacity).toBe(1);
  });

  it('runs for a visible length of time', () => {
    render(<PlayingCard card={card('c1')} index={0} />);
    expect(Number(calls[0]!.options.duration)).toBeGreaterThanOrEqual(200);
  });

  it('staggers later cards in the hand', () => {
    render(<PlayingCard card={card('a')} index={0} />);
    render(<PlayingCard card={card('b')} index={3} />);
    expect(Number(calls[0]!.options.delay)).toBe(0);
    expect(Number(calls[1]!.options.delay)).toBeGreaterThan(0);
  });

  it('caps the stagger so a seventeen card hand is not slow', () => {
    render(<PlayingCard card={card('a')} index={12} />);
    render(<PlayingCard card={card('b')} index={16} />);
    expect(calls[1]!.options.delay).toBe(calls[0]!.options.delay);
  });
});

describe('a played card really animates', () => {
  it('animates when it lands in a seat', () => {
    render(<TableSeat view={seatView('c1')} teamPlay />);
    expect(calls).toHaveLength(1);
    // The seat used here sits on the left, so the card flies in from the left.
    expect(String(calls[0]!.keyframes[0]!.transform)).toMatch(/translate\(-\d+px/);
  });

  it('animates again when a different card lands in the same seat', () => {
    // The exact failure that shipped: React reused the node, so a CSS mount
    // animation never replayed and the card silently swapped.
    const { rerender } = render(<TableSeat view={seatView('c1')} teamPlay />);
    expect(calls).toHaveLength(1);
    rerender(<TableSeat view={seatView('c2')} teamPlay />);
    expect(calls).toHaveLength(2);
  });

  it('does not restart when nothing changed', () => {
    const { rerender } = render(<TableSeat view={seatView('c1')} teamPlay />);
    rerender(<TableSeat view={seatView('c1')} teamPlay />);
    expect(calls).toHaveLength(1);
  });

  it('gives the flight enough time to actually be seen', () => {
    // At 340ms over a short distance the card effectively appeared instantly
    // and players reported never noticing the animation at all.
    render(<PlayingCard card={card('x')} played from="left" />);
    expect(Number(calls[0]!.options.duration)).toBeGreaterThanOrEqual(500);
  });
});

describe('the opening deal waits for the start overlay', () => {
  it('does not animate while the overlay is covering the table', () => {
    render(<PlayingCard card={card('c1')} index={0} dealReady={false} />);
    expect(calls).toHaveLength(0);
  });

  it('animates as soon as the overlay clears', () => {
    const { rerender } = render(<PlayingCard card={card('c1')} index={0} dealReady={false} />);
    expect(calls).toHaveLength(0);
    rerender(<PlayingCard card={card('c1')} index={0} dealReady />);
    expect(calls).toHaveLength(1);
  });

  it('never holds back a card that is landing on the table', () => {
    render(<PlayingCard card={card('c1')} played dealReady={false} />);
    expect(calls).toHaveLength(1);
  });
});

describe('animation is safe and considerate', () => {
  it('respects the reduced motion setting', () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    render(<PlayingCard card={card('c1')} index={0} />);
    expect(calls).toHaveLength(0);
  });

  it('does nothing when the browser has no Web Animations support', () => {
    (Element.prototype as unknown as { animate: unknown }).animate = undefined;
    expect(() => render(<PlayingCard card={card('c1')} index={0} />)).not.toThrow();
  });

  it('cancels the animation when the card is removed', () => {
    const { unmount } = render(<PlayingCard card={card('c1')} index={0} />);
    unmount();
    expect(cancelled).toBe(1);
  });
});

describe('a played card flies in from its owner side', () => {
  /** Reads the starting transform of the most recent animation. */
  const startTransform = () => String(calls[calls.length - 1]!.keyframes[0]!.transform);

  it('enters from the left for the seat on the left', () => {
    render(<PlayingCard card={card('c')} played from="left" />);
    expect(startTransform()).toMatch(/translate\(-\d+px,\s*0px\)/);
  });

  it('enters from the right for the seat on the right', () => {
    render(<PlayingCard card={card('c')} played from="right" />);
    expect(startTransform()).toMatch(/translate\(\d+px,\s*0px\)/);
  });

  it('drops down from the seat across the table', () => {
    render(<PlayingCard card={card('c')} played from="top" />);
    expect(startTransform()).toMatch(/translate\(0px,\s*-\d+px\)/);
  });

  it('rises from your own seat at the bottom', () => {
    render(<PlayingCard card={card('c')} played from="bottom" />);
    expect(startTransform()).toMatch(/translate\(0px,\s*\d+px\)/);
  });

  it('gives opposite sides opposite directions', () => {
    render(<PlayingCard card={card('a')} played from="left" />);
    const left = startTransform();
    render(<PlayingCard card={card('b')} played from="right" />);
    expect(startTransform()).not.toBe(left);
  });

  it('settles square, with no leftover offset or rotation', () => {
    render(<PlayingCard card={card('c')} played from="left" />);
    const last = calls[calls.length - 1]!.keyframes.at(-1)!;
    expect(String(last.transform)).toContain('translate(0, 0)');
    expect(String(last.transform)).toContain('rotate(0deg)');
    expect(last.opacity).toBe(1);
  });

  it('eases through midpoints so the card reads as thrown, not teleported', () => {
    render(<PlayingCard card={card('c')} played from="left" />);
    expect(calls[calls.length - 1]!.keyframes.length).toBeGreaterThanOrEqual(3);
  });

  it('travels far enough to be noticed', () => {
    render(<PlayingCard card={card('c')} played from="left" />);
    const distance = Number(
      String(calls[calls.length - 1]!.keyframes[0]!.transform).match(/translate\((-?\d+)px/)?.[1],
    );
    expect(Math.abs(distance)).toBeGreaterThanOrEqual(100);
  });

  it('still animates when the origin is unknown', () => {
    render(<PlayingCard card={card('c')} played />);
    expect(calls).toHaveLength(1);
    expect(startTransform()).toMatch(/translate/);
  });

  it('still finishes well within the trick hold', () => {
    // The flight must be over long before the finished trick is cleared.
    render(<PlayingCard card={card('c')} played from="top" />);
    expect(Number(calls[calls.length - 1]!.options.duration)).toBeLessThan(1000);
  });
});

describe('the seat passes its own direction to the card', () => {
  it('animates from the seat position, not a fixed direction', () => {
    const left = { ...seatView('c1'), position: 'left' } as SeatView;
    render(<TableSeat view={left} teamPlay />);
    expect(String(calls[0]!.keyframes[0]!.transform)).toMatch(/translate\(-\d+px/);
  });

  it('uses a different direction for a different seat', () => {
    const top = { ...seatView('c1'), position: 'top' } as SeatView;
    render(<TableSeat view={top} teamPlay />);
    expect(String(calls[0]!.keyframes[0]!.transform)).toMatch(/translate\(0px,\s*-\d+px\)/);
  });
});
