import { createDeck, HokmError, isLowHand, shuffle, SUITS, cardRankValue, localizeSuit } from './cards.js';
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
  DEFAULT_RULES,
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
    rules: { ...DEFAULT_RULES, ...options.rules },
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

  const reachedTarget = teamsOf(config).find((team) => (tricks[team] ?? 0) >= config.tricksToWin);
  const allTricksPlayed = completedTricks.length >= config.totalTricks;

  // Without the bam rule a hand stops the moment someone reaches the target.
  // With it, play continues so a side can still sweep every trick.
  const stopNow = state.rules.bam
    ? allTricksPlayed || (reachedTarget !== undefined && !canStillSweep(tricks, config, reachedTarget))
    : reachedTarget !== undefined;

  if (stopNow && reachedTarget !== undefined) {
    return finishHand(
      { ...state, hands, completedTricks, currentTrick: completedTrick, handScore },
      reachedTarget,
    );
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

/**
 * True while the leading side could still win every trick of the hand.
 * Once any opponent has taken a trick a bam is impossible, so there is no
 * reason to keep playing a decided hand.
 */
function canStillSweep(
  tricks: Record<number, number>,
  config: ReturnType<typeof getModeConfig>,
  leader: number,
): boolean {
  const takenByOthers = teamsOf(config)
    .filter((team) => team !== leader)
    .reduce((sum, team) => sum + (tricks[team] ?? 0), 0);
  return takenByOthers === 0;
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
    rules: state.rules,
    // A new hand starts the redeal allowance fresh.
    rng,
  });

/**
 * "ده‌لو کم": the hakem may demand a fresh deal when their opening cards hold
 * no face card. The server checks the condition itself, so a client cannot
 * simply claim a weak hand.
 */
}

export function requestRedeal(
  state: HokmGameState,
  playerId: string,
  rng: () => number = Math.random,
): HokmGameState {
  if (state.phase !== 'waiting_for_trump') {
    throw new HokmError('A redeal can only be requested before trump is chosen.', 'INVALID_PHASE');
  }
  const player = getPlayer(state, playerId);
  if (player.seat !== state.hakemSeat) {
    throw new HokmError('Only hakem can request a redeal.', 'NOT_HAKEM');
  }
  if (!state.rules.lowHandRedeal) {
    throw new HokmError('The low hand redeal rule is disabled.', 'REDEAL_DISABLED');
  }
  if (state.redealCount >= state.rules.maxRedeals) {
    throw new HokmError('No redeals remain for this hand.', 'REDEAL_LIMIT');
  }
  if (!isLowHand(state.hands[state.hakemSeat])) {
    throw new HokmError('This hand is not weak enough for a redeal.', 'REDEAL_NOT_ALLOWED');
  }

  const next = startNewHand({
    id: state.id,
    mode: state.mode,
    players: state.players,
    hakemSeat: state.hakemSeat,
    matchScore: state.matchScore,
    targetScore: state.targetScore,
    roundNumber: state.roundNumber,
    rules: state.rules,
    redealCount: state.redealCount + 1,
    rng,
  });
  return {
    ...next,
    lastEvent: `${player.name} ده‌لو کم اعلام کرد؛ کارت‌ها دوباره پخش شد.`,
  };
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
