import { getPlayer } from './internal/state.js';
import { getValidCards } from './legal-moves.js';
import type { HokmGameState, PublicGameView } from './types.js';

/** The only projection of game state that is ever sent to a client. */

export function toPublicView(state: HokmGameState, playerId: string): PublicGameView {
  const player = getPlayer(state, playerId);
  // `hands` and `stock` must never be spread into the view: they hold cards no
  // client may see. Destructure them out explicitly so adding a field to the
  // state can never leak it by accident.
  const { hands, players, stock, ...rest } = state;
  return {
    ...rest,
    players: players.map((p) => ({ ...p, cardCount: hands[p.seat].length })),
    myHand: hands[player.seat],
    validCardIds: getValidCards(state, playerId).map((card) => card.id),
    stockCount: stock?.length ?? 0,
    // Only the drawing player may see the revealed card.
    pendingDraw: state.pendingDraw?.seat === player.seat ? state.pendingDraw : undefined,
  };
}
