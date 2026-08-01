import { createDeck, shuffle } from './cards.js';
import { getModeConfig } from './modes.js';
import type { GameMode, HakemDrawCard, Seat } from './types.js';

/**
 * Choosing the hakem by turning cards, the way it is done at a real table.
 *
 * Cards are turned face up one at a time, going round the table, until an ace
 * appears. Whoever it lands in front of is the hakem. Doing this on the server
 * rather than picking a seat at random matters for two reasons: every player
 * watches the same cards in the same order, and the result is visibly fair
 * instead of being an unexplained choice.
 */

/** Which seat the nth turned card belongs to. */
function seatForStep(startSeat: number, step: number, seats: number): Seat {
  return ((startSeat + step) % seats) as Seat;
}

export interface HakemDrawResult {
  /** Every card turned, in order. The last one is always the ace. */
  cards: HakemDrawCard[];
  hakemSeat: Seat;
}

/**
 * Runs the draw to completion.
 *
 * A shuffled deck always contains four aces, so the draw is guaranteed to end.
 * The deck is walked in order and, as a safety net, the last card is treated as
 * the winner if somehow no ace was found.
 */
export function drawForHakem(
  mode: GameMode,
  rng: (() => number) | undefined,
  startSeat: Seat = 0,
): HakemDrawResult {
  const { seats } = getModeConfig(mode);
  const deck = shuffle(createDeck(), rng);
  const cards: HakemDrawCard[] = [];

  for (let step = 0; step < deck.length; step += 1) {
    const card = deck[step]!;
    const seat = seatForStep(startSeat, step, seats);
    const isAce = card.rank === 'A';
    cards.push({ seat, card, isAce });
    if (isAce) return { cards, hakemSeat: seat };
  }

  // Unreachable with a standard deck; keeps the return type honest.
  const last = cards[cards.length - 1]!;
  return { cards, hakemSeat: last.seat };
}
