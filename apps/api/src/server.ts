import 'dotenv/config';
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

const port = Number(process.env.PORT ?? 4000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shouldServeWebDist = process.env.SERVE_WEB_DIST === 'true';
const webDistPath = path.resolve(__dirname, '../../web/dist');
const defaultPublicUrl = `http://localhost:${port}`;
const webAppUrl = process.env.WEB_APP_URL ?? defaultPublicUrl;
const publicApiUrl = process.env.PUBLIC_API_URL ?? webAppUrl;
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN ?? webAppUrl);
const roomStore = await SqliteRoomStore.open(process.env.DB_PATH ?? './data/hokm.sqlite');

interface RoomPlayer {
  id: string;
  name: string;
  telegramId?: number;
  seat: Seat;
  connected: boolean;
  isBot?: boolean;
}

interface Room {
  id: string;
  code: string;
  status: 'lobby' | 'playing' | 'finished';
  createdAt: string;
  players: RoomPlayer[];
  game?: HokmGameState;
}

const rooms = new Map<string, Room>(
  roomStore.loadRooms<Room>().map((room) => [room.id, normalizeLoadedRoom(room)]),
);

const app = express();
app.use(cors({ origin: corsOriginHandler, credentials: true }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'hokm-api', now: new Date().toISOString() });
});

app.get('/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'ROOM_NOT_FOUND' });
  return res.json(sanitizeRoom(room));
});

app.post('/rooms', (req, res) => {
  const body = createRoomSchema.parse(req.body);
  const room = createRoom(body.hostName, body.telegramId);
  persistRoom(room);
  res.status(201).json(sanitizeRoom(room));
});

app.post('/rooms/:roomId/join', (req, res) => {
  const room = requireRoom(req.params.roomId);
  const body = joinRoomSchema.parse(req.body);
  const player = joinRoom(room, body.name, body.telegramId);
  persistRoom(room);
  void emitRoom(room);
  res.json({ room: sanitizeRoom(room), player });
});

app.post('/rooms/:roomId/add-bots', (req, res) => {
  const room = requireRoom(req.params.roomId);
  addTestBots(room);
  persistRoom(room);
  void emitRoom(room);
  return res.json(sanitizeRoom(room));
});

app.post('/rooms/:roomId/start', (req, res) => {
  const room = requireRoom(req.params.roomId);
  if (room.players.length !== 4) {
    return res.status(400).json({ error: 'ROOM_NOT_FULL' });
  }
  room.game = createGame(room.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })), { id: room.id, targetScore: 7 });
  room.status = 'playing';
  autoAdvanceBots(room);
  persistRoom(room);
  void emitRoom(room);
  return res.json(sanitizeRoom(room));
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
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'VALIDATION_ERROR', details: err.flatten() });
  if (err instanceof HokmError) return res.status(400).json({ error: err.code, message: err.message });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
  console.error(err);
  return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: corsOriginHandler, credentials: true },
});

