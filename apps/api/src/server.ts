import { config as loadEnv } from 'dotenv';
import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot, InlineKeyboard } from 'grammy';
import { Server } from 'socket.io';
import { z } from 'zod';
import { SqliteRoomStore } from './storage.js';
import { errorBody, localizeErrorCode } from './messages.js';
import { createPlayerToken, verifyPlayerSession, withoutToken } from './session.js';
import { telegramDisplayName, verifyInitData, type TelegramUser } from './telegram-auth.js';
import {
  cleanupAction,
  evaluateReadiness,
  hasNoHumans,
  nextFreeSeat,
  pickNextHost,
  REQUIRED_PLAYERS,
  type CleanupPolicy,
  type RoomStatus,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
loadEnv({ path: path.join(apiRoot, '.env') });

const port = Number(process.env.PORT ?? 4000);
const shouldServeWebDist = process.env.SERVE_WEB_DIST === 'true';
const webDistPath = path.resolve(apiRoot, '../web/dist');
const defaultPublicUrl = `http://localhost:${port}`;
const webAppUrl = normalizeEnvUrl(process.env.WEB_APP_URL ?? defaultPublicUrl);
const publicApiUrl = normalizeEnvUrl(process.env.PUBLIC_API_URL ?? webAppUrl);
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN ?? webAppUrl).map(normalizeEnvUrl);
const dbPath = resolveFromApiRoot(process.env.DB_PATH ?? './data/hokm.sqlite');
const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
// Telegram identities are only trusted when we hold a bot token to verify them
// with. Without one (pure local development) we fall back to guest players.
const telegramAuthEnabled = botToken !== '' && process.env.ALLOW_UNVERIFIED_TELEGRAM !== 'true';
const cleanupPolicy: CleanupPolicy = {
  lobbyIdleMs: hoursToMs(process.env.ROOM_LOBBY_TTL_HOURS, 6),
  playingIdleMs: hoursToMs(process.env.ROOM_PLAYING_TTL_HOURS, 12),
  finishedIdleMs: hoursToMs(process.env.ROOM_FINISHED_TTL_HOURS, 24),
};
// Floor keeps the job cheap in production; tests may opt into a faster tick.
const minCleanupIntervalMs = Number(process.env.ROOM_CLEANUP_MIN_INTERVAL_MS ?? 60_000);
const cleanupIntervalMs = Math.max(
  Number.isFinite(minCleanupIntervalMs) && minCleanupIntervalMs > 0 ? minCleanupIntervalMs : 60_000,
  hoursToMs(process.env.ROOM_CLEANUP_INTERVAL_HOURS, 1),
);
const roomStore = await SqliteRoomStore.open(dbPath);

interface RoomPlayer {
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

interface Room {
  id: string;
  code: string;
  status: RoomStatus;
  createdAt: string;
  lastActivityAt?: string;
  hostPlayerId?: string;
  players: RoomPlayer[];
  game?: HokmGameState;
}

const loadedRooms = roomStore.loadRooms<Room>().map(normalizeLoadedRoom);
const rooms = new Map<string, Room>(loadedRooms.map((room) => [room.id, room]));

console.log(`Hokm config: web=${webAppUrl} api=${publicApiUrl} db=${dbPath} loadedRooms=${loadedRooms.length}`);
console.log(
  telegramAuthEnabled
    ? 'Telegram auth: ENABLED (initData signatures are verified).'
    : 'Telegram auth: DISABLED (guest mode). Set TELEGRAM_BOT_TOKEN to verify real Telegram users.',
);

const app = express();
app.use(cors({ origin: corsOriginHandler, credentials: true }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'hokm-api', now: new Date().toISOString() });
});

app.get('/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json(errorBody('ROOM_NOT_FOUND'));
  return res.json(sanitizeRoom(room));
});

app.post('/rooms', (req, res) => {
  const body = createRoomSchema.parse(req.body);
  const identity = authenticate(body.initData);
  const room = createRoom(identity.name ?? body.hostName, identity.telegramId);
  persistRoom(room);
  const host = room.players[0];
  res.status(201).json({ ...sanitizeRoom(room), token: host?.token });
});

