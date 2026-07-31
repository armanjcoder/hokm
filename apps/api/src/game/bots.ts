import {
  chooseTrump,
  discardCards,
  requestRedeal,
  drawCard,
  getModeConfig,
  getValidCards,
  playCard,
  resolveDraw,
  type Card,
  type HokmGameState,
  type Seat,
  type Suit,
} from '@hokm/game-engine';
import { randomCode } from '../state.js';
import type { Room, RoomPlayer } from '../types.js';

/** Test bots so a single player can try a full table. */

export const BOT_NAMES = ['ربات نیکا', 'ربات آرش', 'ربات سارا'];

/** Safety net against an unexpected engine state looping forever. */
const MAX_BOT_STEPS = 200;

export function createBot(room: Room, seat: Seat): RoomPlayer {
  const used = new Set(room.players.filter((p) => p.isBot).map((p) => p.name));
  const name = BOT_NAMES.find((candidate) => !used.has(candidate)) ?? `ربات ${used.size + 1}`;
  return {
    id: `bot_${randomCode(10).toLowerCase()}`,
    name,
    seat,
    connected: true,
    ready: true,
    isBot: true,
  };
}

/**
 * Plays every consecutive bot turn until it is a human's move again.
 *
 * Mutates `room.game` in place because callers persist and broadcast the room
 * immediately afterwards.
 */
export function autoAdvanceBots(room: Room): void {
  if (!room.game) return;
  for (let guard = 0; guard < MAX_BOT_STEPS; guard += 1) {
    if (!room.game || room.game.phase === 'game_complete') {
      room.status = 'finished';
      return;
    }
    if (room.game.phase === 'hand_complete') return;

    // During discarding every seat acts, not just the one whose turn it is.
    const bot =
      room.game.phase === 'discarding'
        ? room.players.find(
            (player) => player.isBot && !(room.game?.discardedSeats ?? []).includes(player.seat),
          )
        : room.players.find((player) => player.isBot && player.seat === room.game?.currentTurnSeat);
    if (!bot) return;

    // A bot must never be able to crash a request handler and leave the table
    // in a half-updated state; stop advancing and let humans continue instead.
    try {
      if (room.game.phase === 'waiting_for_trump') {
        // A weak hand is a real disadvantage, so take the redeal when offered.
        if (room.game.canRequestRedeal) {
          room.game = requestRedeal(room.game, bot.id);
          continue;
        }
        room.game = chooseTrump(room.game, bot.id, chooseBotTrump(room.game, bot.seat));
        continue;
      }

      // Two player mode: burn the weakest cards, then always keep the draw.
      if (room.game.phase === 'discarding') {
        const config = getModeConfig(room.game.mode);
        const weakest = [...room.game.hands[bot.seat]]
          .sort((a, b) => botRankValue(a) - botRankValue(b))
          .slice(0, config.discardCount)
          .map((card) => card.id);
        room.game = discardCards(room.game, bot.id, weakest);
        continue;
      }

      if (room.game.phase === 'drawing') {
        if (!room.game.pendingDraw) room.game = drawCard(room.game, bot.id);
        room.game = resolveDraw(room.game, bot.id, true);
        continue;
      }

      if (room.game.phase !== 'playing') return;
      const card = chooseBotCard(getValidCards(room.game, bot.id));
      if (!card) return;
      room.game = playCard(room.game, bot.id, card.id);
    } catch (error) {
      console.error(`Bot ${bot.id} could not move in room ${room.id}.`, error);
      return;
    }
  }
}

/** Picks the suit the bot holds most strength in. */
export function chooseBotTrump(game: HokmGameState, seat: Seat): Suit {
  const suitScores: Record<Suit, number> = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
  for (const card of game.hands[seat]) {
    suitScores[card.suit] += 10 + botRankValue(card);
  }
  return (Object.entries(suitScores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'spades') as Suit;
}

/** Currently a simple strategy: always play the lowest legal card. */
export function chooseBotCard(cards: Card[]): Card | undefined {
  return [...cards].sort((a, b) => botRankValue(a) - botRankValue(b))[0];
}

export function botRankValue(card: Card): number {
  const values: Record<Card['rank'], number> = {
    A: 14, K: 13, Q: 12, J: 11, '10': 10, '9': 9,
    '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2,
  };
  return values[card.rank];
}
