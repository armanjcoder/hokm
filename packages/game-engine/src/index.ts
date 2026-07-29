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
  const myHand = state.hands[player.seat];
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, cardCount: state.hands[p.seat].length })),
    myHand,
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

function startNewHand(input: {
  id: string;
  players: Player[];
  hakemSeat: Seat;
  matchScore: Record<TeamId, number>;
  targetScore: number;
  roundNumber: number;
  rng: (() => number) | undefined;
}): HokmGameState {
  const deck = shuffle(createDeck(), input.rng);
  const hands = emptyHands();
  let deckIndex = 0;

  // Opening deal: five cards to each player, starting from hakem. Hakem chooses trump after seeing these cards.
  for (let offset = 0; offset < 4; offset += 1) {
    const seat = ((input.hakemSeat + offset) % 4) as Seat;
    hands[seat].push(...deck.slice(deckIndex, deckIndex + 5));
    deckIndex += 5;
  }

  return {
    id: input.id,
    players: input.players,
    phase: 'waiting_for_trump',
    hakemSeat: input.hakemSeat,
    currentTurnSeat: input.hakemSeat,
    hands: sortHands(hands),
    currentTrick: { leaderSeat: input.hakemSeat, plays: [] },
    completedTricks: [],
    handScore: { tricks: { 0: 0, 1: 0 } },
    matchScore: input.matchScore,
    targetScore: input.targetScore,
    roundNumber: input.roundNumber,
    lastEvent: `راند ${input.roundNumber} شروع شد. حاکم باید حکم کند.`,
  };
}

function finishHand(state: HokmGameState, winningTeam: TeamId): HokmGameState {
  const hakemTeam = getTeamBySeat(state.hakemSeat);
  const loserTeam = winningTeam === 0 ? 1 : 0;
  const loserTricks = state.handScore.tricks[loserTeam as TeamId];
  const kind: NonNullable<HandScore['kind']> = loserTricks === 0
    ? winningTeam === hakemTeam ? 'kot' : 'hakem_kot'
    : 'normal';
  const pointsAwarded = kind === 'hakem_kot' ? 3 : kind === 'kot' ? 2 : 1;
  const matchScore = {
    0: state.matchScore[0] + (winningTeam === 0 ? pointsAwarded : 0),
    1: state.matchScore[1] + (winningTeam === 1 ? pointsAwarded : 0),
  } satisfies Record<TeamId, number>;
  const phase = matchScore[winningTeam] >= state.targetScore ? 'game_complete' : 'hand_complete';

  return {
    ...state,
    phase,
    currentTurnSeat: state.currentTrick.winnerSeat ?? state.currentTurnSeat,
    handScore: { ...state.handScore, winningTeam, kind, pointsAwarded },
    matchScore,
    lastEvent: phase === 'game_complete'
      ? `تیم ${winningTeam + 1} کل بازی را برد.`
      : `تیم ${winningTeam + 1} راند را با ${pointsAwarded} امتیاز برد.`,
  };
}

function emptyHands(): Record<Seat, Card[]> {
  return { 0: [], 1: [], 2: [], 3: [] };
}

function cloneHands(hands: Record<Seat, Card[]>): Record<Seat, Card[]> {
  return { 0: [...hands[0]], 1: [...hands[1]], 2: [...hands[2]], 3: [...hands[3]] };
}

function sortHands(hands: Record<Seat, Card[]>): Record<Seat, Card[]> {
  const suitOrder = new Map<Suit, number>(suits.map((suit, index) => [suit, index]));
  const sorted = cloneHands(hands);
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    sorted[seat].sort((a, b) => (suitOrder.get(a.suit) ?? 0) - (suitOrder.get(b.suit) ?? 0) || cardRankValue(b) - cardRankValue(a));
  }
  return sorted;
}

function validateEveryHandHas13Cards(hands: Record<Seat, Card[]>): void {
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    if (hands[seat].length !== 13) {
      throw new HokmError(`Seat ${seat} has ${hands[seat].length} cards.`, 'INVALID_DEAL');
    }
  }
}

function getPlayer(state: HokmGameState, playerId: string): Player {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new HokmError('Player was not found in this game.', 'PLAYER_NOT_FOUND');
  }
  return player;
}

function getPlayerBySeat(state: HokmGameState, seat: Seat): Player {
  const player = state.players.find((p) => p.seat === seat);
  if (!player) {
    throw new HokmError('Seat is empty.', 'SEAT_NOT_FOUND');
  }
  return player;
}

function assertUnique<T>(values: T[], message: string, code: string): void {
  if (new Set(values).size !== values.length) {
    throw new HokmError(message, code);
  }
}

function cryptoSafeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `game_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
