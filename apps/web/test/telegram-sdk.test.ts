import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announceReady, loadTelegramSdk, SDK_TIMEOUT_MS } from '../src/api/telegram-sdk.js';

/**
 * The Telegram SDK is served from `telegram.org`, which is blocked on some
 * networks. These tests pin the behaviour that a blocked, failing or slow CDN
 * can never stop the Mini App from rendering.
 */

function fakeDoc() {
  const scripts: any[] = [];
  const doc = {
    createElement: () => {
      const listeners: Record<string, Array<() => void>> = {};
      const script: any = {
        src: '',
        async: false,
        addEventListener: (event: string, fn: () => void) => {
          (listeners[event] ??= []).push(fn);
        },
        fire: (event: string) => listeners[event]?.forEach((fn) => fn()),
      };
      scripts.push(script);
      return script;
    },
    head: { appendChild: () => {} },
  } as unknown as Document;
  return { doc, scripts };
}

const emptyWin = () => ({}) as unknown as Window;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('loadTelegramSdk', () => {
  it('resolves immediately when the SDK is already present', async () => {
    const win = { Telegram: { WebApp: { ready() {}, expand() {} } } } as unknown as Window;
    const { doc, scripts } = fakeDoc();
    await expect(loadTelegramSdk(doc, win)).resolves.toBe('already-loaded');
    expect(scripts).toHaveLength(0);
  });

  it('injects the script asynchronously so it never blocks parsing', async () => {
    const { doc, scripts } = fakeDoc();
    const promise = loadTelegramSdk(doc, emptyWin());
    expect(scripts[0].async).toBe(true);
    expect(scripts[0].src).toContain('telegram.org/js/telegram-web-app.js');
    scripts[0].fire('load');
    await expect(promise).resolves.toBe('ready');
  });

  it('resolves on load', async () => {
    const { doc, scripts } = fakeDoc();
    const promise = loadTelegramSdk(doc, emptyWin());
    scripts[0].fire('load');
    await expect(promise).resolves.toBe('ready');
  });

  it('resolves rather than rejecting when the CDN errors', async () => {
    const { doc, scripts } = fakeDoc();
    const promise = loadTelegramSdk(doc, emptyWin());
    scripts[0].fire('error');
    await expect(promise).resolves.toBe('error');
  });

  it('gives up after the timeout when the CDN hangs (the Iran case)', async () => {
    const { doc } = fakeDoc();
    const promise = loadTelegramSdk(doc, emptyWin());
    vi.advanceTimersByTime(SDK_TIMEOUT_MS + 1);
    await expect(promise).resolves.toBe('timeout');
  });

  it('does not resolve before the timeout while the CDN hangs', async () => {
    const { doc } = fakeDoc();
    let settled = false;
    void loadTelegramSdk(doc, emptyWin()).then(() => {
      settled = true;
    });
    vi.advanceTimersByTime(SDK_TIMEOUT_MS - 100);
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it('ignores a late load that arrives after the timeout', async () => {
    const { doc, scripts } = fakeDoc();
    const promise = loadTelegramSdk(doc, emptyWin());
    vi.advanceTimersByTime(SDK_TIMEOUT_MS + 1);
    scripts[0].fire('load');
    await expect(promise).resolves.toBe('timeout');
  });

  it('honours a custom timeout', async () => {
    const { doc } = fakeDoc();
    const promise = loadTelegramSdk(doc, emptyWin(), 50);
    vi.advanceTimersByTime(51);
    await expect(promise).resolves.toBe('timeout');
  });
});

describe('announceReady', () => {
  it('calls ready and expand when the SDK loaded', () => {
    const ready = vi.fn();
    const expand = vi.fn();
    announceReady({ Telegram: { WebApp: { ready, expand } } } as unknown as Window);
    expect(ready).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();
  });

  it('is a no-op when the SDK never loaded', () => {
    expect(() => announceReady(emptyWin())).not.toThrow();
  });
});
