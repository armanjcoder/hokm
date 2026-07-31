import { cardRankValue, createDeck, getTeamBySeat, HokmError, shuffle, SUITS } from '../cards.js';
import type { Card, HandScore, HokmGameState, Player, Seat, Suit, TeamId } from '../types.js';

const suits = SUITS;

export function startNewHand(input: {
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

export function finishHand(state: HokmGameState, winningTeam: TeamId): HokmGameState {
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

export function emptyHands(): Record<Seat, Card[]> {
  return { 0: [], 1: [], 2: [], 3: [] };
}

export function cloneHands(hands: Record<Seat, Card[]>): Record<Seat, Card[]> {
  return { 0: [...hands[0]], 1: [...hands[1]], 2: [...hands[2]], 3: [...hands[3]] };
}

export function sortHands(hands: Record<Seat, Card[]>): Record<Seat, Card[]> {
  const suitOrder = new Map<Suit, number>(suits.map((suit, index) => [suit, index]));
  const sorted = cloneHands(hands);
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    sorted[seat].sort((a, b) => (suitOrder.get(a.suit) ?? 0) - (suitOrder.get(b.suit) ?? 0) || cardRankValue(b) - cardRankValue(a));
  }
  return sorted;
}

export function validateEveryHandHas13Cards(hands: Record<Seat, Card[]>): void {
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    if (hands[seat].length !== 13) {
      throw new HokmError(`Seat ${seat} has ${hands[seat].length} cards.`, 'INVALID_DEAL');
    }
  }
}

export function getPlayer(state: HokmGameState, playerId: string): Player {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new HokmError('Player was not found in this game.', 'PLAYER_NOT_FOUND');
  }
  return player;
}

export function getPlayerBySeat(state: HokmGameState, seat: Seat): Player {
  const player = state.players.find((p) => p.seat === seat);
  if (!player) {
    throw new HokmError('Seat is empty.', 'SEAT_NOT_FOUND');
  }
  return player;
}

export function assertUnique<T>(values: T[], message: string, code: string): void {
  if (new Set(values).size !== values.length) {
    throw new HokmError(message, code);
  }
}

export function cryptoSafeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `game_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
