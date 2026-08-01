import { useEffect, useRef } from 'react';
import type { TablePosition } from './table-seats.js';

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

/**
 * How far a played card travels, in pixels, before settling.
 *
 * Large enough that the flight is unmistakable at a glance. The earlier value
 * was so small, and over so short a time, that the card effectively appeared
 * instantly and the animation went unnoticed.
 */
const TRAVEL = 130;

/**
 * Where a card starts its flight, per seat position.
 *
 * A card played by the seat on the left enters from the left, the seat at the
 * top sends it down, and so on. This is what makes it obvious who played what
 * without reading any labels.
 */
const ORIGIN: Record<TablePosition, { x: number; y: number }> = {
  bottom: { x: 0, y: TRAVEL },
  top: { x: 0, y: -TRAVEL },
  left: { x: -TRAVEL, y: 0 },
  right: { x: TRAVEL, y: 0 },
};

/** Dealt into the hand: slides up from the deck with a slight tilt. */
const DEAL_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: 'translateY(26px) scale(0.86) rotate(-4deg)' },
  { opacity: 1, transform: 'translateY(0) scale(1) rotate(0deg)' },
];

/**
 * Played onto the table: flies in from its owner's side and settles.
 *
 * The midpoint keeps a little scale and rotation so the card feels thrown
 * rather than teleported, then the last frame lands it flat and square.
 */
function landKeyframes(from: TablePosition | undefined): Keyframe[] {
  const origin = from ? ORIGIN[from] : { x: 0, y: -18 };
  const tilt = origin.x === 0 ? 0 : origin.x < 0 ? -14 : 14;
  return [
    {
      opacity: 0,
      transform: `translate(${origin.x}px, ${origin.y}px) scale(0.82) rotate(${tilt}deg)`,
      offset: 0,
    },
    {
      opacity: 1,
      transform: `translate(${origin.x * 0.42}px, ${origin.y * 0.42}px) scale(1.04) rotate(${tilt * 0.5}deg)`,
      offset: 0.45,
    },
    {
      opacity: 1,
      transform: `translate(${origin.x * 0.08}px, ${origin.y * 0.08}px) scale(1.06) rotate(${tilt * 0.12}deg)`,
      offset: 0.78,
    },
    { opacity: 1, transform: 'translate(0, 0) scale(1) rotate(0deg)', offset: 1 },
  ];
}

/**
 * A played card is the single most important event on the table, so its flight
 * is given real time on screen. Dealing stays brisk because it happens to many
 * cards at once and would otherwise feel sluggish.
 */
const DURATION: Record<EntranceKind, number> = { deal: 420, land: 620 };

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
  /** Seat the card was played from, so it can fly in from that side. */
  from?: TablePosition;
}

/** Returns a ref to attach to the card element. */
export function useCardEntrance({
  kind,
  index = 0,
  enabled = true,
  replayKey,
  from,
}: EntranceOptions) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    if (typeof element.animate !== 'function') return;
    if (prefersReducedMotion()) return;

    const delay = kind === 'deal' ? Math.min(index, MAX_STAGGER_STEPS) * STAGGER_MS : 0;
    const animation = element.animate(
      kind === 'deal' ? DEAL_KEYFRAMES : landKeyframes(from),
      {
        duration: DURATION[kind],
        delay,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'both',
      },
    );

    return () => animation.cancel();
  }, [kind, index, enabled, replayKey, from]);

  return ref;
}
