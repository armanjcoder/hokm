import { Router, type Response } from 'express';
import { getModeConfig, type OptionalRules, type Seat } from '@hokm/game-engine';
import { authenticate } from '../auth.js';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { createBot } from '../game/bots.js';
import { DEFAULT_BOT_DIFFICULTY } from '../game/bot-ai.js';
import {
  createRoom,
  DEFAULT_ROOM_RULES,
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
import { withoutToken } from '../session.js';
import { fetchAvatar } from '../telegram/avatar-proxy.js';
import { createTelegramProxyAgent } from '../telegram/proxy.js';
import {
  actorSchema,
  addBotSchema,
  botDifficultySchema,
  createRoomSchema,
  joinRoomSchema,
  readySchema,
  removeBotSchema,
  settingsSchema,
} from '../schemas.js';
import { persistRoom, requireRoom, rooms, touchRoom } from '../state.js';
import { avatarLimiter, createRoomLimiter, enforceLimit, lobbyLimiter } from './middleware.js';

/** Applies only the rule flags a client actually sent. */
function mergeRules(
  base: OptionalRules,
  patch: { lowHandRedeal?: boolean | undefined; bam?: boolean | undefined } | undefined,
): OptionalRules {
  if (!patch) return base;
  return {
    ...base,
    ...(patch.lowHandRedeal !== undefined ? { lowHandRedeal: patch.lowHandRedeal } : {}),
    ...(patch.bam !== undefined ? { bam: patch.bam } : {}),
  };
}

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
    mergeRules(DEFAULT_ROOM_RULES, body.rules),
    identity.photoUrl,
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

  const player = joinRoom(
    room,
    sanitizeDisplayName(identity.name ?? body.name),
    identity.telegramId,
    identity.photoUrl,
  );
  maybeStartGame(room);
  persistRoom(room);
  void emitRoom(room);

  return res.json({ room: sanitizeRoom(room), player: withoutToken(player), token: player.token });
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
  if (body.rules !== undefined) room.rules = mergeRules(room.rules, body.rules);

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
  const body = addBotSchema.parse(req.body);
  requireHost(room, body.playerId, body.token);
  requireLobby(room);

  const seat = nextFreeSeat(room);
  if (seat === undefined) throw new HttpError(400, 'ROOM_FULL', localizeErrorCode('ROOM_FULL'));

  room.players.push(createBot(room, seat as Seat, body.difficulty ?? DEFAULT_BOT_DIFFICULTY));
  touchRoom(room);
  // Filling the last seat can be the event that completes readiness.
  const started = maybeStartGame(room);
  persistRoom(room);
  void emitRoom(room);

  return res.json({ ...sanitizeRoom(room), started });
});

// Each bot can play at its own level, so a table can mix easy and hard.
roomsRouter.post('/rooms/:roomId/bot-difficulty', (req, res) => {
  if (!enforceLimit(lobbyLimiter, req, res)) return;
  const room = requireRoom(req.params.roomId);
  const body = botDifficultySchema.parse(req.body);
  requireHost(room, body.playerId, body.token);
  requireLobby(room);

  const target = room.players.find((player) => player.id === body.botId);
  if (!target) throw new HttpError(404, 'BOT_NOT_FOUND', localizeErrorCode('BOT_NOT_FOUND'));
  if (!target.isBot) {
    throw new HttpError(400, 'CANNOT_REMOVE_HUMAN', localizeErrorCode('CANNOT_REMOVE_HUMAN'));
  }

  target.difficulty = body.difficulty;
  touchRoom(room);
  persistRoom(room);
  void emitRoom(room);
  return res.json(sanitizeRoom(room));
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

/**
 * Serves the caller's own Telegram profile photo, with no room involved.
 *
 * The room-scoped route below cannot help on the landing screen, where the
 * player has not joined a table yet but still wants to see who the game thinks
 * they are. Identity comes from the signed `initData`, exactly like every other
 * authenticated action.
 *
 * `initData` travels as a query parameter because the browser fetches this with
 * a plain `<img src>`, which cannot send a body or custom headers. That is a
 * real trade-off: the value ends up in the URL. It is mitigated by the fact
 * that `initData` is already short-lived (24h) and bound to the bot token, and
 * the response is marked private so no shared cache retains it.
 */
roomsRouter.get('/me/avatar', async (req, res, next) => {
  try {
    if (!enforceLimit(avatarLimiter, req, res)) return;

    const raw = req.query.initData;
    const identity = authenticate(typeof raw === 'string' ? raw : undefined);
    if (!identity.photoUrl) return res.status(404).json(errorBody('AVATAR_NOT_FOUND'));

    const image = await fetchAvatar(identity.photoUrl, createTelegramProxyAgent(config.telegramProxyUrl));
    if (!image) return res.status(404).json(errorBody('AVATAR_NOT_FOUND'));

    return sendAvatar(res, image);
  } catch (error) {
    return next(error);
  }
});

/**
 * Serves a seated player's Telegram profile photo.
 *
 * Fetched server-side rather than linked directly, because Telegram's photo CDN
 * is blocked on the same networks that block the Bot API — the existing
 * `TELEGRAM_PROXY_URL` is reused so the image arrives the same way bot traffic
 * does. Clients only ever see `/rooms/:roomId/players/:playerId/avatar`.
 *
 * Deliberately unauthenticated: the response is a public profile picture of
 * someone already sitting at this table, and requiring a session token would
 * make it impossible to render in a plain `<img>`. Only players of an existing
 * room can be addressed, so this cannot enumerate anything.
 */
roomsRouter.get('/rooms/:roomId/players/:playerId/avatar', async (req, res, next) => {
  try {
    if (!enforceLimit(avatarLimiter, req, res)) return;
    const room = rooms.get(req.params.roomId);
    const player = room?.players.find((candidate) => candidate.id === req.params.playerId);
    if (!player?.photoUrl) return res.status(404).json(errorBody('AVATAR_NOT_FOUND'));

    const image = await fetchAvatar(player.photoUrl, createTelegramProxyAgent(config.telegramProxyUrl));
    if (!image) return res.status(404).json(errorBody('AVATAR_NOT_FOUND'));

    return sendAvatar(res, image);
  } catch (error) {
    return next(error);
  }
});

/** Shared response shaping for both avatar routes. */
function sendAvatar(res: Response, image: { body: Buffer; contentType: string }) {
  // Avatars change rarely, and a stale one is harmless, so let the client keep
  // it: re-fetching through a censored network on every render is expensive.
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Type', image.contentType);
  res.setHeader('Content-Length', String(image.body.length));
  // The bytes are an image no matter what the CDN said; stop a sniffed type.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(image.body);
}
