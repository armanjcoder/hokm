/**
 * Loads the Telegram Mini App SDK without letting it block the whole app.
 *
 * `telegram.org` is unreachable from some networks (notably Iran, where the
 * connection is blackholed rather than refused). A plain blocking
 * `<script src="https://telegram.org/...">` in `index.html` then stalls until
 * the browser's own timeout, and the bundle never runs at all — the user just
 * stares at an empty page.
 *
 * So we inject the tag ourselves, give it a deadline, and always resolve. The
 * game still works without the SDK: identity simply falls back to guest mode.
 */

/** How long to wait for the SDK before starting the app without it. */
export const SDK_TIMEOUT_MS = 2500;

const SDK_URL = 'https://telegram.org/js/telegram-web-app.js';

export type SdkOutcome = 'ready' | 'already-loaded' | 'timeout' | 'error';

/**
 * Resolves once the SDK is usable, or once we have given up waiting.
 * Never rejects: a missing SDK must not stop the app from rendering.
 */
export function loadTelegramSdk(
  doc: Document = document,
  win: Window = window,
  timeoutMs: number = SDK_TIMEOUT_MS,
): Promise<SdkOutcome> {
  if (win.Telegram?.WebApp) return Promise.resolve('already-loaded');

  return new Promise<SdkOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: SdkOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => finish('timeout'), timeoutMs);

    const script = doc.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.addEventListener('load', () => finish('ready'));
    script.addEventListener('error', () => finish('error'));
    doc.head.appendChild(script);
  });
}
