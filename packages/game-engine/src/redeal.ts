import { HokmError, isLowHand } from './cards.js';
import { startNewHand } from './internal/state.js';
import { getPlayer } from './internal/state.js';
import type { HokmGameState } from './types.js';

/**
 * "ده‌لو کم": the hakem may demand a fresh deal when their opening cards hold
 * no face card. The server checks the condition itself, so a client cannot
 * simply claim a weak hand.
 */

export function requestRedeal(
  state: HokmGameState,
  playerId: string,
  rng: () => number = Math.random,
): HokmGameState {
  if (state.phase !== 'waiting_for_trump') {
    throw new HokmError('A redeal can only be requested before trump is chosen.', 'INVALID_PHASE');
  }
  const player = getPlayer(state, playerId);
  if (player.seat !== state.hakemSeat) {
    throw new HokmError('Only hakem can request a redeal.', 'NOT_HAKEM');
  }
  if (!state.rules.lowHandRedeal) {
    throw new HokmError('The low hand redeal rule is disabled.', 'REDEAL_DISABLED');
  }
  if (state.redealCount >= state.rules.maxRedeals) {
    throw new HokmError('No redeals remain for this hand.', 'REDEAL_LIMIT');
  }
  if (!isLowHand(state.hands[state.hakemSeat])) {
    throw new HokmError('This hand is not weak enough for a redeal.', 'REDEAL_NOT_ALLOWED');
  }

  const next = startNewHand({
    id: state.id,
    mode: state.mode,
    players: state.players,
    hakemSeat: state.hakemSeat,
    matchScore: state.matchScore,
    targetScore: state.targetScore,
    roundNumber: state.roundNumber,
    rules: state.rules,
    redealCount: state.redealCount + 1,
    rng,
  });
  return {
    ...next,
    lastEvent: `${player.name} ده‌لو کم اعلام کرد؛ کارت‌ها دوباره پخش شد.`,
  };
}
