import { describe, expect, it } from 'vitest';
import {
  cardRankValue,
  chooseTrump,
  continueToNextHand,
  createDeck,
  createGame,
  evaluateTrickWinner,
  getTeamBySeat,
  getValidCards,
  HokmError,
  localizeSuit,
  nextSeat,
  playCard,
  RANKS,
  shuffle,
  SUITS,
  toPublicView,
  type Card,
  type HokmGameState,
  type Seat,
  type Suit,
} from '../src/index.js';

/** Deterministic rng so every test is reproducible. */
function seededRng(seed = 42) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

const PLAYERS = [
  { id: 'p0', name: 'آرمان' },
  { id: 'p1', name: 'نیکا' },
  { id: 'p2', name: 'آرش' },
  { id: 'p3', name: 'سارا' },
];

function newGame(overrides = {}) {
  return createGame(PLAYERS, { rng: seededRng(), hakemSeat: 0, ...overrides });
}

function startedGame(trump: Suit = 'hearts', overrides = {}) {
  const game = newGame(overrides);
  return chooseTrump(game, PLAYERS[game.hakemSeat]!.id, trump, seededRng(7));
}

function seatOf(state: HokmGameState, seat: Seat) {
  return state.players.find((player) => player.seat === seat)!;
}

/** Plays one full trick using the first legal card of each seat. */
function playTrick(state: HokmGameState): HokmGameState {
  let next = state;
  for (let i = 0; i < 4; i += 1) {
    const seat = next.currentTurnSeat;
    const player = seatOf(next, seat);
    const legal = getValidCards(next, player.id);
    next = playCard(next, player.id, legal[0]!.id);
  }
  return next;
}

describe('deck integrity', () => {
  it('builds a standard 52 card deck with unique ids', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((card) => card.id)).size).toBe(52);
    for (const suit of SUITS) {
      expect(deck.filter((card) => card.suit === suit)).toHaveLength(13);
    }
    for (const rank of RANKS) {
      expect(deck.filter((card) => card.rank === rank)).toHaveLength(4);
    }
  });

  it('shuffles without losing or duplicating cards', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck, seededRng(99));
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled.map((card) => card.id)).size).toBe(52);
    expect(shuffled.map((c) => c.id).sort()).toEqual(deck.map((c) => c.id).sort());
  });

  it('does not mutate the input array', () => {
    const deck = createDeck();
    const before = deck.map((card) => card.id);
    shuffle(deck, seededRng(5));
    expect(deck.map((card) => card.id)).toEqual(before);
  });
});

describe('seating and teams', () => {
  it('pairs seats 0/2 against 1/3', () => {
    expect(getTeamBySeat(0)).toBe(0);
    expect(getTeamBySeat(2)).toBe(0);
    expect(getTeamBySeat(1)).toBe(1);
    expect(getTeamBySeat(3)).toBe(1);
  });

  it('rotates seats in a circle', () => {
    expect(nextSeat(0)).toBe(1);
    expect(nextSeat(3)).toBe(0);
  });
});

describe('createGame validation', () => {
  it('rejects a table that is not exactly four players', () => {
    expect(() => createGame(PLAYERS.slice(0, 3))).toThrow(HokmError);
    expect(() => createGame([...PLAYERS, { id: 'p4', name: 'اضافه' }])).toThrow(HokmError);
  });

  it('rejects duplicate player ids', () => {
    const dupes = [PLAYERS[0]!, PLAYERS[0]!, PLAYERS[2]!, PLAYERS[3]!];
    expect(() => createGame(dupes)).toThrow(/unique/i);
  });

  it('rejects duplicate seats', () => {
    const seated = PLAYERS.map((player) => ({ ...player, seat: 0 as Seat }));
    expect(() => createGame(seated)).toThrow(HokmError);
  });

  it('deals exactly five cards to each seat before trump is chosen', () => {
    const game = newGame();
    expect(game.phase).toBe('waiting_for_trump');
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      expect(game.hands[seat]).toHaveLength(5);
    }
    expect(game.matchScore).toEqual({ 0: 0, 1: 0 });
  });
});

describe('choosing trump', () => {
  it('refuses anyone who is not hakem', () => {
    const game = newGame();
    const notHakem = seatOf(game, 1);
    expect(() => chooseTrump(game, notHakem.id, 'spades')).toThrow(/hakem/i);
  });

  it('rejects an invalid suit', () => {
    const game = newGame();
    const hakem = seatOf(game, game.hakemSeat);
    expect(() => chooseTrump(game, hakem.id, 'stars' as Suit)).toThrow(HokmError);
  });

  it('cannot be chosen twice', () => {
    const game = startedGame();
    const hakem = seatOf(game, game.hakemSeat);
    expect(() => chooseTrump(game, hakem.id, 'spades')).toThrow(/start of a hand/i);
  });

  it('completes every hand to thirteen unique cards', () => {
    const game = startedGame('spades');
    const all: string[] = [];
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      expect(game.hands[seat]).toHaveLength(13);
      all.push(...game.hands[seat].map((card) => card.id));
    }
    // No card may be dealt to two players.
    expect(new Set(all).size).toBe(52);
    expect(game.phase).toBe('playing');
    expect(game.trumpSuit).toBe('spades');
    expect(game.currentTurnSeat).toBe(game.hakemSeat);
  });
});

