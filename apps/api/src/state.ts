import { config } from './config.js';
import { HttpError } from './errors.js';
import { localizeErrorCode } from './messages.js';
import { SqliteRoomStore } from './storage.js';
import type { Room } from './types.js';

/**
 * In-memory room registry backed by SQLite.
 *
 * Rooms live in a Map for fast access during a game and are snapshotted to disk
 * on every meaningful change so a restart does not lose a table.
 */

export const roomStore = await SqliteRoomStore.open(config.dbPath);

const loadedRooms = roomStore.loadRooms<Room>().map(normalizeLoadedRoom);

export const rooms = new Map<string, Room>(loadedRooms.map((room) => [room.id, room]));

export const loadedRoomCount = loadedRooms.length;

export function persistRoom(room: Room): void {
  roomStore.saveRoom(room);
}

export function requireRoom(roomId: string): Room {
  const room = rooms.get(roomId);
  if (!room) throw new HttpError(404, 'ROOM_NOT_FOUND', localizeErrorCode('ROOM_NOT_FOUND'));
  return room;
}

export function touchRoom(room: Room): void {
  room.lastActivityAt = new Date().toISOString();
}

/** Room ids address a table publicly, so a collision would hijack a live game. */
export function uniqueRoomId(): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = randomCode(10).toLowerCase();
    if (!rooms.has(candidate)) return candidate;
  }
  return `${randomCode(10).toLowerCase()}${Date.now().toString(36)}`;
}

export function randomCode(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

/** Backfills fields added after older snapshots were written. */
export function normalizeLoadedRoom(room: Room): Room {
  const players = room.players.map((player) => ({
    ...player,
    connected: player.isBot ? true : false,
    // Humans must press ready again after a restart; bots are always ready.
    ready: player.isBot ? true : false,
  }));
  const firstHuman = players.find((player) => !player.isBot);
  const hostPlayerId =
    room.hostPlayerId && players.some((p) => p.id === room.hostPlayerId && !p.isBot)
      ? room.hostPlayerId
      : firstHuman?.id;
  return {
    ...room,
    // Rooms saved before multi-mode support default to the classic game.
    mode: room.mode ?? 'classic4',
    targetScore: room.targetScore ?? 7,
    // Older snapshots predate some rule flags, so fill in any that are missing.
    rules: {
      lowHandRedeal: room.rules?.lowHandRedeal ?? false,
      maxRedeals: room.rules?.maxRedeals ?? 2,
      bam: room.rules?.bam ?? false,
    },
    players,
    lastActivityAt: room.lastActivityAt ?? room.createdAt,
    ...(hostPlayerId !== undefined ? { hostPlayerId } : {}),
  };
}
