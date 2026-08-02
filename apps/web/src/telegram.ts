import type { TelegramWebApp } from './types.js';

/**
 * Everything the app asks of the Telegram host client.
 *
 * Two rules hold throughout. First, nothing here may ever throw: the Mini App
 * also runs in a plain browser during development, and real Telegram clients in
 * the wild are often several Bot API versions behind, so every capability is
 * feature-detected rather than assumed. Second, none of it is load-bearing —
 * losing haptics or a header colour must never affect the game.
 */

export function webApp(win: Window = window): TelegramWebApp | undefined {
  return win.Telegram?.WebApp;
}

/** True when running inside a real Telegram client rather than a browser tab. */
export function isTelegramHost(win: Window = window): boolean {
  return Boolean(webApp(win));
}

/**
 * Compares the host's Bot API version against a minimum.
 *
 * Versions are dotted numbers like "7.10", so a plain string comparison would
 * decide 7.9 is newer than 7.10. Parsed numerically instead.
 */
export function supportsVersion(minimum: string, win: Window = window): boolean {
  const current = webApp(win)?.version;
  if (!current) return false;
  const parse = (value: string) => value.split('.').map((part) => Number(part) || 0);
  const [curMajor = 0, curMinor = 0] = parse(current);
  const [minMajor = 0, minMinor = 0] = parse(minimum);
  if (curMajor !== minMajor) return curMajor > minMajor;
  return curMinor >= minMinor;
}

/** Users who turned motion down almost certainly do not want buzzing either. */
function motionAllowed(win: Window = window): boolean {
  return typeof win.matchMedia === 'function'
    ? !win.matchMedia('(prefers-reduced-motion: reduce)').matches
    : true;
}

/**
 * Physical feedback for the moments that matter.
 *
 * Deliberately sparse: a buzz on every tap becomes noise and users disable it.
 * Only real game events get one.
 */
export type HapticEvent =
  /** You played a card. */
  | 'play'
  /** You picked or deselected something. */
  | 'select'
  /** Your side took the trick. */
  | 'win'
  /** The move was rejected. */
  | 'error'
  /** A hand or the match finished. */
  | 'finish';

export function haptic(event: HapticEvent, win: Window = window): void {
  if (!motionAllowed(win)) return;
  const haptics = webApp(win)?.HapticFeedback;
  if (!haptics) return;

  try {
    switch (event) {
      case 'play':
        haptics.impactOccurred?.('light');
        return;
      case 'select':
        haptics.selectionChanged?.();
        return;
      case 'win':
        haptics.notificationOccurred?.('success');
        return;
      case 'error':
        haptics.notificationOccurred?.('error');
        return;
      case 'finish':
        haptics.notificationOccurred?.('warning');
        return;
    }
  } catch {
    // An older client can expose the object without the method; never let a
    // decorative buzz break a move.
  }
}

/** Page background, kept in step with the dark theme the app always uses. */
const THEME_COLOR = '#07070c';

/**
 * Applies the host-level chrome settings.
 *
 * Called once on mount. Each call is guarded separately so an unsupported
 * method on an older client does not prevent the later ones from running.
 */
export function applyTelegramChrome(win: Window = window): void {
  const app = webApp(win);
  if (!app) return;

  try {
    app.ready();
    app.expand();
  } catch {
    /* older clients */
  }

  // Colour methods arrived in Bot API 6.1 and only accept hex from 6.9.
  if (supportsVersion('6.9', win)) {
    try {
      app.setHeaderColor?.(THEME_COLOR);
      app.setBackgroundColor?.(THEME_COLOR);
    } catch {
      /* ignore */
    }
  }

  // Stops a stray downward swipe from closing the app mid-hand.
  if (supportsVersion('7.7', win)) {
    try {
      app.disableVerticalSwipes?.();
    } catch {
      /* ignore */
    }
  }
}

/**
 * The height the app should actually fill.
 *
 * `viewportStableHeight` excludes the on-screen keyboard, so the layout does
 * not jump when someone types their name. Falls back through the plain
 * viewport height to the window itself.
 */
export function stableViewportHeight(win: Window = window): number | undefined {
  const app = webApp(win);
  return app?.viewportStableHeight ?? app?.viewportHeight ?? undefined;
}

/**
 * Publishes the viewport height as a CSS variable and keeps it current.
 *
 * Telegram's own viewport is more reliable than `100dvh` inside the in-app
 * browser, so the stylesheets prefer this value when it is present.
 *
 * Returns a cleanup function.
 */
export function trackViewportHeight(win: Window = window, doc: Document = document): () => void {
  const app = webApp(win);
  if (!app) return () => {};

  const publish = () => {
    const height = stableViewportHeight(win);
    if (height && height > 0) {
      doc.documentElement.style.setProperty('--tg-viewport', `${height}px`);
    }
  };

  publish();
  app.onEvent?.('viewportChanged', publish);
  return () => app.offEvent?.('viewportChanged', publish);
}
