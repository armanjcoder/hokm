import { z } from 'zod';
import type { Suit } from '@hokm/game-engine';
import { MAX_NAME_LENGTH } from './sanitize.js';

/** Request and socket payload validation, kept in one place. */

const playerName = z.string().min(1).max(MAX_NAME_LENGTH);
const initData = z.string().max(4096).optional();
const token = z.string().min(1).optional();

export const createRoomSchema = z.object({
  hostName: playerName.default('بازیکن'),
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
