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
 * All three levels play like a real person rather than a random card picker.
 * They differ in how much they notice:
 *
 *   easy   - knows the basics (take the trick, don't beat your partner) but
 *            slips up now and then, the way a casual player does
 *   medium - never slips: always takes a trick it can win, never overtakes its
 *            partner, and leads from its longest suit
 *   hard   - counts every card: cashes guaranteed winners, draws trumps when
 *            holding a long suit, sheds to create voids, and avoids leading
 *            into a suit an opponent has already shown they can cut
 *
 * Every heuristic here was measured over hundreds of seeded matches rather
 * than assumed; anything that did not actually win more games was removed.
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

/** How often an easy bot plays a careless card instead of the sensible one. */
const EASY_MISTAKE_RATE = 0.25;

/** Trump length at which a hard bot starts drawing the opponents' trumps. */
const DRAW_TRUMPS_FROM = 5;

interface Context {
  game: HokmGameState;
  seat: Seat;
  legal: Card[];
  difficulty: BotDifficulty;
  trump: Suit | undefined;
}

/** Picks the card a bot should play from its legal options. */
export function chooseCard(
  game: HokmGameState,
  seat: Seat,
  legal: Card[],
  difficulty: BotDifficulty,
  random: () => number = Math.random,
): Card | undefined {
  if (legal.length === 0) return undefined;
  if (legal.length === 1) return legal[0];

  // Easy bots are competent most of the time and careless the rest, which
  // feels far more human than always playing the worst card.
  if (difficulty === 'easy' && random() < EASY_MISTAKE_RATE) {
    return legal[Math.floor(random() * legal.length)]!;
  }

  const ctx: Context = { game, seat, legal, difficulty, trump: game.trumpSuit };
  return game.currentTrick.plays.length === 0 ? chooseLead(ctx) : chooseFollow(ctx);
}

/** Leading a trick: nobody has played yet, so we choose the suit. */
function chooseLead(ctx: Context): Card {
  const { game, seat, legal, difficulty, trump } = ctx;
  const sideCards = legal.filter((card) => card.suit !== trump);
  const myTrumps = legal.filter((card) => card.suit === trump);

  if (difficulty === 'hard') {
    // Cash a card nothing can beat: a free trick that also strips the suit.
    const guaranteed = sideCards
      .filter((card) => isHighestRemaining(game, card, seat))
      .sort((a, b) => cardRankValue(b) - cardRankValue(a))[0];
    if (guaranteed) return guaranteed;
  }

  // Counting the opponents' trumps is an expert habit, so only hard bots do it.
  if (difficulty === 'hard' && trump && myTrumps.length > 0) {
    // Once we hold the only trumps left, every trump trick is ours.
    if (opponentsHoldNoTrumps(game, seat, trump)) return highest(myTrumps);
    // A long trump suit is worth spending to strip the opponents.
    if (myTrumps.length >= DRAW_TRUMPS_FROM) return highest(myTrumps);
  }

  if (sideCards.length === 0) return highest(legal);

  const bySuit = groupBySuit(sideCards);
  if (difficulty === 'hard') {
    // Never lead a suit an opponent has already shown they cannot follow,
    // because they would simply cut it.
    const voids = knownVoids(game);
    const opponents = opponentSeats(game, seat);
    const safe = [...bySuit.entries()].filter(
      ([suit]) => !opponents.some((other) => voids.get(other)?.has(suit)),
    );
    const pool = (safe.length > 0 ? safe : [...bySuit.entries()]).sort(
      (a, b) => b[1].length - a[1].length,
    )[0]![1];
    return highest(pool);
  }

  // Medium and easy: lead high from the longest side suit to establish it.
  const longest = [...bySuit.values()].sort((a, b) => b.length - a.length)[0]!;
  return highest(longest);
}

/** Following a trick that is already in progress. */
function chooseFollow(ctx: Context): Card {
  const { game, seat, legal, trump } = ctx;
  const config = getModeConfig(game.mode);

  const leaderSeat = evaluateTrickWinner(game.currentTrick, trump!);
  const partnerIsWinning =
    config.teamPlay && teamOfSeat(leaderSeat, config) === teamOfSeat(seat, config);

  // Never overtake a partner who already has the trick.
  if (partnerIsWinning) return shed(ctx);

  const winners = legal.filter((card) => beatsCurrentTrick(game, card, seat, trump!));
  // Measured: declining a cheap trump to "save" it loses more tricks than it
  // ever wins back, so all levels simply take the trick when they can.
  return winners.length > 0 ? lowest(winners) : shed(ctx);
}

/**
 * Picks a card to throw away on a trick we are not contesting.
 *
 * Hard bots shed from their shortest side suit so they become void and can cut
 * that suit later. Easy and medium bots simply throw their lowest card, which
 * is what most human players do.
 */
function shed({ game, seat, legal, difficulty, trump }: Context): Card {
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

/** Every card that has been played, is on the table, or was removed pre-deal. */
function playedCardIds(game: HokmGameState): Set<string> {
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
function isHighestRemaining(game: HokmGameState, card: Card, seat: Seat): boolean {
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
function opponentsHoldNoTrumps(game: HokmGameState, seat: Seat, trump: Suit): boolean {
  const seen = playedCardIds(game);
  for (const own of game.hands[seat]) seen.add(own.id);
  return allCardsOfSuit(trump).every((card) => seen.has(card.id));
}

/**
 * Suits each seat has shown they cannot follow.
 * Failing to follow the led suit proves a player is out of it.
 */
function knownVoids(game: HokmGameState): Map<Seat, Set<Suit>> {
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

function opponentSeats(game: HokmGameState, seat: Seat): Seat[] {
  const config = getModeConfig(game.mode);
  return game.players
    .filter(
      (player) =>
        !config.teamPlay || teamOfSeat(player.seat, config) !== teamOfSeat(seat, config),
    )
    .map((player) => player.seat);
}

function groupBySuit(cards: Card[]): Map<Suit, Card[]> {
  const bySuit = new Map<Suit, Card[]>();
  for (const card of cards) {
    bySuit.set(card.suit, [...(bySuit.get(card.suit) ?? []), card]);
  }
  return bySuit;
}

const RANKS: Card['rank'][] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

function allCardsOfSuit(suit: Suit): Card[] {
  return RANKS.map((rank) => ({ id: `${suit}-${rank}`, suit, rank }));
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

  const scores = suits.map((suit) => {
    const cards = hand.filter((card) => card.suit === suit);
    const strength = cards.reduce((sum, card) => sum + cardRankValue(card), 0);
    // Length matters more on hard: each extra card is worth roughly an ace.
    const lengthWeight = difficulty === 'hard' ? 14 : difficulty === 'medium' ? 10 : 8;
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
  // Every level keeps trumps and high cards now; easy simply values them less.
  const trumpBonus = difficulty === 'easy' ? 20 : 100;
  return hand
    .sort((a, b) => discardValue(a, game.trumpSuit, trumpBonus) - discardValue(b, game.trumpSuit, trumpBonus))
    .slice(0, count)
    .map((card) => card.id);
}

function discardValue(card: Card, trump: Suit | undefined, trumpBonus: number): number {
  return cardRankValue(card) + (card.suit === trump ? trumpBonus : 0);
}

/** Two player mode: whether to keep a revealed stock card. */
export function shouldKeepDraw(
  card: Card,
  trump: Suit | undefined,
  difficulty: BotDifficulty,
): boolean {
  // Trumps are always worth keeping.
  if (card.suit === trump) return true;
  // Otherwise only genuinely strong cards; easy bots are less selective.
  const threshold = difficulty === 'hard' ? 11 : difficulty === 'medium' ? 10 : 9;
  return cardRankValue(card) >= threshold;
}
