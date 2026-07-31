import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { Bot, InlineKeyboard } from 'grammy';
import { Server } from 'socket.io';
import { z } from 'zod';
import { config } from './config.js';
import { autoAdvanceBots, createBot } from './game/bots.js';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  maybeStartGame,
  requireActiveGame,
  requireHost,
  requireLobby,
  requireSession,
} from './game/room-service.js';
import { HttpError, normalizeError } from './errors.js';
import {
  loadedRoomCount,
  persistRoom,
  randomCode,
  requireRoom,
  rooms,
  roomStore,
  touchRoom,
  uniqueRoomId,
} from './state.js';
import type { Identity, Room, RoomPlayer } from './types.js';
import { errorBody, localizeErrorCode } from './messages.js';
import { createPlayerToken, verifyPlayerSession, withoutToken } from './session.js';
import { telegramDisplayName, verifyInitData, type TelegramUser } from './telegram-auth.js';
import { RateLimiter } from './rate-limit.js';
import { sanitizeDisplayName } from './sanitize.js';
import {
  cleanupAction,
  evaluateReadiness,
  hasNoHumans,
  nextFreeSeat,
  pickNextHost,
} from './room-lifecycle.js';
import {
  chooseTrump,
  continueToNextHand,
  createGame,
  getValidCards,
  HokmError,
  playCard,
  toPublicView,
  type Card,
  type HokmGameState,
  type Seat,
  type Suit,
} from '@hokm/game-engine';

const {
  port,
  webAppUrl,
  publicApiUrl,
  webDistPath,
  shouldServeWebDist,
  corsOrigins,
  botToken,
  telegramAuthEnabled,
  maxRooms,
  cleanupPolicy,
  cleanupIntervalMs,
} = config;

const createRoomLimiter = new RateLimiter({ windowMs: 60_000, max: config.rateLimits.createPerMinute });
const lobbyLimiter = new RateLimiter({ windowMs: 60_000, max: config.rateLimits.actionsPerMinute });

console.log(
  `Hokm config: web=${webAppUrl} api=${publicApiUrl} db=${config.dbPath} loadedRooms=${loadedRoomCount}`,
);
console.log(
  telegramAuthEnabled
    ? 'Telegram auth: ENABLED (initData signatures are verified).'
    : 'Telegram auth: DISABLED (guest mode). Set TELEGRAM_BOT_TOKEN to verify real Telegram users.',
);

const app = express();
app.use(cors({ origin: corsOriginHandler, credentials: true }));
app.use(express.json({ limit: '32kb' }));
app.set('trust proxy', true);

/** Applies a limiter to a request, throwing a localized 429 when exceeded. */
function enforceLimit(limiter: RateLimiter, req: express.Request, res: express.Response): boolean {
  const key = clientKey(req);
  const verdict = limiter.check(key);
  if (verdict.allowed) return true;
  res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
  res.status(429).json(errorBody('RATE_LIMITED'));
  return false;
}

function clientKey(req: express.Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'hokm-api', now: new Date().toISOString() });
});

app.get('/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json(errorBody('ROOM_NOT_FOUND'));
  return res.json(sanitizeRoom(room));
});

app.post('/rooms', (req, res) => {
  if (!enforceLimit(createRoomLimiter, req, res)) return;
  if (rooms.size >= maxRooms) {
    runRoomCleanup();
    if (rooms.size >= maxRooms) return res.status(503).json(errorBody('TOO_MANY_ROOMS'));
  }
  const body = createRoomSchema.parse(req.body);
  const identity = authenticate(body.initData);
  const room = createRoom(sanitizeDisplayName(identity.name ?? body.hostName), identity.telegramId);
  persistRoom(room);
  const host = room.players[0];
  res.status(201).json({ ...sanitizeRoom(room), token: host?.token });
});

app.post('/rooms/:roomId/join', (req, res) => {
  if (!enforceLimit(lobbyLimiter, req, res)) return;
  const room = requireRoom(req.params.roomId);
  const body = joinRoomSchema.parse(req.body);
  const identity = authenticate(body.initData);
  const player = joinRoom(room, sanitizeDisplayName(identity.name ?? body.name), identity.telegramId);
  maybeStartGame(room);
  persistRoom(room);
  void emitRoom(room);
  res.json({ room: sanitizeRoom(room), player, token: player.token });
});

