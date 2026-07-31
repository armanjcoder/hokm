import { describe, expect, it } from 'vitest';
import {
  buildInviteLink,
  normalizeApiUrl,
  parseJoinInput,
  parseStoredSession,
  socketPayload,
  userMessage,
} from '../src/lib.js';

describe('userMessage', () => {
  it('uses a Persian server message when there is one', () => {
    expect(userMessage({ message: 'میز پیدا نشد.' }, 'پیش‌فرض')).toBe('میز پیدا نشد.');
  });

  it('ignores an English server message so codes never reach the player', () => {
    expect(userMessage({ message: 'Room was not found.' }, 'پیش‌فرض')).toBe('پیش‌فرض');
    expect(userMessage({ message: 'ROOM_NOT_FOUND' }, 'پیش‌فرض')).toBe('پیش‌فرض');
  });

  it('falls back for missing, empty or non-string messages', () => {
    expect(userMessage({}, 'پیش‌فرض')).toBe('پیش‌فرض');
    expect(userMessage({ message: '   ' }, 'پیش‌فرض')).toBe('پیش‌فرض');
    expect(userMessage({ message: 42 }, 'پیش‌فرض')).toBe('پیش‌فرض');
    expect(userMessage(null, 'پیش‌فرض')).toBe('پیش‌فرض');
    expect(userMessage(undefined, 'پیش‌فرض')).toBe('پیش‌فرض');
  });
});

describe('normalizeApiUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeApiUrl('  https://a.example.com/  ')).toBe('https://a.example.com');
    expect(normalizeApiUrl('https://a.example.com///')).toBe('https://a.example.com');
    expect(normalizeApiUrl('https://a.example.com')).toBe('https://a.example.com');
  });
});

describe('socketPayload', () => {
  it('sends only the fields the server expects', () => {
    expect(
      socketPayload({ roomId: 'r1', playerId: 'p1', apiUrl: 'https://x', token: 't' }),
    ).toEqual({ roomId: 'r1', playerId: 'p1', token: 't' });
  });

  it('omits the token when there is none', () => {
    expect(socketPayload({ roomId: 'r1', playerId: 'p1', apiUrl: 'https://x' })).toEqual({
      roomId: 'r1',
      playerId: 'p1',
    });
  });

  it('never leaks apiUrl', () => {
    const payload = socketPayload({ roomId: 'r', playerId: 'p', apiUrl: 'https://secret' });
    expect(JSON.stringify(payload)).not.toContain('secret');
  });
});

describe('parseJoinInput', () => {
  it('accepts a bare room code', () => {
    expect(parseJoinInput('  abc123  ')).toEqual({ roomId: 'abc123' });
  });

  it('extracts room and api from a full invite link', () => {
    expect(
      parseJoinInput('https://x.pinggy.net/?room=abc123&api=https%3A%2F%2Fx.pinggy.net'),
    ).toEqual({ roomId: 'abc123', apiUrl: 'https://x.pinggy.net' });
  });

  it('handles a link without an api parameter', () => {
    expect(parseJoinInput('https://x.pinggy.net/?room=abc123')).toEqual({ roomId: 'abc123' });
  });

  it('returns an empty roomId for empty input', () => {
    expect(parseJoinInput('')).toEqual({ roomId: '' });
    expect(parseJoinInput('    ')).toEqual({ roomId: '' });
  });

  it('normalises a trailing slash on the extracted api url', () => {
    const parsed = parseJoinInput('https://x.net/?room=r1&api=https%3A%2F%2Fapi.net%2F');
    expect(parsed.apiUrl).toBe('https://api.net');
  });
});

describe('parseStoredSession', () => {
  const fallback = 'https://fallback.example';

  it('reads a valid session', () => {
    const raw = JSON.stringify({ roomId: 'r', playerId: 'p', apiUrl: 'https://a', token: 't' });
    expect(parseStoredSession(raw, fallback)).toEqual({
      roomId: 'r',
      playerId: 'p',
      apiUrl: 'https://a',
      token: 't',
    });
  });

  it('falls back to the current api url when the stored one is missing', () => {
    const raw = JSON.stringify({ roomId: 'r', playerId: 'p' });
    expect(parseStoredSession(raw, fallback)?.apiUrl).toBe(fallback);
  });

  it('returns null for corrupt or absent storage instead of throwing', () => {
    expect(parseStoredSession(null, fallback)).toBeNull();
    expect(parseStoredSession('not json at all', fallback)).toBeNull();
    expect(parseStoredSession('null', fallback)).toBeNull();
  });

  it('rejects a session that is missing required identifiers', () => {
    expect(parseStoredSession(JSON.stringify({ roomId: 'r' }), fallback)).toBeNull();
    expect(parseStoredSession(JSON.stringify({ playerId: 'p' }), fallback)).toBeNull();
    expect(parseStoredSession(JSON.stringify({ roomId: '', playerId: 'p' }), fallback)).toBeNull();
  });

  it('drops an empty token rather than sending a blank one', () => {
    const raw = JSON.stringify({ roomId: 'r', playerId: 'p', apiUrl: 'https://a', token: '' });
    expect(parseStoredSession(raw, fallback)).not.toHaveProperty('token');
  });
});

describe('buildInviteLink', () => {
  it('encodes the room and api so links survive pasting', () => {
    const link = buildInviteLink('https://x.net', '/', 'r 1', 'https://api.net');
    expect(link).toBe('https://x.net/?room=r%201&api=https%3A%2F%2Fapi.net');
    const parsed = parseJoinInput(link);
    expect(parsed.roomId).toBe('r 1');
    expect(parsed.apiUrl).toBe('https://api.net');
  });
});
