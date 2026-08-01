import { buildInviteLink } from '../lib.js';

/**
 * Shares an invite link, falling back to the clipboard when sharing is
 * unavailable.
 *
 * Both Web Share and the clipboard reject in perfectly ordinary situations:
 * dismissing the share sheet raises `AbortError`, and the clipboard throws when
 * the document is not focused or permission is denied. Those rejections must be
 * caught, otherwise every cancelled share produces an unhandled rejection.
 *
 * Resolves to a short Persian status the caller can surface as a toast.
 */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function shareRoom(
  roomId: string,
  apiUrl: string,
  nav: Pick<Navigator, 'share' | 'clipboard'> = navigator,
  loc: Pick<Location, 'origin' | 'pathname'> = location,
): Promise<ShareOutcome> {
  const link = buildInviteLink(loc.origin, loc.pathname, roomId, apiUrl);

  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: 'میز حکم', text: 'بیا حکم بازی کنیم', url: link });
      return 'shared';
    } catch (error) {
      // The user closing the sheet is a normal outcome, not a failure.
      if (isAbort(error)) return 'cancelled';
      // Any other share failure still deserves a clipboard attempt.
    }
  }

  try {
    await nav.clipboard?.writeText(link);
    return 'copied';
  } catch {
    return 'failed';
  }
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}
