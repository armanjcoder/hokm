import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CleanupPolicy } from './room-lifecycle.js';

/**
 * Single place where environment variables are read and validated.
 *
 * Everything else imports the resolved values, so there is exactly one answer
 * to "where does this setting come from?".
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Repository path of `apps/api`, used to resolve `.env` and the database. */
export const apiRoot = path.resolve(moduleDir, '..');

loadEnv({ path: path.join(apiRoot, '.env') });

const port = Number(process.env.PORT ?? 4000);
const defaultPublicUrl = `http://localhost:${port}`;
const webAppUrl = normalizeEnvUrl(process.env.WEB_APP_URL ?? defaultPublicUrl);
const publicApiUrl = normalizeEnvUrl(process.env.PUBLIC_API_URL ?? webAppUrl);
const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';

const minCleanupIntervalMs = Number(process.env.ROOM_CLEANUP_MIN_INTERVAL_MS ?? 60_000);

export const config = {
  port,
  apiRoot,
  webAppUrl,
  publicApiUrl,
  webDistPath: path.resolve(apiRoot, '../web/dist'),
  shouldServeWebDist: process.env.SERVE_WEB_DIST === 'true',
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGIN ?? webAppUrl).map(normalizeEnvUrl),
  dbPath: resolveFromApiRoot(process.env.DB_PATH ?? './data/hokm.sqlite'),
  botToken,
  /**
   * Telegram identities are only trusted when we hold a bot token to verify
   * them with. Without one (pure local development) we fall back to guests.
   */
  telegramAuthEnabled: botToken !== '' && process.env.ALLOW_UNVERIFIED_TELEGRAM !== 'true',
  maxRooms: positiveNumber(process.env.MAX_ROOMS, 500),
  rateLimits: {
    createPerMinute: positiveNumber(process.env.RATE_LIMIT_CREATE_PER_MIN, 6),
    actionsPerMinute: positiveNumber(process.env.RATE_LIMIT_ACTIONS_PER_MIN, 60),
  },
  cleanupPolicy: {
    lobbyIdleMs: hoursToMs(process.env.ROOM_LOBBY_TTL_HOURS, 6),
    playingIdleMs: hoursToMs(process.env.ROOM_PLAYING_TTL_HOURS, 12),
    finishedIdleMs: hoursToMs(process.env.ROOM_FINISHED_TTL_HOURS, 24),
  } satisfies CleanupPolicy,
  /** Floor keeps the job cheap in production; tests may opt into a faster tick. */
  cleanupIntervalMs: Math.max(
    Number.isFinite(minCleanupIntervalMs) && minCleanupIntervalMs > 0 ? minCleanupIntervalMs : 60_000,
    hoursToMs(process.env.ROOM_CLEANUP_INTERVAL_HOURS, 1),
  ),
} as const;

/**
 * Accepts a raw URL or one pasted inside markdown brackets, which is an easy
 * mistake to make when copying a tunnel link into `.env`.
 */
export function normalizeEnvUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, '');
  const markdownUrl = trimmed.match(/https?:\/\/[^)\]\s]+/);
  return markdownUrl?.[0]?.replace(/\/$/, '') ?? trimmed;
}

function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function resolveFromApiRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(apiRoot, value);
}

function hoursToMs(value: string | undefined, fallbackHours: number): number {
  const hours = Number(value);
  return (Number.isFinite(hours) && hours > 0 ? hours : fallbackHours) * 60 * 60 * 1000;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