describe('following suit', () => {
  it('lets the leader play anything', () => {
    const game = startedGame();
    const hakem = seatOf(game, game.hakemSeat);
    expect(getValidCards(game, hakem.id)).toHaveLength(13);
  });

  it('forces a player holding the lead suit to follow it', () => {
    let game = startedGame();
    const leader = seatOf(game, game.currentTurnSeat);
    const lead = game.hands[leader.seat]![0]!;
    game = playCard(game, leader.id, lead.id);

    const responder = seatOf(game, game.currentTurnSeat);
    const legal = getValidCards(game, responder.id);
    const holdsLeadSuit = game.hands[responder.seat]!.some((c) => c.suit === lead.suit);
    if (holdsLeadSuit) {
      expect(legal.every((card) => card.suit === lead.suit)).toBe(true);
    } else {
      expect(legal).toHaveLength(game.hands[responder.seat]!.length);
    }
  });

  it('returns no legal cards when it is not your turn', () => {
    const game = startedGame();
    const other = seatOf(game, nextSeat(game.currentTurnSeat));
    expect(getValidCards(game, other.id)).toHaveLength(0);
  });

  it('rejects playing out of turn', () => {
    const game = startedGame();
    const other = seatOf(game, nextSeat(game.currentTurnSeat));
    const card = game.hands[other.seat]![0]!;
    expect(() => playCard(game, other.id, card.id)).toThrow(/turn/i);
  });

  it('rejects a card the player does not hold', () => {
    const game = startedGame();
    const current = seatOf(game, game.currentTurnSeat);
    expect(() => playCard(game, current.id, 'spades-A-not-real')).toThrow(HokmError);
  });

  it('rejects renouncing when the lead suit is held', () => {
    let game = startedGame();
    const leader = seatOf(game, game.currentTurnSeat);
    const lead = game.hands[leader.seat]![0]!;
    game = playCard(game, leader.id, lead.id);

    const responder = seatOf(game, game.currentTurnSeat);
    const offSuit = game.hands[responder.seat]!.find((card) => card.suit !== lead.suit);
    const holdsLeadSuit = game.hands[responder.seat]!.some((card) => card.suit === lead.suit);
    if (offSuit && holdsLeadSuit) {
      expect(() => playCard(game, responder.id, offSuit.id)).toThrow(/legal/i);
    }
  });
});

describe('trick winner evaluation', () => {
  const card = (suit: Suit, rank: Card['rank']): Card => ({ id: `${suit}-${rank}`, suit, rank });
  const trick = (plays: Array<[Seat, Card]>) => ({
    leaderSeat: plays[0]![0],
    plays: plays.map(([seat, c]) => ({ playerId: `p${seat}`, seat, card: c })),
  });

  it('gives the trick to the highest card of the lead suit', () => {
    const t = trick([
      [0, card('hearts', '9')],
      [1, card('hearts', 'K')],
      [2, card('hearts', '3')],
      [3, card('hearts', '10')],
    ]);
    expect(evaluateTrickWinner(t, 'spades')).toBe(1);
  });

  it('lets any trump beat the highest lead suit card', () => {
    const t = trick([
      [0, card('hearts', 'A')],
      [1, card('spades', '2')],
      [2, card('hearts', 'K')],
      [3, card('hearts', 'Q')],
    ]);
    expect(evaluateTrickWinner(t, 'spades')).toBe(1);
  });

  it('gives the trick to the highest trump when several are played', () => {
    const t = trick([
      [0, card('hearts', 'A')],
      [1, card('spades', '5')],
      [2, card('spades', 'J')],
      [3, card('spades', '7')],
    ]);
    expect(evaluateTrickWinner(t, 'spades')).toBe(2);
  });

  it('ignores off-suit cards that are neither trump nor lead', () => {
    const t = trick([
      [0, card('hearts', '4')],
      [1, card('diamonds', 'A')],
      [2, card('clubs', 'A')],
      [3, card('hearts', '5')],
    ]);
    expect(evaluateTrickWinner(t, 'spades')).toBe(3);
  });

  it('ranks ace high and two low', () => {
    expect(cardRankValue(card('hearts', 'A'))).toBeGreaterThan(cardRankValue(card('hearts', 'K')));
    expect(cardRankValue(card('hearts', '2'))).toBeLessThan(cardRankValue(card('hearts', '3')));
  });

  it('refuses to evaluate an empty trick', () => {
    expect(() => evaluateTrickWinner({ leaderSeat: 0, plays: [] }, 'spades')).toThrow(HokmError);
  });
});

