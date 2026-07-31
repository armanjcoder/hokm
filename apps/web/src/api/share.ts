import { buildInviteLink } from '../lib.js';

/** Shares an invite link, falling back to the clipboard when sharing is unavailable. */
export function shareRoom(roomId: string, apiUrl: string): void {
  const link = buildInviteLink(location.origin, location.pathname, roomId, apiUrl);
  if (navigator.share) {
    void navigator.share({ title: 'میز حکم', text: 'بیا حکم بازی کنیم', url: link });
  } else {
    void navigator.clipboard.writeText(link);
  }
}
