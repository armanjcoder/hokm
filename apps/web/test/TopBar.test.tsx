import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '../src/components/TopBar.js';
import type { RoomView } from '../src/types.js';

afterEach(cleanup);

/**
 * The exit lives in the top bar, so it is in the same corner on every screen
 * rather than competing with the hand of cards for space. Being a compact icon
 * it has to work harder on labelling and keyboard behaviour than a wide button.
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
    players: [],
    ...overrides,
  } as RoomView;
}

function renderBar(over: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const leaveRoom = over.leaveRoom ?? vi.fn();
  render(
    <TopBar
      room={over.room ?? room()}
      me={{ id: 'p0', name: 'آرمان', seat: 0, connected: true }}
      apiUrl="https://api.test"
      connection="connected"
      showRules={noop}
      leaveRoom={leaveRoom}
      {...over}
    />,
  );
  return { leaveRoom };
}

const trigger = () => screen.getByRole('button', { name: 'خروج از میز' });

describe('leave control', () => {
  it('is an icon button, not a block of text', () => {
    renderBar();
    // The accessible name comes from aria-label, so the visible content is the
    // icon alone and no stray text is rendered.
    expect(trigger().textContent).toBe('');
    expect(trigger().querySelector('svg')).toBeTruthy();
  });

  it('hides the icon from assistive tech and labels the button instead', () => {
    renderBar();
    expect(trigger().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(trigger().getAttribute('aria-label')).toBe('خروج از میز');
  });

  it('does not leave on the first tap', () => {
    const { leaveRoom } = renderBar();
    fireEvent.click(trigger());
    expect(leaveRoom).not.toHaveBeenCalled();
  });

  it('warns that the seat is kept when leaving mid game', () => {
    renderBar();
    fireEvent.click(trigger());
    expect(screen.getByText(/صندلی‌ات نگه داشته می‌شود/)).toBeDefined();
  });

  it('uses a plainer message outside a live game', () => {
    renderBar({ room: room({ status: 'lobby' }) });
    fireEvent.click(trigger());
    expect(screen.getByText('از این میز خارج می‌شوی.')).toBeDefined();
  });

  it('leaves once confirmed', () => {
    const { leaveRoom } = renderBar();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'خروج' }));
    expect(leaveRoom).toHaveBeenCalledOnce();
  });

  it('lets the player change their mind', () => {
    const { leaveRoom } = renderBar();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'ماندم' }));
    expect(leaveRoom).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape', () => {
    renderBar();
    fireEvent.click(trigger());
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('returns focus to the trigger after Escape', () => {
    renderBar();
    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger());
  });

  it('closes when clicking elsewhere', () => {
    renderBar();
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays open when clicking inside the popover', () => {
    renderBar();
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('reports its expanded state', () => {
    renderBar();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('shows progress and blocks a double submit', () => {
    renderBar({ leaveBusy: true });
    fireEvent.click(trigger());
    const confirm = screen.getByRole('button', { name: 'در حال خروج…' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it('is absent when leaving is not possible', () => {
    render(
      <TopBar
        room={room({ status: 'abandoned' })}
        me={undefined}
        apiUrl="https://api.test"
        connection="connected"
        showRules={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: 'خروج از میز' })).toBeNull();
  });

  it('removes its listeners on unmount', () => {
    const leaveRoom = vi.fn();
    const { unmount } = render(
      <TopBar
        room={room()}
        me={undefined}
        apiUrl="https://api.test"
        connection="connected"
        showRules={noop}
        leaveRoom={leaveRoom}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'خروج از میز' }));
    unmount();
    // Must not throw or act on a torn-down component.
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(document.body);
    expect(leaveRoom).not.toHaveBeenCalled();
  });
});

describe('top bar still shows table state', () => {
  it('keeps the rules button reachable', () => {
    renderBar();
    expect(screen.getByRole('button', { name: 'راهنمای قوانین' })).toBeDefined();
  });

  it('shows a reconnect banner when the socket drops', () => {
    renderBar({ connection: 'connecting' });
    expect(screen.getByText(/در حال اتصال دوباره به میز/)).toBeDefined();
  });
});
