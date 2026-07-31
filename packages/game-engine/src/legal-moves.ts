import { getPlayer } from './internal/state.js';
import type { Card, HokmGameState } from './types.js';

/** Which cards a player may legally play right now. */

export function getValidCards(state: HokmGameState, playerId: string): Card[] {
  const player = getPlayer(state, playerId);
  const hand = state.hands[player.seat];
  if (state.phase !== 'playing' || player.seat !== state.currentTurnSeat) {
    return [];
  }
  const leadSuit = state.currentTrick.plays[0]?.card.suit;
  if (!leadSuit) {
    return hand;
  }
  const sameSuitCards = hand.filter((card) => card.suit === leadSuit);
  return sameSuitCards.length > 0 ? sameSuitCards : hand;
}
