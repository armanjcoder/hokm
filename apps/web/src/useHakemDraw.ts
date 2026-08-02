import { useEffect, useRef, useState } from 'react';
import type { HakemDrawCard, PublicGameView } from '@hokm/game-engine';

/**
 * Replays the hakem draw one card at a time.
 *
 * The server sends the whole sequence at once, because the outcome must be
 * decided server-side and identical for everyone. The client's job is only to
 * reveal it at a watchable pace: a card lands in front of each seat in turn
 * until an ace appears, then the winning card is held up for a moment so the
 * table can see who became hakem.
 */

/** Gap between turned cards. Slow enough to follow, brisk enough not to drag. */
export const DRAW_STEP_MS = 620;

/** How long the winning ace stays highlighted before the deal begins. */
export const DRAW_SETTLE_MS = 1500;

export interface HakemDrawState {
  /** Cards revealed so far, in order. */
  revealed: HakemDrawCard[];
  /** True while the sequence is still being revealed or settling. */
  running: boolean;
  /** Seat of the winning ace, once it has been revealed. */
  hakemSeat: number | undefined;
}

export interface UseHakemDrawOptions {
  /** Called once the whole sequence has been shown. */
  onFinished?: () => void;
  /**
   * Held back while something covers the table, such as the start overlay.
   * Without this the draw plays out behind the blur and the players only ever
   * see its aftermath.
   */
  enabled?: boolean;
  stepMs?: number;
  settleMs?: number;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export function useHakemDraw(
  game: PublicGameView,
  {
    onFinished,
    enabled = true,
    stepMs = DRAW_STEP_MS,
    settleMs = DRAW_SETTLE_MS,
  }: UseHakemDrawOptions = {},
): HakemDrawState {
  const cards = game.phase === 'choosing_hakem' ? (game.hakemDraw ?? []) : [];
  const total = cards.length;
  const [shown, setShown] = useState(0);

  // `onFinished` is usually an inline arrow, so keep it in a ref rather than
  // letting it restart the sequence on every render.
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const reportedRef = useRef(false);

  useEffect(() => {
    // Nothing is revealed until the table is actually visible.
    if (!enabled) {
      setShown(0);
      return;
    }
    if (total === 0) {
      setShown(0);
      reportedRef.current = false;
      return;
    }

    reportedRef.current = false;

    // With reduced motion the whole draw appears at once; the result is what
    // matters and the pacing is purely decorative.
    if (prefersReducedMotion()) {
      setShown(total);
      const timer = setTimeout(() => {
        if (reportedRef.current) return;
        reportedRef.current = true;
        finishedRef.current?.();
      }, settleMs);
      return () => clearTimeout(timer);
    }

    setShown(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let step = 1; step <= total; step += 1) {
      timers.push(setTimeout(() => setShown(step), step * stepMs));
    }
    timers.push(
      setTimeout(() => {
        if (reportedRef.current) return;
        reportedRef.current = true;
        finishedRef.current?.();
      }, total * stepMs + settleMs),
    );

    return () => timers.forEach(clearTimeout);
    // The sequence is identified by its length and last card, which is stable
    // for a given draw and changes only when a new draw arrives.
  }, [total, cards[total - 1]?.card.id, stepMs, settleMs, enabled]);

  const revealed = cards.slice(0, shown);
  const ace = revealed.find((entry) => entry.isAce);

  return {
    revealed,
    running: enabled && total > 0,
    hakemSeat: ace?.seat,
  };
}
