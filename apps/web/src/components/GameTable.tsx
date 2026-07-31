import type { Card, PublicGameView, Suit } from '@hokm/game-engine';
import { SUIT_META, suitSymbol, type RoomView } from '../types.js';
import { PlayingCard } from './PlayingCard.js';
import { Score } from './Score.js';

export function GameTable({ room, game, meId, chooseSuit, play, nextHand }: {
  room: RoomView; game: PublicGameView; meId: string; chooseSuit: (suit: Suit) => void; play: (card: Card) => void; nextHand: () => void;
}) {
  const me = room.players.find((p) => p.id === meId);
  const hakem = room.players.find((p) => p.seat === game.hakemSeat);
  const isMyTurn = me?.seat === game.currentTurnSeat;
  const isHakem = me?.seat === game.hakemSeat;

  return (
    <section className="table-wrap">
      <div className="score-strip">
        <Score title="تیم ۱" match={game.matchScore[0]} tricks={game.handScore.tricks[0]} />
        <div className="round-info"><span>راند {game.roundNumber}</span><strong>{game.trumpSuit ? suitSymbol(game.trumpSuit) : '؟'}</strong><small>حاکم: {hakem?.name}</small></div>
        <Score title="تیم ۲" match={game.matchScore[1]} tricks={game.handScore.tricks[1]} />
      </div>

      {game.phase === 'waiting_for_trump' && isHakem && (
        <div className="trump-picker glass">
          <h3 id="trump-title">حکم رو انتخاب کن</h3>
          <div role="group" aria-labelledby="trump-title">
            {SUIT_META.map((s) => (
              <button key={s.id} type="button" className={s.color} aria-label={`انتخاب حکم ${s.label}`} onClick={() => chooseSuit(s.id)}>
                <span aria-hidden="true">{s.symbol}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {game.phase === 'waiting_for_trump' && !isHakem && <div className="glass wait-card">منتظر انتخاب حکم توسط حاکم...</div>}

      <div className="table-center">
        <div className="turn-badge" role="status" aria-live="polite">
          {isMyTurn ? 'نوبت توئه' : `نوبت صندلی ${game.currentTurnSeat + 1}`}
        </div>
        <div className="played-cards">
          {game.currentTrick.plays.map((play) => <PlayingCard key={`${play.seat}-${play.card.id}`} card={play.card} compact />)}
        </div>
        <small>{game.lastEvent}</small>
      </div>

      {(game.phase === 'hand_complete' || game.phase === 'game_complete') && (
        <div className="glass result-card">
          <h2>{game.phase === 'game_complete' ? 'بازی تموم شد!' : 'راند تموم شد'}</h2>
          <p>{game.lastEvent}</p>
          {game.phase === 'hand_complete' && <button className="primary" onClick={nextHand}>راند بعدی</button>}
        </div>
      )}

      <div className="hand">
        {game.myHand.map((card) => <PlayingCard key={card.id} card={card} disabled={!game.validCardIds.includes(card.id)} onClick={() => play(card)} />)}
      </div>
    </section>
  );
}
