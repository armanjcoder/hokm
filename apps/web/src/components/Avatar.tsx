import { useEffect, useState } from 'react';

/**
 * The player bubble used in the lobby, at the table and in the profile sheet.
 *
 * Shared so a player looks the same everywhere: recognising your partner in the
 * lobby and then finding them at the table should not require re-reading names.
 * Bots get a marker instead of initials because they are not people.
 *
 * When the player signed in from Telegram and their profile photo is public,
 * `photoUrl` points at our own API (never the Telegram CDN, which is blocked on
 * many of the networks this game is played on). The initials stay underneath the
 * image, so a photo that fails to load degrades to exactly the old design rather
 * than to an empty hole — and because the box is sized identically either way,
 * nothing on the page moves when the image arrives.
 */
export function Avatar({
  initials,
  /** Colours the bubble by side: your team, theirs, or nobody's. */
  tone = 'solo',
  isBot = false,
  size = 'md',
  photoUrl,
}: {
  initials: string;
  tone?: 'ours' | 'theirs' | 'solo' | 'empty';
  isBot?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Profile photo endpoint. Omitted when the player has no public photo. */
  photoUrl?: string | undefined;
}) {
  const [failed, setFailed] = useState(false);

  // A new URL deserves a new attempt; without this, one broken photo would
  // permanently suppress the next player to occupy the same rendered node.
  useEffect(() => setFailed(false), [photoUrl]);

  const showPhoto = Boolean(photoUrl) && !failed && !isBot;

  return (
    <span className={`avatar avatar--${size} avatar--${tone}`} aria-hidden="true">
      {isBot ? '🤖' : initials}
      {showPhoto && (
        <img
          className="avatar__photo"
          src={photoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
