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

/**
 * Pause between bot moves.
 *
 * Without it a table of bots resolves an entire trick between two frames, which
 * reads as cards teleporting rather than a game being played. Configurable so
 * the end to end tests do not have to sit through it.
 */
export const BOT_MOVE_DELAY_MS = Number(process.env.HOKM_BOT_MOVE_DELAY_MS ?? 900);

/**
 * Extra pause after a trick completes, before the next one begins.
 *
 * This has to live on the server. Clients hold the finished cards on screen so
 * everyone can read them, but if the server starts the next trick underneath
 * that pause the held cards are replaced immediately and the collection
 * animation never gets to run. Pausing here keeps every client in step.
 *
 * Must comfortably exceed the client's own hold plus its sweep.
 */
export const TRICK_PAUSE_MS = Number(process.env.HOKM_TRICK_PAUSE_MS ?? 6000);

/** Rooms with a bot move already queued, so a burst of events cannot stack up. */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Broadcaster injected by the composition root, to avoid an import cycle. */
let publish: ((room: Room) => void) | undefined;

export function setBotStepPublisher(handler: (room: Room) => void): void {
  publish = handler;
}

export function cancelBotSteps(roomId: string): void {
  const timer = pending.get(roomId);
  if (!timer) return;
  clearTimeout(timer);
  pending.delete(roomId);
}

/**
 * Plays at most one bot move, then schedules the next after a pause.
 *
 * Each step is published so every client sees the cards arrive one by one,
 * which is the whole point of the delay.
 */
export function scheduleBotSteps(room: Room, delayMs: number = BOT_MOVE_DELAY_MS): void {
  if (pending.has(room.id)) return;
  if (!nextBotSeat(room)) return;

  // A zero delay means pacing is switched off entirely, so resolve the moves
  // inline. Queuing a macrotask per move would otherwise turn a single trick
  // into dozens of event loop round trips.
  if (delayMs <= 0) {
    autoAdvanceBots(room);
    return;
  }

  // A trick that just completed stays on the table until everyone has seen it.
  const pauseMs = pauseFor(delayMs);
  const wait = delayMs + (justCompletedTrick(room) ? pauseMs : 0);

  const timer = setTimeout(() => {
    pending.delete(room.id);
    const moved = advanceOneBotStep(room);
    if (!moved) return;
    publish?.(room);
    scheduleBotSteps(room, delayMs);
  }, wait);
  timer.unref?.();
  pending.set(room.id, timer);
}

/**
 * The between-tricks pause that goes with a given move delay.
 *
 * Pacing is either on or off as a whole: a caller that switches off the move
 * delay (tests, or a bots-only table being resolved) must not then be made to
 * wait seconds between tricks.
 */
function pauseFor(delayMs: number): number {
  return delayMs <= 0 ? 0 : TRICK_PAUSE_MS;
}

/**
 * Whether play should be blocked because the last trick is still on show.
 *
 * Returns false when the pause is switched off, so a table with pacing disabled
 * is never blocked by a rule that exists purely to protect an animation.
 */
export function isTrickPauseActive(room: Room): boolean {
  return pauseFor(BOT_MOVE_DELAY_MS) > 0 && justCompletedTrick(room);
}

/**
 * True when the table is sitting between tricks.
 *
 * The engine empties `currentTrick` the moment the last card lands, so an empty
 * trick with completed ones behind it means the previous trick has just been
 * resolved and is still being shown.
 */
export function justCompletedTrick(room: Room): boolean {
  const game = room.game;
  if (!game || game.phase !== 'playing') return false;
  if (game.currentTrick.plays.length > 0) return false;
  return (game.completedTricks?.length ?? 0) > 0;
}

/** The bot that should act next, if any. */
function nextBotSeat(room: Room): RoomPlayer | undefined {
  const game = room.game;
  if (!game) return undefined;
  if (game.phase === 'game_complete' || game.phase === 'hand_complete') return undefined;
  if (game.phase === 'choosing_hakem') return undefined;
  if (game.phase === 'discarding') {
    return room.players.find(
      (player) => player.isBot && !(game.discardedSeats ?? []).includes(player.seat),
    );
  }
  return room.players.find((player) => player.isBot && player.seat === game.currentTurnSeat);
}

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
 * Plays exactly one bot move.
 *
 * Returns false when no bot could act, which is the signal to stop stepping.
 * Splitting a single move out of the loop is what allows the paced scheduler to
 * put a visible pause between bot turns.
 */
export function advanceOneBotStep(room: Room): boolean {
  const game = room.game;
  if (!game) return false;

  if (game.phase === 'game_complete') {
    room.status = 'finished';
    return false;
  }
  if (game.phase === 'hand_complete') return false;

  // The hakem draw is ended by whichever client finishes showing it. A table
  // with no humans left to report in would otherwise sit in this phase forever,
  // so the server closes it out itself.
  if (game.phase === 'choosing_hakem') {
    if (room.players.some((player) => !player.isBot)) return false;
    room.game = finishHakemDraw(game);
    return true;
  }

  const bot = nextBotSeat(room);
  if (!bot) return false;

  // A bot must never be able to crash a request handler and leave the table in
  // a half-updated state; stop advancing and let humans continue instead.
  try {
    if (game.phase === 'waiting_for_trump') {
      // A weak hand is a real disadvantage, so take the redeal when offered.
      if (game.canRequestRedeal) {
        room.game = requestRedeal(game, bot.id);
        return true;
      }
      room.game = chooseTrump(game, bot.id, chooseTrumpSuit(game, bot.seat, difficultyOf(bot)));
      return true;
    }

    // Two player mode: burn the weakest cards, then draw selectively.
    if (game.phase === 'discarding') {
      const config = getModeConfig(game.mode);
      const burn = chooseDiscards(game, bot.seat, config.discardCount, difficultyOf(bot));
      room.game = discardCards(game, bot.id, burn);
      return true;
    }

    if (game.phase === 'drawing') {
      if (!game.pendingDraw) {
        room.game = drawCard(game, bot.id);
        return true;
      }
      const revealed = game.pendingDraw.card;
      const keep = shouldKeepDraw(revealed, game.trumpSuit, difficultyOf(bot));
      room.game = resolveDraw(game, bot.id, keep);
      return true;
    }

    if (game.phase !== 'playing') return false;
    const legal = getValidCards(game, bot.id);
    const card = chooseCard(game, bot.seat, legal, difficultyOf(bot));
    if (!card) return false;
    room.game = playCard(game, bot.id, card.id);
    return true;
  } catch (error) {
    console.error(`Bot ${bot.id} could not move in room ${room.id}.`, error);
    return false;
  }
}

/**
 * Plays every consecutive bot turn immediately.
 *
 * Used where the result must be settled synchronously, such as tests and the
 * bots-only fallback. Interactive play uses `scheduleBotSteps` instead so the
 * moves are spread out and can actually be followed.
 */
export function autoAdvanceBots(room: Room): void {
  for (let guard = 0; guard < MAX_BOT_STEPS; guard += 1) {
    if (!advanceOneBotStep(room)) return;
  }
}

