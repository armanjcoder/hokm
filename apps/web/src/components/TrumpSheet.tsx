import { useRef } from 'react';
import type { Suit } from '@hokm/game-engine';
import { SUIT_META } from '../types.js';
import { useFocusTrap } from '../useFocusTrap.js';

/**
 * Naming trump, as a bottom sheet.
 *
 * This is the single most important decision in a hand, so it gets the whole
 * bottom of the screen rather than a small floating panel: the four suits sit
 * within thumb reach and are large enough to hit without looking. It is modal
 * on purpose, because nothing else can happen until the hakem has chosen.
 *
 * There is deliberately no dismiss: the hand cannot continue without a trump,
 * so offering a way to close the sheet would only create a dead end.
 */
export function TrumpSheet({
  onChoose,
  canRequestRedeal = false,
  onRequestRedeal,
}: {
  onChoose: (suit: Suit) => void;
  /** "ده‌لو کم": offered when the opening hand has no face card. */
  canRequestRedeal?: boolean;
  onRequestRedeal?: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const firstSuitRef = useRef<HTMLButtonElement>(null);

  useFocusTrap({ containerRef: sheetRef, initialFocusRef: firstSuitRef });

  return (
    <div className="trump-backdrop" role="dialog" aria-modal="true" aria-labelledby="trump-title">
      <div ref={sheetRef} className="trump-sheet">
        <span className="trump-sheet__grip" aria-hidden="true" />
        <h3 id="trump-title" className="trump-sheet__title">
          حکم رو انتخاب کن
        </h3>
        <p className="trump-sheet__hint">
          خالی را انتخاب کن که در دستت قوی‌تر است؛ تا آخر این دست حکم می‌ماند.
        </p>

        <div className="trump-sheet__suits" role="group" aria-labelledby="trump-title">
          {SUIT_META.map((suit, index) => (
            <button
              key={suit.id}
              ref={index === 0 ? firstSuitRef : undefined}
              type="button"
              className={`trump-suit ${suit.color}`}
              aria-label={`انتخاب حکم ${suit.label}`}
              onClick={() => onChoose(suit.id)}
            >
              <span className="trump-suit__symbol" aria-hidden="true">
                {suit.symbol}
              </span>
              <span className="trump-suit__label">{suit.label}</span>
            </button>
          ))}
        </div>

        {canRequestRedeal && onRequestRedeal && (
          <button className="ghost full-width trump-sheet__redeal" type="button" onClick={onRequestRedeal}>
            ده‌لو کم دارم؛ دوباره پخش کن
          </button>
        )}
      </div>
    </div>
  );
}
