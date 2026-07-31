import type { GameMode, HokmGameState, Seat } from '@hokm/game-engine';
import type { RoomStatus } from './room-lifecycle.js';

export interface RoomPlayer {
  id: string;
  /** Secret session token. Never leaves the server except to its own owner. */
  token?: string;
  name: string;
  telegramId?: number;
  seat: Seat;
  connected: boolean;
  ready?: boolean;
  isBot?: boolean;
}

export interface Room {
  id: string;
  code: string;
  /** Which Hokm variant this table plays. */
  mode: GameMode;
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
}
