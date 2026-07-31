import { cardRankValue, createDeck, HokmError, isLowHand, shuffle, SUITS } from '../cards.js';
import { getModeConfig, suitsToTrim, teamOfSeat, teamsOf, TRIMMED_RANK, type ModeConfig } from '../modes.js';
import type { Card, GameMode, HandScore, HokmGameState, OptionalRules, Player, Seat, Suit, TeamId } from '../types.js';

const suits = SUITS;

/** Zeroed trick counters for every team a mode uses. */
export function emptyTrickScore(config: ModeConfig): Record<TeamId, number> {
  return Object.fromEntries(teamsOf(config).map((team) => [team, 0])) as Record<TeamId, number>;
}

export const DEFAULT_RULES: OptionalRules = {
  lowHandRedeal: false,
  maxRedeals: 2,
  bam: false,
};

export function startNewHand(input: {
  id: string;
  mode: GameMode;
  players: Player[];
  hakemSeat: Seat;
  matchScore: Record<TeamId, number>;
  targetScore: number;
  roundNumber: number;
  rules: OptionalRules;
  /** Carried across a redeal so the limit is not reset by dealing again. */
  redealCount?: number;
  rng: (() => number) | undefined;
}): HokmGameState {
  const config = getModeConfig(input.mode);
  const deck = shuffle(createDeck(), input.rng);
  const hands = emptyHands();
  let deckIndex = 0;

  // Opening deal, starting from hakem. Hakem chooses trump after seeing these.
  for (let offset = 0; offset < config.seats; offset += 1) {
    const seat = ((input.hakemSeat + offset) % config.seats) as Seat;
    hands[seat].push(...deck.slice(deckIndex, deckIndex + config.initialDeal));
    deckIndex += config.initialDeal;
  }

  const redealCount = input.redealCount ?? 0;
  const canRequestRedeal =
    input.rules.lowHandRedeal &&
    redealCount < input.rules.maxRedeals &&
    isLowHand(hands[input.hakemSeat]);

  return {
    id: input.id,
    mode: input.mode,
    players: input.players,
    rules: input.rules,
    redealCount,
    canRequestRedeal,
    phase: 'waiting_for_trump',
    hakemSeat: input.hakemSeat,
    currentTurnSeat: input.hakemSeat,
    hands: sortHands(hands),
    currentTrick: { leaderSeat: input.hakemSeat, plays: [] },
    completedTricks: [],
    handScore: { tricks: emptyTrickScore(config) },
    matchScore: input.matchScore,
    targetScore: input.targetScore,
    roundNumber: input.roundNumber,
    // Everything after the opening deal is dealt once trump is known.
    stock: deck.slice(deckIndex),
    lastEvent: `راند ${input.roundNumber} شروع شد. حاکم باید حکم کند.`,
  };
}

export function finishHand(state: HokmGameState, winningTeam: TeamId): HokmGameState {
  const config = getModeConfig(state.mode);
  const hakemTeam = teamOfSeat(state.hakemSeat, config);
  const otherTeams = teamsOf(config).filter((team) => team !== winningTeam);
  // A "kot" means every opponent finished the hand without taking a trick.
  const opponentsShutOut = otherTeams.every((team) => (state.handScore.tricks[team] ?? 0) === 0);

  // A "bam" is a clean sweep of every trick in the hand.
  const sweptEveryTrick =
    state.rules.bam && (state.handScore.tricks[winningTeam] ?? 0) >= config.totalTricks;

  const kind: NonNullable<HandScore['kind']> = sweptEveryTrick
    ? winningTeam === hakemTeam
      ? 'bam'
      : 'hakem_bam'
    : opponentsShutOut
      ? winningTeam === hakemTeam
        ? 'kot'
        : 'hakem_kot'
      : 'normal';

  const POINTS: Record<NonNullable<HandScore['kind']>, number> = {
    normal: 1,
    kot: 2,
    hakem_kot: 3,
    bam: 3,
    hakem_bam: 3,
  };
  const pointsAwarded = POINTS[kind];

  const matchScore = { ...state.matchScore };
  matchScore[winningTeam] = (matchScore[winningTeam] ?? 0) + pointsAwarded;

  // A bam ends the entire match immediately, whatever the score is.
  const isBam = kind === 'bam' || kind === 'hakem_bam';
  const phase =
    isBam || (matchScore[winningTeam] ?? 0) >= state.targetScore ? 'game_complete' : 'hand_complete';

  const label = winnerLabel(state, winningTeam, config);
  if (isBam) {
    return {
      ...state,
      phase,
      currentTurnSeat: state.currentTrick.winnerSeat ?? state.currentTurnSeat,
      handScore: { ...state.handScore, winningTeam, kind, pointsAwarded },
      matchScore,
      lastEvent: `${label} بام کرد و کل بازی را برد!`,
    };
  }

  return {
    ...state,
    phase,
    currentTurnSeat: state.currentTrick.winnerSeat ?? state.currentTurnSeat,
    handScore: { ...state.handScore, winningTeam, kind, pointsAwarded },
    matchScore,
    lastEvent:
      phase === 'game_complete'
        ? `${label} کل بازی را برد.`
        : `${label} راند را با ${pointsAwarded} امتیاز برد.`,
  };
}

/** In team play we name the team; otherwise the individual player. */
function winnerLabel(state: HokmGameState, team: TeamId, config: ModeConfig): string {
  if (config.teamPlay) return `تیم ${team + 1}`;
  return state.players.find((player) => player.seat === team)?.name ?? `بازیکن ${team + 1}`;
}

/**
 * Removes low cards so the deck divides evenly between players.
 * The trump suit is never trimmed so trump strength is unaffected.
 */
export function trimDeckForMode(
  cards: Card[],
  config: ModeConfig,
  trumpSuit: Suit | undefined,
): { kept: Card[]; removed: Card[] } {
  const targets = new Set(suitsToTrim(config, trumpSuit, suits));
  if (targets.size === 0) return { kept: cards, removed: [] };

  const removed: Card[] = [];
  const kept = cards.filter((card) => {
    if (card.rank === TRIMMED_RANK && targets.has(card.suit) && !removed.some((r) => r.suit === card.suit)) {
      removed.push(card);
      return false;
    }
    return true;
  });
  return { kept, removed };
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
    sorted[seat].sort(
      (a, b) => (suitOrder.get(a.suit) ?? 0) - (suitOrder.get(b.suit) ?? 0) || cardRankValue(b) - cardRankValue(a),
    );
  }
  return sorted;
}

/** Confirms every seated player ended up with the hand size the mode expects. */
export function validateDeal(hands: Record<Seat, Card[]>, config: ModeConfig): void {
  for (let seat = 0; seat < config.seats; seat += 1) {
    const count = hands[seat as Seat].length;
    if (count !== config.handSize) {
      throw new HokmError(`Seat ${seat} has ${count} cards.`, 'INVALID_DEAL');
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
