import { cardRankValue, getModeConfig, teamOfSeat, type Card, type HokmGameState, type Seat, type Suit } from '@hokm/game-engine';

const RANKS: Card['rank'][] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

/** Every card of a suit, used to reason about what is still unseen. */
export function allCardsOfSuit(suit: Suit): Card[] {
  return RANKS.map((rank) => ({ id: `${suit}-${rank}`, suit, rank }));
}

/**
 * Card-counting helpers used by the hard bot.
 *
 * These are exactly the deductions a strong human player makes: what has
 * already been played, which cards are now unbeatable, and which suits an
 * opponent has shown they cannot follow.
 */

/** Every card that has been played, is on the table, or was removed pre-deal. */
export function playedCardIds(game: HokmGameState): Set<string> {
  const seen = new Set<string>();
  for (const trick of game.completedTricks) {
    for (const play of trick.plays) seen.add(play.card.id);
  }
  for (const play of game.currentTrick.plays) seen.add(play.card.id);
  for (const removed of game.removedCards ?? []) seen.add(removed.id);
  return seen;
}

/**
 * True when no higher card of the same suit can still be held by anyone else.
 * Hard bots use this to know an ace or king is safe to lead.
 */
export function isHighestRemaining(game: HokmGameState, card: Card, seat: Seat): boolean {
  const seen = playedCardIds(game);
  for (const own of game.hands[seat]) seen.add(own.id);
  return !allCardsOfSuit(card.suit).some(
    (other) => !seen.has(other.id) && cardRankValue(other) > cardRankValue(card),
  );
}

/**
 * True when every trump except our own has already been played.
 * Counting cards this way is exactly what a strong human player does.
 */
export function opponentsHoldNoTrumps(game: HokmGameState, seat: Seat, trump: Suit): boolean {
  const seen = playedCardIds(game);
  for (const own of game.hands[seat]) seen.add(own.id);
  return allCardsOfSuit(trump).every((card) => seen.has(card.id));
}

/**
 * Suits each seat has shown they cannot follow.
 * Failing to follow the led suit proves a player is out of it.
 */
export function knownVoids(game: HokmGameState): Map<Seat, Set<Suit>> {
  const voids = new Map<Seat, Set<Suit>>();
  for (const trick of [...game.completedTricks, game.currentTrick]) {
    const leadSuit = trick.plays[0]?.card.suit;
    if (!leadSuit) continue;
    for (const play of trick.plays) {
      if (play.card.suit === leadSuit) continue;
      const current = voids.get(play.seat) ?? new Set<Suit>();
      current.add(leadSuit);
      voids.set(play.seat, current);
    }
  }
  return voids;
}

export function opponentSeats(game: HokmGameState, seat: Seat): Seat[] {
  const config = getModeConfig(game.mode);
  return game.players
    .filter(
      (player) =>
        !config.teamPlay || teamOfSeat(player.seat, config) !== teamOfSeat(seat, config),
    )
    .map((player) => player.seat);
}
