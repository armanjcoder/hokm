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

describe('game actions give physical feedback', () => {
  function setup(over: { validCardIds?: string[]; connection?: string } = {}) {
    const calls: string[] = [];
    (window as any).Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        HapticFeedback: {
          impactOccurred: (s: string) => calls.push(`impact:${s}`),
          notificationOccurred: (t: string) => calls.push(`notify:${t}`),
          selectionChanged: () => calls.push('selection'),
        },
      },
    };
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, addEventListener() {}, removeEventListener() {},
    })) as unknown as typeof window.matchMedia;

    const emitted: any[] = [];
    const socket = { emit: (...args: any[]) => emitted.push(args) } as never;
    let actions: any;
    function Probe() {
      actions = useGameActions({
        socket,
        session: { roomId: 'r', playerId: 'p', apiUrl: 'https://a' },
        game: { validCardIds: over.validCardIds ?? ['c1'] } as never,
        connection: (over.connection ?? 'connected') as never,
        setToast: () => {},
      });
      return null;
    }
    render(<Probe />);
    return { calls, get actions() { return actions; }, emitted };
  }

  afterEach(() => {
    delete (window as any).Telegram;
  });

  it('taps when you play a card', () => {
    const h = setup();
    h.actions.play({ id: 'c1' });
    expect(h.calls).toContain('impact:light');
  });

  it('buzzes an error when the card cannot be played', () => {
    // Silently ignoring the tap leaves the player wondering what happened.
    const h = setup({ validCardIds: [] });
    h.actions.play({ id: 'nope' });
    expect(h.calls).toEqual(['notify:error']);
    expect(h.emitted).toHaveLength(0);
  });

  it('buzzes an error when the connection is down', () => {
    const h = setup({ connection: 'offline' });
    h.actions.nextHand();
    expect(h.calls).toContain('notify:error');
  });

  it('uses selection feedback for naming trump', () => {
    const h = setup();
    h.actions.chooseSuit('hearts');
    expect(h.calls).toContain('selection');
  });

  it('works normally when there is no Telegram host', () => {
    delete (window as any).Telegram;
    const emitted: any[] = [];
    const socket = { emit: (...args: any[]) => emitted.push(args) } as never;
    let actions: any;
    function Probe() {
      actions = useGameActions({
        socket,
        session: { roomId: 'r', playerId: 'p', apiUrl: 'https://a' },
        game: { validCardIds: ['c1'] } as never,
        connection: 'connected' as never,
        setToast: () => {},
      });
      return null;
    }
    render(<Probe />);
    expect(() => actions.play({ id: 'c1' })).not.toThrow();
    expect(emitted).toHaveLength(1);
  });
});

describe('resuming a saved table', () => {
  it('moves into the resuming state and re-uses the saved seat', () => {
    const stored: StoredSession = { roomId: 'r9', playerId: 'p9', apiUrl: 'https://api.test' };
    localStorage.setItem('hokm.session', JSON.stringify(stored));

    const result = renderHook(() => useSession('https://api.test'));
    expect(result.current.phase).toBe('idle');

    act(() => result.current.resume());
    expect(result.current.phase).toBe('resuming');
    expect(result.current.session?.roomId).toBe('r9');
  });

  it('does nothing when there is no saved table to resume', () => {
    const result = renderHook(() => useSession('https://api.test'));
    act(() => result.current.resume());
    expect(result.current.phase).toBe('idle');
    expect(result.current.session).toBeNull();
  });

  it('abandons a resume without wiping the saved table', () => {
    // The player may want to try again later, so cancelling must not clear it.
    const stored: StoredSession = { roomId: 'r9', playerId: 'p9', apiUrl: 'https://api.test' };
    localStorage.setItem('hokm.session', JSON.stringify(stored));

    const result = renderHook(() => useSession('https://api.test'));
    act(() => result.current.resume());
    act(() => result.current.cancelResume());

    expect(result.current.phase).toBe('idle');
    expect(result.current.session).toBeNull();
    expect(result.current.savedSession?.roomId).toBe('r9');
  });

  it('becomes active once the table actually arrives', () => {
    const result = renderHook(() => useSession('https://api.test'));
    act(() => result.current.markActive());
    expect(result.current.phase).toBe('active');
  });

  it('keeps the api url on the session when it changes', () => {
    const result = renderHook(() => useSession('https://old.test'));
    act(() =>
      result.current.activate({ roomId: 'r1', playerId: 'p1', apiUrl: 'https://old.test' }),
    );
    act(() => result.current.updateApiUrl('https://new.test/'));

    expect(result.current.apiUrl).toBe('https://new.test');
    expect(result.current.session?.apiUrl).toBe('https://new.test');
    // Persisted too, so a reload does not fall back to the stale host.
    expect(JSON.parse(localStorage.getItem('hokm.session')!).apiUrl).toBe('https://new.test');
  });

  it('changing the api url before joining does not invent a session', () => {
    const result = renderHook(() => useSession('https://old.test'));
    act(() => result.current.updateApiUrl('https://new.test'));
    expect(result.current.session).toBeNull();
  });
});
