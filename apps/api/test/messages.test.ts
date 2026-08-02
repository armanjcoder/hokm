import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES_FA, errorBody, localizeErrorCode } from '../src/messages.js';

const persian = /[\u0600-\u06FF]/;

describe('localizeErrorCode', () => {
  it('returns a Persian message for every known code', () => {
    for (const [code, message] of Object.entries(ERROR_MESSAGES_FA)) {
      expect(persian.test(message), `${code} must be Persian`).toBe(true);
      expect(localizeErrorCode(code)).toBe(message);
    }
  });

  it('never leaks an English engine message for an unknown code', () => {
    const result = localizeErrorCode('SOME_NEW_CODE', 'Room was not found.');
    expect(persian.test(result)).toBe(true);
    expect(result).not.toContain('Room');
  });

  it('keeps a Persian fallback when the code is unknown', () => {
    expect(localizeErrorCode('SOME_NEW_CODE', 'پیام سفارشی')).toBe('پیام سفارشی');
  });

  it('builds an error body with the code plus a Persian message', () => {
    expect(errorBody('ROOM_NOT_FOUND')).toEqual({
      error: 'ROOM_NOT_FOUND',
      message: ERROR_MESSAGES_FA.ROOM_NOT_FOUND,
    });
  });
});
