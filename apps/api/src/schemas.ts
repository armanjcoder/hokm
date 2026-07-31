import { z } from 'zod';
import { DEFAULT_TARGET_SCORE, GAME_MODES, TARGET_SCORES } from '@hokm/game-engine';
import type { GameMode, Suit } from '@hokm/game-engine';
import { MAX_NAME_LENGTH } from './sanitize.js';

/** Request and socket payload validation, kept in one place. */

const playerName = z.string().min(1).max(MAX_NAME_LENGTH);
const initData = z.string().max(4096).optional();
const token = z.string().min(1).optional();

export const modeSchema: z.ZodType<GameMode> = z.enum(GAME_MODES);

/** Only a fixed set of target scores is allowed, so a client cannot pick 9999. */
export const targetScoreSchema = z
  .number()
  .refine((value): value is number => (TARGET_SCORES as readonly number[]).includes(value), {
    message: 'Unsupported target score.',
  });

export const rulesSchema = z.object({
  lowHandRedeal: z.boolean().optional(),
});

export const createRoomSchema = z.object({
  hostName: playerName.default('بازیکن'),
  mode: modeSchema.default('classic4'),
  targetScore: targetScoreSchema.default(DEFAULT_TARGET_SCORE),
  rules: rulesSchema.optional(),
  initData,
});

export const joinRoomSchema = z.object({
  name: playerName,
  initData,
});

/** Identifies the caller for any authenticated room action. */
export const actorSchema = z.object({
  playerId: z.string().min(1),
  token,
});

export const removeBotSchema = actorSchema.extend({ botId: z.string().min(1) });

/** Host-only lobby settings; each field is optional so one can change alone. */
export const settingsSchema = actorSchema.extend({
  mode: modeSchema.optional(),
  targetScore: targetScoreSchema.optional(),
  rules: rulesSchema.optional(),
});
export const readySchema = actorSchema.extend({ ready: z.boolean().default(true) });

export const suitSchema: z.ZodType<Suit> = z.enum(['spades', 'hearts', 'diamonds', 'clubs']);

const socketActor = z.object({
  roomId: z.string().min(1),
  playerId: z.string().min(1),
  token,
});

export const socketJoinSchema = socketActor;
export const chooseTrumpSchema = socketActor.extend({ suit: suitSchema });
export const playCardSchema = socketActor.extend({ cardId: z.string().min(1) });
export const nextHandSchema = socketActor;
export const redealSchema = socketActor;
export const discardSchema = socketActor.extend({
  cardIds: z.array(z.string().min(1)).min(1).max(5),
});
export const drawSchema = socketActor;
export const resolveDrawSchema = socketActor.extend({ keep: z.boolean() });
