import type { PublicGameView } from '@hokm/game-engine';
import { PlayingCard } from './PlayingCard.js';

/** The discard and draw steps that only the two player variant uses. */
export function DuelPhasePanels({
  game,
  discarding,
  discardCount,
  selected,
  isMyTurn,
  confirmDiscard,
  draw,
  resolveDraw,
}: {
  game: PublicGameView;
  discarding: boolean;
  discardCount: number;
  selected: string[];
  isMyTurn: boolean;
  confirmDiscard: () => void;
  draw: () => void;
  resolveDraw: (keep: boolean) => void;
}) {
  const pendingDraw = game.pendingDraw;
  return (
    <>
      {game.phase === 'discarding' && (
        <div className="glass wait-card phase-card">
          {discarding ? (
            <>
              <h3>{discardCount} کارت بسوزان</h3>
              <p>ضعیف‌ترین کارت‌هایت را انتخاب کن. حریف آن‌ها را نمی‌بیند.</p>
              <button
                className="primary"
                type="button"
                disabled={selected.length !== discardCount}
                onClick={confirmDiscard}
              >
                سوزاندن {selected.length}/{discardCount}
              </button>
            </>
          ) : (
            <p>منتظر حریف تا کارت‌هایش را بسوزاند…</p>
          )}
        </div>
      )}

      {game.phase === 'drawing' && (
        <div className="glass wait-card phase-card">
          <h3>برداشتن از دسته</h3>
          <p>{game.stockCount ?? 0} کارت در دسته مانده است.</p>
          {pendingDraw ? (
            <div className="draw-decision">
              <PlayingCard card={pendingDraw.card} compact />
              <div className="draw-actions">
                <button className="primary" type="button" onClick={() => resolveDraw(true)}>
                  نگه می‌دارم
                </button>
                <button className="ghost" type="button" onClick={() => resolveDraw(false)}>
                  می‌سوزانم
                </button>
              </div>
              <small>اگر نگه داری، کارت بعدی نادیده سوزانده می‌شود. اگر بسوزانی، کارت بعدی را ندیده باید برداری.</small>
            </div>
          ) : isMyTurn ? (
            <button className="primary" type="button" onClick={draw}>
              برداشتن کارت
            </button>
          ) : (
            <p>نوبت حریف است…</p>
          )}
        </div>
      )}
    </>
  );
}
