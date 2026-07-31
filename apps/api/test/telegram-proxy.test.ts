import { describe, expect, it, vi } from 'vitest';
import { createTelegramProxyAgent, describeProxy } from '../src/telegram/proxy.js';
import { parseProxyUrl } from '../src/config.js';

describe('parseProxyUrl', () => {
  it('returns undefined for an empty value', () => {
    expect(parseProxyUrl('')).toBeUndefined();
    expect(parseProxyUrl('   ')).toBeUndefined();
  });

  it('accepts http and socks proxies', () => {
    expect(parseProxyUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(parseProxyUrl('socks5://127.0.0.1:10808')).toBe('socks5://127.0.0.1:10808');
    expect(parseProxyUrl('socks5h://user:pass@10.0.0.1:1080')).toBe('socks5h://user:pass@10.0.0.1:1080');
  });

  it('unwraps a markdown-pasted URL like the other env URLs', () => {
    expect(parseProxyUrl('[http://127.0.0.1:8080](http://127.0.0.1:8080)')).toBe('http://127.0.0.1:8080');
  });

  it('ignores an unparsable value instead of crashing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseProxyUrl('not a url')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores an unsupported scheme', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseProxyUrl('ftp://127.0.0.1:21')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('createTelegramProxyAgent', () => {
  it('returns undefined when no proxy is configured', () => {
    expect(createTelegramProxyAgent(undefined)).toBeUndefined();
  });

  it('builds a socks agent for socks schemes', () => {
    const agent = createTelegramProxyAgent('socks5://127.0.0.1:10808');
    expect(agent?.constructor.name).toBe('SocksProxyAgent');
  });

  it('builds an https agent for http schemes', () => {
    const agent = createTelegramProxyAgent('http://127.0.0.1:8080');
    expect(agent?.constructor.name).toBe('HttpsProxyAgent');
  });

  it('returns undefined rather than throwing on a malformed url', () => {
    expect(createTelegramProxyAgent('nonsense')).toBeUndefined();
  });
});

describe('describeProxy', () => {
  it('describes a direct connection', () => {
    expect(describeProxy(undefined)).toBe('direct connection');
  });

  it('keeps host and scheme visible', () => {
    expect(describeProxy('socks5://127.0.0.1:10808')).toBe('socks5://127.0.0.1:10808');
  });

  it('never leaks proxy credentials into logs', () => {
    const described = describeProxy('http://secretuser:secretpass@10.0.0.1:8080');
    expect(described).not.toContain('secretuser');
    expect(described).not.toContain('secretpass');
    expect(described).toBe('http://***@10.0.0.1:8080');
  });

  it('degrades gracefully on a malformed url', () => {
    expect(describeProxy('nonsense')).toBe('invalid proxy');
  });
});