// Adds exactly one bot per call so the host can build a 1, 2 or 3 human table.
app.post('/rooms/:roomId/add-bot', (req, res) => {
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

app.post('/rooms/:roomId/remove-bot', (req, res) => {
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
app.post('/rooms/:roomId/ready', (req, res) => {
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

app.post('/rooms/:roomId/leave', (req, res) => {
  if (!enforceLimit(lobbyLimiter, req, res)) return;
  const room = requireRoom(req.params.roomId);
  const body = actorSchema.parse(req.body);
  requireSession(room, body.playerId, body.token);
  leaveRoom(room, body.playerId);
  persistRoom(room);
  void emitRoom(room);
  return res.json({ ok: true, room: sanitizeRoom(room) });
});

if (shouldServeWebDist) {
  if (existsSync(webDistPath)) {
    app.use((_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      next();
    });
    app.use(express.static(webDistPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  } else {
    console.warn(`SERVE_WEB_DIST=true but web dist was not found at ${webDistPath}. Run npm run build first.`);
  }
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
    return res.status(413).json(errorBody('PAYLOAD_TOO_LARGE'));
  }
  if (err instanceof z.ZodError) {
    return res.status(400).json({ ...errorBody('VALIDATION_ERROR'), details: err.flatten() });
  }
  if (err instanceof HokmError) return res.status(400).json(errorBody(err.code, err.message));
  if (err instanceof HttpError) return res.status(err.status).json(errorBody(err.code, err.message));
  console.error(err);
  return res.status(500).json(errorBody('INTERNAL_SERVER_ERROR'));
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: corsOriginHandler, credentials: true },
});

io.on('connection', (socket) => {
  socket.on('room:join', (payload: unknown, ack?: (response: unknown) => void) => {
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
  });

  socket.on('game:choose_trump', (payload: unknown, ack?: (response: unknown) => void) => {
    try {
      const { roomId, playerId, suit, token } = chooseTrumpSchema.parse(payload);
      const room = requireRoom(roomId);
      requireSession(room, playerId, token);
      requireActiveGame(room);
      room.game = chooseTrump(room.game!, playerId, suit);
      autoAdvanceBots(room);
      touchRoom(room);
      persistRoom(room);
      ack?.({ ok: true });
      void emitRoom(room);
    } catch (error) {
      ack?.(normalizeError(error));
    }
  });

  socket.on('game:play_card', (payload: unknown, ack?: (response: unknown) => void) => {
    try {
      const { roomId, playerId, cardId, token } = playCardSchema.parse(payload);
      const room = requireRoom(roomId);
      requireSession(room, playerId, token);
      requireActiveGame(room);
      room.game = playCard(room.game!, playerId, cardId);
      autoAdvanceBots(room);
      if (room.game.phase === 'game_complete') room.status = 'finished';
      touchRoom(room);
      persistRoom(room);
      ack?.({ ok: true });
      void emitRoom(room);
    } catch (error) {
      ack?.(normalizeError(error));
    }
  });

  socket.on('disconnect', () => {
    void handleSocketDisconnect(socket.id, socket.data.roomId, socket.data.playerId);
  });

  socket.on('game:next_hand', (payload: unknown, ack?: (response: unknown) => void) => {
    try {
      const { roomId, playerId, token } = nextHandSchema.parse(payload);
      const room = requireRoom(roomId);
      requireSession(room, playerId, token);
      requireActiveGame(room);
      room.game = continueToNextHand(room.game!);
      autoAdvanceBots(room);
      touchRoom(room);
      persistRoom(room);
      ack?.({ ok: true });
      void emitRoom(room);
    } catch (error) {
      ack?.(normalizeError(error));
    }
  });
});

httpServer.listen(port, () => {
  console.log(`Hokm API listening on http://localhost:${port}`);
});

runRoomCleanup();
setInterval(() => runRoomCleanup(), cleanupIntervalMs).unref();

// sql.js re-serialises the whole database on every save, so the process must
// not be killed mid-write. Close cleanly on the usual termination signals.
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down cleanly...`);

    const finish = () => {
      try {
        roomStore.close();
      } catch (error) {
        console.error('Failed to close the database cleanly.', error);
      }
      process.exit(0);
    };

    // Never hang forever if a socket refuses to close.
    const forceTimer = setTimeout(finish, 5000);
    forceTimer.unref();

    io.close(() => {
      httpServer.close(() => {
        clearTimeout(forceTimer);
        finish();
      });
    });
  });
}

// The bot is optional infrastructure: if Telegram is unreachable the game API
// must keep serving, so failures here are logged instead of crashing the process.
void startTelegramBot().catch((error) => {
  console.error('Telegram bot could not start; the API keeps running without it.', error);
});

async function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('TELEGRAM_BOT_TOKEN is empty; bot is disabled in local mode.');
    return;
  }

  const bot = new Bot(token);
  await bot.api.setMyCommands([
    { command: 'start', description: 'شروع و باز کردن مینی‌اپ حکم' },
    { command: 'newgame', description: 'ساخت میز جدید حکم' },
  ]);

  bot.command('start', async (ctx) => {
    const appUrl = buildWebAppUrl();
    await ctx.reply('به حکم خوش اومدی 👑\nاز دکمه زیر می‌تونی وارد مینی‌اپ بشی و میز بسازی یا به دوستات وصل شی.', {
      reply_markup: new InlineKeyboard().webApp('ورود به مینی‌اپ', appUrl),
    });
  });

  bot.command('newgame', async (ctx) => {
    const room = createRoom(ctx.from?.first_name ?? 'بازیکن', ctx.from?.id);
    const appUrl = buildWebAppUrl({ room: room.id });
    await ctx.reply(`میزت آماده‌ست: ${room.code}\nلینک ورود: ${appUrl}`, {
      reply_markup: new InlineKeyboard().webApp('باز کردن میز', appUrl),
    });
  });

  bot.catch((err) => console.error('Telegram bot error:', err));
  await bot.api.deleteWebhook({ drop_pending_updates: true });
  await bot.start();
}

/**
 * Marks a player offline when their last socket goes away.
 *
 * A reconnect can briefly overlap with the dying socket, and a player may also
 * have several tabs open, so we only flip `connected` to false when no other
 * live socket claims the same seat.
 */
async function handleSocketDisconnect(socketId: string, roomId: unknown, playerId: unknown): Promise<void> {
  if (typeof roomId !== 'string' || typeof playerId !== 'string') return;
  const room = rooms.get(roomId);
  if (!room) return;
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player || player.isBot) return;

  const sockets = await io.in(roomId).fetchSockets();
  const stillConnected = sockets.some(
    (other) => other.id !== socketId && other.data.playerId === playerId,
  );
  if (stillConnected || player.connected === false) return;

  player.connected = false;
  persistRoom(room);
  await emitRoom(room);
}

/**
 * Deletes expired rooms and abandons stalled games.
 * Runs once at boot (to clear anything accumulated while the server was down)
 * and then on a timer.
 */
function runRoomCleanup(now = Date.now()): { deleted: number; abandoned: number } {
  let deleted = 0;
  let abandoned = 0;
  for (const room of [...rooms.values()]) {
    const action = cleanupAction(room, now, cleanupPolicy);
    if (action === 'delete') {
      rooms.delete(room.id);
      roomStore.deleteRoom(room.id);
      deleted += 1;
    } else if (action === 'abandon' && room.status !== 'abandoned') {
      room.status = 'abandoned';
      touchRoom(room);
      persistRoom(room);
      abandoned += 1;
    }
  }
  if (deleted > 0 || abandoned > 0) {
    console.log(`Room cleanup: deleted=${deleted} abandoned=${abandoned} remaining=${rooms.size}`);
  }
  return { deleted, abandoned };
}

async function emitRoom(room: Room) {
  const sockets = await io.in(room.id).fetchSockets();
  for (const roomSocket of sockets) {
    const playerId = typeof roomSocket.data.playerId === 'string' ? roomSocket.data.playerId : undefined;
    roomSocket.emit('room:update', viewFor(room, playerId));
  }
}

function sanitizeRoom(room: Room) {
  const readiness = evaluateReadiness(room);
  return {
    ...room,
    readiness: {
      waitingOn: readiness.waitingOn,
      humanCount: readiness.humanCount,
      botCount: readiness.botCount,
      canStart: readiness.canStart,
    },
    players: room.players.map(withoutToken),
    game: room.game
      ? {
          phase: room.game.phase,
          hakemSeat: room.game.hakemSeat,
          currentTurnSeat: room.game.currentTurnSeat,
          trumpSuit: room.game.trumpSuit,
          currentTrick: room.game.currentTrick,
          handScore: room.game.handScore,
          matchScore: room.game.matchScore,
          roundNumber: room.game.roundNumber,
          lastEvent: room.game.lastEvent,
        }
      : undefined,
  };
}

function viewFor(room: Room, playerId?: string) {
  if (!room.game || !playerId) return sanitizeRoom(room);
  return {
    ...sanitizeRoom(room),
    game: {
      ...toPublicView(room.game, playerId),
      validCardIds: getValidCards(room.game, playerId).map((card: Card) => card.id),
    },
  };
}

/**
 * Verifies the caller owns the seat they claim.
 * Returns a freshly adopted token when the seat came from a pre-token snapshot.
 */
/**
 * Turns raw `initData` into a trusted identity.
 *
 * When Telegram auth is enabled the signature must verify, so a client can no
 * longer simply post someone else's telegramId to steal their seat.
 */
function authenticate(initData: string | undefined): Identity {
  if (!telegramAuthEnabled) return {};

  const result = verifyInitData(initData, botToken);
  if (!result.ok) {
    if (result.reason === 'MISSING_INIT_DATA') {
      throw new HttpError(401, 'TELEGRAM_AUTH_REQUIRED', localizeErrorCode('TELEGRAM_AUTH_REQUIRED'));
    }
    if (result.reason === 'EXPIRED_INIT_DATA') {
      throw new HttpError(401, 'TELEGRAM_AUTH_EXPIRED', localizeErrorCode('TELEGRAM_AUTH_EXPIRED'));
    }
    throw new HttpError(401, 'TELEGRAM_AUTH_FAILED', localizeErrorCode('TELEGRAM_AUTH_FAILED'));
  }
  return identityFromUser(result.user);
}

function identityFromUser(user: TelegramUser): Identity {
  const name = telegramDisplayName(user);
  return { telegramId: user.id, ...(name ? { name } : {}) };
}

function buildWebAppUrl(params: Record<string, string> = {}) {
  const url = new URL(webAppUrl);
  url.searchParams.set('api', publicApiUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function corsOriginHandler(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
  if (!origin || corsOrigins.includes('*') || corsOrigins.includes(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error(`Origin ${origin} is not allowed by CORS.`));
}

const createRoomSchema = z.object({ hostName: z.string().min(1).max(40).default('بازیکن'), initData: z.string().max(4096).optional() });
const joinRoomSchema = z.object({ name: z.string().min(1).max(40), initData: z.string().max(4096).optional() });
const socketJoinSchema = z.object({ roomId: z.string().min(1), playerId: z.string().min(1), token: z.string().min(1).optional() });
const suitSchema: z.ZodType<Suit> = z.enum(['spades', 'hearts', 'diamonds', 'clubs']);
const chooseTrumpSchema = z.object({ roomId: z.string().min(1), playerId: z.string().min(1), token: z.string().min(1).optional(), suit: suitSchema });
const playCardSchema = z.object({ roomId: z.string().min(1), playerId: z.string().min(1), token: z.string().min(1).optional(), cardId: z.string().min(1) });
const actorSchema = z.object({ playerId: z.string().min(1), token: z.string().min(1).optional() });
const removeBotSchema = actorSchema.extend({ botId: z.string().min(1) });
const readySchema = actorSchema.extend({ ready: z.boolean().default(true) });
const nextHandSchema = z.object({ roomId: z.string().min(1), playerId: z.string().min(1), token: z.string().min(1).optional() });
