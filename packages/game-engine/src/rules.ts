import { createDeck, HokmError, shuffle, SUITS, cardRankValue, localizeSuit } from './cards.js';
import {
  getModeConfig,
  isGameMode,
  nextSeatFor,
  teamOfSeat,
  teamsOf,
  type ModeConfig,
} from './modes.js';
import {
  cloneHands,
  cryptoSafeId,
  emptyTrickScore,
  finishHand,
  getPlayer,
  getPlayerBySeat,
  sortHands,
  startNewHand,
  trimDeckForMode,
  validateDeal,
  assertUnique,
} from './internal/state.js';
import type {
  Card,
  CreateGameOptions,
  GameMode,
  HandScore,
  HokmGameState,
  Player,
  PublicGameView,
  Seat,
  Suit,
  Trick,
  TrickPlay,
} from './types.js';

const suits = SUITS;

export function createGame(
  playersInput: Array<Omit<Player, 'seat' | 'team'> & Partial<Pick<Player, 'seat'>>>,
  options: CreateGameOptions = {},
): HokmGameState {
  const mode: GameMode = isGameMode(options.mode) ? options.mode : 'classic4';
  const config = getModeConfig(mode);

  if (playersInput.length !== config.seats) {
    throw new HokmError(
      `${config.label} needs exactly ${config.seats} players.`,
      'INVALID_PLAYER_COUNT',
    );
  }

  const players = playersInput
    .map((player, index) => {
      const seat = (player.seat ?? index) as Seat;
      return { id: player.id, name: player.name, seat, team: teamOfSeat(seat, config) };
    })
    .sort((a, b) => a.seat - b.seat);

  assertUnique(players.map((p) => p.id), 'Player ids must be unique.', 'DUPLICATE_PLAYER');
  assertUnique(players.map((p) => p.seat), 'Seats must be unique.', 'DUPLICATE_SEAT');
  for (const player of players) {
    if (player.seat >= config.seats) {
      throw new HokmError(`Seat ${player.seat} does not exist in ${config.label}.`, 'SEAT_NOT_FOUND');
    }
  }

  const matchScore = Object.fromEntries(teamsOf(config).map((team) => [team, 0]));
  return startNewHand({
    id: options.id ?? cryptoSafeId(),
    mode,
    players,
    hakemSeat: options.hakemSeat ?? 0,
    matchScore,
    targetScore: options.targetScore ?? 7,
    roundNumber: 1,
    rng: options.rng,
  });
}

export function chooseTrump(
  state: HokmGameState,
  playerId: string,
  trumpSuit: Suit,
  rng: () => number = Math.random,
): HokmGameState {
  if (state.phase !== 'waiting_for_trump') {
    throw new HokmError('Trump can only be selected at the start of a hand.', 'INVALID_PHASE');
  }
  const player = getPlayer(state, playerId);
  if (player.seat !== state.hakemSeat) {
    throw new HokmError('Only hakem can choose trump.', 'NOT_HAKEM');
  }
  if (!suits.includes(trumpSuit)) {
    throw new HokmError('Invalid trump suit.', 'INVALID_TRUMP');
  }

  const config = getModeConfig(state.mode);
  const dealtCards = new Set(Object.values(state.hands).flat().map((card) => card.id));
  const undealt = createDeck().filter((card) => !dealtCards.has(card.id));

  // Three player Hokm removes one low card so 51 cards split evenly into 17.
  const { kept, removed } = trimDeckForMode(undealt, config, trumpSuit);
  const remainingDeck = shuffle(kept, rng);

  if (config.usesDrawPhase) {
    // Two player Hokm: both sides discard, then draw alternately from the stock.
    return {
      ...state,
      phase: 'discarding',
      trumpSuit,
      stock: remainingDeck,
      discardedSeats: [],
      removedCards: removed,
      currentTurnSeat: state.hakemSeat,
      lastEvent: `حاکم خال ${localizeSuit(trumpSuit)} را حکم کرد. حالا هرکس ${config.discardCount} کارت می‌سوزاند.`,
    };
  }

  const hands = cloneHands(state.hands);
  let deckIndex = 0;
  for (const waveSize of config.followUpDeals) {
    for (let offset = 0; offset < config.seats; offset += 1) {
      const seat = ((state.hakemSeat + offset) % config.seats) as Seat;
      hands[seat].push(...remainingDeck.slice(deckIndex, deckIndex + waveSize));
      deckIndex += waveSize;
    }
  }
  validateDeal(hands, config);

  return {
    ...state,
    phase: 'playing',
    trumpSuit,
    hands: sortHands(hands),
    stock: [],
    removedCards: removed,
    currentTurnSeat: state.hakemSeat,
    currentTrick: { leaderSeat: state.hakemSeat, plays: [] },
    lastEvent: `حاکم خال ${localizeSuit(trumpSuit)} را حکم کرد.`,
  };
}

