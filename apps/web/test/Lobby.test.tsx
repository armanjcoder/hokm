import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lobby } from '../src/components/Lobby.js';
import type { RoomView } from '../src/types.js';

afterEach(cleanup);

function room(overrides: Partial<RoomView> = {}): RoomView {
  return {
    id: 'r1',
    code: 'ABCDE',
    status: 'lobby',
    mode: 'classic4',
    targetScore: 7,
    hostPlayerId: 'p0',
    players: [{ id: 'p0', name: 'آرمان', seat: 0, connected: true, ready: false }],
    readiness: { waitingOn: ['p0'], humanCount: 1, botCount: 0, canStart: false },
    ...overrides,
  };
}

const noop = () => {};

function renderLobby(props: Partial<Parameters<typeof Lobby>[0]> = {}) {
  const merged = {
    room: room(),
    me: room().players[0],
    isHost: true,
    toggleReady: noop,
    addBot: noop,
    removeBot: noop,
    leaveRoom: noop,
    invite: noop,
    busy: false,
    showRules: noop,
    updateSettings: noop,
    ...props,
  };
  return { ...render(<Lobby {...(merged as any)} />), props: merged };
}

describe('host table settings', () => {
  it('lets the host switch the target score', () => {
    const updateSettings = vi.fn();
    renderLobby({ updateSettings });

    fireEvent.click(screen.getByText('5'));
    expect(updateSettings).toHaveBeenCalledWith({ targetScore: 5 });
  });

  it('lets the host switch the game mode', () => {
    const updateSettings = vi.fn();
    renderLobby({ updateSettings });

    fireEvent.click(screen.getByText('۲ نفره'));
    expect(updateSettings).toHaveBeenCalledWith({ mode: 'duel2' });
  });

  it('marks the current mode and score as selected', () => {
    renderLobby({ room: room({ mode: 'solo3', targetScore: 11 }) });
    const checked = screen
      .getAllByRole('radio')
      .filter((r) => r.getAttribute('aria-checked') === 'true')
      .map((r) => r.textContent?.trim());
    expect(checked).toContain('۳ نفره');
    expect(checked).toContain('11');
  });

  it('disables the controls while a request is in flight', () => {
    renderLobby({ busy: true });
    const radios = screen.getAllByRole('radio');
    expect(radios.every((r) => (r as HTMLButtonElement).disabled)).toBe(true);
  });

  it('warns that changing the mode resets readiness', () => {
    renderLobby();
    expect(screen.getByText(/آمادگی همه دوباره صفر می‌شود/)).toBeDefined();
  });
});

describe('non-host view', () => {
  it('hides the settings panel and shows the target score instead', () => {
    renderLobby({ isHost: false, room: room({ targetScore: 5 }) });
    expect(screen.queryByText('تنظیمات میز')).toBeNull();
    expect(screen.getByText(/بازی تا 5 امتیاز/)).toBeDefined();
  });
});

describe('seat count follows the mode', () => {
  it.each([
    ['classic4', 4],
    ['solo3', 3],
    ['duel2', 2],
  ] as const)('shows %i seats for %s', (mode, seats) => {
    cleanup();
    renderLobby({ room: room({ mode }) });
    const labels = screen.getAllByText(/^صندلی \d$/);
    expect(labels).toHaveLength(seats);
  });
});

describe('optional rule toggles', () => {
  it('lets the host enable the low hand redeal', () => {
    const updateSettings = vi.fn();
    renderLobby({ updateSettings });
    fireEvent.click(screen.getByText('ده‌لو کم'));
    expect(updateSettings).toHaveBeenCalledWith({ rules: { lowHandRedeal: true } });
  });

  it('lets the host enable bam', () => {
    const updateSettings = vi.fn();
    renderLobby({ updateSettings });
    fireEvent.click(screen.getByText('بام'));
    expect(updateSettings).toHaveBeenCalledWith({ rules: { bam: true } });
  });

  it('reflects rules that are already on', () => {
    renderLobby({
      room: room({ rules: { lowHandRedeal: true, maxRedeals: 2, bam: true } }),
    });
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.every((b) => b.checked)).toBe(true);
  });

  it('hides the toggles from non-hosts', () => {
    renderLobby({ isHost: false });
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
