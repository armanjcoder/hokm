import { useEffect, useRef } from 'react';

/**
 * Plays a card's entrance with the Web Animations API instead of a CSS class.
 *
 * CSS mount animations proved unreliable here. They depend on the element being
 * *inserted* while the rule already applies, which quietly fails whenever React
 * reuses a node, whenever the class is added a frame late, and in some in-app
 * WebViews. Nothing about that is visible from the markup, which is exactly why
 * the bug survived several rounds of "the CSS is definitely there".
 *
 * Calling `element.animate()` sidesteps all of it: the animation is started
 * imperatively on a node we hold a reference to, so it either runs or throws.
 * It also degrades safely, because `animate` is feature-detected.
 */

export type EntranceKind = 'deal' | 'land';

/** Motion is opt-out: respect the OS setting rather than animating regardless. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

const KEYFRAMES: Record<EntranceKind, Keyframe[]> = {
  // Dealt into the hand: slides up from the deck with a slight tilt.
  deal: [
    { opacity: 0, transform: 'translateY(26px) scale(0.86) rotate(-4deg)' },
    { opacity: 1, transform: 'translateY(0) scale(1) rotate(0deg)' },
  ],
  // Played onto the table: drops down onto the seat's slot.
  land: [
    { opacity: 0, transform: 'translateY(-18px) scale(1.08)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' },
  ],
};

const DURATION: Record<EntranceKind, number> = { deal: 380, land: 220 };

/** Cards after this position share the last delay, so long hands stay snappy. */
const MAX_STAGGER_STEPS = 12;
const STAGGER_MS = 45;

export interface EntranceOptions {
  kind: EntranceKind;
  /** Position in the hand; used to stagger a deal. Ignored for a landing card. */
  index?: number;
  /** When false the animation is held back, e.g. behind the start overlay. */
  enabled?: boolean;
  /** Changing this replays the animation, so a new card in a reused node still animates. */
  replayKey?: string;
}

/** Returns a ref to attach to the card element. */
export function useCardEntrance({
  kind,
  index = 0,
  enabled = true,
  replayKey,
}: EntranceOptions) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    if (typeof element.animate !== 'function') return;
    if (prefersReducedMotion()) return;

    const delay = kind === 'deal' ? Math.min(index, MAX_STAGGER_STEPS) * STAGGER_MS : 0;
    const animation = element.animate(KEYFRAMES[kind], {
      duration: DURATION[kind],
      delay,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both',
    });

    return () => animation.cancel();
  }, [kind, index, enabled, replayKey]);

  return ref;
}