io.on('connection', (socket) => {
  socket.on('room:join', (payload: unknown, ack?: (response: unknown) => void) => {
    try {
      const { roomId, playerId } = socketJoinSchema.parse(payload);
      const room = requireRoom(roomId);
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.playerId = playerId;
      const player = room.players.find((p) => p.id === playerId);
      if (player) player.connected = true;
      ack?.({ ok: true, room: viewFor(room, playerId) });
      void emitRoom(room);
    } catch (error) {
      ack?.(normalizeError(error));
    }
  });

  socket.on('game:choose_trump', (payload: unknown, ack?: (response: unknown) => void) => {
    try {
      const { roomId, playerId, suit } = chooseTrumpSchema.parse(payload);
      const room = requireRoom(roomId);
      if (!room.game) throw new HttpError(400, 'GAME_NOT_STARTED', 'Game is not started.');
      room.game = chooseTrump(room.game, playerId, suit);
      autoAdvanceBots(room);
      persistRoom(room);
      ack?.({ ok: true });
      void emitRoom(room);
    } catch (error) {
      ack?.(normalizeError(error));
    }
  });

  socket.on('game:play_card', (payload: unknown, ack?: (response: unknown) => void) => {
    try {
      const { roomId, playerId, cardId } = playCardSchema.parse(payload);
      const room = requireRoom(roomId);
      if (!room.game) throw new HttpError(400, 'GAME_NOT_STARTED', 'Game is not started.');
      room.game = playCard(room.game, playerId, cardId);
      autoAdvanceBots(room);
      if (room.game.phase === 'game_complete') room.status = 'finished';
      persistRoom(room);
      ack?.({ ok: true });
      void emitRoom(room);
    } catch (error) {
      ack?.(normalizeError(error));
    }
  });

  socket.on('game:next_hand', (payload: unknown, ack?: (response: unknown) => void) => {
    try {
      const { roomId } = nextHandSchema.parse(payload);
      const room = requireRoom(roomId);
      if (!room.game) throw new HttpError(400, 'GAME_NOT_STARTED', 'Game is not started.');
      room.game = continueToNextHand(room.game);
      autoAdvanceBots(room);
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

void startTelegramBot();

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

function persistRoom(room: Room): void {
  roomStore.saveRoom(room);
}

function normalizeLoadedRoom(room: Room): Room {
  return {
    ...room,
    players: room.players.map((player) => ({
      ...player,
      connected: player.isBot ? true : false,
    })),
  };
}

function createRoom(hostName: string, telegramId?: number): Room {
  const id = randomCode(10).toLowerCase();
  const room: Room = {
    id,
    code: randomCode(5),
    status: 'lobby',
    createdAt: new Date().toISOString(),
    players: [{ id: randomCode(12), name: hostName, seat: 0, connected: false, ...(telegramId !== undefined ? { telegramId } : {}) }],
  };
  rooms.set(room.id, room);
  persistRoom(room);
  return room;
}

function joinRoom(room: Room, name: string, telegramId?: number): RoomPlayer {
  if (room.status !== 'lobby') throw new HttpError(400, 'ROOM_ALREADY_STARTED', 'Room has already started.');
  if (room.players.length >= 4) throw new HttpError(400, 'ROOM_FULL', 'Room is full.');
  const existing = telegramId ? room.players.find((p) => p.telegramId === telegramId) : undefined;
  if (existing) return existing;
  const takenSeats = new Set(room.players.map((p) => p.seat));
  const seat = ([0, 1, 2, 3] as Seat[]).find((s) => !takenSeats.has(s));
  if (seat === undefined) throw new HttpError(400, 'ROOM_FULL', 'Room is full.');
  const player: RoomPlayer = { id: randomCode(12), name, seat, connected: false, ...(telegramId !== undefined ? { telegramId } : {}) };
  room.players.push(player);
  return player;
}

function addTestBots(room: Room): void {
  if (room.status !== 'lobby') throw new HttpError(400, 'ROOM_ALREADY_STARTED', 'Room has already started.');
  const botNames = ['ربات نیکا', 'ربات آرش', 'ربات سارا'];
  let botIndex = room.players.filter((player) => player.isBot).length;
  while (room.players.length < 4) {
    const takenSeats = new Set(room.players.map((player) => player.seat));
    const seat = ([0, 1, 2, 3] as Seat[]).find((candidate) => !takenSeats.has(candidate));
    if (seat === undefined) return;
    room.players.push({
      id: `bot_${randomCode(10).toLowerCase()}`,
      name: botNames[botIndex % botNames.length] ?? `ربات ${botIndex + 1}`,
      seat,
      connected: true,
      isBot: true,
    });
    botIndex += 1;
  }
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
  return {
    ...room,
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

function requireRoom(roomId: string): Room {
  const room = rooms.get(roomId);
  if (!room) throw new HttpError(404, 'ROOM_NOT_FOUND', 'Room was not found.');
  return room;
}

function randomCode(length: number) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function normalizeError(error: unknown) {
  if (error instanceof z.ZodError) return { ok: false, error: 'VALIDATION_ERROR', details: error.flatten() };
  if (error instanceof HokmError) return { ok: false, error: error.code, message: error.message };
  if (error instanceof HttpError) return { ok: false, error: error.code, message: error.message };
  console.error(error);
  return { ok: false, error: 'INTERNAL_SERVER_ERROR' };
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

function corsOriginHandler(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
  if (!origin || corsOrigins.includes('*') || corsOrigins.includes(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error(`Origin ${origin} is not allowed by CORS.`));
}

const createRoomSchema = z.object({ hostName: z.string().min(1).max(40).default('بازیکن'), telegramId: z.number().optional() });
const joinRoomSchema = z.object({ name: z.string().min(1).max(40), telegramId: z.number().optional() });
const socketJoinSchema = z.object({ roomId: z.string().min(1), playerId: z.string().min(1) });
const suitSchema: z.ZodType<Suit> = z.enum(['spades', 'hearts', 'diamonds', 'clubs']);
const chooseTrumpSchema = z.object({ roomId: z.string().min(1), playerId: z.string().min(1), suit: suitSchema });
const playCardSchema = z.object({ roomId: z.string().min(1), playerId: z.string().min(1), cardId: z.string().min(1) });
const nextHandSchema = z.object({ roomId: z.string().min(1) });