app.post('/rooms/:roomId/join', (req, res) => {
  const room = requireRoom(req.params.roomId);
  const body = joinRoomSchema.parse(req.body);
  const identity = authenticate(body.initData);
  const player = joinRoom(room, identity.name ?? body.name, identity.telegramId);
  maybeStartGame(room);
  persistRoom(room);
  void emitRoom(room);
  res.json({ room: sanitizeRoom(room), player, token: player.token });
});

// Adds exactly one bot per call so the host can build a 1, 2 or 3 human table.
app.post('/rooms/:roomId/add-bot', (req, res) => {
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

function hoursToMs(value: string | undefined, fallbackHours: number): number {
  const hours = Number(value);
  return (Number.isFinite(hours) && hours > 0 ? hours : fallbackHours) * 60 * 60 * 1000;
}

function persistRoom(room: Room): void {
  roomStore.saveRoom(room);
}

/** Backfills fields added after older snapshots were written. */
function normalizeLoadedRoom(room: Room): Room {
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
    players,
    lastActivityAt: room.lastActivityAt ?? room.createdAt,
    ...(hostPlayerId !== undefined ? { hostPlayerId } : {}),
  };
}

function createRoom(hostName: string, telegramId?: number): Room {
  const id = randomCode(10).toLowerCase();
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
    id,
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

function joinRoom(room: Room, name: string, telegramId?: number): RoomPlayer {
  if (room.status === 'abandoned') {
    throw new HttpError(400, 'ROOM_ABANDONED', localizeErrorCode('ROOM_ABANDONED'));
  }
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
  if (room.status !== 'lobby') throw new HttpError(400, 'ROOM_ALREADY_STARTED', localizeErrorCode('ROOM_ALREADY_STARTED'));
  if (room.players.length >= 4) throw new HttpError(400, 'ROOM_FULL', localizeErrorCode('ROOM_FULL'));
  const takenSeats = new Set(room.players.map((p) => p.seat));
  const seat = ([0, 1, 2, 3] as Seat[]).find((s) => !takenSeats.has(s));
  if (seat === undefined) throw new HttpError(400, 'ROOM_FULL', localizeErrorCode('ROOM_FULL'));
  const player: RoomPlayer = { id: randomCode(12), token: createPlayerToken(), name, seat, connected: false, ready: false, ...(telegramId !== undefined ? { telegramId } : {}) };
  room.players.push(player);
  return player;
}

const BOT_NAMES = ['ربات نیکا', 'ربات آرش', 'ربات سارا'];

function createBot(room: Room, seat: Seat): RoomPlayer {
  const used = new Set(room.players.filter((p) => p.isBot).map((p) => p.name));
  const name = BOT_NAMES.find((candidate) => !used.has(candidate)) ?? `ربات ${used.size + 1}`;
  return {
    id: `bot_${randomCode(10).toLowerCase()}`,
    name,
    seat,
    connected: true,
    ready: true,
    isBot: true,
  };
}

/** Gameplay is impossible once a table has been abandoned. */
function requireActiveGame(room: Room): HokmGameState {
  if (room.status === 'abandoned') {
    throw new HttpError(400, 'ROOM_ABANDONED', localizeErrorCode('ROOM_ABANDONED'));
  }
  if (!room.game) {
    throw new HttpError(400, 'GAME_NOT_STARTED', localizeErrorCode('GAME_NOT_STARTED'));
  }
  return room.game;
}

function requireLobby(room: Room): void {
  if (room.status === 'abandoned') {
    throw new HttpError(400, 'ROOM_ABANDONED', localizeErrorCode('ROOM_ABANDONED'));
  }
  if (room.status !== 'lobby') {
    throw new HttpError(400, 'ROOM_ALREADY_STARTED', localizeErrorCode('ROOM_ALREADY_STARTED'));
  }
}

/** Verifies the caller is the host, on top of the normal session check. */
function requireHost(room: Room, playerId: string, token: string | undefined): void {
  requireSession(room, playerId, token);
  if (room.hostPlayerId !== playerId) {
    throw new HttpError(403, 'NOT_HOST', localizeErrorCode('NOT_HOST'));
  }
}

function touchRoom(room: Room): void {
  room.lastActivityAt = new Date().toISOString();
}

/** Starts the game when the table is full and every human pressed ready. */
function maybeStartGame(room: Room): boolean {
  if (!evaluateReadiness(room).canStart) return false;
  room.game = createGame(
    room.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
    { id: room.id, targetScore: 7 },
  );
  room.status = 'playing';
  autoAdvanceBots(room);
  touchRoom(room);
  return true;
}

/**
 * Removes a player from a lobby, or marks them gone mid-game.
 *
 * Mid-game the seat is kept on purpose: the engine state is indexed by seat, so
 * deleting a player would corrupt hands and scores. The player can come back.
 */
function leaveRoom(room: Room, playerId: string): void {
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new HttpError(404, 'PLAYER_NOT_FOUND', localizeErrorCode('PLAYER_NOT_FOUND'));

  if (room.status === 'lobby') {
    room.players = room.players.filter((candidate) => candidate.id !== playerId);
  } else {
    player.connected = false;
    player.ready = false;
  }

  if (room.hostPlayerId === playerId) {
    const nextHost = pickNextHost(room, playerId);
    if (nextHost) room.hostPlayerId = nextHost;
  }

  if (hasNoHumans(room)) {
    room.status = room.status === 'playing' ? 'abandoned' : room.status;
    if (room.status === 'lobby') room.status = 'abandoned';
  }

  touchRoom(room);
}

function autoAdvanceBots(room: Room): void {
  if (!room.game) return;
  for (let guard = 0; guard < 80; guard += 1) {
    if (!room.game || room.game.phase === 'game_complete') {
      room.status = 'finished';
      return;
    }
    if (room.game.phase === 'hand_complete') return;

    const bot = room.players.find((player) => player.isBot && player.seat === room.game?.currentTurnSeat);
    if (!bot) return;

    if (room.game.phase === 'waiting_for_trump') {
      room.game = chooseTrump(room.game, bot.id, chooseBotTrump(room.game, bot.seat));
      continue;
    }

    if (room.game.phase !== 'playing') return;
    const validCards = getValidCards(room.game, bot.id);
    const card = chooseBotCard(validCards);
    if (!card) return;
    room.game = playCard(room.game, bot.id, card.id);
  }
}

function chooseBotTrump(game: HokmGameState, seat: Seat): Suit {
  const suitScores: Record<Suit, number> = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
  for (const card of game.hands[seat]) {
    suitScores[card.suit] += 10 + botRankValue(card);
  }
  return (Object.entries(suitScores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'spades') as Suit;
}

function chooseBotCard(cards: Card[]): Card | undefined {
  return [...cards].sort((a, b) => botRankValue(a) - botRankValue(b))[0];
}

function botRankValue(card: Card): number {
  const values: Record<Card['rank'], number> = { A: 14, K: 13, Q: 12, J: 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };
  return values[card.rank];
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
interface Identity {
  telegramId?: number;
  name?: string;
}

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

function requireSession(room: Room, playerId: string, token: string | undefined): string | undefined {
  const result = verifyPlayerSession(room.players, playerId, token);
  if (!result.ok) {
    const status = result.code === 'PLAYER_NOT_FOUND' ? 404 : 403;
    throw new HttpError(status, result.code, localizeErrorCode(result.code));
  }
  if (result.adoptedToken) persistRoom(room);
  return result.adoptedToken;
}

function requireRoom(roomId: string): Room {
  const room = rooms.get(roomId);
  if (!room) throw new HttpError(404, 'ROOM_NOT_FOUND', localizeErrorCode('ROOM_NOT_FOUND'));
  return room;
}

function randomCode(length: number) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function normalizeError(error: unknown) {
  if (error instanceof z.ZodError) {
    return { ok: false as const, ...errorBody('VALIDATION_ERROR'), details: error.flatten() };
  }
  if (error instanceof HokmError) return { ok: false as const, ...errorBody(error.code, error.message) };
  if (error instanceof HttpError) return { ok: false as const, ...errorBody(error.code, error.message) };
  console.error(error);
  return { ok: false as const, ...errorBody('INTERNAL_SERVER_ERROR') };
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function buildWebAppUrl(params: Record<string, string> = {}) {
  const url = new URL(webAppUrl);
  url.searchParams.set('api', publicApiUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function parseCorsOrigins(value: string) {
  return value.split(',').map((origin) => origin.trim()).filter(Boolean);
}

function normalizeEnvUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, '');
  const markdownUrl = trimmed.match(/https?:\/\/[^)\]\s]+/);
  return markdownUrl?.[0]?.replace(/\/$/, '') ?? trimmed;
}

function resolveFromApiRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(apiRoot, value);
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
