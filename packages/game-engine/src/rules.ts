import { createDeck, getTeamBySeat, HokmError, nextSeat, shuffle, SUITS, cardRankValue, localizeSuit } from './cards.js';
import {
  cloneHands,
  cryptoSafeId,
  finishHand,
  getPlayer,
  getPlayerBySeat,
  sortHands,
  startNewHand,
  validateEveryHandHas13Cards,
  assertUnique,
} from './internal/state.js';
import type {
  Card,
  CreateGameOptions,
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

export function createGame(playersInput: Array<Omit<Player, 'seat' | 'team'> & Partial<Pick<Player, 'seat'>>>, options: CreateGameOptions = {}): HokmGameState {
  if (playersInput.length !== 4) {
    throw new HokmError('Hokm needs exactly four players.', 'INVALID_PLAYER_COUNT');
  }

  const players = playersInput.map((player, index) => {
    const seat = (player.seat ?? index) as Seat;
    return { id: player.id, name: player.name, seat, team: getTeamBySeat(seat) };
  }).sort((a, b) => a.seat - b.seat);

  assertUnique(players.map((p) => p.id), 'Player ids must be unique.', 'DUPLICATE_PLAYER');
  assertUnique(players.map((p) => p.seat), 'Seats must be unique.', 'DUPLICATE_SEAT');

  return startNewHand({
    id: options.id ?? cryptoSafeId(),
    players,
    hakemSeat: options.hakemSeat ?? 0,
    matchScore: { 0: 0, 1: 0 },
    targetScore: options.targetScore ?? 7,
    roundNumber: 1,
    rng: options.rng,
  });
}

export function chooseTrump(state: HokmGameState, playerId: string, trumpSuit: Suit, rng: () => number = Math.random): HokmGameState {
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

  const dealtCards = new Set(Object.values(state.hands).flat().map((card) => card.id));
  const remainingDeck = shuffle(createDeck().filter((card) => !dealtCards.has(card.id)), rng);
  const hands = cloneHands(state.hands);
  let deckIndex = 0;

  // Complete the traditional 13-card hand. We deal in two 4-card waves and always start from hakem.
  for (let wave = 0; wave < 2; wave += 1) {
    for (let offset = 0; offset < 4; offset += 1) {
      const seat = ((state.hakemSeat + offset) % 4) as Seat;
      hands[seat].push(...remainingDeck.slice(deckIndex, deckIndex + 4));
      deckIndex += 4;
    }
  }

  validateEveryHandHas13Cards(hands);

  return {
    ...state,
    phase: 'playing',
    trumpSuit,
    hands: sortHands(hands),
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

  if (currentTrick.plays.length < 4) {
    return {
      ...state,
      hands,
      currentTrick,
      currentTurnSeat: nextSeat(player.seat),
      lastEvent: `${player.name} یک کارت بازی کرد.`,
    };
  }

  const winnerSeat = evaluateTrickWinner(currentTrick, state.trumpSuit);
  const winningTeam = getTeamBySeat(winnerSeat);
  const completedTrick = { ...currentTrick, winnerSeat };
  const completedTricks = [...state.completedTricks, completedTrick];
  const handScore: HandScore = {
    tricks: {
      0: state.handScore.tricks[0] + (winningTeam === 0 ? 1 : 0),
      1: state.handScore.tricks[1] + (winningTeam === 1 ? 1 : 0),
    },
  };

  const handWinner = handScore.tricks[0] >= 7 ? 0 : handScore.tricks[1] >= 7 ? 1 : undefined;
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
  const hakemTeam = getTeamBySeat(state.hakemSeat);
  const nextHakem = winner === hakemTeam ? state.hakemSeat : nextSeat(state.hakemSeat);

  return startNewHand({
    id: state.id,
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
  // `hands` must never be spread into the view: it holds every player's cards,
  // and this payload is sent straight to a client. Build the view explicitly so
  // adding a field to the state can never leak it by accident.
  const { hands, players, ...rest } = state;
  return {
    ...rest,
    players: players.map((p) => ({ ...p, cardCount: hands[p.seat].length })),
    myHand: hands[player.seat],
    validCardIds: getValidCards(state, playerId).map((card) => card.id),
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
