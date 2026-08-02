export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';
/** Team 0/1 in the four player game; in solo modes each seat is its own team. */
export type TeamId = number;
export type Seat = 0 | 1 | 2 | 3;

/**
 * `classic4` - four players, two fixed teams, full deck.
 * `solo3`    - three players, everyone for themselves, one 2 removed.
 * `duel2`    - two players, discard then draw to 13 cards.
 */
export type GameMode = 'classic4' | 'solo3' | 'duel2';

export type GamePhase =
  /** Cards are turned one by one until an ace appears, naming the hakem. */
  | 'choosing_hakem'
  | 'waiting_for_trump'
  /** Two player only: both sides discard before the draw begins. */
  | 'discarding'
  /** Two player only: alternating draw from the stock. */
  | 'drawing'
  | 'playing'
  | 'hand_complete'
  | 'game_complete';

/** One card turned during the hakem draw. */
export interface HakemDrawCard {
  seat: Seat;
  card: Card;
  /** True for the ace that ended the draw. */
  isAce: boolean;
}

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
}

export interface Player {
  id: string;
  name: string;
  seat: Seat;
  team: TeamId;
}

export interface TrickPlay {
  playerId: string;
  seat: Seat;
  card: Card;
}

export interface Trick {
  leaderSeat: Seat;
  plays: TrickPlay[];
  winnerSeat?: Seat;
}

export interface HandScore {
  tricks: Record<TeamId, number>;
  pointsAwarded?: number;
  winningTeam?: TeamId;
  kind?: 'normal' | 'kot' | 'hakem_kot' | 'bam' | 'hakem_bam';
}

export interface HokmGameState {
  id: string;
  mode: GameMode;
  players: Player[];
  phase: GamePhase;
  hakemSeat: Seat;
  currentTurnSeat: Seat;
  trumpSuit?: Suit;
  hands: Record<Seat, Card[]>;
  currentTrick: Trick;
  completedTricks: Trick[];
  handScore: HandScore;
  matchScore: Record<TeamId, number>;
  targetScore: number;
  roundNumber: number;
  lastEvent?: string;
  /** Active house rules for this match. */
  rules: OptionalRules;
  /** Consecutive redeals already granted this hand. */
  redealCount: number;
  /** True when the hakem is currently allowed to demand a redeal. */
  canRequestRedeal: boolean;
  /** Cards removed so the deck divides evenly (three player mode). */
  removedCards?: Card[];
  /**
   * Cards turned during the hakem draw, in the order they were dealt.
   *
   * Kept on the state so every client replays the same sequence, and so a
   * player who reconnects mid-draw still sees how the hakem was decided.
   */
  hakemDraw?: HakemDrawCard[];
  /** Two player only: face-down stock drawn from during the draw phase. */
  stock?: Card[];
  /** Two player only: seats that have finished discarding. */
  discardedSeats?: Seat[];
  /**
   * Two player only: a card taken from the stock and shown to the drawing
   * player, who must decide to keep it or burn it and take the next one.
   */
  pendingDraw?: { seat: Seat; card: Card } | undefined;
}

/** House rules a host can switch on before the match starts. */
export interface OptionalRules {
  /**
   * "ده‌لو کم": the hakem may demand a redeal when their opening cards contain
   * no face card (A, K, Q, J).
   */
  lowHandRedeal: boolean;
  /** Maximum consecutive redeals, so a table cannot lock up. */
  maxRedeals: number;
  /**
   * "بام": play continues past the winning trick count, and sweeping every
   * trick wins the whole match outright.
   */
  bam: boolean;
}

export interface CreateGameOptions {
  id?: string;
  mode?: GameMode;
  targetScore?: number;
  hakemSeat?: Seat;
  rules?: Partial<OptionalRules>;
  rng?: () => number;
  /**
   * Decide the first hakem by turning cards until an ace appears, and start in
   * the `choosing_hakem` phase so the client can show it happening.
   *
   * Off by default: callers that pin `hakemSeat` want a deterministic hand.
   */
  drawHakem?: boolean;
}

export interface PublicPlayerView extends Player {
  cardCount: number;
}

export interface PublicGameView
  extends Omit<HokmGameState, 'hands' | 'players' | 'stock'> {
  players: PublicPlayerView[];
  myHand: Card[];
  validCardIds: string[];
  /** How many cards remain in the two player stock (never the cards themselves). */
  stockCount?: number;
}
