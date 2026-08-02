import { HokmError } from './cards.js';
import { getModeConfig, nextSeatFor, teamOfSeat } from './modes.js';
import { startNewHand } from './internal/state.js';
import type { HokmGameState } from './types.js';

/** Moving from one hand to the next. */

export function continueToNextHand(state: HokmGameState, rng: () => number = Math.random): HokmGameState {
  if (state.phase !== 'hand_complete') {
    throw new HokmError('Next hand can only start after a completed hand.', 'INVALID_PHASE');
  }
  const winner = state.handScore.winningTeam;
  if (winner === undefined) {
    throw new HokmError('Cannot continue before hand winner is known.', 'NO_HAND_WINNER');
  }
  const config = getModeConfig(state.mode);
  const hakemTeam = teamOfSeat(state.hakemSeat, config);
  const nextHakem = winner === hakemTeam ? state.hakemSeat : nextSeatFor(state.hakemSeat, config);

  return startNewHand({
    id: state.id,
    mode: state.mode,
    players: state.players,
    hakemSeat: nextHakem,
    matchScore: state.matchScore,
    targetScore: state.targetScore,
    roundNumber: state.roundNumber + 1,
    rules: state.rules,
    // A new hand starts the redeal allowance fresh.
    rng,
  });

}
