import { useEffect, useRef, useState } from 'react';
import type { PublicGameView } from '@hokm/game-engine';
import { lastCompletedTrick } from './table-seats.js';

/**
 * Keeps a finished trick on screen long enough to actually be read.
 *
 * The engine clears `currentTrick` the instant the last card lands, so without
 * this the four cards vanish in the same frame they complete and nobody can see
 * what was played. Holding the completed trick for a few seconds is the whole
 * point of watching the table in Hokm, where tracking played cards is the game.
 *
 * The hold ends early if the next trick starts, so a fast table is never
 * blocked waiting on an animation.
 */

/** How long a completed trick stays visible. */
export const TRICK_HOLD_MS = 3000;

/**
 * Returns the game view the table should render.
 *
 * While a trick is being held this is a shallow copy whose `currentTrick` is
 * the completed one, so every seat still shows its card. Callers can treat the
 * result exactly like the live view.
 */
export function useTrickHold(game: PublicGameView, holdMs: number = TRICK_HOLD_MS): PublicGameView {
  const [held, setHeld] = useState<PublicGameView['completedTricks'][number] | undefined>();
  const shownRef = useRef<string | undefined>(undefined);

  const finished = lastCompletedTrick(game);
  const liveCount = game.currentTrick?.plays.length ?? 0;

  // A trick is identified by the cards in it, which is stable and cheap.
  const finishedId = finished?.plays.map((play) => play.card.id).join('|');

  useEffect(() => {
    // The next trick has begun, so stop holding immediately.
    if (liveCount > 0) {
      setHeld(undefined);
      return;
    }
    if (!finished || !finishedId) return;
    // Only start a hold for a trick we have not already shown.
    if (shownRef.current === finishedId) return;

    shownRef.current = finishedId;
    setHeld(finished);
    const timer = setTimeout(() => setHeld(undefined), holdMs);
    return () => clearTimeout(timer);
  }, [finishedId, liveCount, holdMs, finished]);

  if (!held || liveCount > 0) return game;
  return { ...game, currentTrick: held };
}
