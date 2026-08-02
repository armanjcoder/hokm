import { z } from 'zod';
import { HokmError } from '@hokm/game-engine';
import { errorBody } from './messages.js';

/** An error that carries the HTTP status the client should receive. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Converts any thrown value into a Socket.IO acknowledgement payload with a
 * machine-readable code and a Persian message.
 */
export function normalizeError(error: unknown) {
  if (error instanceof z.ZodError) {
    return { ok: false as const, ...errorBody('VALIDATION_ERROR'), details: error.flatten() };
  }
  if (error instanceof HokmError) return { ok: false as const, ...errorBody(error.code, error.message) };
  if (error instanceof HttpError) return { ok: false as const, ...errorBody(error.code, error.message) };
  console.error(error);
  return { ok: false as const, ...errorBody('INTERNAL_SERVER_ERROR') };
}
