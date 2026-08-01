import {
  finishHakemDraw,
  chooseTrump,
  discardCards,
  requestRedeal,
  drawCard,
  getModeConfig,
  getValidCards,
  playCard,
  resolveDraw,
  type Seat,
} from '@hokm/game-engine';
import { randomCode } from '../state.js';
import type { Room, RoomPlayer } from '../types.js';
import {
  chooseCard,
  chooseTrumpSuit,
  DEFAULT_BOT_DIFFICULTY,
  type BotDifficulty,
} from './bot-ai.js';
import { chooseDiscards, shouldKeepDraw } from './bot-duel.js';

/** Test bots so a single player can try a full table. */

export const BOT_NAMES = ['ربات نیکا', 'ربات آرش', 'ربات سارا'];

/** Safety net against an unexpected engine state looping forever. */
const MAX_BOT_STEPS = 200;

export function createBot(
  room: Room,
  seat: Seat,
  difficulty: BotDifficulty = DEFAULT_BOT_DIFFICULTY,
): RoomPlayer {
  const used = new Set(room.players.filter((p) => p.isBot).map((p) => p.name));
  const name = BOT_NAMES.find((candidate) => !used.has(candidate)) ?? `ربات ${used.size + 1}`;
  return {
    id: `bot_${randomCode(10).toLowerCase()}`,
    name,
    seat,
    connected: true,
    ready: true,
    isBot: true,
    difficulty,
  };
}

function difficultyOf(player: RoomPlayer): BotDifficulty {
  return player.difficulty ?? DEFAULT_BOT_DIFFICULTY;
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

    // The hakem draw is ended by whichever client finishes showing it. A table
    // with no humans left to report in would otherwise sit in this phase
    // forever, so the server closes it out itself.
    if (room.game.phase === 'choosing_hakem') {
      if (room.players.some((player) => !player.isBot)) return;
      room.game = finishHakemDraw(room.game);
      continue;
    }

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
        room.game = chooseTrump(
          room.game,
          bot.id,
          chooseTrumpSuit(room.game, bot.seat, difficultyOf(bot)),
        );
        continue;
      }

      // Two player mode: burn the weakest cards, then draw selectively.
      if (room.game.phase === 'discarding') {
        const config = getModeConfig(room.game.mode);
        const burn = chooseDiscards(room.game, bot.seat, config.discardCount, difficultyOf(bot));
        room.game = discardCards(room.game, bot.id, burn);
        continue;
      }

      if (room.game.phase === 'drawing') {
        if (!room.game.pendingDraw) {
          room.game = drawCard(room.game, bot.id);
          continue;
        }
        const revealed = room.game.pendingDraw.card;
        const keep = shouldKeepDraw(revealed, room.game.trumpSuit, difficultyOf(bot));
        room.game = resolveDraw(room.game, bot.id, keep);
        continue;
      }

      if (room.game.phase !== 'playing') return;
      const legal = getValidCards(room.game, bot.id);
      const card = chooseCard(room.game, bot.seat, legal, difficultyOf(bot));
      if (!card) return;
      room.game = playCard(room.game, bot.id, card.id);
    } catch (error) {
      console.error(`Bot ${bot.id} could not move in room ${room.id}.`, error);
      return;
    }
  }
}

