import { describe, expect, it } from 'vitest';
import { createPlayerToken, tokensMatch, verifyPlayerSession, withoutToken } from '../src/session.js';

function players() {
  return [
    { id: 'p1', token: 'token-one', name: 'آرمان' },
    { id: 'p2', token: 'token-two', name: 'نیکا' },
    { id: 'bot_1', token: undefined, name: 'ربات', isBot: true },
    { id: 'legacy', name: 'میز قدیمی' },
  ];
}

describe('createPlayerToken', () => {
  it('creates long, unique, url-safe tokens', () => {
    const a = createPlayerToken();
    const b = createPlayerToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('tokensMatch', () => {
  it('matches only identical tokens', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('abc', 'abd')).toBe(false);
    expect(tokensMatch('abc', 'abcd')).toBe(false);
    expect(tokensMatch(undefined, 'abc')).toBe(false);
    expect(tokensMatch('abc', undefined)).toBe(false);
  });
});

describe('verifyPlayerSession', () => {
  it('accepts the correct token', () => {
    expect(verifyPlayerSession(players(), 'p1', 'token-one')).toEqual({ ok: true });
  });

  it('rejects a wrong or missing token', () => {
    expect(verifyPlayerSession(players(), 'p1', 'token-two')).toEqual({ ok: false, code: 'INVALID_SESSION' });
    expect(verifyPlayerSession(players(), 'p1', undefined)).toEqual({ ok: false, code: 'INVALID_SESSION' });
  });

  it('rejects impersonating another seat with a valid token of your own', () => {
    expect(verifyPlayerSession(players(), 'p2', 'token-one')).toEqual({ ok: false, code: 'INVALID_SESSION' });
  });

  it('rejects unknown players', () => {
    expect(verifyPlayerSession(players(), 'ghost', 'token-one')).toEqual({ ok: false, code: 'PLAYER_NOT_FOUND' });
  });

  it('never lets a client claim a bot seat', () => {
    expect(verifyPlayerSession(players(), 'bot_1', undefined)).toEqual({ ok: false, code: 'INVALID_SESSION' });
  });

  it('adopts a token for legacy seats and then locks them', () => {
    const list = players();
    const first = verifyPlayerSession(list, 'legacy', undefined);
    expect(first.ok).toBe(true);
    const adopted = first.ok ? first.adoptedToken : undefined;
    expect(adopted).toBeTruthy();
    expect(list.find((p) => p.id === 'legacy')?.token).toBe(adopted);

    expect(verifyPlayerSession(list, 'legacy', adopted)).toEqual({ ok: true });
    expect(verifyPlayerSession(list, 'legacy', 'guess')).toEqual({ ok: false, code: 'INVALID_SESSION' });
  });
});

describe('withoutToken', () => {
  it('strips the secret token', () => {
    expect(withoutToken({ id: 'p1', token: 'secret', name: 'آرمان' })).toEqual({ id: 'p1', name: 'آرمان' });
  });
});
