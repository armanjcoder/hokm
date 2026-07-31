import { cardRankValue, HokmError } from './cards.js';
import type { Seat, Suit, Trick, TrickPlay } from './types.js';

/** Deciding who takes a trick: highest trump, otherwise highest lead suit. */

export function evaluateTrickWinner(trick: Trick, trumpSuit: Suit): Seat {
  if (trick.plays.length === 0) {
    throw new HokmError('Cannot evaluate an empty trick.', 'EMPTY_TRICK');
  }
  const leadSuit = trick.plays[0]?.card.suit;
  let best = trick.plays[0] as TrickPlay;
  for (const play of trick.plays.slice(1)) {
    const playIsTrump = play.card.suit === trumpSuit;
    const bestIsTrump = best.card.suit === trumpSuit;
    const canBeat = (playIsTrump && !bestIsTrump)
      || (play.card.suit === best.card.suit && cardRankValue(play.card) > cardRankValue(best.card))
      || (!bestIsTrump && !playIsTrump && play.card.suit === leadSuit && best.card.suit !== leadSuit);
    if (canBeat) {
      best = play;
    }
  }
  return best.seat;
}
