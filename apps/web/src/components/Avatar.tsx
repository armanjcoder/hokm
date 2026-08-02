/**
 * The initials bubble used for a player, in the lobby and at the table.
 *
 * Shared so a player looks the same in both places: recognising your partner in
 * the lobby and then finding them at the table should not require re-reading
 * names. Bots get a marker instead of initials because they are not people.
 */
export function Avatar({
  initials,
  /** Colours the bubble by side: your team, theirs, or nobody's. */
  tone = 'solo',
  isBot = false,
  size = 'md',
}: {
  initials: string;
  tone?: 'ours' | 'theirs' | 'solo' | 'empty';
  isBot?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className={`avatar avatar--${size} avatar--${tone}`} aria-hidden="true">
      {isBot ? '🤖' : initials}
    </span>
  );
}
