import {
  cardRankValue,
  evaluateTrickWinner,
  getModeConfig,
  teamOfSeat,
  type Card,
  type HokmGameState,
  type Seat,
  type Suit,
} from '@hokm/game-engine';

/**
 * Bot decision making, separated from the turn loop so it can be unit tested
 * without a running game.
 *
 * Three levels, all playing legally but with different awareness:
 *   easy   - plays almost at random, ignores partners and card strength
 *   medium - wins tricks when cheap, does not overtake its own partner
 *   hard   - tracks played cards, saves trumps, leads its long strong suit
 */

export type BotDifficulty = 'easy' | 'medium' | 'hard';

export const BOT_DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'hard'];
export const DEFAULT_BOT_DIFFICULTY: BotDifficulty = 'medium';

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return typeof value === 'string' && (BOT_DIFFICULTIES as string[]).includes(value);
}

export const DIFFICULTY_LABELS: Record<BotDifficulty, string> = {
  easy: 'آسان',
  medium: 'متوسط',
  hard: 'سخت',
};

interface Context {
  game: HokmGameState;
  seat: Seat;
  legal: Card[];
  difficulty: BotDifficulty;
}

/** Picks the card a bot should play from its legal options. */
export function chooseCard(
  game: HokmGameState,
  seat: Seat,
  legal: Card[],
  difficulty: BotDifficulty,
): Card | undefined {
  if (legal.length === 0) return undefined;
  if (legal.length === 1) return legal[0];

  const ctx: Context = { game, seat, legal, difficulty };
  if (difficulty === 'easy') return chooseEasy(ctx);
  return game.currentTrick.plays.length === 0 ? chooseLead(ctx) : chooseFollow(ctx);
}

/**
 * Easy bots play a random legal card.
 *
 * This is genuinely weak rather than "always lowest", which is actually a
 * decent strategy by accident. Random play also feels less robotic.
 */
function chooseEasy({ legal }: Context): Card {
  return legal[Math.floor(Math.random() * legal.length)]!;
}

/** Leading a trick: nobody has played yet, so we set the suit. */
function chooseLead(ctx: Context): Card {
  const { game, seat, legal, difficulty } = ctx;
  const trump = game.trumpSuit;

  if (difficulty === 'hard') {
    // Cash guaranteed winners first: a side card nobody can beat is a free
    // trick, and leading it also strips that suit from the opponents.
    const guaranteed = legal
      .filter((card) => card.suit !== trump && isHighestRemaining(game, card, seat))
      .sort((a, b) => cardRankValue(b) - cardRankValue(a))[0];
    if (guaranteed) return guaranteed;

    // Once our own trumps are the only ones left, draw them out: every trump
    // trick is then ours and our side suits become winners.
    const myTrumps = legal.filter((card) => card.suit === trump);
    if (trump && myTrumps.length > 0 && opponentsHoldNoTrumps(game, seat, trump)) {
      return highest(myTrumps);
    }

    // Otherwise lead the longest side suit to establish it, keeping trumps
    // back for cutting.
    const sideSuits = legal.filter((card) => card.suit !== trump);
    if (sideSuits.length > 0) return highest(longestSuitCards(sideSuits));
  }

  // Medium: lead a strong non-trump card, saving trumps for cutting.
  const nonTrump = legal.filter((card) => card.suit !== trump);
  return highest(nonTrump.length > 0 ? nonTrump : legal);
}

/** Following a trick that is already in progress. */
function chooseFollow(ctx: Context): Card {
  const { game, seat, legal, difficulty } = ctx;
  const trump = game.trumpSuit!;
  const config = getModeConfig(game.mode);

  const leaderSeat = evaluateTrickWinner(game.currentTrick, trump);
  const partnerIsWinning =
    config.teamPlay && teamOfSeat(leaderSeat, config) === teamOfSeat(seat, config);
  const isLastToPlay = game.currentTrick.plays.length === config.seats - 1;

  // Never overtake a partner who is already winning the trick; throw a spare
  // card instead. This was the most obvious flaw in the old bot.
  if (partnerIsWinning) {
    return shed(ctx, trump);
  }

  const winners = legal.filter((card) => beatsCurrentTrick(game, card, seat, trump));
  if (winners.length === 0) {
    // Cannot win: get rid of the least useful card, keeping trumps for cutting.
    return shed(ctx, trump);
  }

  // Win as cheaply as possible. Measured head-to-head, declining a cheap trump
  // early loses far more tricks than the saved trump ever wins back, so both
  // medium and hard simply take the trick.
  void isLastToPlay;
  return lowest(winners);
}

/**
 * Picks a card to throw away on a trick we are not contesting.
 *
 * Hard bots shed from their shortest side suit so they become void in it and
 * can cut it later; measured over hundreds of matches this beats simply
 * throwing the globally lowest card.
 */
function shed({ game, seat, legal, difficulty }: Context, trump: Suit): Card {
  const side = legal.filter((card) => card.suit !== trump);
  const pool = side.length > 0 ? side : legal;
  if (difficulty !== 'hard') return lowest(pool);

  const suitLength = new Map<Suit, number>();
  for (const card of game.hands[seat]) {
    suitLength.set(card.suit, (suitLength.get(card.suit) ?? 0) + 1);
  }
  return [...pool].sort(
    (a, b) =>
      (suitLength.get(a.suit) ?? 0) - (suitLength.get(b.suit) ?? 0) ||
      cardRankValue(a) - cardRankValue(b),
  )[0]!;
}

