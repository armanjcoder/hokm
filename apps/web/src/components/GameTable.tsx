import { useState } from 'react';
import { getModeConfig, type Card, type PublicGameView, type Suit } from '@hokm/game-engine';
import { SUIT_META, suitSymbol, type RoomView } from '../types.js';
import { PlayingCard } from './PlayingCard.js';
import { DuelPhasePanels } from './DuelPhasePanels.js';
import { Score } from './Score.js';
import { TableSeat } from './TableSeat.js';
import { buildSeatViews, turnMessage } from '../table-seats.js';

export interface GameTableProps {
  room: RoomView;
  game: PublicGameView;
  meId: string;
  chooseSuit: (suit: Suit) => void;
  play: (card: Card) => void;
  nextHand: () => void;
  requestRedeal: () => void;
  discard: (cardIds: string[]) => void;
  draw: () => void;
  resolveDraw: (keep: boolean) => void;
  /** False while the start overlay is covering the table. */
  dealReady?: boolean;
}

export function GameTable({
  room,
  game,
  meId,
  chooseSuit,
  play,
  nextHand,
  requestRedeal,
  discard,
  draw,
  resolveDraw,
  dealReady = true,
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
  const seats = buildSeatViews({ mode: game.mode, players: room.players, game, mySeat: me?.seat });

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
      {game.phase === 'waiting_for_trump' && isHakem && game.canRequestRedeal && (
        <div className="glass wait-card phase-card redeal-card">
          <h3>ده‌لو کم</h3>
          <p>هیچ کارت عکس‌داری نداری. می‌توانی بخواهی کارت‌ها دوباره پخش شوند.</p>
          <button className="ghost" type="button" onClick={requestRedeal}>
            درخواست پخش دوباره
          </button>
        </div>
      )}
      {game.phase === 'waiting_for_trump' && !isHakem && (
        <div className="glass wait-card">منتظر انتخاب حکم توسط حاکم...</div>
      )}

      <DuelPhasePanels
        game={game}
        discarding={discarding}
        discardCount={config.discardCount}
        selected={selected}
        isMyTurn={isMyTurn}
        confirmDiscard={confirmDiscard}
        draw={draw}
        resolveDraw={resolveDraw}
      />

      <div className={`table-center seats-${config.seats}`}>
        {seats.map((view) => (
          <TableSeat key={view.seat} view={view} teamPlay={config.teamPlay} />
        ))}
        <div className="table-center__core">
          <div className="turn-badge" role="status" aria-live="polite">
            {turnMessage(seats)}
          </div>
          <small className="table-event" role="status" aria-live="polite">
            {game.lastEvent}
          </small>
        </div>
      </div>

      {(game.phase === 'hand_complete' || game.phase === 'game_complete') && (
        <div className="glass result-card">
          <h2>{game.phase === 'game_complete' ? 'بازی تموم شد!' : 'راند تموم شد'}</h2>
          <ScoreBadge handScore={game.handScore} />
          <p>{game.lastEvent}</p>
          {game.phase === 'hand_complete' && (
            <button className="primary" type="button" onClick={nextHand}>
              راند بعدی
            </button>
          )}
        </div>
      )}

      <div className="hand">
        {game.myHand.map((card, index) =>
          discarding ? (
            <PlayingCard
              key={card.id}
              card={card}
              index={index}
              dealReady={dealReady}
              selected={selected.includes(card.id)}
              onClick={() => toggleSelected(card.id)}
            />
          ) : (
            <PlayingCard
              key={card.id}
              card={card}
              index={index}
              dealReady={dealReady}
              disabled={!game.validCardIds.includes(card.id)}
              onClick={() => play(card)}
            />
          ),
        )}
      </div>

    </section>
  );
}

/** Explains why the round was worth 1, 2 or 3 points. */
function ScoreBadge({ handScore }: { handScore: PublicGameView['handScore'] }) {
  const { kind, pointsAwarded } = handScore;
  if (!kind || pointsAwarded === undefined) return null;

  const labels = {
    normal: { text: 'برد عادی', className: 'normal' },
    kot: { text: 'کوت! حریف هیچ دستی نبرد', className: 'kot' },
    hakem_kot: { text: 'حاکم‌کوت! حاکم هیچ دستی نبرد', className: 'hakem-kot' },
    bam: { text: 'بام! همه دست‌ها را برد', className: 'bam' },
    hakem_bam: { text: 'بام روی حاکم! همه دست‌ها را برد', className: 'bam' },
  } as const;
  const label = labels[kind];

  return (
    <div className={`score-badge ${label.className}`}>
      <strong>{label.text}</strong>
      <span>+{pointsAwarded} امتیاز</span>
    </div>
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
