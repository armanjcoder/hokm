import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import {
  applyTelegramChrome,
  haptic,
  isTelegramHost,
  stableViewportHeight,
  supportsVersion,
  trackViewportHeight,
  webApp,
} from '../src/telegram.js';
import type { TelegramWebApp } from '../src/types.js';

/**
 * Telegram host integration.
 *
 * The rule this whole module lives by: none of it is load-bearing. The Mini App
 * runs in a plain browser during development and inside Telegram clients that
 * are several Bot API versions behind, so every capability has to be
 * feature-detected and every failure has to be survivable. A missing buzz must
 * never cost someone their turn.
 */

function fakeWindow(app?: Partial<TelegramWebApp>, reducedMotion = false): Window {
  return {
    ...(app ? { Telegram: { WebApp: { ready() {}, expand() {}, ...app } } } : {}),
    matchMedia: (query: string) => ({
      matches: reducedMotion && query.includes('reduce'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }),
  } as unknown as Window;
}

afterEach(() => vi.restoreAllMocks());

describe('host detection', () => {
  it('reports a Telegram host when the SDK is present', () => {
    expect(isTelegramHost(fakeWindow({}))).toBe(true);
  });

  it('reports a plain browser when it is not', () => {
    expect(isTelegramHost(fakeWindow())).toBe(false);
    expect(webApp(fakeWindow())).toBeUndefined();
  });
});

describe('version checks', () => {
  it('compares versions numerically, not as strings', () => {
    // A string compare would call 7.9 newer than 7.10.
    expect(supportsVersion('7.9', fakeWindow({ version: '7.10' }))).toBe(true);
    expect(supportsVersion('7.10', fakeWindow({ version: '7.9' }))).toBe(false);
  });

  it('accepts an exact match', () => {
    expect(supportsVersion('6.9', fakeWindow({ version: '6.9' }))).toBe(true);
  });

  it('compares the major version first', () => {
    expect(supportsVersion('6.9', fakeWindow({ version: '7.0' }))).toBe(true);
    expect(supportsVersion('7.0', fakeWindow({ version: '6.99' }))).toBe(false);
  });

  it('assumes nothing when the host reports no version', () => {
    expect(supportsVersion('6.1', fakeWindow({}))).toBe(false);
    expect(supportsVersion('6.1', fakeWindow())).toBe(false);
  });
});

describe('haptics', () => {
  function withHaptics(reducedMotion = false) {
    const calls: string[] = [];
    const win = fakeWindow(
      {
        HapticFeedback: {
          impactOccurred: (style) => calls.push(`impact:${style}`),
          notificationOccurred: (type) => calls.push(`notify:${type}`),
          selectionChanged: () => calls.push('selection'),
        },
      },
      reducedMotion,
    );
    return { win, calls };
  }

  it('uses a light tap for playing a card', () => {
    const { win, calls } = withHaptics();
    haptic('play', win);
    expect(calls).toEqual(['impact:light']);
  });

  it('uses selection feedback for picking something', () => {
    const { win, calls } = withHaptics();
    haptic('select', win);
    expect(calls).toEqual(['selection']);
  });

  it('distinguishes winning, failing and finishing', () => {
    const { win, calls } = withHaptics();
    haptic('win', win);
    haptic('error', win);
    haptic('finish', win);
    expect(calls).toEqual(['notify:success', 'notify:error', 'notify:warning']);
  });

  it('stays silent when the user asked for reduced motion', () => {
    // Someone who turned motion down almost certainly does not want buzzing.
    const { win, calls } = withHaptics(true);
    haptic('play', win);
    expect(calls).toEqual([]);
  });

  it('does nothing outside Telegram', () => {
    expect(() => haptic('play', fakeWindow())).not.toThrow();
  });

  it('survives a client that has no haptics at all', () => {
    expect(() => haptic('win', fakeWindow({}))).not.toThrow();
  });

  it('survives a client whose haptics object is missing the method', () => {
    // Older clients expose the object but not every method on it.
    const win = fakeWindow({ HapticFeedback: {} });
    expect(() => haptic('play', win)).not.toThrow();
  });

  it('never lets a throwing host break a move', () => {
    const win = fakeWindow({
      HapticFeedback: {
        impactOccurred: () => {
          throw new Error('unsupported');
        },
      },
    });
    expect(() => haptic('play', win)).not.toThrow();
  });
});

describe('host chrome', () => {
  it('announces readiness and expands the app', () => {
    const ready = vi.fn();
    const expand = vi.fn();
    applyTelegramChrome(fakeWindow({ ready, expand, version: '7.10' }));
    expect(ready).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();
  });

  it('paints the host chrome to match the dark theme', () => {
    const setHeaderColor = vi.fn();
    const setBackgroundColor = vi.fn();
    applyTelegramChrome(fakeWindow({ setHeaderColor, setBackgroundColor, version: '7.10' }));
    expect(setHeaderColor).toHaveBeenCalledWith('#07070c');
    expect(setBackgroundColor).toHaveBeenCalledWith('#07070c');
  });

  it('skips colour methods on clients too old to accept a hex value', () => {
    const setHeaderColor = vi.fn();
    applyTelegramChrome(fakeWindow({ setHeaderColor, version: '6.2' }));
    expect(setHeaderColor).not.toHaveBeenCalled();
  });

  it('blocks the swipe-to-close gesture on clients that support it', () => {
    const disableVerticalSwipes = vi.fn();
    applyTelegramChrome(fakeWindow({ disableVerticalSwipes, version: '7.7' }));
    expect(disableVerticalSwipes).toHaveBeenCalledOnce();
  });

  it('does not try to block swipes on older clients', () => {
    const disableVerticalSwipes = vi.fn();
    applyTelegramChrome(fakeWindow({ disableVerticalSwipes, version: '7.0' }));
    expect(disableVerticalSwipes).not.toHaveBeenCalled();
  });

  it('still readies the app when a later call throws', () => {
    const ready = vi.fn();
    const win = fakeWindow({
      ready,
      version: '7.10',
      setHeaderColor: () => {
        throw new Error('nope');
      },
    });
    expect(() => applyTelegramChrome(win)).not.toThrow();
    expect(ready).toHaveBeenCalledOnce();
  });

  it('does nothing at all outside Telegram', () => {
    expect(() => applyTelegramChrome(fakeWindow())).not.toThrow();
  });
});

describe('viewport', () => {
  function fakeDoc() {
    const props: Record<string, string> = {};
    return {
      doc: {
        documentElement: { style: { setProperty: (k: string, v: string) => (props[k] = v) } },
      } as unknown as Document,
      props,
    };
  }

  it('prefers the stable height, which excludes the keyboard', () => {
    const win = fakeWindow({ viewportStableHeight: 700, viewportHeight: 500 });
    expect(stableViewportHeight(win)).toBe(700);
  });

  it('falls back to the plain viewport height', () => {
    expect(stableViewportHeight(fakeWindow({ viewportHeight: 500 }))).toBe(500);
  });

  it('reports nothing outside Telegram, so CSS keeps its own fallback', () => {
    expect(stableViewportHeight(fakeWindow())).toBeUndefined();
  });

  it('publishes the height as a CSS variable', () => {
    const { doc, props } = fakeDoc();
    trackViewportHeight(fakeWindow({ viewportStableHeight: 640 }), doc);
    expect(props['--tg-viewport']).toBe('640px');
  });

  it('keeps the variable current as the viewport changes', () => {
    const { doc, props } = fakeDoc();
    let handler = () => {};
    const app: Partial<TelegramWebApp> = {
      viewportStableHeight: 600,
      onEvent: (_event, fn) => {
        handler = fn;
      },
      offEvent: () => {},
    };
    const win = fakeWindow(app);
    trackViewportHeight(win, doc);
    expect(props['--tg-viewport']).toBe('600px');

    (win.Telegram!.WebApp as TelegramWebApp).viewportStableHeight = 420;
    handler();
    expect(props['--tg-viewport']).toBe('420px');
  });

  it('unsubscribes when the app unmounts', () => {
    const offEvent = vi.fn();
    const stop = trackViewportHeight(
      fakeWindow({ viewportStableHeight: 600, onEvent: () => {}, offEvent }),
      fakeDoc().doc,
    );
    stop();
    expect(offEvent).toHaveBeenCalledOnce();
  });

  it('never writes a nonsensical height', () => {
    const { doc, props } = fakeDoc();
    trackViewportHeight(fakeWindow({ viewportStableHeight: 0 }), doc);
    expect(props['--tg-viewport']).toBeUndefined();
  });

  it('returns a safe no-op outside Telegram', () => {
    expect(() => trackViewportHeight(fakeWindow(), fakeDoc().doc)()).not.toThrow();
  });
});

describe('the app actually calls into the host on mount', () => {
  // Testing `telegram.ts` alone would miss the wiring, which is exactly how a
  // sweep animation shipped twice while its prop was never passed down.
  afterEach(() => {
    delete (window as unknown as { Telegram?: unknown }).Telegram;
    cleanup();
  });

  function installHost() {
    const calls: string[] = [];
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        version: '7.10',
        viewportStableHeight: 700,
        ready: () => calls.push('ready'),
        expand: () => calls.push('expand'),
        setHeaderColor: () => calls.push('header'),
        setBackgroundColor: () => calls.push('background'),
        disableVerticalSwipes: () => calls.push('swipes'),
        onEvent: () => calls.push('subscribe'),
        offEvent: () => calls.push('unsubscribe'),
      },
    };
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    return calls;
  }

  it('readies, expands, themes and tracks the viewport', () => {
    const calls = installHost();
    render(<App />);
    for (const expected of ['ready', 'expand', 'header', 'background', 'swipes', 'subscribe']) {
      expect(calls, `App should call ${expected} on mount`).toContain(expected);
    }
  });

  it('publishes the host viewport height for the stylesheets', () => {
    installHost();
    render(<App />);
    expect(document.documentElement.style.getPropertyValue('--tg-viewport')).toBe('700px');
  });

  it('unsubscribes from viewport changes when it unmounts', () => {
    const calls = installHost();
    const view = render(<App />);
    view.unmount();
    expect(calls).toContain('unsubscribe');
  });

  it('mounts perfectly well outside Telegram', () => {
    expect(() => render(<App />)).not.toThrow();
  });
});
