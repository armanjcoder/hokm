import type { Card, Rank, Seat, Suit, TeamId } from './types.js';

const suits: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const ranks: Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
const rankValue = new Map<Rank, number>(ranks.map((rank, index) => [rank, ranks.length - index]));

export const SUITS = suits;
export const RANKS = ranks;

export class HokmError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'HokmError';
  }
}

export function createDeck(): Card[] {
  return suits.flatMap((suit) => ranks.map((rank) => ({ id: `${suit}-${rank}`, suit, rank })));
}

export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j] as T;
    copy[j] = tmp as T;
  }
  return copy;
}

export function getTeamBySeat(seat: Seat): TeamId {
  return seat === 0 || seat === 2 ? 0 : 1;
}

export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % 4) as Seat;
}

/** Face cards for the "ده‌لو کم" rule: anything above a 10. */
const FACE_RANKS = new Set<Rank>(['A', 'K', 'Q', 'J']);

export function isFaceCard(card: Card): boolean {
  return FACE_RANKS.has(card.rank);
}

/** True when a hand has no A, K, Q or J, which allows a redeal request. */
export function isLowHand(cards: Card[]): boolean {
  return cards.length > 0 && !cards.some(isFaceCard);
}

export function cardRankValue(card: Card): number {
  return rankValue.get(card.rank) ?? 0;
}

export function localizeSuit(suit: Suit): string {
  const names: Record<Suit, string> = {
    spades: 'پیک',
    hearts: 'دل',
    diamonds: 'خشت',
    clubs: 'گشنیز',
  };
  return names[suit];
}
