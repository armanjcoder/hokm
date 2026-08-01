import { describe, expect, it } from 'vitest';
import type { PublicGameView } from '@hokm/game-engine';
import {
  buildSeatViews,
  seatInitials,
  seatLabel,
  turnMessage,
  type SeatView,
} from '../src/table-seats.js';
import type { RoomPlayer } from '../src/types.js';

/**
 * Seat arrangement.
 *
 * The whole point is that a player can tell at a glance who is their partner,
 * who is the hakem and whose turn it is. Getting the rotation wrong would put
 * the partner in an opponent's chair, so every mode is pinned here.
 */

function players(count: number): RoomPlayer[] {
  const names = ['آرمان', 'سارا', 'رضا', 'مینا'];
  return Array.from({ length: count }, (_, seat) => ({
    id: `p${seat}`,
    name: names[seat]!,
    seat,
    connected: true,
  }));
}

function game(overrides: Partial<PublicGameView> = {}): PublicGameView {
  return {
    hakemSeat: 0,
    currentTurnSeat: 0,
    currentTrick: { plays: [] },
    players: [],
    ...overrides,
  } as unknown as PublicGameView;
}

const positionsOf = (views: SeatView[]) =>
  Object.fromEntries(views.map((v) => [v.seat, v.position]));

describe('four player rotation', () => {
  it('puts the viewer at the bottom and their partner opposite', () => {
    const views = buildSeatViews({
      mode: 'classic4',
      players: players(4),
      game: game(),
      mySeat: 0,
    });
    expect(positionsOf(views)).toEqual({ 0: 'bottom', 1: 'left', 2: 'top', 3: 'right' });
    expect(views.find((v) => v.seat === 2)!.isPartner).toBe(true);
    expect(views.find((v) => v.seat === 1)!.isPartner).toBe(false);
    expect(views.find((v) => v.seat === 3)!.isPartner).toBe(false);
  });

  it('rotates correctly for a player sitting in seat 3', () => {
    const views = buildSeatViews({
      mode: 'classic4',
      players: players(4),
      game: game(),
      mySeat: 3,
    });
    expect(positionsOf(views)).toEqual({ 3: 'bottom', 0: 'left', 1: 'top', 2: 'right' });
    // Seat 3's partner is seat 1, and it must be the one facing them.
    const partner = views.find((v) => v.isPartner)!;
    expect(partner.seat).toBe(1);
    expect(partner.position).toBe('top');
  });

  it.each([0, 1, 2, 3])('always seats the partner opposite for seat %i', (mySeat) => {
    const views = buildSeatViews({
      mode: 'classic4',
      players: players(4),
      game: game(),
      mySeat,
    });
    expect(views.find((v) => v.isSelf)!.position).toBe('bottom');
    expect(views.find((v) => v.isPartner)!.position).toBe('top');
  });
});

describe('three and two player tables', () => {
  it('spreads three players bottom, left and right', () => {
    const views = buildSeatViews({ mode: 'solo3', players: players(3), game: game(), mySeat: 0 });
    expect(positionsOf(views)).toEqual({ 0: 'bottom', 1: 'left', 2: 'right' });
  });

  it('never marks a partner when everyone plays for themselves', () => {
    const views = buildSeatViews({ mode: 'solo3', players: players(3), game: game(), mySeat: 1 });
    expect(views.every((v) => !v.isPartner)).toBe(true);
    // Solo scoring is per seat, so each player is their own "team".
    expect(views.map((v) => v.team).sort()).toEqual([0, 1, 2]);
  });

  it('faces the two duel players across the table', () => {
    const views = buildSeatViews({ mode: 'duel2', players: players(2), game: game(), mySeat: 1 });
    expect(positionsOf(views)).toEqual({ 1: 'bottom', 0: 'top' });
    expect(views.every((v) => !v.isPartner)).toBe(true);
  });
});

