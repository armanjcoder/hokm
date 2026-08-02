import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLobbyActions, type LobbyActions } from '../src/hooks/useLobbyActions.js';
import type { RoomView } from '../src/types.js';

afterEach(cleanup);

/**
 * Lobby actions.
 *
 * Every button in the lobby routes through here, so a mistake means a dead
 * button rather than a visible crash. Each action has to reach the right
 * endpoint, surface a Persian message when it fails, and never leave the busy
 * flag stuck on, which would silently disable the whole lobby.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(body: unknown, ok = true) {
  const calls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) });
    return { ok, status: ok ? 200 : 400, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

const room = (): RoomView =>
  ({ id: 'r1', code: 'ABCDE', status: 'lobby', mode: 'classic4', players: [] }) as unknown as RoomView;

interface Harness {
  actions: LobbyActions;
  toasts: string[];
  started: number;
  left: number;
}

function setup(over: { connected?: boolean; ready?: boolean } = {}) {
  const state: Harness = { actions: undefined as never, toasts: [], started: 0, left: 0 };

  function Probe() {
    state.actions = useLobbyActions({
      apiUrl: 'https://api.test',
      room: room(),
      session: { roomId: 'r1', playerId: 'p1', apiUrl: 'https://api.test', token: 't' },
      me: { ready: over.ready ?? false },
      requireConnection: () => over.connected ?? true,
      setToast: (message) => state.toasts.push(message),
      onGameStarted: () => (state.started += 1),
      onLeft: () => (state.left += 1),
    });
    return null;
  }

  render(<Probe />);
  return state;
}

describe('each action reaches its own endpoint', () => {
  beforeEach(() => mockFetch({ ok: true }));

  it.each([
    ['toggleReady', 'ready'],
    ['addBot', 'add-bot'],
    ['leaveRoom', 'leave'],
  ])('%s posts to /%s', async (action, path) => {
    const calls = mockFetch({ ok: true });
    const harness = setup();
    await act(async () => {
      await (harness.actions as any)[action]('medium');
    });
    expect(calls[0]!.url).toBe(`https://api.test/rooms/r1/${path}`);
  });

  it('sends the opposite of the current readiness', async () => {
    const calls = mockFetch({ ok: true });
    const harness = setup({ ready: true });
    await act(async () => {
      await harness.actions.toggleReady();
    });
    expect(calls[0]!.body.ready).toBe(false);
  });

  it('passes the chosen bot difficulty', async () => {
    const calls = mockFetch({ ok: true });
    const harness = setup();
    await act(async () => {
      await harness.actions.addBot('hard');
    });
    expect(calls[0]!.body.difficulty).toBe('hard');
  });

  it('sends the bot id when changing difficulty', async () => {
    const calls = mockFetch({ ok: true });
    const harness = setup();
    act(() => harness.actions.setBotDifficulty('b1', 'easy'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toContain('/bot-difficulty');
    expect(calls[0]!.body).toMatchObject({ botId: 'b1', difficulty: 'easy' });
  });

  it('sends the bot id when removing one', async () => {
    const calls = mockFetch({ ok: true });
    const harness = setup();
    act(() => harness.actions.removeBot('b2'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toContain('/remove-bot');
    expect(calls[0]!.body.botId).toBe('b2');
  });

  it('forwards only the settings that changed', async () => {
    const calls = mockFetch({ ok: true });
    const harness = setup();
    await act(async () => {
      await harness.actions.updateSettings({ targetScore: 11 });
    });
    expect(calls[0]!.url).toContain('/settings');
    expect(calls[0]!.body.targetScore).toBe(11);
  });
});

describe('starting the game', () => {
  it('reports a start when the server says the table began', async () => {
    mockFetch({ started: true });
    const harness = setup();
    await act(async () => {
      await harness.actions.toggleReady();
    });
    expect(harness.started).toBe(1);
  });

  it('stays quiet when the table is still filling up', async () => {
    mockFetch({ started: false });
    const harness = setup();
    await act(async () => {
      await harness.actions.toggleReady();
    });
    expect(harness.started).toBe(0);
  });

  it('can also start from adding the last bot', async () => {
    mockFetch({ started: true });
    const harness = setup();
    await act(async () => {
      await harness.actions.addBot('easy');
    });
    expect(harness.started).toBe(1);
  });

  it('can start from a settings change that resizes the table', async () => {
    mockFetch({ started: true });
    const harness = setup();
    await act(async () => {
      await harness.actions.updateSettings({ mode: 'duel2' });
    });
    expect(harness.started).toBe(1);
  });
});

describe('leaving', () => {
  it('reports the departure once the server confirms', async () => {
    mockFetch({ ok: true });
    const harness = setup();
    await act(async () => {
      await harness.actions.leaveRoom();
    });
    expect(harness.left).toBe(1);
  });

  it('does not pretend to leave when the request failed', async () => {
    // Otherwise the player is thrown back to the landing screen while the
    // server still has them seated.
    mockFetch({ error: 'BOOM', message: 'خطا رخ داد.' }, false);
    const harness = setup();
    await act(async () => {
      await harness.actions.leaveRoom();
    });
    expect(harness.left).toBe(0);
  });
});

describe('failures are always explained in Persian', () => {
  it('shows the server message when there is one', async () => {
    mockFetch({ error: 'NOT_HOST', message: 'فقط سازنده میز می‌تواند تنظیمات را عوض کند.' }, false);
    const harness = setup();
    await act(async () => {
      await harness.actions.updateSettings({ targetScore: 3 });
    });
    expect(harness.toasts).toContain('فقط سازنده میز می‌تواند تنظیمات را عوض کند.');
  });

  it('falls back to its own message when the server sends none', async () => {
    mockFetch({ error: 'BOOM' }, false);
    const harness = setup();
    await act(async () => {
      await harness.actions.addBot('medium');
    });
    expect(harness.toasts).toEqual(['اضافه کردن ربات انجام نشد.']);
  });

  it('explains a network failure rather than failing silently', async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch;
    const harness = setup();
    await act(async () => {
      await harness.actions.toggleReady();
    });
    expect(harness.toasts).toHaveLength(1);
    expect(harness.toasts[0]).toMatch(/[\u0600-\u06FF]/);
  });
});

describe('the busy flag', () => {
  it('is off once a request finishes', async () => {
    mockFetch({ ok: true });
    const harness = setup();
    await act(async () => {
      await harness.actions.toggleReady();
    });
    expect(harness.actions.busy).toBe(false);
  });

  it('is released even when the request fails', async () => {
    // A stuck busy flag disables every button in the lobby.
    mockFetch({ error: 'BOOM' }, false);
    const harness = setup();
    await act(async () => {
      await harness.actions.addBot('medium');
    });
    expect(harness.actions.busy).toBe(false);
  });

  it('is released even when the network throws', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
    const harness = setup();
    await act(async () => {
      await harness.actions.leaveRoom();
    });
    expect(harness.actions.busy).toBe(false);
  });
});

describe('actions are blocked while the socket is down', () => {
  it('sends nothing when the connection check fails', async () => {
    const calls = mockFetch({ ok: true });
    const harness = setup({ connected: false });
    await act(async () => {
      await harness.actions.toggleReady();
      await harness.actions.addBot('easy');
      await harness.actions.leaveRoom();
    });
    expect(calls).toHaveLength(0);
    expect(harness.started).toBe(0);
    expect(harness.left).toBe(0);
  });
});
