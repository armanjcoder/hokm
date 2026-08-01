import type { Server, Socket } from 'socket.io';
import {
  chooseTrump,
  continueToNextHand,
  finishHakemDraw,
  discardCards,
  drawCard,
  playCard,
  requestRedeal,
  resolveDraw,
} from '@hokm/game-engine';
import { normalizeError } from '../errors.js';
import { scheduleBotSteps, setBotStepPublisher } from '../game/bots.js';
import {
  clearHakemDrawTimeout,
  requireActiveGame,
  requireSession,
  setHakemDrawTimeoutHandler,
} from '../game/room-service.js';
import { viewFor } from '../game/views.js';
import {
  chooseTrumpSchema,
  discardSchema,
  hakemDrawDoneSchema,
  drawSchema,
  nextHandSchema,
  playCardSchema,
  redealSchema,
  resolveDrawSchema,
  socketJoinSchema,
} from '../schemas.js';
import { persistRoom, requireRoom, rooms, touchRoom } from '../state.js';
import { emitRoom, hasOtherSocketForPlayer } from './broadcast.js';

type Ack = ((response: unknown) => void) | undefined;

export function registerSocketHandlers(io: Server): void {
  // A table whose clients never report back must still start its hand.
  // Each paced bot move is persisted and broadcast, so clients see the cards
  // arrive one by one rather than a whole trick appearing at once.
  setBotStepPublisher((room) => {
    if (room.game?.phase === 'game_complete') room.status = 'finished';
    touchRoom(room);
    persistRoom(room);
    void emitRoom(room);
  });

  setHakemDrawTimeoutHandler((room) => {
    if (room.game?.phase !== 'choosing_hakem') return;
    room.game = finishHakemDraw(room.game);
    scheduleBotSteps(room);
    touchRoom(room);
    persistRoom(room);
    void emitRoom(room);
  });

  io.on('connection', (socket) => {
    socket.on('room:join', (payload: unknown, ack: Ack) => handleJoin(socket, payload, ack));
    socket.on('game:choose_trump', (payload: unknown, ack: Ack) => handleChooseTrump(payload, ack));
    socket.on('game:play_card', (payload: unknown, ack: Ack) => handlePlayCard(payload, ack));
    socket.on('game:hakem_draw_done', (payload: unknown, ack: Ack) =>
      handleHakemDrawDone(payload, ack),
    );
    socket.on('game:next_hand', (payload: unknown, ack: Ack) => handleNextHand(payload, ack));
    socket.on('game:redeal', (payload: unknown, ack: Ack) => handleRedeal(payload, ack));
    socket.on('game:discard', (payload: unknown, ack: Ack) => handleDiscard(payload, ack));
    socket.on('game:draw', (payload: unknown, ack: Ack) => handleDraw(payload, ack));
    socket.on('game:resolve_draw', (payload: unknown, ack: Ack) => handleResolveDraw(payload, ack));
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
    scheduleBotSteps(room);
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
    scheduleBotSteps(room);
    if (room.game.phase === 'game_complete') room.status = 'finished';
    touchRoom(room);
    persistRoom(room);

    ack?.({ ok: true });
    void emitRoom(room);
  } catch (error) {
    ack?.(normalizeError(error));
  }
}

/**
 * Ends the hakem draw once a client has finished showing it.
 *
 * Idempotent on purpose: every player reports in when their animation ends, and
 * `finishHakemDraw` simply returns the state unchanged after the first one.
 */
function handleHakemDrawDone(payload: unknown, ack: Ack): void {
  try {
    const { roomId, playerId, token } = hakemDrawDoneSchema.parse(payload);
    const room = requireRoom(roomId);
    requireSession(room, playerId, token);
    const game = requireActiveGame(room);
    if (game.phase !== 'choosing_hakem') {
      ack?.({ ok: true });
      return;
    }

    clearHakemDrawTimeout(room.id);
    room.game = finishHakemDraw(game);
    scheduleBotSteps(room);
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
    scheduleBotSteps(room);
    touchRoom(room);
    persistRoom(room);

    ack?.({ ok: true });
    void emitRoom(room);
  } catch (error) {
    ack?.(normalizeError(error));
  }
}

/** "ده‌لو کم": hakem asks for a fresh deal when their opening hand is weak. */
function handleRedeal(payload: unknown, ack: Ack): void {
  try {
    const { roomId, playerId, token } = redealSchema.parse(payload);
    const room = requireRoom(roomId);
    requireSession(room, playerId, token);
    const game = requireActiveGame(room);

    room.game = requestRedeal(game, playerId);
    scheduleBotSteps(room);
    touchRoom(room);
    persistRoom(room);

    ack?.({ ok: true });
    void emitRoom(room);
  } catch (error) {
    ack?.(normalizeError(error));
  }
}

// --- Two player duel actions ---

function handleDiscard(payload: unknown, ack: Ack): void {
  try {
    const { roomId, playerId, cardIds, token } = discardSchema.parse(payload);
    const room = requireRoom(roomId);
    requireSession(room, playerId, token);
    const game = requireActiveGame(room);

    room.game = discardCards(game, playerId, cardIds);
    scheduleBotSteps(room);
    touchRoom(room);
    persistRoom(room);

    ack?.({ ok: true });
    void emitRoom(room);
  } catch (error) {
    ack?.(normalizeError(error));
  }
}

function handleDraw(payload: unknown, ack: Ack): void {
  try {
    const { roomId, playerId, token } = drawSchema.parse(payload);
    const room = requireRoom(roomId);
    requireSession(room, playerId, token);
    const game = requireActiveGame(room);

    room.game = drawCard(game, playerId);
    touchRoom(room);
    persistRoom(room);

    ack?.({ ok: true });
    void emitRoom(room);
  } catch (error) {
    ack?.(normalizeError(error));
  }
}

function handleResolveDraw(payload: unknown, ack: Ack): void {
  try {
    const { roomId, playerId, keep, token } = resolveDrawSchema.parse(payload);
    const room = requireRoom(roomId);
    requireSession(room, playerId, token);
    const game = requireActiveGame(room);

    room.game = resolveDraw(game, playerId, keep);
    scheduleBotSteps(room);
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
