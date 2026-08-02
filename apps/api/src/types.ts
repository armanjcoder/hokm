import type { GameMode, HokmGameState, OptionalRules, Seat } from '@hokm/game-engine';
import type { BotDifficulty } from './game/bot-ai.js';
import type { RoomStatus } from './room-lifecycle.js';

export interface RoomPlayer {
  id: string;
  /** Secret session token. Never leaves the server except to its own owner. */
  token?: string;
  name: string;
  telegramId?: number;
  /**
   * Telegram profile photo URL from verified `initData`. Server-only: it is
   * stripped from every client view and reached through the avatar endpoint
   * instead, so the CDN address never leaves the machine.
   */
  photoUrl?: string;
  seat: Seat;
  connected: boolean;
  ready?: boolean;
  isBot?: boolean;
  /** Only set for bots: how strong this opponent plays. */
  difficulty?: BotDifficulty;
}

export interface Room {
  id: string;
  code: string;
  /** Which Hokm variant this table plays. */
  mode: GameMode;
  /** Points needed to win the match. */
  targetScore: number;
  /** House rules chosen by the host. */
  rules: OptionalRules;
  status: RoomStatus;
  createdAt: string;
  lastActivityAt?: string;
  hostPlayerId?: string;
  players: RoomPlayer[];
  game?: HokmGameState;
}

/** A Telegram identity that has been verified, or an anonymous guest. */
export interface Identity {
  telegramId?: number;
  name?: string;
  /** Verified Telegram profile photo, when the account has a public one. */
  photoUrl?: string;
}
