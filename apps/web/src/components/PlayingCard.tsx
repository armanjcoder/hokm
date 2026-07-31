import type { Card } from '@hokm/game-engine';
import { suitMeta } from '../types.js';

export function PlayingCard({ card, disabled, compact, selected, onClick }: {
  card: Card;
  disabled?: boolean;
  compact?: boolean;
  /** Highlighted while choosing cards to discard. */
  selected?: boolean;
  onClick?: () => void;
}) {
  const suit = suitMeta(card.suit);
  const label = `${card.rank} ${suit.label}`;
  return (
    <button
      type="button"
      className={`card ${suit.color} ${compact ? 'compact' : ''} ${selected ? 'selected' : ''}`}
      disabled={disabled}
      aria-label={compact ? label : `بازی کردن ${label}`}
      aria-pressed={selected}
      title={label}
      onClick={onClick}
    >
      <span aria-hidden="true">{card.rank}</span>
      <b aria-hidden="true">{suit.symbol}</b>
    </button>
  );
}