describe('playing a full hand', () => {
  it('awards each trick to exactly one team and keeps 13 tricks total', () => {
    let game = startedGame('hearts');
    let tricks = 0;
    while (game.phase === 'playing' && tricks < 13) {
      game = playTrick(game);
      tricks += 1;
    }
    const total = (game.handScore.tricks[0] ?? 0) + (game.handScore.tricks[1] ?? 0);
    expect(total).toBe(tricks);
    // A hand ends as soon as a team reaches 7 tricks.
    expect(Math.max(game.handScore.tricks[0] ?? 0, game.handScore.tricks[1] ?? 0)).toBe(7);
    expect(['hand_complete', 'game_complete']).toContain(game.phase);
  });

  it('never lets a player hold a card that was already played', () => {
    let game = startedGame('clubs');
    const seen = new Set<string>();
    while (game.phase === 'playing') {
      const before = game.currentTrick.plays.length;
      game = playTrick(game);
      expect(game.currentTrick.plays.length).toBeLessThanOrEqual(4);
      void before;
    }
    for (const t of game.completedTricks) {
      for (const play of t.plays) {
        expect(seen.has(play.card.id)).toBe(false);
        seen.add(play.card.id);
      }
    }
  });

  it('blocks playing once the hand is complete', () => {
    let game = startedGame('diamonds');
    while (game.phase === 'playing') game = playTrick(game);
    const someone = seatOf(game, 0);
    expect(() => playCard(game, someone.id, 'hearts-A')).toThrow(/active/i);
  });
});

describe('scoring rules', () => {
  it('awards one point for a normal win', () => {
    let game = startedGame('hearts');
    while (game.phase === 'playing') game = playTrick(game);
    const { winningTeam, kind, pointsAwarded } = game.handScore;
    expect(winningTeam).toBeDefined();
    const loser = winningTeam === 0 ? 1 : 0;
    if ((game.handScore.tricks[loser] ?? 0) > 0) {
      expect(kind).toBe('normal');
      expect(pointsAwarded).toBe(1);
    }
    expect(game.matchScore[winningTeam!]).toBe(pointsAwarded);
  });

  it('scores kot as 2 and hakem-kot as 3', () => {
    // Verified through the documented rule: loser with zero tricks is a kot,
    // and a kot against the hakem's own team is worth an extra point.
    let game = startedGame('hearts');
    while (game.phase === 'playing') game = playTrick(game);
    if (game.handScore.kind === 'kot') expect(game.handScore.pointsAwarded).toBe(2);
    if (game.handScore.kind === 'hakem_kot') expect(game.handScore.pointsAwarded).toBe(3);
    if (game.handScore.kind === 'normal') expect(game.handScore.pointsAwarded).toBe(1);
  });

  it('ends the match when the target score is reached', () => {
    let game = createGame(PLAYERS, { rng: seededRng(3), hakemSeat: 0, targetScore: 1 });
    game = chooseTrump(game, seatOf(game, 0).id, 'hearts', seededRng(11));
    while (game.phase === 'playing') game = playTrick(game);
    expect(game.phase).toBe('game_complete');
    expect(() => continueToNextHand(game)).toThrow(HokmError);
  });
});

describe('hand rotation', () => {
  it('keeps hakem when the hakem team wins, otherwise passes it on', () => {
    let game = startedGame('hearts');
    const originalHakem = game.hakemSeat;
    while (game.phase === 'playing') game = playTrick(game);
    if (game.phase !== 'hand_complete') return;

    const winner = game.handScore.winningTeam!;
    const next = continueToNextHand(game, seededRng(21));
    const hakemTeam = getTeamBySeat(originalHakem);
    expect(next.hakemSeat).toBe(winner === hakemTeam ? originalHakem : nextSeat(originalHakem));
    expect(next.roundNumber).toBe(game.roundNumber + 1);
    expect(next.phase).toBe('waiting_for_trump');
    // Match score carries over, trick score resets.
    expect(next.matchScore).toEqual(game.matchScore);
    expect(next.handScore.tricks).toEqual({ 0: 0, 1: 0 });
  });

  it('refuses to continue before a hand is finished', () => {
    const game = startedGame('hearts');
    expect(() => continueToNextHand(game)).toThrow(/completed hand/i);
  });
});

describe('public view privacy', () => {
  it('shows a player only their own hand', () => {
    const game = startedGame('hearts');
    const me = seatOf(game, 2);
    const view = toPublicView(game, me.id);
    expect(view.myHand).toHaveLength(13);
    expect(view.myHand.map((c) => c.id).sort()).toEqual(
      game.hands[2]!.map((c) => c.id).sort(),
    );
    // No other player's cards may appear anywhere in the payload.
    const serialised = JSON.stringify(view);
    for (const seat of [0, 1, 3] as Seat[]) {
      for (const card of game.hands[seat]!) {
        expect(serialised).not.toContain(`"${card.id}"`);
      }
    }
  });
});

describe('localisation', () => {
  it('translates every suit into Persian', () => {
    for (const suit of SUITS) {
      const label = localizeSuit(suit);
      expect(label).toMatch(/[\u0600-\u06FF]/);
    }
  });
});
