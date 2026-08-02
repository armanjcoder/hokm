import { useEffect, useRef } from 'react';
import type { PublicGameView } from '@hokm/game-engine';
import { haptic } from './telegram.js';

/**
 * A short buzz when your side takes a trick.
 *
 * Taking a trick is the most satisfying beat in a hand, and on a phone the
 * cards are small enough that it is easy to miss who won. Fires once per trick,
 * only for the viewer's own side, so it stays a reward rather than noise.
 */
export function useTrickWonHaptic(
  game: PublicGameView,
  mySeat: number | undefined,
  teamPlay: boolean,
): void {
  // Tricks are identified by their cards, which is stable for a given trick.
  const lastReported = useRef<string | undefined>(undefined);

  const trick = game.currentTrick;
  const winnerSeat = trick?.winnerSeat;
  const trickId = trick?.plays.map((play) => play.card.id).join('|');

  useEffect(() => {
    if (winnerSeat === undefined || !trickId || mySeat === undefined) return;
    if (lastReported.current === trickId) return;
    lastReported.current = trickId;

    const mine = teamPlay
      ? Number(winnerSeat) % 2 === mySeat % 2
      : Number(winnerSeat) === mySeat;
    if (mine) haptic('win');
  }, [trickId, winnerSeat, mySeat, teamPlay]);
}
