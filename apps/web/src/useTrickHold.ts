import { useEffect, useRef, useState } from 'react';
import type { PublicGameView } from '@hokm/game-engine';
import { lastCompletedTrick } from './table-seats.js';

/**
 * Keeps a finished trick on screen long enough to actually be read, then sweeps
 * it towards whoever won it.
 *
 * The engine clears `currentTrick` the instant the last card lands, so without
 * this the four cards vanish in the same frame they complete. Tracking played
 * cards is the whole skill of Hokm, so they are held, and then collected by the
 * winner rather than simply disappearing, which is what makes it obvious who
 * took the trick.
 *
 * The hold ends early if the next trick starts, so a fast table is never
 * blocked waiting on an animation.
 */

/**
 * How long the completed cards sit still before being collected.
 *
 * Measured from the moment the last card has finished flying in, not from when
 * it was played, so the reading time is what it looks like.
 */
export const TRICK_HOLD_MS = 2600;

/** How long the cards take to sweep to the winner once the hold is over. */
export const TRICK_SWEEP_MS = 620;

/** Time the last played card needs to finish its own landing animation. */
const LANDING_ALLOWANCE_MS = 900;

export interface TrickHoldState {
  /** The view the table should render. */
  game: PublicGameView;
  /** Seat the held cards are sweeping towards, while that is happening. */
  sweepingTo: number | undefined;
}

export function useTrickHold(
  game: PublicGameView,
  holdMs: number = TRICK_HOLD_MS,
  sweepMs: number = TRICK_SWEEP_MS,
): TrickHoldState {
  const [held, setHeld] = useState<PublicGameView['completedTricks'][number] | undefined>();
  const [sweeping, setSweeping] = useState(false);
  const shownRef = useRef<string | undefined>(undefined);

  const finished = lastCompletedTrick(game);
  const liveCount = game.currentTrick?.plays.length ?? 0;

  // A trick is identified by the cards in it, which is stable and cheap.
  const finishedId = finished?.plays.map((play) => play.card.id).join('|');

  useEffect(() => {
    // The next trick has begun, so stop holding immediately.
    if (liveCount > 0) {
      setHeld(undefined);
      setSweeping(false);
      return;
    }
    if (!finished || !finishedId) return;
    // Only start a hold for a trick we have not already shown.
    if (shownRef.current === finishedId) return;

    shownRef.current = finishedId;
    setHeld(finished);
    setSweeping(false);

    // Reading time starts once the final card has actually arrived.
    const sweepAt = LANDING_ALLOWANCE_MS + holdMs;
    const startSweep = setTimeout(() => setSweeping(true), sweepAt);
    const clear = setTimeout(() => {
      setHeld(undefined);
      setSweeping(false);
    }, sweepAt + sweepMs);

    return () => {
      clearTimeout(startSweep);
      clearTimeout(clear);
    };
  }, [finishedId, liveCount, holdMs, sweepMs, finished]);

  if (!held || liveCount > 0) return { game, sweepingTo: undefined };
  return {
    game: { ...game, currentTrick: held },
    sweepingTo: sweeping ? (held.winnerSeat as number | undefined) : undefined,
  };
}
