import { useEffect, useRef } from 'react';
import type { TablePosition } from './table-seats.js';

/**
 * Animates a card with the Web Animations API instead of CSS classes.
 *
 * CSS mount animations proved unreliable here: they only run when the element
 * is *inserted* while the rule already applies, which quietly fails whenever
 * React reuses a node or adds the class a frame late.
 *
 * The exit is driven by the same API for a related reason. Mixing a CSS
 * transition with `element.animate()` on the same property does not work,
 * because a running animation owns `transform` in a cascade origin above all
 * CSS, so the transition is simply ignored. One owner per property, one API.
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
 * Large enough that the flight is unmistakable at a glance.
 */
const TRAVEL = 130;

/** How far a collected card travels on its way to the winner. */
const EXIT_TRAVEL = 190;

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
 * The midpoints keep a little scale and rotation so the card feels thrown
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

/** Collected by the winner: slides off towards their seat and fades out. */
export function exitKeyframes(towards: TablePosition): Keyframe[] {
  const target = ORIGIN[towards];
  const dx = target.x === 0 ? 0 : (target.x / TRAVEL) * EXIT_TRAVEL;
  const dy = target.y === 0 ? 0 : (target.y / TRAVEL) * EXIT_TRAVEL;
  const tilt = dx === 0 ? 0 : dx < 0 ? -10 : 10;
  return [
    { opacity: 1, transform: 'translate(0, 0) scale(1) rotate(0deg)', offset: 0 },
    { opacity: 1, transform: `translate(${dx * 0.25}px, ${dy * 0.25}px) scale(1.04)`, offset: 0.25 },
    {
      opacity: 0,
      transform: `translate(${dx}px, ${dy}px) scale(0.66) rotate(${tilt}deg)`,
      offset: 1,
    },
  ];
}

const DURATION: Record<EntranceKind, number> = { deal: 520, land: 900 };

/** How long a collected card takes to reach the winner. */
export const EXIT_DURATION_MS = 620;

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
  /**
   * Seat the finished trick is being collected by. Set only while the cards are
   * sweeping away; it takes over from the entrance and drives the exit.
   */
  exitTowards?: TablePosition | undefined;
}

/** Returns a ref to attach to the card element. */
export function useCardEntrance({
  kind,
  index = 0,
  enabled = true,
  replayKey,
  from,
  exitTowards,
}: EntranceOptions) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    if (typeof element.animate !== 'function') return;

    // The exit must still leave the card hidden when motion is reduced,
    // otherwise a collected trick would sit on the table forever.
    if (prefersReducedMotion()) {
      if (exitTowards) element.style.opacity = '0';
      return;
    }

    if (exitTowards) {
      // Cancel any lingering entrance first: two animations on the same
      // property would otherwise both apply and the later one would not win
      // cleanly. `forwards` keeps the card hidden until React removes it.
      element.getAnimations?.().forEach((animation) => animation.cancel());
      const exit = element.animate(exitKeyframes(exitTowards), {
        duration: EXIT_DURATION_MS,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'forwards',
      });
      return () => exit.cancel();
    }

    const delay = kind === 'deal' ? Math.min(index, MAX_STAGGER_STEPS) * STAGGER_MS : 0;
    const animation = element.animate(
      kind === 'deal' ? DEAL_KEYFRAMES : landKeyframes(from),
      {
        duration: DURATION[kind],
        delay,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        // `backwards` holds the first keyframe during the stagger delay so a
        // card never flashes at full size before its turn, then releases the
        // element once it has settled.
        fill: 'backwards',
      },
    );

    return () => animation.cancel();
  }, [kind, index, enabled, replayKey, from, exitTowards]);

  return ref;
}