describe('seat state', () => {
  it('marks the hakem and the active seat', () => {
    const views = buildSeatViews({
      mode: 'classic4',
      players: players(4),
      game: game({ hakemSeat: 2, currentTurnSeat: 3 } as Partial<PublicGameView>),
      mySeat: 0,
    });
    expect(views.find((v) => v.isHakem)!.seat).toBe(2);
    expect(views.find((v) => v.isTurn)!.seat).toBe(3);
  });

  it('attaches each played card to the seat that played it', () => {
    const card = { id: 'S-A', suit: 'spades', rank: 'A' } as never;
    const views = buildSeatViews({
      mode: 'classic4',
      players: players(4),
      game: game({ currentTrick: { plays: [{ seat: 2, card }] } } as unknown as Partial<PublicGameView>),
      mySeat: 0,
    });
    expect(views.find((v) => v.seat === 2)!.playedCard).toBe(card);
    expect(views.find((v) => v.seat === 1)!.playedCard).toBeUndefined();
  });

  it('reports remaining card counts per seat', () => {
    const views = buildSeatViews({
      mode: 'classic4',
      players: players(4),
      game: game({
        players: [
          { seat: 0, cardCount: 13 },
          { seat: 1, cardCount: 12 },
        ],
      } as unknown as Partial<PublicGameView>),
      mySeat: 0,
    });
    expect(views.find((v) => v.seat === 1)!.cardCount).toBe(12);
    expect(views.find((v) => v.seat === 3)!.cardCount).toBeUndefined();
  });

  it('flags a disconnected human but never a bot', () => {
    const roster = players(4);
    roster[1] = { ...roster[1]!, connected: false };
    roster[2] = { ...roster[2]!, connected: false, isBot: true };
    const views = buildSeatViews({ mode: 'classic4', players: roster, game: game(), mySeat: 0 });
    expect(views.find((v) => v.seat === 1)!.isOffline).toBe(true);
    expect(views.find((v) => v.seat === 2)!.isOffline).toBe(false);
  });

  it('keeps empty chairs in the ring', () => {
    const views = buildSeatViews({
      mode: 'classic4',
      players: players(4).slice(0, 2),
      game: game(),
      mySeat: 0,
    });
    expect(views).toHaveLength(4);
    expect(views.find((v) => v.seat === 3)!.player).toBeUndefined();
  });

  it('falls back to seat 0 when the viewer has no seat', () => {
    const views = buildSeatViews({
      mode: 'classic4',
      players: players(4),
      game: game(),
      mySeat: undefined,
    });
    expect(views.find((v) => v.isSelf)!.seat).toBe(0);
  });
});

describe('labels', () => {
  const view = (over: Partial<SeatView>): SeatView =>
    ({ seat: 1, player: undefined, ...over }) as SeatView;

  it('uses the player name when present', () => {
    expect(seatLabel(view({ player: { name: 'آرمان' } as RoomPlayer }))).toBe('آرمان');
  });

  it('falls back to the seat number for an empty chair', () => {
    expect(seatLabel(view({}))).toBe('صندلی 2');
  });

  it('builds initials from up to two words', () => {
    expect(seatInitials(view({ player: { name: 'آرمان جعفری' } as RoomPlayer }))).toBe('آج');
    expect(seatInitials(view({ player: { name: 'Sara' } as RoomPlayer }))).toBe('S');
  });

  it('falls back to the seat number when there is no name', () => {
    expect(seatInitials(view({}))).toBe('2');
    expect(seatInitials(view({ player: { name: '   ' } as RoomPlayer }))).toBe('2');
  });

  it('announces your own turn differently from an opponent turn', () => {
    const mine = buildSeatViews({
      mode: 'classic4',
      players: players(4),
      game: game({ currentTurnSeat: 0 } as Partial<PublicGameView>),
      mySeat: 0,
    });
    expect(turnMessage(mine)).toBe('نوبت توئه');

    const theirs = buildSeatViews({
      mode: 'classic4',
      players: players(4),
      game: game({ currentTurnSeat: 1 } as Partial<PublicGameView>),
      mySeat: 0,
    });
    expect(turnMessage(theirs)).toBe('نوبت سارا');
  });
});

