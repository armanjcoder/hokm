import { Router } from 'express';
import { getModeConfig, type Seat } from '@hokm/game-engine';
import { authenticate } from '../auth.js';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { createBot } from '../game/bots.js';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  maybeStartGame,
  requireHost,
  requireLobby,
  requireSession,
} from '../game/room-service.js';
import { sanitizeRoom } from '../game/views.js';
import { runRoomCleanup } from '../jobs/cleanup.js';
import { errorBody, localizeErrorCode } from '../messages.js';
import { emitRoom } from '../realtime/broadcast.js';
import { nextFreeSeat } from '../room-lifecycle.js';
import { sanitizeDisplayName } from '../sanitize.js';
import {
  actorSchema,
  createRoomSchema,
  joinRoomSchema,
  readySchema,
  removeBotSchema,
  settingsSchema,
} from '../schemas.js';
import { persistRoom, requireRoom, rooms, touchRoom } from '../state.js';
import { createRoomLimiter, enforceLimit, lobbyLimiter } from './middleware.js';

export const roomsRouter: Router = Router();

roomsRouter.get('/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json(errorBody('ROOM_NOT_FOUND'));
  return res.json(sanitizeRoom(room));
});

roomsRouter.post('/rooms', (req, res) => {
  if (!enforceLimit(createRoomLimiter, req, res)) return;
  if (rooms.size >= config.maxRooms) {
    runRoomCleanup();
    if (rooms.size >= config.maxRooms) return res.status(503).json(errorBody('TOO_MANY_ROOMS'));
  }

  const body = createRoomSchema.parse(req.body);
  const identity = authenticate(body.initData);
  const room = createRoom(
    sanitizeDisplayName(identity.name ?? body.hostName),
    identity.telegramId,
    body.mode,
    body.targetScore,
  );
  persistRoom(room);

  const host = room.players[0];
  return res.status(201).json({ ...sanitizeRoom(room), token: host?.token });
});

roomsRouter.post('/rooms/:roomId/join', (req, res) => {
  if (!enforceLimit(lobbyLimiter, req, res)) return;
  const room = requireRoom(req.params.roomId);
  const body = joinRoomSchema.parse(req.body);
  const identity = authenticate(body.initData);

  const player = joinRoom(room, sanitizeDisplayName(identity.name ?? body.name), identity.telegramId);
  maybeStartGame(room);
  persistRoom(room);
  void emitRoom(room);

  return res.json({ room: sanitizeRoom(room), player, token: player.token });
});

// Host-only table settings. Changing the mode resizes the table, so any bots
// that no longer fit are dropped and everyone must confirm readiness again.
roomsRouter.post('/rooms/:roomId/settings', (req, res) => {
  if (!enforceLimit(lobbyLimiter, req, res)) return;
  const room = requireRoom(req.params.roomId);
  const body = settingsSchema.parse(req.body);
  requireHost(room, body.playerId, body.token);
  requireLobby(room);

  if (body.targetScore !== undefined) room.targetScore = body.targetScore;

  if (body.mode !== undefined && body.mode !== room.mode) {
    room.mode = body.mode;
    const seats = getModeConfig(room.mode).seats;

    // Keep humans (they chose to be here) and trim bots that no longer fit.
    const humans = room.players.filter((player) => !player.isBot);
    if (humans.length > seats) {
      throw new HttpError(400, 'TOO_MANY_PLAYERS', localizeErrorCode('TOO_MANY_PLAYERS'));
    }
    const bots = room.players.filter((player) => player.isBot).slice(0, seats - humans.length);
    room.players = [...humans, ...bots].map((player, index) => ({
      ...player,
      seat: index as Seat,
      // Changing the rules invalidates earlier consent to start.
      ready: player.isBot ? true : false,
    }));
  }

  touchRoom(room);
  const started = maybeStartGame(room);
  persistRoom(room);
  void emitRoom(room);
  return res.json({ ...sanitizeRoom(room), started });
});

// Adds exactly one bot per call so the host can build a 1, 2 or 3 human table.
roomsRouter.post('/rooms/:roomId/add-bot', (req, res) => {
  if (!enforceLimit(lobbyLimiter, req, res)) return;
  const room = requireRoom(req.params.roomId);
  const body = actorSchema.parse(req.body);
  requireHost(room, body.playerId, body.token);
  requireLobby(room);

  const seat = nextFreeSeat(room);
  if (seat === undefined) throw new HttpError(400, 'ROOM_FULL', localizeErrorCode('ROOM_FULL'));

  room.players.push(createBot(room, seat as Seat));
  touchRoom(room);
  // Filling the last seat can be the event that completes readiness.
  const started = maybeStartGame(room);
  persistRoom(room);
  void emitRoom(room);

  return res.json({ ...sanitizeRoom(room), started });
});

roomsRouter.post('/rooms/:roomId/remove-bot', (req, res) => {
  if (!enforceLimit(lobbyLimiter, req, res)) return;
  const room = requireRoom(req.params.roomId);
  const body = removeBotSchema.parse(req.body);
  requireHost(room, body.playerId, body.token);
  requireLobby(room);

  const target = room.players.find((player) => player.id === body.botId);
  if (!target) throw new HttpError(404, 'BOT_NOT_FOUND', localizeErrorCode('BOT_NOT_FOUND'));
  if (!target.isBot) {
    throw new HttpError(400, 'CANNOT_REMOVE_HUMAN', localizeErrorCode('CANNOT_REMOVE_HUMAN'));
  }

  room.players = room.players.filter((player) => player.id !== body.botId);
  touchRoom(room);
  persistRoom(room);
  void emitRoom(room);

  return res.json(sanitizeRoom(room));
});

// Any seated human can toggle their own readiness; the game auto-starts once
// the table is full and every human is ready.
roomsRouter.post('/rooms/:roomId/ready', (req, res) => {
  if (!enforceLimit(lobbyLimiter, req, res)) return;
  const room = requireRoom(req.params.roomId);
  const body = readySchema.parse(req.body);
  requireSession(room, body.playerId, body.token);
  requireLobby(room);

  const player = room.players.find((candidate) => candidate.id === body.playerId);
  if (!player) throw new HttpError(404, 'PLAYER_NOT_FOUND', localizeErrorCode('PLAYER_NOT_FOUND'));
  player.ready = body.ready;
  touchRoom(room);

  const started = maybeStartGame(room);
  persistRoom(room);
  void emitRoom(room);

  return res.json({ ...sanitizeRoom(room), started });
});

roomsRouter.post('/rooms/:roomId/leave', (req, res) => {
  if (!enforceLimit(lobbyLimiter, req, res)) return;
  const room = requireRoom(req.params.roomId);
  const body = actorSchema.parse(req.body);
  requireSession(room, body.playerId, body.token);

  leaveRoom(room, body.playerId);
  persistRoom(room);
  void emitRoom(room);

  return res.json({ ok: true, room: sanitizeRoom(room) });
});
