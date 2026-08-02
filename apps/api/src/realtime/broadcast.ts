import type { Server } from 'socket.io';
import { viewFor } from '../game/views.js';
import type { Room } from '../types.js';

/**
 * Broadcasting needs the Socket.IO server, which is created after the HTTP
 * server. Registering it once here avoids passing `io` through every call.
 */

let server: Server | undefined;

export function registerSocketServer(io: Server): void {
  server = io;
}

/**
 * Sends each connected socket its own personalised room view.
 *
 * A shared broadcast is impossible: every player must receive only their own
 * hand, so the payload differs per recipient.
 */
export async function emitRoom(room: Room): Promise<void> {
  if (!server) return;
  const sockets = await server.in(room.id).fetchSockets();
  for (const roomSocket of sockets) {
    const playerId = typeof roomSocket.data.playerId === 'string' ? roomSocket.data.playerId : undefined;
    roomSocket.emit('room:update', viewFor(room, playerId));
  }
}

/**
 * True when another live socket still claims the same seat.
 *
 * A reconnect can briefly overlap with the dying socket, and a player may have
 * several tabs open, so a disconnect must not immediately mark them offline.
 */
export async function hasOtherSocketForPlayer(
  roomId: string,
  playerId: string,
  excludingSocketId: string,
): Promise<boolean> {
  if (!server) return false;
  const sockets = await server.in(roomId).fetchSockets();
  return sockets.some((other) => other.id !== excludingSocketId && other.data.playerId === playerId);
}
