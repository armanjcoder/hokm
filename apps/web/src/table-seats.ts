import { getModeConfig, type GameMode, type PublicGameView } from '@hokm/game-engine';
import type { RoomPlayer } from './types.js';

/**
 * Works out who sits where around the table, from the viewer's point of view.
 *
 * The player looking at the screen is always at the bottom. Everyone else is
 * rotated into place around them, so a four player table reads exactly like a
 * real one: your partner faces you and the two opponents sit left and right.
 * Keeping this as plain data (no JSX) makes every arrangement directly testable.
 */

/** Where a seat is drawn on screen, relative to the viewer. */
export type TablePosition = 'bottom' | 'left' | 'top' | 'right';

export interface SeatView {
  seat: number;
  position: TablePosition;
  player: RoomPlayer | undefined;
  /** True for the viewer's own seat. */
  isSelf: boolean;
  /** True when this seat plays on the viewer's side. Always false solo. */
  isPartner: boolean;
  /** Team index, or the seat number when everyone plays for themselves. */
  team: number;
  /**
   * True when this seat plays on the viewer's side, including the viewer.
   * Colour keys off this rather than the absolute team index, so "my side" is
   * always the same colour no matter which seat you happen to occupy.
   */
  isMyTeam: boolean;
  isHakem: boolean;
  isTurn: boolean;
  /** Cards still in hand, when the server reported it. */
  cardCount: number | undefined;
  /** The card this seat played in the current trick, if any. */
  playedCard: PublicGameView['currentTrick']['plays'][number]['card'] | undefined;
  /** True while the just-finished trick is being shown sweeping to its winner. */
  wonTrick: boolean;
  /** A human who dropped their connection. Bots are never "offline". */
  isOffline: boolean;
}

/**
 * Clockwise ring of screen positions per table size.
 *
 * Index 0 is always the viewer. Subsequent entries follow the turn order, so a
 * three player table puts the next player to the left and the last to the right
 * rather than leaving an odd gap opposite the viewer.
 */
const RINGS: Record<number, TablePosition[]> = {
  2: ['bottom', 'top'],
  3: ['bottom', 'left', 'right'],
  4: ['bottom', 'left', 'top', 'right'],
};

export interface BuildSeatsOptions {
  mode: GameMode;
  players: RoomPlayer[];
  game: PublicGameView;
  /** Seat of the viewer. Falls back to seat 0 for spectators. */
  mySeat: number | undefined;
}

/** Builds one entry per seat, ordered from the viewer clockwise. */
export function buildSeatViews({ mode, players, game, mySeat }: BuildSeatsOptions): SeatView[] {
  const config = getModeConfig(mode);
  const seats = config.seats;
  const ring = RINGS[seats] ?? RINGS[4]!;
  const viewerSeat = mySeat ?? 0;

  // Keyed by plain seat numbers so lookups do not depend on the branded Seat
  // type flowing through unchanged.
  // Between tricks the current one is already empty, so fall back to the trick
  // that just finished. Without this the cards vanish the instant the fourth
  // one lands and nobody can see what actually happened.
  const resolving = game.currentTrick.plays.length === 0 ? lastCompletedTrick(game) : undefined;
  const visiblePlays = resolving?.plays ?? game.currentTrick.plays;
  const winnerSeat = resolving?.winnerSeat;

  const playedBySeat = new Map<number, SeatView['playedCard']>(
    visiblePlays.map((play) => [Number(play.seat), play.card]),
  );
  const countBySeat = new Map<number, number | undefined>(
    (game.players ?? []).map((player) => [
      Number(player.seat),
      (player as { cardCount?: number }).cardCount,
    ]),
  );

  return Array.from({ length: seats }, (_, offset) => {
    // Rotate so the viewer lands at the bottom and turn order runs clockwise.
    const seat = (viewerSeat + offset) % seats;
    const player = players.find((candidate) => candidate.seat === seat);
    const team = config.teamPlay ? seat % 2 : seat;
    const myTeam = config.teamPlay ? viewerSeat % 2 : viewerSeat;

    return {
      seat,
      position: ring[offset] ?? 'top',
      player,
      isSelf: seat === viewerSeat,
      isPartner: config.teamPlay && team === myTeam && seat !== viewerSeat,
      team,
      isMyTeam: config.teamPlay && team === myTeam,
      isHakem: seat === game.hakemSeat,
      isTurn: seat === game.currentTurnSeat,
      cardCount: countBySeat.get(seat),
      playedCard: playedBySeat.get(seat),
      wonTrick: winnerSeat !== undefined && Number(winnerSeat) === seat,
      isOffline: Boolean(player) && !player?.isBot && player?.connected === false,
    } satisfies SeatView;
  });
}

/** Short label for a seat with no player yet. */
export function seatPlaceholder(seat: number): string {
  return `صندلی ${seat + 1}`;
}

/** Display name, falling back to the seat number for an empty chair. */
export function seatLabel(view: SeatView): string {
  return view.player?.name ?? seatPlaceholder(view.seat);
}

/**
 * Initials shown in the avatar bubble.
 *
 * Persian names have no reliable "first letter of surname" convention, so we
 * take the first character of up to two words, which reads well in both
 * Persian and Latin scripts.
 */
export function seatInitials(view: SeatView): string {
  const name = view.player?.name?.trim();
  if (!name) return String(view.seat + 1);
  const words = name.split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = words.map((word) => [...word][0] ?? '').join('');
  return initials || String(view.seat + 1);
}

/**
 * The trick that was just completed, if the table is between tricks.
 *
 * While a trick is being played the cards sit in `currentTrick`. The moment the
 * last card lands the engine moves it to `completedTricks` and clears the
 * current one, so this is what should be shown sweeping towards its winner
 * instead of the table blanking instantly.
 */
export function lastCompletedTrick(game: PublicGameView) {
  const tricks = game.completedTricks ?? [];
  const last = tricks[tricks.length - 1];
  if (!last || last.winnerSeat === undefined) return undefined;
  return last;
}

/** Whose turn it is, phrased for the turn banner. */
export function turnMessage(seats: SeatView[]): string {
  const active = seats.find((view) => view.isTurn);
  if (!active) return '';
  if (active.isSelf) return 'نوبت توئه';
  return `نوبت ${seatLabel(active)}`;
}
