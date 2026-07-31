import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards module initialisation order in `config.ts`.
 *
 * `config` is built at import time and calls helpers defined lower in the
 * file. Function declarations hoist, but `const` bindings do not: a `const`
 * declared after `config` would sit in its temporal dead zone and crash the
 * server on startup with "Cannot access X before initialization". Importing
 * the module fresh with each proxy value re-runs that top-level code, which is
 * the only way to catch the bug.
 */

const ORIGINAL = process.env.TELEGRAM_PROXY_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TELEGRAM_PROXY_URL;
  else process.env.TELEGRAM_PROXY_URL = ORIGINAL;
  vi.resetModules();
});

async function importFreshConfig(proxyValue: string | undefined) {
  vi.resetModules();
  if (proxyValue === undefined) delete process.env.TELEGRAM_PROXY_URL;
  else process.env.TELEGRAM_PROXY_URL = proxyValue;
  return (await import('../src/config.js')).config;
}

describe('config module initialisation', () => {
  it('loads with no proxy configured', async () => {
    const config = await importFreshConfig(undefined);
    expect(config.telegramProxyUrl).toBeUndefined();
  });

  it('loads with a valid socks proxy configured', async () => {
    const config = await importFreshConfig('socks5://127.0.0.1:10808');
    expect(config.telegramProxyUrl).toBe('socks5://127.0.0.1:10808');
  });

  it('loads with an unsupported scheme instead of crashing at startup', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = await importFreshConfig('ftp://127.0.0.1:21');
    expect(config.telegramProxyUrl).toBeUndefined();
    warn.mockRestore();
  });

  it('loads with an unparsable proxy value instead of crashing at startup', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = await importFreshConfig('not a url');
    expect(config.telegramProxyUrl).toBeUndefined();
    warn.mockRestore();
  });
});
