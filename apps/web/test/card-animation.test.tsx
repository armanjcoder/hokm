import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlayingCard } from '../src/components/PlayingCard.js';
import { TableSeat } from '../src/components/TableSeat.js';
import { GameTable } from '../src/components/GameTable.js';
import type { SeatView } from '../src/table-seats.js';
import type { RoomView } from '../src/types.js';

afterEach(cleanup);

/**
 * Card animation.
 *
 * CSS mount animations are fragile in React for one specific reason: an
 * animation only plays when the element is *inserted*. If React reuses a DOM
 * node, the animation silently never replays. Three separate bugs of exactly
 * that shape shipped before these tests existed, so each is pinned here.
 */

const card = (id: string) => ({ id, suit: 'spades', rank: 'A' }) as never;
const noop = () => {};

function seatView(playedId: string | undefined): SeatView {
  return {
    seat: 1,
    position: 'left',
    player: { id: 'p1', name: 'حریف', seat: 1, connected: true },
    isSelf: false,
    isPartner: false,
    isMyTeam: false,
    team: 1,
    isHakem: false,
    isTurn: false,
    cardCount: 5,
    playedCard: playedId ? card(playedId) : undefined,
    wonTrick: false,
    isOffline: false,
  } as SeatView;
}

describe('a played card re-animates for every new card', () => {
  it('mounts a fresh node when a different card lands in the same seat', () => {
    // Without a key React reconciles by position and reuses the node, so the
    // landing animation never restarts and the card appears instantly.
    const { container, rerender } = render(<TableSeat view={seatView('c1')} teamPlay />);
    const first = container.querySelector('.card');
    rerender(<TableSeat view={seatView('c2')} teamPlay />);
    const second = container.querySelector('.card');
    expect(first).not.toBe(second);
  });

  it('keeps the same node when nothing changed', () => {
    const { container, rerender } = render(<TableSeat view={seatView('c1')} teamPlay />);
    const first = container.querySelector('.card');
    rerender(<TableSeat view={seatView('c1')} teamPlay />);
    expect(container.querySelector('.card')).toBe(first);
  });

  it('carries the landing class rather than the dealing one', () => {
    const { container } = render(<TableSeat view={seatView('c1')} teamPlay />);
    const el = container.querySelector('.card')!;
    expect(el.classList.contains('is-played')).toBe(true);
    expect(el.classList.contains('is-dealt')).toBe(false);
  });
});

describe('dealing waits for the start overlay', () => {
  it('does not animate while the overlay still covers the table', () => {
    // The overlay lasts far longer than the deal, so animating underneath it
    // means the player never sees a single card move.
    const { container } = render(<PlayingCard card={card('c1')} index={0} dealReady={false} />);
    expect(container.querySelector('.card')!.classList.contains('is-dealt')).toBe(false);
  });

  it('animates once the overlay has cleared', () => {
    const { container } = render(<PlayingCard card={card('c1')} index={0} dealReady />);
    expect(container.querySelector('.card')!.classList.contains('is-dealt')).toBe(true);
  });

  it('adds the class on the transition, which is what starts the animation', () => {
    const { container, rerender } = render(
      <PlayingCard card={card('c1')} index={0} dealReady={false} />,
    );
    expect(container.querySelector('.card')!.classList.contains('is-dealt')).toBe(false);
    rerender(<PlayingCard card={card('c1')} index={0} dealReady />);
    expect(container.querySelector('.card')!.classList.contains('is-dealt')).toBe(true);
  });

  it('passes its position so the deal can be staggered', () => {
    const { container } = render(<PlayingCard card={card('c1')} index={7} dealReady />);
    expect(container.querySelector('.card')!.getAttribute('style')).toContain('--card-index: 7');
  });
});

describe('the hand deals through the table', () => {
  function room(): RoomView {
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
    } as RoomView;
  }

  function game(hand: string[]) {
    return {
      id: 'g1',
      mode: 'classic4',
      phase: 'playing',
      hakemSeat: 0,
      currentTurnSeat: 0,
      trumpSuit: 'hearts',
      currentTrick: { leaderSeat: 0, plays: [] },
      completedTricks: [],
      handScore: { tricks: { 0: 0, 1: 0 } },
      matchScore: { 0: 0, 1: 0 },
      targetScore: 7,
      roundNumber: 1,
      players: [],
      myHand: hand.map((id) => card(id)),
      validCardIds: hand,
    } as any;
  }

  function renderHand(hand: string[], dealReady: boolean) {
    return render(
      <GameTable
        room={room()}
        game={game(hand)}
        meId="p0"
        chooseSuit={noop}
        play={noop}
        nextHand={noop}
        requestRedeal={noop}
        discard={noop}
        draw={noop}
        resolveDraw={noop}
        dealReady={dealReady}
      />,
    );
  }

  it('holds the opening deal back while the overlay is up', () => {
    const { container } = renderHand(['a', 'b', 'c', 'd', 'e'], false);
    const cards = container.querySelectorAll('.hand .card');
    expect(cards).toHaveLength(5);
    expect([...cards].every((el) => !el.classList.contains('is-dealt'))).toBe(true);
  });

  it('deals every card once the overlay clears', () => {
    const { container } = renderHand(['a', 'b', 'c', 'd', 'e'], true);
    const cards = container.querySelectorAll('.hand .card');
    expect([...cards].every((el) => el.classList.contains('is-dealt'))).toBe(true);
  });

  it('staggers each card by its position in the hand', () => {
    const { container } = renderHand(['a', 'b', 'c'], true);
    const indices = [...container.querySelectorAll('.hand .card')].map((el) =>
      el.getAttribute('style'),
    );
    expect(indices[0]).toContain('--card-index: 0');
    expect(indices[1]).toContain('--card-index: 1');
    expect(indices[2]).toContain('--card-index: 2');
  });

  it('animates only the cards added by the second deal', () => {
    // After trump is named the hand grows from 5 to 13. The original five keep
    // their nodes, so only the new arrivals mount and animate.
    const { container, rerender } = renderHand(['a', 'b', 'c', 'd', 'e'], true);
    const before = [...container.querySelectorAll('.hand .card')];
    rerender(
      <GameTable
        room={room()}
        game={game(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])}
        meId="p0"
        chooseSuit={noop}
        play={noop}
        nextHand={noop}
        requestRedeal={noop}
        discard={noop}
        draw={noop}
        resolveDraw={noop}
        dealReady
      />,
    );
    const after = [...container.querySelectorAll('.hand .card')];
    expect(after).toHaveLength(8);
    // The first five are the very same elements, so they do not replay.
    for (let i = 0; i < 5; i += 1) expect(after[i]).toBe(before[i]);
  });
});