/**
 * Two player Hokm: each side burns `discardCount` cards face down before the
 * draw phase begins. Play starts only once both have discarded.
 */
export function discardCards(state: HokmGameState, playerId: string, cardIds: string[]): HokmGameState {
  const config = getModeConfig(state.mode);
  if (state.phase !== 'discarding') {
    throw new HokmError('Discarding is not allowed right now.', 'INVALID_PHASE');
  }
  const player = getPlayer(state, playerId);
  if ((state.discardedSeats ?? []).includes(player.seat)) {
    throw new HokmError('This player already discarded.', 'ALREADY_DISCARDED');
  }
  if (cardIds.length !== config.discardCount) {
    throw new HokmError(`Exactly ${config.discardCount} cards must be discarded.`, 'INVALID_DISCARD');
  }
  assertUnique(cardIds, 'Cannot discard the same card twice.', 'INVALID_DISCARD');

  const hands = cloneHands(state.hands);
  const hand = hands[player.seat];
  for (const cardId of cardIds) {
    const index = hand.findIndex((card) => card.id === cardId);
    if (index === -1) throw new HokmError('Card was not found in player hand.', 'CARD_NOT_FOUND');
    hand.splice(index, 1);
  }

  const discardedSeats = [...(state.discardedSeats ?? []), player.seat];
  const everyoneDiscarded = discardedSeats.length >= config.seats;

  return {
    ...state,
    hands,
    discardedSeats,
    // Hakem always draws first.
    phase: everyoneDiscarded ? 'drawing' : 'discarding',
    currentTurnSeat: everyoneDiscarded ? state.hakemSeat : state.currentTurnSeat,
    lastEvent: everyoneDiscarded
      ? 'هر دو بازیکن کارت سوزاندند. حالا نوبت برداشتن از دسته است.'
      : `${player.name} کارت‌هایش را سوزاند.`,
  };
}

/**
 * Two player Hokm draw step: reveals the top stock card to the player on turn.
 * They then keep it (and burn the next one) or burn it (and must take the next).
 */
export function drawCard(state: HokmGameState, playerId: string): HokmGameState {
  if (state.phase !== 'drawing') {
    throw new HokmError('Drawing is not allowed right now.', 'INVALID_PHASE');
  }
  const player = getPlayer(state, playerId);
  if (player.seat !== state.currentTurnSeat) {
    throw new HokmError('It is not this player’s turn.', 'NOT_YOUR_TURN');
  }
  if (state.pendingDraw) {
    throw new HokmError('Resolve the revealed card first.', 'DRAW_PENDING');
  }

  const stock = [...(state.stock ?? [])];
  const card = stock.shift();
  if (!card) throw new HokmError('The stock is empty.', 'EMPTY_STOCK');

  return {
    ...state,
    stock,
    pendingDraw: { seat: player.seat, card },
    lastEvent: `${player.name} یک کارت از دسته برداشت.`,
  };
}

/**
 * Resolves a revealed draw.
 *
 * Keeping it means the next stock card is burned unseen; burning it means the
 * next card must be taken sight unseen. That trade-off is the heart of the
 * two player variant.
 */
export function resolveDraw(state: HokmGameState, playerId: string, keep: boolean): HokmGameState {
  const config = getModeConfig(state.mode);
  if (state.phase !== 'drawing' || !state.pendingDraw) {
    throw new HokmError('There is no revealed card to resolve.', 'INVALID_PHASE');
  }
  const player = getPlayer(state, playerId);
  if (player.seat !== state.pendingDraw.seat) {
    throw new HokmError('It is not this player’s turn.', 'NOT_YOUR_TURN');
  }

  const hands = cloneHands(state.hands);
  const stock = [...(state.stock ?? [])];
  const revealed = state.pendingDraw.card;

  if (keep) {
    hands[player.seat].push(revealed);
    // The follow-up card is burned without being seen.
    stock.shift();
  } else {
    const forced = stock.shift();
    // Burning the revealed card obliges the player to take the next one.
    if (forced) hands[player.seat].push(forced);
  }

  const full = [...Array(config.seats).keys()].every(
    (seat) => hands[seat as Seat].length >= config.handSize,
  );
  const stockExhausted = stock.length === 0;
  const done = full || stockExhausted;

  if (done) {
    validateDeal(hands, config);
    return {
      ...state,
      hands: sortHands(hands),
      stock: [],
      pendingDraw: undefined,
      phase: 'playing',
      currentTurnSeat: state.hakemSeat,
      currentTrick: { leaderSeat: state.hakemSeat, plays: [] },
      lastEvent: 'برداشتن کارت‌ها تمام شد. بازی شروع می‌شود.',
    };
  }

  return {
    ...state,
    hands: sortHands(hands),
    stock,
    pendingDraw: undefined,
    currentTurnSeat: nextSeatFor(player.seat, config),
    lastEvent: keep ? `${player.name} کارت را نگه داشت.` : `${player.name} کارت را سوزاند.`,
  };
}

