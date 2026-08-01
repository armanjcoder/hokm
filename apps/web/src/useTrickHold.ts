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
export const TRICK_HOLD_MS = 3200;

/** How long the cards take to sweep to the winner once the hold is over. */
export const TRICK_SWEEP_MS = 620;

/** Time the last played card needs to finish its own landing animation. */
export const LANDING_ALLOWANCE_MS = 900;

/**
 * Everything the client needs from the last card landing to the cards being
 * gone. The server's between-tricks pause must exceed this, or the next trick
 * replaces the cards before they can be collected.
 */
export const TRICK_CYCLE_MS = LANDING_ALLOWANCE_MS + TRICK_HOLD_MS + TRICK_SWEEP_MS;

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
  // Which trick has been released, rather than which is held. Holding is the
  // default so it can be decided during render; releasing is what needs a timer.
  const [releasedId, setReleasedId] = useState<string | undefined>();
  const [sweepingId, setSweepingId] = useState<string | undefined>();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const finished = lastCompletedTrick(game);
  const liveCount = game.currentTrick?.plays.length ?? 0;

  // A trick is identified by the cards in it, which is stable and cheap.
  const finishedId = finished?.plays.map((play) => play.card.id).join('|');

  // Decided during render, not in an effect. Doing this in an effect meant the
  // cards unmounted for one frame before the hold was applied, so the whole
  // trick blinked out and then re-entered together.
  const holding = Boolean(finished && finishedId && liveCount === 0 && releasedId !== finishedId);

  useEffect(() => {
    if (!holding || !finishedId) return;

    // Reading time starts once the final card has actually arrived.
    const sweepAt = LANDING_ALLOWANCE_MS + holdMs;
    timers.current = [
      setTimeout(() => setSweepingId(finishedId), sweepAt),
      setTimeout(() => setReleasedId(finishedId), sweepAt + sweepMs),
    ];
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [holding, finishedId, holdMs, sweepMs]);

  if (!holding || !finished) return { game, sweepingTo: undefined };
  return {
    game: { ...game, currentTrick: finished },
    sweepingTo:
      sweepingId === finishedId ? (finished.winnerSeat as number | undefined) : undefined,
  };
}
