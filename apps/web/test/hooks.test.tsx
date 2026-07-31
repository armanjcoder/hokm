import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../src/hooks/useSession.js';
import { useGameActions } from '../src/hooks/useGameActions.js';
import type { StoredSession } from '../src/lib.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** Renders a hook and exposes its latest value. */
function renderHook<T>(hook: () => T) {
  const box = { current: undefined as unknown as T };
  function Probe() {
    box.current = hook();
    return null;
  }
  render(<Probe />);
  return box;
}

describe('useSession', () => {
  const session: StoredSession = { roomId: 'r1', playerId: 'p1', apiUrl: 'https://x', token: 't1' };

  it('starts with no active session', () => {
    const box = renderHook(() => useSession('https://default'));
    expect(box.current.session).toBeNull();
    expect(box.current.phase).toBe('idle');
  });

  it('activates and persists a session', () => {
    const box = renderHook(() => useSession('https://default'));
    act(() => box.current.activate(session));
    expect(box.current.session).toEqual(session);
    expect(box.current.phase).toBe('active');
    expect(JSON.parse(localStorage.getItem('hokm.session')!).roomId).toBe('r1');
  });

  it('forgets a session everywhere, including storage', () => {
    const box = renderHook(() => useSession('https://default'));
    act(() => box.current.activate(session));
    act(() => box.current.forget());
    expect(box.current.session).toBeNull();
    expect(box.current.savedSession).toBeNull();
    expect(localStorage.getItem('hokm.session')).toBeNull();
  });

  it('upgrades the token without losing the rest of the session', () => {
    const box = renderHook(() => useSession('https://default'));
    act(() => box.current.activate(session));
    act(() => box.current.upgradeToken('t2'));
    expect(box.current.session?.token).toBe('t2');
    expect(box.current.session?.roomId).toBe('r1');
    // The upgrade must survive a reload.
    expect(JSON.parse(localStorage.getItem('hokm.session')!).token).toBe('t2');
  });

  it('ignores a token upgrade when there is no session', () => {
    const box = renderHook(() => useSession('https://default'));
    act(() => box.current.upgradeToken('t2'));
    expect(box.current.session).toBeNull();
  });

  it('cancels a resume without wiping storage', () => {
    const box = renderHook(() => useSession('https://default'));
    act(() => box.current.activate(session));
    act(() => box.current.cancelResume());
    expect(box.current.session).toBeNull();
    // The saved session is still there so the player can try again.
    expect(localStorage.getItem('hokm.session')).not.toBeNull();
  });

  it('rewrites the api url on the live session too', () => {
    const box = renderHook(() => useSession('https://default'));
    act(() => box.current.activate(session));
    act(() => box.current.updateApiUrl('https://new.example/'));
    expect(box.current.apiUrl).toBe('https://new.example');
    expect(box.current.session?.apiUrl).toBe('https://new.example');
  });
});

describe('useGameActions', () => {
  function setup(connection: 'connected' | 'offline', session: StoredSession | null = {
    roomId: 'r1',
    playerId: 'p1',
    apiUrl: 'https://x',
    token: 't',
  }) {
    const emit = vi.fn();
    const setToast = vi.fn();
    const socket = { emit } as any;
    const game = { validCardIds: ['hearts-A'] } as any;
    const box = renderHook(() =>
      useGameActions({ socket, session, game, connection, setToast }),
    );
    return { box, emit, setToast };
  }

  it('emits game moves when connected', () => {
    const { box, emit } = setup('connected');
    act(() => box.current.chooseSuit('hearts'));
    expect(emit).toHaveBeenCalledWith(
      'game:choose_trump',
      expect.objectContaining({ roomId: 'r1', suit: 'hearts' }),
      expect.any(Function),
    );
  });

  it('blocks every move while offline and explains why', () => {
    const { box, emit, setToast } = setup('offline');
    act(() => {
      box.current.chooseSuit('hearts');
      box.current.play({ id: 'hearts-A' } as any);
      box.current.nextHand();
      box.current.requestRedeal();
      box.current.draw();
    });
    expect(emit).not.toHaveBeenCalled();
    expect(setToast).toHaveBeenCalled();
  });

  it('refuses to play a card that is not legal', () => {
    const { box, emit } = setup('connected');
    act(() => box.current.play({ id: 'spades-2' } as any));
    expect(emit).not.toHaveBeenCalled();
  });

  it('never emits without a session', () => {
    const { box, emit } = setup('connected', null);
    act(() => box.current.nextHand());
    expect(emit).not.toHaveBeenCalled();
  });

  it('never leaks the api url into a socket payload', () => {
    const { box, emit } = setup('connected');
    act(() => box.current.nextHand());
    expect(JSON.stringify(emit.mock.calls[0]![1])).not.toContain('https://x');
  });
});
