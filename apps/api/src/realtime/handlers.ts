import type { Server, Socket } from 'socket.io';
import { chooseTrump, continueToNextHand, playCard } from '@hokm/game-engine';
import { normalizeError } from '../errors.js';
import { autoAdvanceBots } from '../game/bots.js';
import { requireActiveGame, requireSession } from '../game/room-service.js';
import { viewFor } from '../game/views.js';
import {
  chooseTrumpSchema,
  nextHandSchema,
  playCardSchema,
  socketJoinSchema,
} from '../schemas.js';
import { persistRoom, requireRoom, rooms, touchRoom } from '../state.js';
import { emitRoom, hasOtherSocketForPlayer } from './broadcast.js';

type Ack = ((response: unknown) => void) | undefined;

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket) => {
    socket.on('room:join', (payload: unknown, ack: Ack) => handleJoin(socket, payload, ack));
    socket.on('game:choose_trump', (payload: unknown, ack: Ack) => handleChooseTrump(payload, ack));
    socket.on('game:play_card', (payload: unknown, ack: Ack) => handlePlayCard(payload, ack));
    socket.on('game:next_hand', (payload: unknown, ack: Ack) => handleNextHand(payload, ack));
    socket.on('disconnect', () => {
      void handleDisconnect(socket.id, socket.data.roomId, socket.data.playerId);
    });
  });
}

function handleJoin(socket: Socket, payload: unknown, ack: Ack): void {
  try {
    const { roomId, playerId, token } = socketJoinSchema.parse(payload);
    const room = requireRoom(roomId);
    const adoptedToken = requireSession(room, playerId, token);

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerId = playerId;

    const player = room.players.find((p) => p.id === playerId);
    if (player) player.connected = true;
    persistRoom(room);

    ack?.({ ok: true, room: viewFor(room, playerId), ...(adoptedToken ? { token: adoptedToken } : {}) });
    void emitRoom(room);
  } catch (error) {
    ack?.(normalizeError(error));
  }
}

function handleChooseTrump(payload: unknown, ack: Ack): void {
  try {
    const { roomId, playerId, suit, token } = chooseTrumpSchema.parse(payload);
    const room = requireRoom(roomId);
    requireSession(room, playerId, token);
    const game = requireActiveGame(room);

    room.game = chooseTrump(game, playerId, suit);
    autoAdvanceBots(room);
    touchRoom(room);
    persistRoom(room);

    ack?.({ ok: true });
    void emitRoom(room);
  } catch (error) {
    ack?.(normalizeError(error));
  }
}

function handlePlayCard(payload: unknown, ack: Ack): void {
  try {
    const { roomId, playerId, cardId, token } = playCardSchema.parse(payload);
    const room = requireRoom(roomId);
    requireSession(room, playerId, token);
    const game = requireActiveGame(room);

    room.game = playCard(game, playerId, cardId);
    autoAdvanceBots(room);
    if (room.game.phase === 'game_complete') room.status = 'finished';
    touchRoom(room);
    persistRoom(room);

    ack?.({ ok: true });
    void emitRoom(room);
  } catch (error) {
    ack?.(normalizeError(error));
  }
}

function handleNextHand(payload: unknown, ack: Ack): void {
  try {
    const { roomId, playerId, token } = nextHandSchema.parse(payload);
    const room = requireRoom(roomId);
    requireSession(room, playerId, token);
    const game = requireActiveGame(room);

    room.game = continueToNextHand(game);
    autoAdvanceBots(room);
    touchRoom(room);
    persistRoom(room);

    ack?.({ ok: true });
    void emitRoom(room);
  } catch (error) {
    ack?.(normalizeError(error));
  }
}

/** Marks a player offline when their last socket goes away. */
async function handleDisconnect(socketId: string, roomId: unknown, playerId: unknown): Promise<void> {
  if (typeof roomId !== 'string' || typeof playerId !== 'string') return;
  const room = rooms.get(roomId);
  if (!room) return;

  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player || player.isBot || player.connected === false) return;

  if (await hasOtherSocketForPlayer(roomId, playerId, socketId)) return;

  player.connected = false;
  persistRoom(room);
  await emitRoom(room);
}
