import { getValidCards, toPublicView, type Card } from '@hokm/game-engine';
import { evaluateReadiness } from '../room-lifecycle.js';
import { withoutToken } from '../session.js';
import type { Room } from '../types.js';

/**
 * Client-facing projections of a room.
 *
 * These are the only shapes that leave the server, so every field is listed
 * explicitly. Never spread raw game state here: it contains every player's
 * hand and would let anyone read their opponents' cards.
 */

/** Room view with no private data at all; safe for any recipient. */
export function sanitizeRoom(room: Room) {
  const readiness = evaluateReadiness(room);
  return {
    ...room,
    readiness: {
      waitingOn: readiness.waitingOn,
      humanCount: readiness.humanCount,
      botCount: readiness.botCount,
      canStart: readiness.canStart,
    },
    players: room.players.map(withoutToken),
    game: room.game
      ? {
          phase: room.game.phase,
          hakemSeat: room.game.hakemSeat,
          currentTurnSeat: room.game.currentTurnSeat,
          trumpSuit: room.game.trumpSuit,
          currentTrick: room.game.currentTrick,
          handScore: room.game.handScore,
          matchScore: room.game.matchScore,
          roundNumber: room.game.roundNumber,
          mode: room.game.mode,
          targetScore: room.game.targetScore,
          canRequestRedeal: room.game.canRequestRedeal,
          rules: room.game.rules,
          redealCount: room.game.redealCount,
          stockCount: room.game.stock?.length ?? 0,
          // Public by design: the hakem draw is meant to be watched by everyone.
          hakemDraw: room.game.hakemDraw,
          lastEvent: room.game.lastEvent,
        }
      : undefined,
  };
}

/** Room view personalised for one player, including only their own hand. */
export function viewFor(room: Room, playerId?: string) {
  if (!room.game || !playerId) return sanitizeRoom(room);
  return {
    ...sanitizeRoom(room),
    game: {
      ...toPublicView(room.game, playerId),
      validCardIds: getValidCards(room.game, playerId).map((card: Card) => card.id),
    },
  };
}