/** True when playing `card` would currently take the trick. */
function beatsCurrentTrick(game: HokmGameState, card: Card, seat: Seat, trump: Suit): boolean {
  const trick = {
    ...game.currentTrick,
    plays: [...game.currentTrick.plays, { playerId: 'candidate', seat, card }],
  };
  return evaluateTrickWinner(trick, trump) === seat;
}

/**
 * True when no higher card of the same suit can still be held by anyone else.
 * Hard bots use this to know an ace or king is safe to lead.
 */
function isHighestRemaining(game: HokmGameState, card: Card, seat: Seat): boolean {
  const seen = new Set<string>();
  for (const trick of game.completedTricks) {
    for (const play of trick.plays) seen.add(play.card.id);
  }
  for (const play of game.currentTrick.plays) seen.add(play.card.id);
  for (const own of game.hands[seat]) seen.add(own.id);
  for (const removed of game.removedCards ?? []) seen.add(removed.id);

  // Any unseen card of this suit that outranks ours could still beat it.
  return !allCardsOfSuit(card.suit).some(
    (other) => !seen.has(other.id) && cardRankValue(other) > cardRankValue(card),
  );
}

/**
 * True when every trump except our own has already been played.
 * Counting cards this way is exactly what a strong human player does.
 */
function opponentsHoldNoTrumps(game: HokmGameState, seat: Seat, trump: Suit): boolean {
  const played = new Set<string>();
  for (const trick of game.completedTricks) {
    for (const play of trick.plays) played.add(play.card.id);
  }
  for (const play of game.currentTrick.plays) played.add(play.card.id);

  const mine = new Set(game.hands[seat].filter((c) => c.suit === trump).map((c) => c.id));
  const removed = new Set((game.removedCards ?? []).map((c) => c.id));

  return allCardsOfSuit(trump).every(
    (card) => played.has(card.id) || mine.has(card.id) || removed.has(card.id),
  );
}

const RANKS: Card['rank'][] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

function allCardsOfSuit(suit: Suit): Card[] {
  return RANKS.map((rank) => ({ id: `${suit}-${rank}`, suit, rank }));
}

/** Cards from whichever suit the bot holds most of, to establish length. */
function longestSuitCards(cards: Card[]): Card[] {
  const bySuit = new Map<Suit, Card[]>();
  for (const card of cards) {
    bySuit.set(card.suit, [...(bySuit.get(card.suit) ?? []), card]);
  }
  return [...bySuit.values()].sort((a, b) => b.length - a.length)[0] ?? cards;
}

function highest(cards: Card[]): Card {
  return [...cards].sort((a, b) => cardRankValue(b) - cardRankValue(a))[0]!;
}

function lowest(cards: Card[]): Card {
  return [...cards].sort((a, b) => cardRankValue(a) - cardRankValue(b))[0]!;
}

/**
 * Chooses trump from the opening cards.
 * Harder bots weigh suit length as well as raw card strength, because a long
 * trump suit wins far more tricks than a couple of high cards.
 */
export function chooseTrumpSuit(
  game: HokmGameState,
  seat: Seat,
  difficulty: BotDifficulty,
): Suit {
  const hand = game.hands[seat];
  const suits: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

  if (difficulty === 'easy') {
    // Simply the suit with the most cards, ignoring their strength.
    return suits.reduce((best, suit) =>
      hand.filter((c) => c.suit === suit).length > hand.filter((c) => c.suit === best).length
        ? suit
        : best,
    );
  }

  const scores = suits.map((suit) => {
    const cards = hand.filter((card) => card.suit === suit);
    const strength = cards.reduce((sum, card) => sum + cardRankValue(card), 0);
    // Length matters more on hard: each extra card is worth roughly an ace.
    const lengthWeight = difficulty === 'hard' ? 14 : 8;
    return { suit, score: cards.length * lengthWeight + strength };
  });

  return scores.sort((a, b) => b.score - a.score)[0]!.suit;
}

/** Two player mode: which cards to burn before the draw phase. */
export function chooseDiscards(
  game: HokmGameState,
  seat: Seat,
  count: number,
  difficulty: BotDifficulty,
): string[] {
  const hand = [...game.hands[seat]];
  if (difficulty === 'easy') {
    return hand.slice(0, count).map((card) => card.id);
  }
  // Keep trumps and high cards; burn the weakest side cards.
  return hand
    .sort((a, b) => discardValue(a, game.trumpSuit) - discardValue(b, game.trumpSuit))
    .slice(0, count)
    .map((card) => card.id);
}

function discardValue(card: Card, trump: Suit | undefined): number {
  return cardRankValue(card) + (card.suit === trump ? 100 : 0);
}

/** Two player mode: whether to keep a revealed stock card. */
export function shouldKeepDraw(
  card: Card,
  trump: Suit | undefined,
  difficulty: BotDifficulty,
): boolean {
  if (difficulty === 'easy') return true;
  // Trumps are always worth keeping; otherwise only genuinely strong cards.
  if (card.suit === trump) return true;
  return cardRankValue(card) >= (difficulty === 'hard' ? 11 : 10);
}
