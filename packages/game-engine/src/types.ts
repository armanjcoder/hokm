export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';
export type TeamId = 0 | 1;
export type Seat = 0 | 1 | 2 | 3;
export type GamePhase = 'waiting_for_trump' | 'playing' | 'hand_complete' | 'game_complete';

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
  kind?: 'normal' | 'kot' | 'hakem_kot';
}

export interface HokmGameState {
  id: string;
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
}

export interface CreateGameOptions {
  id?: string;
  targetScore?: number;
  hakemSeat?: Seat;
  rng?: () => number;
}

export interface PublicPlayerView extends Player {
  cardCount: number;
}

export interface PublicGameView extends Omit<HokmGameState, 'hands' | 'players'> {
  players: PublicPlayerView[];
  myHand: Card[];
  validCardIds: string[];
}
