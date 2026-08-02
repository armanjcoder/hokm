import { useEffect, useRef, useState } from 'react';
import { getModeConfig, type PublicGameView } from '@hokm/game-engine';

/**
 * Reveals a freshly dealt hand one card at a time.
 *
 * The server deals atomically: one moment you hold nothing, the next you hold
 * five cards. At a real table the dealer works round the table giving each
 * player their cards in turn, and that rhythm is most of what makes the start
 * of a hand feel like a card game rather than a state update.
 *
 * So the cards are held back and released on a timer. Only the count is
 * animated; the cards themselves are exactly what the server sent.
 */

/** Gap between individual cards. Slow enough to see each one land. */
export const DEAL_CARD_MS = 300;

/** Extra pause when the dealer moves on to the next player. */
export const DEAL_SEAT_GAP_MS = 400;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * How long the viewer waits before their own cards start arriving.
 *
 * Dealing starts at the hakem and goes round the table, so a player sitting two
 * seats along waits for two full batches before their own cards appear.
 */
export function seatDealDelay(
  mySeat: number,
  hakemSeat: number,
  seats: number,
  batchSize: number,
  cardMs = DEAL_CARD_MS,
  seatGapMs = DEAL_SEAT_GAP_MS,
): number {
  const turnsBefore = (mySeat - hakemSeat + seats) % seats;
  return turnsBefore * (batchSize * cardMs + seatGapMs);
}

/**
 * Returns how many of the player's cards should currently be visible.
 *
 * Grows to the full hand size and never shrinks mid-deal, so a re-render cannot
 * make cards disappear.
 */
export function useDealSequence(game: PublicGameView, mySeat: number | undefined): number {
  const total = game.myHand?.length ?? 0;
  const [visible, setVisible] = useState(total);
  const previousTotal = useRef(total);

  useEffect(() => {
    const previous = previousTotal.current;
    previousTotal.current = total;

    // Cards leaving the hand (playing, discarding) is not a deal.
    if (total <= previous) {
      setVisible(total);
      return;
    }

    if (prefersReducedMotion()) {
      setVisible(total);
      return;
    }

    const config = getModeConfig(game.mode);
    const batch = total - previous;
    const startDelay = seatDealDelay(
      mySeat ?? game.hakemSeat,
      game.hakemSeat,
      config.seats,
      batch,
    );

    setVisible(previous);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let step = 1; step <= batch; step += 1) {
      timers.push(
        setTimeout(() => setVisible(previous + step), startDelay + step * DEAL_CARD_MS),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [total, game.mode, game.hakemSeat, mySeat]);

  return Math.min(visible, total);
}
