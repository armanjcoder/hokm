import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameTable } from '../src/components/GameTable.js';
import type { RoomView } from '../src/types.js';

afterEach(cleanup);

const noop = () => {};

function baseRoom(): RoomView {
  return {
    id: 'r1',
    code: 'ABCDE',
    status: 'playing',
    mode: 'classic4',
    targetScore: 7,
    hostPlayerId: 'p0',
    players: [0, 1, 2, 3].map((seat) => ({
      id: `p${seat}`,
      name: `بازیکن ${seat + 1}`,
      seat,
      connected: true,
    })),
  };
}

function game(overrides: any = {}) {
  return {
    id: 'g1',
    mode: 'classic4',
    phase: 'hand_complete',
    hakemSeat: 0,
    currentTurnSeat: 0,
    trumpSuit: 'hearts',
    currentTrick: { leaderSeat: 0, plays: [] },
    completedTricks: [],
    handScore: { tricks: { 0: 7, 1: 0 }, winningTeam: 0, kind: 'kot', pointsAwarded: 2 },
    matchScore: { 0: 2, 1: 0 },
    targetScore: 7,
    roundNumber: 1,
    players: [],
    myHand: [],
    validCardIds: [],
    ...overrides,
  };
}

function renderTable(g: any) {
  return render(
    <GameTable
      room={baseRoom()}
      game={g}
      meId="p0"
      chooseSuit={noop}
      play={noop}
      nextHand={noop}
      requestRedeal={noop}
      discard={noop}
      draw={noop}
      resolveDraw={noop}
    />,
  );
}

describe('score badge explains the points', () => {
  it('shows a kot as 2 points', () => {
    renderTable(game());
    expect(screen.getByText(/کوت! حریف هیچ دستی نبرد/)).toBeDefined();
    expect(screen.getByText('+2 امتیاز')).toBeDefined();
  });

  it('shows a hakem kot as 3 points', () => {
    renderTable(
      game({ handScore: { tricks: { 0: 0, 1: 7 }, winningTeam: 1, kind: 'hakem_kot', pointsAwarded: 3 } }),
    );
    expect(screen.getByText(/حاکم‌کوت/)).toBeDefined();
    expect(screen.getByText('+3 امتیاز')).toBeDefined();
  });

  it('shows a normal win as 1 point', () => {
    renderTable(
      game({ handScore: { tricks: { 0: 7, 1: 4 }, winningTeam: 0, kind: 'normal', pointsAwarded: 1 } }),
    );
    expect(screen.getByText('برد عادی')).toBeDefined();
    expect(screen.getByText('+1 امتیاز')).toBeDefined();
  });

  it('shows nothing mid-hand when there is no result yet', () => {
    const { container } = renderTable(game({ phase: 'playing', handScore: { tricks: { 0: 2, 1: 1 } } }));
    expect(container.querySelector('.score-badge')).toBeNull();
  });
});

describe('target score is visible during play', () => {
  it('tells the player how long the match is', () => {
    renderTable(game({ phase: 'playing', targetScore: 5 }));
    expect(screen.getByText('تا 5 امتیاز')).toBeDefined();
  });
});

describe('low hand redeal (ده‌لو کم)', () => {
  const waiting = (extra: any = {}) =>
    game({ phase: 'waiting_for_trump', handScore: { tricks: { 0: 0, 1: 0 } }, ...extra });

  it('offers the redeal to the hakem when the hand qualifies', () => {
    renderTable(waiting({ canRequestRedeal: true }));
    expect(screen.getByText('درخواست پخش دوباره')).toBeDefined();
  });

  it('hides it when the rule is off or the hand is strong', () => {
    renderTable(waiting({ canRequestRedeal: false }));
    expect(screen.queryByText('درخواست پخش دوباره')).toBeNull();
  });

  it('calls the handler when pressed', () => {
    const requestRedeal = vi.fn();
    render(
      <GameTable
        room={baseRoom()}
        game={waiting({ canRequestRedeal: true })}
        meId="p0"
        chooseSuit={noop}
        play={noop}
        nextHand={noop}
        requestRedeal={requestRedeal}
        discard={noop}
        draw={noop}
        resolveDraw={noop}
      />,
    );
    fireEvent.click(screen.getByText('درخواست پخش دوباره'));
    expect(requestRedeal).toHaveBeenCalledTimes(1);
  });

  it('never offers it to a non-hakem player', () => {
    render(
      <GameTable
        room={baseRoom()}
        game={waiting({ canRequestRedeal: true, hakemSeat: 1 })}
        meId="p0"
        chooseSuit={noop}
        play={noop}
        nextHand={noop}
        requestRedeal={noop}
        discard={noop}
        draw={noop}
        resolveDraw={noop}
      />,
    );
    expect(screen.queryByText('درخواست پخش دوباره')).toBeNull();
  });
});

describe('bam badge', () => {
  it('shows a bam as 3 points', () => {
    renderTable(
      game({ handScore: { tricks: { 0: 13, 1: 0 }, winningTeam: 0, kind: 'bam', pointsAwarded: 3 } }),
    );
    expect(screen.getByText(/بام! همه دست‌ها را برد/)).toBeDefined();
    expect(screen.getByText('+3 امتیاز')).toBeDefined();
  });

  it('distinguishes a bam against the hakem', () => {
    renderTable(
      game({
        handScore: { tricks: { 0: 0, 1: 13 }, winningTeam: 1, kind: 'hakem_bam', pointsAwarded: 3 },
      }),
    );
    expect(screen.getByText(/بام روی حاکم/)).toBeDefined();
  });
});
