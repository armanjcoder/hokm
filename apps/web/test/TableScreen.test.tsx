import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TableScreen } from '../src/components/TableScreen.js';
import type { RoomView } from '../src/types.js';

afterEach(cleanup);

/**
 * TableScreen is the router between lobby, live game and dead-end states.
 *
 * The rule it must never break: a seated player always has a way out. Before
 * this was covered, an in-progress table with missing game state rendered
 * nothing at all and the only escape was closing Telegram.
 */

const noop = () => {};

function room(overrides: Partial<RoomView> = {}): RoomView {
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
    ...overrides,
  } as RoomView;
}

function liveGame(overrides: any = {}) {
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
    myHand: [],
    validCardIds: [],
    ...overrides,
  };
}

function renderScreen(over: { room?: RoomView; game?: any; leaveRoom?: () => void } = {}) {
  const leaveRoom = over.leaveRoom ?? vi.fn();
  render(
    <TableScreen
      room={over.room ?? room()}
      session={{ roomId: 'r1', playerId: 'p0', apiUrl: 'https://api.test' }}
      me={{ id: 'p0', name: 'بازیکن 1', seat: 0, connected: true }}
      game={'game' in over ? over.game : liveGame()}
      apiUrl="https://api.test"
      connection="connected"
      toast=""
      starting={false}
      lobbyBusy={false}
      rulesOverlay={null}
      setToast={noop}
      showRules={noop}
      onNewTable={noop}
      lobby={{
        toggleReady: noop,
        addBot: noop,
        setBotDifficulty: noop,
        removeBot: noop,
        leaveRoom,
        updateSettings: noop,
      }}
      table={{
        chooseSuit: noop,
        play: noop,
        nextHand: noop,
        requestRedeal: noop,
        discard: noop,
        draw: noop,
        resolveDraw: noop,
      }}
      invite={noop}
    />,
  );
  return { leaveRoom };
}

describe('a seated player can always leave', () => {
  it('offers a leave control during a live game', () => {
    renderScreen();
    expect(screen.getByRole('button', { name: 'خروج از میز' })).toBeDefined();
  });

  it('offers a leave control in the lobby', () => {
    renderScreen({ room: room({ status: 'lobby' }), game: undefined });
    expect(screen.getByRole('button', { name: 'خروج از میز' })).toBeDefined();
  });

  it('offers a leave control once the match is finished', () => {
    renderScreen({ room: room({ status: 'finished' }) });
    expect(screen.getByRole('button', { name: 'خروج از میز' })).toBeDefined();
  });

  it('never strands the player when the game state is missing', () => {
    const leaveRoom = vi.fn();
    renderScreen({ room: room({ status: 'playing' }), game: undefined, leaveRoom });
    expect(screen.getByText('میز در دسترس نیست')).toBeDefined();
    // Both the recovery panel and the corner icon can get the player out.
    const exits = screen.getAllByRole('button', { name: 'خروج از میز' });
    expect(exits.length).toBeGreaterThan(0);
    fireEvent.click(exits[exits.length - 1]!);
    expect(leaveRoom).toHaveBeenCalledOnce();
  });

  it('shows the abandoned notice instead of an empty screen', () => {
    renderScreen({ room: room({ status: 'abandoned' }), game: undefined });
    expect(screen.queryByText('میز در دسترس نیست')).toBeNull();
  });
});

describe('the opening deal is not hidden behind the start overlay', () => {
  it('suppresses dealing while the overlay is showing', () => {
    // The overlay lasts 2200ms and the deal is under 400ms, so animating
    // underneath it means the player sees nothing at all.
    render(
      <TableScreen
        room={room()}
        session={{ roomId: 'r1', playerId: 'p0', apiUrl: 'https://api.test' }}
        me={{ id: 'p0', name: 'بازیکن 1', seat: 0, connected: true }}
        game={{ ...liveGame(), myHand: [{ id: 'c1', suit: 'spades', rank: 'A' }], validCardIds: ['c1'] }}
        apiUrl="https://api.test"
        connection="connected"
        toast=""
        starting
        lobbyBusy={false}
        rulesOverlay={null}
        setToast={noop}
        showRules={noop}
        onNewTable={noop}
        lobby={{
          toggleReady: noop, addBot: noop, setBotDifficulty: noop,
          removeBot: noop, leaveRoom: noop, updateSettings: noop,
        }}
        table={{
          chooseSuit: noop, play: noop, nextHand: noop, requestRedeal: noop,
          discard: noop, draw: noop, resolveDraw: noop,
        }}
        invite={noop}
      />,
    );
    const card = document.querySelector('.hand .card')!;
    expect(card.classList.contains('is-dealt')).toBe(false);
  });

  it('deals as soon as the overlay is gone', () => {
    render(
      <TableScreen
        room={room()}
        session={{ roomId: 'r1', playerId: 'p0', apiUrl: 'https://api.test' }}
        me={{ id: 'p0', name: 'بازیکن 1', seat: 0, connected: true }}
        game={{ ...liveGame(), myHand: [{ id: 'c1', suit: 'spades', rank: 'A' }], validCardIds: ['c1'] }}
        apiUrl="https://api.test"
        connection="connected"
        toast=""
        starting={false}
        lobbyBusy={false}
        rulesOverlay={null}
        setToast={noop}
        showRules={noop}
        onNewTable={noop}
        lobby={{
          toggleReady: noop, addBot: noop, setBotDifficulty: noop,
          removeBot: noop, leaveRoom: noop, updateSettings: noop,
        }}
        table={{
          chooseSuit: noop, play: noop, nextHand: noop, requestRedeal: noop,
          discard: noop, draw: noop, resolveDraw: noop,
        }}
        invite={noop}
      />,
    );
    const card = document.querySelector('.hand .card')!;
    expect(card.classList.contains('is-dealt')).toBe(true);
  });
});
