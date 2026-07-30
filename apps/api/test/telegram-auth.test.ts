import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { telegramDisplayName, verifyInitData } from '../src/telegram-auth.js';

const BOT_TOKEN = '123456:TEST-TOKEN-FOR-UNIT-TESTS';

/** Builds a correctly signed initData string, exactly like Telegram would. */
function signInitData(
  fields: Record<string, string>,
  botToken = BOT_TOKEN,
): string {
  const dataCheckString = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function validFields(overrides: Record<string, string> = {}) {
  return {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAF_test',
    user: JSON.stringify({ id: 424242, first_name: 'آرمان', username: 'armanj' }),
    ...overrides,
  };
}

describe('verifyInitData', () => {
  it('accepts a correctly signed payload and extracts the user', () => {
    const result = verifyInitData(signInitData(validFields()), BOT_TOKEN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.id).toBe(424242);
    expect(result.user.firstName).toBe('آرمان');
    expect(result.user.username).toBe('armanj');
  });

  it('rejects a payload signed with a different bot token', () => {
    const forged = signInitData(validFields(), 'other-token');
    expect(verifyInitData(forged, BOT_TOKEN)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects a payload whose user field was tampered with after signing', () => {
    const signed = signInitData(validFields());
    const params = new URLSearchParams(signed);
    // The attacker swaps in a different Telegram id but keeps the original hash.
    params.set('user', JSON.stringify({ id: 999, first_name: 'مهاجم' }));
    expect(verifyInitData(params.toString(), BOT_TOKEN)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects a tampered hash', () => {
    const params = new URLSearchParams(signInitData(validFields()));
    params.set('hash', 'a'.repeat(64));
    expect(verifyInitData(params.toString(), BOT_TOKEN)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects a missing hash', () => {
    const params = new URLSearchParams(validFields());
    expect(verifyInitData(params.toString(), BOT_TOKEN)).toEqual({
      ok: false,
      reason: 'MISSING_HASH',
    });
  });

  it('rejects empty or missing init data', () => {
    expect(verifyInitData(undefined, BOT_TOKEN)).toEqual({ ok: false, reason: 'MISSING_INIT_DATA' });
    expect(verifyInitData('   ', BOT_TOKEN)).toEqual({ ok: false, reason: 'MISSING_INIT_DATA' });
  });

  it('rejects stale init data to limit replay attacks', () => {
    const twoDaysAgo = String(Math.floor(Date.now() / 1000) - 48 * 60 * 60);
    const signed = signInitData(validFields({ auth_date: twoDaysAgo }));
    expect(verifyInitData(signed, BOT_TOKEN)).toEqual({ ok: false, reason: 'EXPIRED_INIT_DATA' });
  });

  it('accepts stale init data when the age limit is disabled', () => {
    const twoDaysAgo = String(Math.floor(Date.now() / 1000) - 48 * 60 * 60);
    const signed = signInitData(validFields({ auth_date: twoDaysAgo }));
    expect(verifyInitData(signed, BOT_TOKEN, { maxAgeSeconds: 0 }).ok).toBe(true);
  });

  it('rejects a signed payload that carries no user', () => {
    const fields = validFields();
    delete (fields as Record<string, string>).user;
    expect(verifyInitData(signInitData(fields), BOT_TOKEN)).toEqual({
      ok: false,
      reason: 'MISSING_USER',
    });
  });

  it('never verifies when the server has no bot token', () => {
    expect(verifyInitData(signInitData(validFields()), '')).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });
});

describe('telegramDisplayName', () => {
  it('prefers the full name, then the username', () => {
    expect(telegramDisplayName({ id: 1, firstName: 'آرمان', lastName: 'ج' })).toBe('آرمان ج');
    expect(telegramDisplayName({ id: 1, username: 'armanj' })).toBe('armanj');
    expect(telegramDisplayName({ id: 1 })).toBeUndefined();
  });
});
