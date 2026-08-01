import type { HakemDrawCard } from '@hokm/game-engine';
import { PlayingCard } from './PlayingCard.js';
import type { SeatView } from '../table-seats.js';
import { seatLabel } from '../table-seats.js';

/**
 * The cards turned to decide the hakem, shown in front of the seat they landed
 * on. Runs over the table rather than in a modal, so players watch the cards
 * arrive at the actual seats instead of reading a summary afterwards.
 */
export function HakemDrawOverlay({
  revealed,
  seats,
  hakemSeat,
}: {
  revealed: HakemDrawCard[];
  seats: SeatView[];
  hakemSeat: number | undefined;
}) {
  const hakem = seats.find((seat) => seat.seat === hakemSeat);

  return (
    <div className="hakem-draw" role="status" aria-live="polite">
      <p className="hakem-draw__title">
        {hakem
          ? `${hakem.isSelf ? 'تو' : seatLabel(hakem)} آس آورد و حاکم شد`
          : 'کارت می‌آید تا حاکم مشخص شود…'}
      </p>
      <div className="hakem-draw__rows">
        {seats.map((seat) => {
          const forSeat = revealed.filter((entry) => entry.seat === seat.seat);
          const isWinner = hakemSeat !== undefined && seat.seat === hakemSeat;
          return (
            <div
              key={seat.seat}
              className={`hakem-draw__row ${isWinner ? 'is-winner' : ''}`}
            >
              <span className="hakem-draw__name">{seatLabel(seat)}</span>
              <span className="hakem-draw__cards">
                {forSeat.map((entry) => (
                  <PlayingCard
                    key={entry.card.id}
                    card={entry.card}
                    compact
                    played
                    from={seat.position}
                  />
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
