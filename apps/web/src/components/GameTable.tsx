import { useState } from 'react';
import { getModeConfig, type Card, type PublicGameView, type Suit } from '@hokm/game-engine';
import { SUIT_META, suitSymbol, type RoomView } from '../types.js';
import { PlayingCard } from './PlayingCard.js';
import { Score } from './Score.js';

export interface GameTableProps {
  room: RoomView;
  game: PublicGameView;
  meId: string;
  chooseSuit: (suit: Suit) => void;
  play: (card: Card) => void;
  nextHand: () => void;
  discard: (cardIds: string[]) => void;
  draw: () => void;
  resolveDraw: (keep: boolean) => void;
}

export function GameTable({
  room,
  game,
  meId,
  chooseSuit,
  play,
  nextHand,
  discard,
  draw,
  resolveDraw,
}: GameTableProps) {
  const me = room.players.find((p) => p.id === meId);
  const hakem = room.players.find((p) => p.seat === game.hakemSeat);
  const isMyTurn = me?.seat === game.currentTurnSeat;
  const isHakem = me?.seat === game.hakemSeat;
  const config = getModeConfig(game.mode);
  const [selected, setSelected] = useState<string[]>([]);

  const iHaveDiscarded = me ? (game.discardedSeats ?? []).some((seat) => seat === me.seat) : false;
  const pendingDraw = game.pendingDraw;

  function toggleSelected(cardId: string) {
    setSelected((current) =>
      current.includes(cardId)
        ? current.filter((id) => id !== cardId)
        : current.length < config.discardCount
          ? [...current, cardId]
          : current,
    );
  }

  function confirmDiscard() {
    discard(selected);
    setSelected([]);
  }

  const discarding = game.phase === 'discarding' && !iHaveDiscarded;

  return (
    <section className="table-wrap">
      <div className="score-strip">
        {config.teamPlay ? (
          <>
            <Score title="تیم ۱" match={game.matchScore[0] ?? 0} tricks={game.handScore.tricks[0] ?? 0} />
            <RoundInfo game={game} hakemName={hakem?.name} />
            <Score title="تیم ۲" match={game.matchScore[1] ?? 0} tricks={game.handScore.tricks[1] ?? 0} />
          </>
        ) : (
          <>
            <Score
              title="تو"
              match={game.matchScore[me?.seat ?? 0] ?? 0}
              tricks={game.handScore.tricks[me?.seat ?? 0] ?? 0}
            />
            <RoundInfo game={game} hakemName={hakem?.name} />
            <Score title="حریفان" match={opponentBest(game, me?.seat)} tricks={opponentTricks(game, me?.seat)} />
          </>
        )}
      </div>

      {game.phase === 'waiting_for_trump' && isHakem && (
        <div className="trump-picker glass">
          <h3 id="trump-title">حکم رو انتخاب کن</h3>
          <div role="group" aria-labelledby="trump-title">
            {SUIT_META.map((s) => (
              <button
                key={s.id}
                type="button"
                className={s.color}
                aria-label={`انتخاب حکم ${s.label}`}
                onClick={() => chooseSuit(s.id)}
              >
                <span aria-hidden="true">{s.symbol}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {game.phase === 'waiting_for_trump' && !isHakem && (
        <div className="glass wait-card">منتظر انتخاب حکم توسط حاکم...</div>
      )}

      {game.phase === 'discarding' && (
        <div className="glass wait-card phase-card">
          {discarding ? (
            <>
              <h3>{config.discardCount} کارت بسوزان</h3>
              <p>ضعیف‌ترین کارت‌هایت را انتخاب کن. حریف آن‌ها را نمی‌بیند.</p>
              <button
                className="primary"
                type="button"
                disabled={selected.length !== config.discardCount}
                onClick={confirmDiscard}
              >
                سوزاندن {selected.length}/{config.discardCount}
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

      <div className="table-center">
        <div className="turn-badge" role="status" aria-live="polite">
          {isMyTurn ? 'نوبت توئه' : `نوبت صندلی ${game.currentTurnSeat + 1}`}
        </div>
        <div className="played-cards">
          {game.currentTrick.plays.map((played) => (
            <PlayingCard key={`${played.seat}-${played.card.id}`} card={played.card} compact />
          ))}
        </div>
        <small>{game.lastEvent}</small>
      </div>

      {(game.phase === 'hand_complete' || game.phase === 'game_complete') && (
        <div className="glass result-card">
          <h2>{game.phase === 'game_complete' ? 'بازی تموم شد!' : 'راند تموم شد'}</h2>
          <p>{game.lastEvent}</p>
          {game.phase === 'hand_complete' && (
            <button className="primary" onClick={nextHand}>
              راند بعدی
            </button>
          )}
        </div>
      )}

      <div className="hand">
        {game.myHand.map((card) =>
          discarding ? (
            <PlayingCard
              key={card.id}
              card={card}
              selected={selected.includes(card.id)}
              onClick={() => toggleSelected(card.id)}
            />
          ) : (
            <PlayingCard
              key={card.id}
              card={card}
              disabled={!game.validCardIds.includes(card.id)}
              onClick={() => play(card)}
            />
          ),
        )}
      </div>
    </section>
  );
}

function RoundInfo({ game, hakemName }: { game: PublicGameView; hakemName: string | undefined }) {
  return (
    <div className="round-info">
      <span>راند {game.roundNumber}</span>
      <strong>{game.trumpSuit ? suitSymbol(game.trumpSuit) : '؟'}</strong>
      <small>حاکم: {hakemName}</small>
      <small className="target-note">تا {game.targetScore} امتیاز</small>
    </div>
  );
}

/** Best score among everyone except me, for the solo score strip. */
function opponentBest(game: PublicGameView, mySeat: number | undefined): number {
  const scores = Object.entries(game.matchScore)
    .filter(([team]) => Number(team) !== mySeat)
    .map(([, value]) => value);
  return scores.length > 0 ? Math.max(...scores) : 0;
}

function opponentTricks(game: PublicGameView, mySeat: number | undefined): number {
  const scores = Object.entries(game.handScore.tricks)
    .filter(([team]) => Number(team) !== mySeat)
    .map(([, value]) => value);
  return scores.length > 0 ? Math.max(...scores) : 0;
}
