import type { GameMode, Rank, Seat, Suit } from './types.js';

/**
 * Rules that differ between the Iranian Hokm variants.
 *
 * Sources: the four player game is the classic one; the three and two player
 * variants are the common Iranian house rules where every player scores for
 * themselves and the deck is trimmed so it divides evenly.
 */
export interface ModeConfig {
  mode: GameMode;
  /** Number of seats at the table. */
  seats: number;
  label: string;
  /** True when seats 0/2 face 1/3; false when everyone plays for themselves. */
  teamPlay: boolean;
  /** Cards each player holds once dealing is finished. */
  handSize: number;
  /** Cards dealt before the hakem names trump. */
  initialDeal: number;
  /** Deal sizes after trump is chosen (empty for the two player draw variant). */
  followUpDeals: number[];
  /** How many ranks are removed from the deck so it divides evenly. */
  removedTwos: number;
  /** Tricks needed to win a hand. */
  tricksToWin: number;
  /** Total tricks in a hand, i.e. the hand size. */
  totalTricks: number;
  /** Two player only: cards each side discards after trump is named. */
  discardCount: number;
  /** Two player only: alternating draw phase after discarding. */
  usesDrawPhase: boolean;
}

export const GAME_MODES = ['classic4', 'solo3', 'duel2'] as const;

const CONFIGS: Record<GameMode, ModeConfig> = {
  // Classic Hokm: two fixed teams, full 52 card deck, 13 cards each.
  classic4: {
    mode: 'classic4',
    seats: 4,
    label: 'حکم چهار نفره',
    teamPlay: true,
    handSize: 13,
    initialDeal: 5,
    followUpDeals: [4, 4],
    removedTwos: 0,
    tricksToWin: 7,
    totalTricks: 13,
    discardCount: 0,
    usesDrawPhase: false,
  },
  // Three player: one 2 is removed so 51 cards split evenly into 17 each.
  solo3: {
    mode: 'solo3',
    seats: 3,
    label: 'حکم سه نفره',
    teamPlay: false,
    handSize: 17,
    initialDeal: 5,
    followUpDeals: [4, 4, 4],
    removedTwos: 1,
    tricksToWin: 7,
    totalTricks: 17,
    discardCount: 0,
    usesDrawPhase: false,
  },
  // Two player duel: 5 dealt, 2 discarded, then an alternating draw to 13.
  duel2: {
    mode: 'duel2',
    seats: 2,
    label: 'حکم دو نفره',
    teamPlay: false,
    handSize: 13,
    initialDeal: 5,
    followUpDeals: [],
    removedTwos: 0,
    tricksToWin: 7,
    totalTricks: 13,
    discardCount: 2,
    usesDrawPhase: true,
  },
};

export function getModeConfig(mode: GameMode = 'classic4'): ModeConfig {
  return CONFIGS[mode] ?? CONFIGS.classic4;
}

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === 'string' && (GAME_MODES as readonly string[]).includes(value);
}

/**
 * Team of a seat.
 * Team play pairs opposite seats; otherwise every player is their own team.
 */
export function teamOfSeat(seat: Seat, config: ModeConfig): number {
  return config.teamPlay ? seat % 2 : seat;
}

/** All team ids used by a mode. */
export function teamsOf(config: ModeConfig): number[] {
  return config.teamPlay ? [0, 1] : Array.from({ length: config.seats }, (_, i) => i);
}

/** The next seat in turn order, wrapping around the table. */
export function nextSeatFor(seat: Seat, config: ModeConfig): Seat {
  return ((seat + 1) % config.seats) as Seat;
}

/**
 * Which low cards to strip so the deck divides evenly.
 * The trump suit is never trimmed, because removing a trump would change play.
 */
export function suitsToTrim(config: ModeConfig, trumpSuit: Suit | undefined, order: Suit[]): Suit[] {
  if (config.removedTwos === 0) return [];
  return order.filter((suit) => suit !== trumpSuit).slice(0, config.removedTwos);
}

export const TRIMMED_RANK: Rank = '2';

/** Target scores a host may pick for a match. */
export const TARGET_SCORES = [3, 5, 7, 11] as const;
export type TargetScore = (typeof TARGET_SCORES)[number];
export const DEFAULT_TARGET_SCORE: TargetScore = 7;

export function isTargetScore(value: unknown): value is TargetScore {
  return typeof value === 'number' && (TARGET_SCORES as readonly number[]).includes(value);
}
