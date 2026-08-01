import { seatInitials, seatLabel, type SeatView, type TablePosition } from '../table-seats.js';
import { PlayingCard } from './PlayingCard.js';

/**
 * One player's place at the table.
 *
 * Shows who they are, whether they are the hakem, whether it is their turn and
 * the card they just played. Everything a player needs to follow the round
 * without guessing which anonymous seat number belongs to whom.
 */
export function TableSeat({
  view,
  teamPlay,
  /** Set while the finished trick is sweeping towards the winning seat. */
  sweepTo,
}: {
  view: SeatView;
  teamPlay: boolean;
  sweepTo?: TablePosition;
}) {
  const label = seatLabel(view);
  const empty = !view.player;

  const classes = [
    'table-seat',
    `is-${view.position}`,
    view.isSelf && 'is-self',
    view.isPartner && 'is-partner',
    view.isTurn && 'is-turn',
    view.isOffline && 'is-offline',
    view.wonTrick && 'has-won-trick',
    empty && 'is-empty',
    teamPlay ? (view.isMyTeam ? 'team-ours' : 'team-theirs') : 'team-solo',
  ]
    .filter(Boolean)
    .join(' ');

  // One sentence per seat so a screen reader gets the same picture a sighted
  // player gets from colour, position and badges.
  const described = [
    label,
    view.isSelf ? 'خودت' : view.isPartner ? 'یار تو' : empty ? '' : 'حریف',
    view.isHakem ? 'حاکم' : '',
    view.isTurn ? 'نوبت اوست' : '',
    view.isOffline ? 'ارتباطش قطع شده' : '',
    view.wonTrick ? 'این دست را برد' : '',
    view.cardCount !== undefined ? `${view.cardCount} کارت` : '',
  ]
    .filter(Boolean)
    .join('، ');

  return (
    <div className={classes} aria-label={described}>
      <div className="table-seat__badge">
        <span className="table-seat__avatar" aria-hidden="true">
          {seatInitials(view)}
        </span>
        <span className="table-seat__meta">
          <strong className="table-seat__name">
            {label}
            {view.player?.isBot && <span aria-hidden="true"> 🤖</span>}
          </strong>
          <span className="table-seat__tags">
            {view.isTurn && <em className="tag tag--turn">نوبت</em>}
            {view.isHakem && <em className="tag tag--hakem">حاکم</em>}
            {view.isSelf && <em className="tag tag--self">تو</em>}
            {view.isPartner && <em className="tag tag--partner">یار</em>}
            {view.isOffline && <em className="tag tag--offline">قطع</em>}
            {view.cardCount !== undefined && !view.isSelf && (
              <em className="tag tag--count">{view.cardCount} کارت</em>
            )}
          </span>
        </span>
      </div>

      <div className={`table-seat__played ${sweepTo ? `is-sweeping sweep-${sweepTo}` : ''}`}>
        {(view.drawCards?.length ?? 0) > 0 ? (
          // The hakem draw can go round more than once, so each new card is
          // stacked slightly over the last rather than replacing it.
          <span className="draw-stack">
            {(view.drawCards ?? []).map((card, depth) => (
              <span
                key={card!.id}
                className="draw-stack__card"
                style={{ '--stack-depth': depth } as React.CSSProperties}
              >
                <PlayingCard card={card!} compact played from={view.position} />
              </span>
            ))}
          </span>
        ) : view.playedCard ? (
          // Keyed by card id on purpose. Without it React reuses the same DOM
          // node for whatever card lands next, and a CSS mount animation never
          // replays, so the card would silently swap instead of landing.
          <PlayingCard
            key={view.playedCard.id}
            card={view.playedCard}
            compact
            played
            from={view.position}
          />
        ) : (
          <span className="table-seat__empty-slot" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