export function getValidCards(state: HokmGameState, playerId: string): Card[] {
  const player = getPlayer(state, playerId);
  const hand = state.hands[player.seat];
  if (state.phase !== 'playing' || player.seat !== state.currentTurnSeat) {
    return [];
  }
  const leadSuit = state.currentTrick.plays[0]?.card.suit;
  if (!leadSuit) {
    return hand;
  }
  const sameSuitCards = hand.filter((card) => card.suit === leadSuit);
  return sameSuitCards.length > 0 ? sameSuitCards : hand;
}

export function playCard(state: HokmGameState, playerId: string, cardId: string): HokmGameState {
  if (state.phase !== 'playing') {
    throw new HokmError('Cards can only be played while the hand is active.', 'INVALID_PHASE');
  }
  if (!state.trumpSuit) {
    throw new HokmError('Trump suit is not selected yet.', 'NO_TRUMP');
  }

  const player = getPlayer(state, playerId);
  if (player.seat !== state.currentTurnSeat) {
    throw new HokmError('It is not this player’s turn.', 'NOT_YOUR_TURN');
  }

  const validCards = getValidCards(state, playerId);
  if (!validCards.some((card) => card.id === cardId)) {
    throw new HokmError('This card is not a legal move.', 'ILLEGAL_CARD');
  }

  const hands = cloneHands(state.hands);
  const cardIndex = hands[player.seat].findIndex((card) => card.id === cardId);
  const [card] = hands[player.seat].splice(cardIndex, 1);
  if (!card) {
    throw new HokmError('Card was not found in player hand.', 'CARD_NOT_FOUND');
  }

  const currentTrick: Trick = {
    ...state.currentTrick,
    plays: [...state.currentTrick.plays, { playerId, seat: player.seat, card }],
  };

  const config = getModeConfig(state.mode);
  if (currentTrick.plays.length < config.seats) {
    return {
      ...state,
      hands,
      currentTrick,
      currentTurnSeat: nextSeatFor(player.seat, config),
      lastEvent: `${player.name} یک کارت بازی کرد.`,
    };
  }

  const winnerSeat = evaluateTrickWinner(currentTrick, state.trumpSuit);
  const winningTeam = teamOfSeat(winnerSeat, config);
  const completedTrick = { ...currentTrick, winnerSeat };
  const completedTricks = [...state.completedTricks, completedTrick];
  const tricks = { ...state.handScore.tricks };
  tricks[winningTeam] = (tricks[winningTeam] ?? 0) + 1;
  const handScore: HandScore = { tricks };

  const handWinner = teamsOf(config).find((team) => (tricks[team] ?? 0) >= config.tricksToWin);
  if (handWinner !== undefined) {
    return finishHand({ ...state, hands, completedTricks, currentTrick: completedTrick, handScore }, handWinner);
  }

  return {
    ...state,
    hands,
    completedTricks,
    handScore,
    currentTrick: { leaderSeat: winnerSeat, plays: [] },
    currentTurnSeat: winnerSeat,
    lastEvent: `دست را ${getPlayerBySeat(state, winnerSeat).name} گرفت.`,
  };
}

export function continueToNextHand(state: HokmGameState, rng: () => number = Math.random): HokmGameState {
  if (state.phase !== 'hand_complete') {
    throw new HokmError('Next hand can only start after a completed hand.', 'INVALID_PHASE');
  }
  const winner = state.handScore.winningTeam;
  if (winner === undefined) {
    throw new HokmError('Cannot continue before hand winner is known.', 'NO_HAND_WINNER');
  }
  const config = getModeConfig(state.mode);
  const hakemTeam = teamOfSeat(state.hakemSeat, config);
  const nextHakem = winner === hakemTeam ? state.hakemSeat : nextSeatFor(state.hakemSeat, config);

  return startNewHand({
    id: state.id,
    mode: state.mode,
    players: state.players,
    hakemSeat: nextHakem,
    matchScore: state.matchScore,
    targetScore: state.targetScore,
    roundNumber: state.roundNumber + 1,
    rng,
  });
}

export function toPublicView(state: HokmGameState, playerId: string): PublicGameView {
  const player = getPlayer(state, playerId);
  // `hands` and `stock` must never be spread into the view: they hold cards no
  // client may see. Destructure them out explicitly so adding a field to the
  // state can never leak it by accident.
  const { hands, players, stock, ...rest } = state;
  return {
    ...rest,
    players: players.map((p) => ({ ...p, cardCount: hands[p.seat].length })),
    myHand: hands[player.seat],
    validCardIds: getValidCards(state, playerId).map((card) => card.id),
    stockCount: stock?.length ?? 0,
    // Only the drawing player may see the revealed card.
    pendingDraw: state.pendingDraw?.seat === player.seat ? state.pendingDraw : undefined,
  };
}

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
