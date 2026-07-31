import { createGame, type HokmGameState, type Seat } from '@hokm/game-engine';
import { HttpError } from '../errors.js';
import { localizeErrorCode } from '../messages.js';
import { evaluateReadiness, hasNoHumans, pickNextHost, REQUIRED_PLAYERS } from '../room-lifecycle.js';
import { createPlayerToken, verifyPlayerSession } from '../session.js';
import { persistRoom, randomCode, rooms, touchRoom, uniqueRoomId } from '../state.js';
import type { Room, RoomPlayer } from '../types.js';
import { autoAdvanceBots } from './bots.js';

/** Table lifecycle: creating, joining, readiness, leaving and authorisation. */

const TARGET_SCORE = 7;

export function createRoom(hostName: string, telegramId?: number): Room {
  const host: RoomPlayer = {
    id: randomCode(12),
    token: createPlayerToken(),
    name: hostName,
    seat: 0,
    connected: false,
    ready: false,
    ...(telegramId !== undefined ? { telegramId } : {}),
  };
  const now = new Date().toISOString();
  const room: Room = {
    id: uniqueRoomId(),
    code: randomCode(5),
    status: 'lobby',
    createdAt: now,
    lastActivityAt: now,
    hostPlayerId: host.id,
    players: [host],
  };
  rooms.set(room.id, room);
  persistRoom(room);
  return room;
}

export function joinRoom(room: Room, name: string, telegramId?: number): RoomPlayer {
  requireNotAbandoned(room);
  touchRoom(room);

  // A verified Telegram user always gets their previous seat back, even mid-game
  // and even from a new device, because their identity is now proven.
  const existing = telegramId !== undefined ? room.players.find((p) => p.telegramId === telegramId) : undefined;
  if (existing) {
    existing.name = name;
    // Issue a fresh token so a reinstalled client can control the seat again.
    existing.token = createPlayerToken();
    if (!room.players.some((p) => p.id === room.hostPlayerId && !p.isBot)) {
      room.hostPlayerId = existing.id;
    }
    return existing;
  }

  if (room.status !== 'lobby') {
    throw new HttpError(400, 'ROOM_ALREADY_STARTED', localizeErrorCode('ROOM_ALREADY_STARTED'));
  }
  if (room.players.length >= REQUIRED_PLAYERS) {
    throw new HttpError(400, 'ROOM_FULL', localizeErrorCode('ROOM_FULL'));
  }

  const takenSeats = new Set(room.players.map((p) => p.seat));
  const seat = ([0, 1, 2, 3] as Seat[]).find((candidate) => !takenSeats.has(candidate));
  if (seat === undefined) throw new HttpError(400, 'ROOM_FULL', localizeErrorCode('ROOM_FULL'));

  const player: RoomPlayer = {
    id: randomCode(12),
    token: createPlayerToken(),
    name,
    seat,
    connected: false,
    ready: false,
    ...(telegramId !== undefined ? { telegramId } : {}),
  };
  room.players.push(player);
  return player;
}

/**
 * Removes a player from a lobby, or marks them gone mid-game.
 *
 * Mid-game the seat is kept on purpose: the engine state is indexed by seat, so
 * deleting a player would corrupt hands and scores. The player can come back.
 */
export function leaveRoom(room: Room, playerId: string): void {
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new HttpError(404, 'PLAYER_NOT_FOUND', localizeErrorCode('PLAYER_NOT_FOUND'));

  if (room.status === 'playing') {
    player.connected = false;
    player.ready = false;
  } else {
    room.players = room.players.filter((candidate) => candidate.id !== playerId);
  }

  if (room.hostPlayerId === playerId) {
    const nextHost = pickNextHost(room, playerId);
    if (nextHost) room.hostPlayerId = nextHost;
  }

  if (hasNoHumans(room) && (room.status === 'playing' || room.status === 'lobby')) {
    room.status = 'abandoned';
  }

  touchRoom(room);
}

/** Starts the game when the table is full and every human pressed ready. */
export function maybeStartGame(room: Room): boolean {
  if (!evaluateReadiness(room).canStart) return false;
  room.game = createGame(
    room.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
    { id: room.id, targetScore: TARGET_SCORE },
  );
  room.status = 'playing';
  autoAdvanceBots(room);
  touchRoom(room);
  return true;
}

function requireNotAbandoned(room: Room): void {
  if (room.status === 'abandoned') {
    throw new HttpError(400, 'ROOM_ABANDONED', localizeErrorCode('ROOM_ABANDONED'));
  }
}

/** Gameplay is impossible once a table has been abandoned. */
export function requireActiveGame(room: Room): HokmGameState {
  requireNotAbandoned(room);
  if (!room.game) {
    throw new HttpError(400, 'GAME_NOT_STARTED', localizeErrorCode('GAME_NOT_STARTED'));
  }
  return room.game;
}

export function requireLobby(room: Room): void {
  requireNotAbandoned(room);
  if (room.status !== 'lobby') {
    throw new HttpError(400, 'ROOM_ALREADY_STARTED', localizeErrorCode('ROOM_ALREADY_STARTED'));
  }
}

/**
 * Verifies the caller owns the seat they claim.
 * Returns a freshly adopted token when the seat came from a pre-token snapshot.
 */
export function requireSession(room: Room, playerId: string, token: string | undefined): string | undefined {
  const result = verifyPlayerSession(room.players, playerId, token);
  if (!result.ok) {
    const status = result.code === 'PLAYER_NOT_FOUND' ? 404 : 403;
    throw new HttpError(status, result.code, localizeErrorCode(result.code));
  }
  if (result.adoptedToken) persistRoom(room);
  return result.adoptedToken;
}

/** Verifies the caller is the host, on top of the normal session check. */
export function requireHost(room: Room, playerId: string, token: string | undefined): void {
  requireSession(room, playerId, token);
  if (room.hostPlayerId !== playerId) {
    throw new HttpError(403, 'NOT_HOST', localizeErrorCode('NOT_HOST'));
  }
}
