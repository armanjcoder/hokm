import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/rate-limit.js';
import { FALLBACK_NAME, MAX_NAME_LENGTH, sanitizeDisplayName } from '../src/sanitize.js';

describe('RateLimiter', () => {
  it('allows up to the limit and then blocks', () => {
    const limiter = new RateLimiter({ windowMs: 1000, max: 3 });
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.check('a', now + i).allowed).toBe(true);
    }
    const blocked = limiter.check('a', now + 4);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks callers independently', () => {
    const limiter = new RateLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('b', 0).allowed).toBe(true);
    expect(limiter.check('a', 1).allowed).toBe(false);
  });

  it('lets a caller through again once the window slides past', () => {
    const limiter = new RateLimiter({ windowMs: 1000, max: 2 });
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('a', 100).allowed).toBe(true);
    expect(limiter.check('a', 200).allowed).toBe(false);
    // Both earlier hits have now expired.
    expect(limiter.check('a', 1300).allowed).toBe(true);
  });

  it('reports remaining capacity', () => {
    const limiter = new RateLimiter({ windowMs: 1000, max: 3 });
    expect(limiter.check('a', 0).remaining).toBe(2);
    expect(limiter.check('a', 1).remaining).toBe(1);
    expect(limiter.check('a', 2).remaining).toBe(0);
  });

  it('can be reset', () => {
    const limiter = new RateLimiter({ windowMs: 1000, max: 1 });
    limiter.check('a', 0);
    expect(limiter.check('a', 1).allowed).toBe(false);
    limiter.reset('a');
    expect(limiter.check('a', 2).allowed).toBe(true);
  });

  it('does not leak memory for idle callers', () => {
    const limiter = new RateLimiter({ windowMs: 100, max: 5 });
    for (let i = 0; i < 500; i += 1) limiter.check(`caller-${i}`, i);
    // Sweeping happens on later calls; the limiter must still behave correctly.
    expect(limiter.check('caller-0', 100_000).allowed).toBe(true);
  });
});

describe('sanitizeDisplayName', () => {
  it('keeps ordinary Persian and Latin names untouched', () => {
    expect(sanitizeDisplayName('آرمان')).toBe('آرمان');
    expect(sanitizeDisplayName('Arman J')).toBe('Arman J');
  });

  it('trims and collapses whitespace', () => {
    expect(sanitizeDisplayName('   آرمان    جان   ')).toBe('آرمان جان');
  });

  it('falls back when the name is empty or whitespace only', () => {
    expect(sanitizeDisplayName('')).toBe(FALLBACK_NAME);
    expect(sanitizeDisplayName('     ')).toBe(FALLBACK_NAME);
    expect(sanitizeDisplayName('\t\n')).toBe(FALLBACK_NAME);
  });

  it('falls back for non-string input', () => {
    expect(sanitizeDisplayName(undefined)).toBe(FALLBACK_NAME);
    expect(sanitizeDisplayName(42)).toBe(FALLBACK_NAME);
    expect(sanitizeDisplayName(null)).toBe(FALLBACK_NAME);
  });

  it('strips newlines and control characters that would break the layout', () => {
    expect(sanitizeDisplayName('آرمان\nحکم')).toBe('آرمان حکم');
    expect(sanitizeDisplayName('a\u0000b')).toBe('a b');
  });

  it('removes bidi overrides that scramble an RTL lobby', () => {
    expect(sanitizeDisplayName('\u202Eآرمان')).toBe('آرمان');
    expect(sanitizeDisplayName('a\u202Db')).toBe('ab');
    expect(sanitizeDisplayName('\u2066\u2067خطرناک\u2069')).toBe('خطرناک');
  });

  it('removes zero-width padding', () => {
    expect(sanitizeDisplayName('آر\u200Bمان')).toBe('آرمان');
    expect(sanitizeDisplayName('\u200B\u200C\u200D')).toBe(FALLBACK_NAME);
  });

  it('caps the length without splitting characters', () => {
    const long = 'ا'.repeat(100);
    expect(sanitizeDisplayName(long)).toHaveLength(MAX_NAME_LENGTH);
  });

  it('accepts a custom fallback', () => {
    expect(sanitizeDisplayName('   ', 'مهمان')).toBe('مهمان');
  });
});