describe('team colour is relative to the viewer', () => {
  it.each([0, 1, 2, 3])('marks the viewer own side consistently from seat %i', (mySeat) => {
    const views = buildSeatViews({
      mode: 'classic4',
      players: players(4),
      game: game(),
      mySeat,
    });
    const ours = views.filter((v) => v.isMyTeam).map((v) => v.position).sort();
    const theirs = views.filter((v) => !v.isMyTeam).map((v) => v.position).sort();
    // Whichever seat you sit in, your side is always you plus the seat opposite.
    expect(ours).toEqual(['bottom', 'top']);
    expect(theirs).toEqual(['left', 'right']);
  });

  it('counts the viewer as part of their own team', () => {
    const views = buildSeatViews({ mode: 'classic4', players: players(4), game: game(), mySeat: 2 });
    expect(views.find((v) => v.isSelf)!.isMyTeam).toBe(true);
  });

  it('never assigns a team side in solo modes', () => {
    for (const mode of ['solo3', 'duel2'] as const) {
      const views = buildSeatViews({
        mode,
        players: players(mode === 'solo3' ? 3 : 2),
        game: game(),
        mySeat: 0,
      });
      expect(views.every((v) => !v.isMyTeam)).toBe(true);
    }
  });
});

describe('the finished trick stays visible until the next one starts', () => {
  const card = (id: string) => ({ id, suit: 'spades', rank: 'A' }) as never;

  it('keeps showing the last trick while the current one is empty', () => {
    const views = buildSeatViews({
      mode: 'classic4',
      players: players(4),
      game: game({
        currentTrick: { plays: [] },
        completedTricks: [
          {
            leaderSeat: 0,
            winnerSeat: 2,
            plays: [0, 1, 2, 3].map((seat) => ({ seat, card: card(`c${seat}`) })),
          },
        ],
      } as unknown as Partial<PublicGameView>),
      mySeat: 0,
    });
    // All four cards are still on the table rather than blanking instantly.
    expect(views.filter((v) => v.playedCard).length).toBe(4);
    expect(views.find((v) => v.wonTrick)!.seat).toBe(2);
  });

  it('prefers the live trick once the next card is played', () => {
    const views = buildSeatViews({
      mode: 'classic4',
      players: players(4),
      game: game({
        currentTrick: { plays: [{ seat: 1, card: card('live') }] },
        completedTricks: [
          { leaderSeat: 0, winnerSeat: 2, plays: [{ seat: 0, card: card('old') }] },
        ],
      } as unknown as Partial<PublicGameView>),
      mySeat: 0,
    });
    expect(views.filter((v) => v.playedCard).length).toBe(1);
    expect(views.find((v) => v.seat === 1)!.playedCard!.id).toBe('live');
    expect(views.every((v) => !v.wonTrick)).toBe(true);
  });

  it('ignores a trick that has no recorded winner', () => {
    const views = buildSeatViews({
      mode: 'classic4',
      players: players(4),
      game: game({
        currentTrick: { plays: [] },
        completedTricks: [{ leaderSeat: 0, plays: [{ seat: 0, card: card('x') }] }],
      } as unknown as Partial<PublicGameView>),
      mySeat: 0,
    });
    expect(views.every((v) => !v.playedCard)).toBe(true);
    expect(views.every((v) => !v.wonTrick)).toBe(true);
  });

  it('copes with a game that has no completed tricks yet', () => {
    const views = buildSeatViews({
      mode: 'classic4',
      players: players(4),
      game: game({ currentTrick: { plays: [] } } as unknown as Partial<PublicGameView>),
      mySeat: 0,
    });
    expect(views.every((v) => !v.wonTrick)).toBe(true);
  });
});
