import type { Card } from '@hokm/game-engine';
import { suitMeta } from '../types.js';
import { useCardEntrance } from '../useCardEntrance.js';
import type { TablePosition } from '../table-seats.js';

/**
 * A single playing card.
 *
 * Laid out like a real card: a rank-and-suit index in the top corner, a large
 * pip in the middle, and the index repeated upside down in the opposite corner.
 * That mirrored index is what makes a fanned hand readable, because the corner
 * stays visible even when the card is overlapped by the next one.
 */
export function PlayingCard({
  card,
  disabled,
  compact,
  selected,
  onClick,
  /** Position in the hand, used to stagger the deal animation. */
  index = 0,
  /** Set for the card sitting in front of a seat, which lands rather than deals. */
  played = false,
  /**
   * Whether the dealing animation may run yet. The opening deal happens while
   * the start overlay still covers the table, so the hand waits for it to clear
   * and only then adds the animation class, which starts the animation.
   */
  dealReady = true,
  /** Seat this card was played from, so it flies in from that side. */
  from,
  /** Set while a finished trick is being collected by the winning seat. */
  exitTowards,
}: {
  card: Card;
  disabled?: boolean;
  compact?: boolean;
  /** Highlighted while choosing cards to discard. */
  selected?: boolean;
  onClick?: () => void;
  index?: number;
  played?: boolean;
  dealReady?: boolean;
  from?: TablePosition;
  exitTowards?: TablePosition | undefined;
}) {
  const suit = suitMeta(card.suit);
  const label = `${card.rank} ${suit.label}`;
  // Driven imperatively rather than by a CSS class: a mount-only CSS animation
  // silently does nothing when React reuses the node.
  const ref = useCardEntrance({
    kind: played ? 'land' : 'deal',
    index,
    enabled: played || dealReady,
    replayKey: card.id,
    ...(from ? { from } : {}),
    ...(exitTowards ? { exitTowards } : {}),
  });
  const classes = ['card', suit.color, compact && 'compact', selected && 'selected', disabled && 'is-blocked']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      disabled={disabled}
      aria-label={compact ? label : `بازی کردن ${label}`}
      aria-pressed={selected}
      title={label}
      onClick={onClick}
    >
      <span className="card__index" aria-hidden="true">
        <span className="card__rank">{card.rank}</span>
        <span className="card__suit">{suit.symbol}</span>
      </span>
      <span className="card__pip" aria-hidden="true">
        {suit.symbol}
      </span>
      <span className="card__index card__index--flipped" aria-hidden="true">
        <span className="card__rank">{card.rank}</span>
        <span className="card__suit">{suit.symbol}</span>
      </span>
    </button>
  );
}
