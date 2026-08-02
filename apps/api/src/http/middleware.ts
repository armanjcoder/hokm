import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { HokmError } from '@hokm/game-engine';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { errorBody } from '../messages.js';
import { RateLimiter } from '../rate-limit.js';

/** Cross-cutting HTTP concerns: CORS, rate limiting and error shaping. */

export const createRoomLimiter = new RateLimiter({
  windowMs: 60_000,
  max: config.rateLimits.createPerMinute,
});

export const lobbyLimiter = new RateLimiter({
  windowMs: 60_000,
  max: config.rateLimits.actionsPerMinute,
});

/**
 * Separate budget for profile photos.
 *
 * Avatars are fetched by the browser, not by the player: one table view asks
 * for up to four at once. Sharing the lobby budget would mean simply looking at
 * a full table could rate-limit your own ready button, which is absurd. The
 * allowance is generous because responses are cached both in the server and by
 * the browser, so a well-behaved client asks once an hour.
 */
export const avatarLimiter = new RateLimiter({
  windowMs: 60_000,
  max: Math.max(60, config.rateLimits.actionsPerMinute * 4),
});

export function corsOriginHandler(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error(`Origin ${origin} is not allowed by CORS.`));
}

/** Applies a limiter to a request, replying with a localized 429 when exceeded. */
export function enforceLimit(limiter: RateLimiter, req: Request, res: Response): boolean {
  const verdict = limiter.check(clientKey(req));
  if (verdict.allowed) return true;
  res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
  res.status(429).json(errorBody('RATE_LIMITED'));
  return false;
}

function clientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** Final error handler: every failure leaves as a code plus a Persian message. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
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
}
