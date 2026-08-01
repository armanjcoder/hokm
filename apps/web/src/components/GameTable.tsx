import { useState } from 'react';
import { getModeConfig, type Card, type PublicGameView, type Suit } from '@hokm/game-engine';
import { SUIT_META, suitSymbol, type RoomView } from '../types.js';
import { PlayingCard } from './PlayingCard.js';
import { DuelPhasePanels } from './DuelPhasePanels.js';
import { Score } from './Score.js';
import { TableSeat } from './TableSeat.js';
import { TrumpSheet } from './TrumpSheet.js';
import { buildSeatViews, drawMessage, teamRosters, turnMessage } from '../table-seats.js';
import { useTrickHold } from '../useTrickHold.js';
import { useHakemDraw } from '../useHakemDraw.js';
import { useDealSequence } from '../useDealSequence.js';

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
  /** Tells the server this client finished showing the hakem draw. */
  hakemDrawDone?: () => void;
}

export function GameTable({
  room,
  game: liveGame,
  meId,
  chooseSuit,
  play,
  nextHand,
  requestRedeal,
  discard,
  draw,
  resolveDraw,
  dealReady = true,
  hakemDrawDone,
}: GameTableProps) {
  // A completed trick is held on screen for a few seconds so everyone can see
  // what was played; the rest of the component treats this as the live view.
  const { game, sweepingTo } = useTrickHold(liveGame);
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
  const hakemDraw = useHakemDraw(game, {
    enabled: dealReady,
    ...(hakemDrawDone ? { onFinished: hakemDrawDone } : {}),
  });
  const seats = buildSeatViews({
    mode: game.mode,
    players: room.players,
    game,
    mySeat: me?.seat,
    drawRevealed: hakemDraw.revealed.map((entry) => ({ seat: entry.seat, card: entry.card })),
  });
  // While the trick is being collected, every card leans towards the winner.
  const sweepTarget = sweepingTo === undefined ? undefined : seats.find((s) => s.seat === sweepingTo);
  const rosters = teamRosters(seats);
  // Cards are released one at a time so the deal can be watched.
  const dealtCount = useDealSequence(game, me?.seat);
  // Scores are keyed by absolute team index, but the strip is labelled from the
  // viewer's side so "our team" always sits on the same side of the screen.
  const myTeam = config.teamPlay ? (me?.seat ?? 0) % 2 : (me?.seat ?? 0);
  const theirTeam = config.teamPlay ? 1 - myTeam : undefined;

  return (
    <section className="table-wrap">
      <div className="score-strip">
        {config.teamPlay ? (
          <>
            <Score
              title="تیم ما"
              ours
              members={rosters.ours}
              match={game.matchScore[myTeam] ?? 0}
              tricks={game.handScore.tricks[myTeam] ?? 0}
            />
            <RoundInfo game={game} hakemName={hakem?.name} />
            <Score
              title="حریف"
              members={rosters.theirs}
              match={game.matchScore[theirTeam ?? 1] ?? 0}
              tricks={game.handScore.tricks[theirTeam ?? 1] ?? 0}
            />
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
        <TrumpSheet
          onChoose={chooseSuit}
          canRequestRedeal={Boolean(game.canRequestRedeal)}
          onRequestRedeal={requestRedeal}
        />
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
          <TableSeat
            key={view.seat}
            view={view}
            teamPlay={config.teamPlay}
            {...(sweepTarget ? { sweepTo: sweepTarget.position } : {})}
          />
        ))}
        <div className="table-center__core">
          <div className="turn-badge" role="status" aria-live="polite">
            {hakemDraw.running ? drawMessage(seats, hakemDraw.hakemSeat) : turnMessage(seats)}
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
        {game.myHand.slice(0, dealtCount).map((card, index) =>
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
