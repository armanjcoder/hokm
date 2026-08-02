import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LobbySeat } from '../src/components/LobbySeat.js';
import type { RoomPlayer } from '../src/types.js';

afterEach(cleanup);

/**
 * A lobby chair.
 *
 * The lobby is where players work out who they are playing with, so each seat
 * has to answer three questions at a glance: who is here, are they ready, and
 * are they on my side. Before this the lobby showed no team information at all.
 */

const human = (over: Partial<RoomPlayer> = {}): RoomPlayer => ({
  id: 'p1',
  name: 'آرمان جعفری',
  seat: 0,
  connected: true,
  ...over,
});

function renderSeat(over: Partial<Parameters<typeof LobbySeat>[0]> = {}) {
  const props = {
    seat: 0,
    player: human(),
    isMe: false,
    isHost: false,
    isPartner: false,
    teamPlay: true,
    myTeam: true,
    viewerIsHost: false,
    busy: false,
    setBotDifficulty: vi.fn(),
    removeBot: vi.fn(),
    ...over,
  };
  render(<LobbySeat {...props} />);
  return props;
}

describe('who is sitting here', () => {
  it('shows the player name', () => {
    renderSeat();
    expect(screen.getByText('آرمان جعفری')).toBeDefined();
  });

  it('shows an empty chair as waiting', () => {
    renderSeat({ player: undefined });
    expect(screen.getByText('در انتظار بازیکن…')).toBeDefined();
  });

  it('marks you, your partner and the host', () => {
    cleanup();
    renderSeat({ isMe: true });
    expect(screen.getByText('تو')).toBeDefined();
    cleanup();
    renderSeat({ isPartner: true });
    expect(screen.getByText('یار')).toBeDefined();
    cleanup();
    renderSeat({ isHost: true });
    expect(screen.getByText('سازنده')).toBeDefined();
  });

  it('marks a bot as a bot', () => {
    renderSeat({ player: human({ isBot: true, name: 'ربات ۱' }) });
    expect(screen.getByText('ربات')).toBeDefined();
  });

  it('describes the whole seat in one sentence for assistive tech', () => {
    renderSeat({ isMe: true, isHost: true, player: human({ ready: true }) });
    const seat = screen.getByRole('listitem');
    const label = seat.getAttribute('aria-label') ?? '';
    expect(label).toContain('صندلی 1');
    expect(label).toContain('آرمان جعفری');
    expect(label).toContain('خودت');
    expect(label).toContain('سازنده میز');
    expect(label).toContain('آماده');
  });
});

describe('team membership is visible before the hand starts', () => {
  it('tints the viewer own side', () => {
    renderSeat({ myTeam: true });
    expect(screen.getByRole('listitem').className).toContain('team-ours');
  });

  it('tints the opposing side differently', () => {
    renderSeat({ myTeam: false });
    expect(screen.getByRole('listitem').className).toContain('team-theirs');
  });

  it('does not claim a side in solo modes', () => {
    renderSeat({ teamPlay: false, myTeam: true });
    const className = screen.getByRole('listitem').className;
    expect(className).not.toContain('team-ours');
    expect(className).not.toContain('team-theirs');
  });

  it('never relies on colour alone to say who your partner is', () => {
    // The tinted edge is reinforced by an explicit tag.
    renderSeat({ myTeam: true, isPartner: true });
    expect(screen.getByText('یار')).toBeDefined();
  });
});

describe('readiness', () => {
  it('shows a human as ready or waiting', () => {
    renderSeat({ player: human({ ready: true }) });
    expect(screen.getByText('آماده ✓')).toBeDefined();
    cleanup();
    renderSeat({ player: human({ ready: false }) });
    expect(screen.getByText('در انتظار آمادگی')).toBeDefined();
  });

  it('shows a dropped human as disconnected', () => {
    renderSeat({ player: human({ connected: false }) });
    expect(screen.getByText('قطع شده')).toBeDefined();
  });

  it('never shows readiness for a bot, which is always ready', () => {
    renderSeat({ player: human({ isBot: true }) });
    expect(screen.queryByText('در انتظار آمادگی')).toBeNull();
  });
});

describe('bot controls belong to the host', () => {
  it('lets the host change difficulty', () => {
    const props = renderSeat({
      player: human({ isBot: true, id: 'b1', name: 'ربات' }),
      viewerIsHost: true,
    });
    fireEvent.change(screen.getByLabelText('سطح سختی ربات'), { target: { value: 'hard' } });
    expect(props.setBotDifficulty).toHaveBeenCalledWith('b1', 'hard');
  });

  it('lets the host remove a bot', () => {
    const props = renderSeat({
      player: human({ isBot: true, id: 'b1', name: 'ربات' }),
      viewerIsHost: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'حذف ربات' }));
    expect(props.removeBot).toHaveBeenCalledWith('b1');
  });

  it('shows other players the difficulty without controls', () => {
    renderSeat({ player: human({ isBot: true, difficulty: 'hard' }), viewerIsHost: false });
    expect(screen.getByText('سخت')).toBeDefined();
    expect(screen.queryByRole('button', { name: /حذف/ })).toBeNull();
  });

  it('blocks the controls while a request is in flight', () => {
    renderSeat({ player: human({ isBot: true, name: 'ربات' }), viewerIsHost: true, busy: true });
    expect((screen.getByLabelText('سطح سختی ربات') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'حذف ربات' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
