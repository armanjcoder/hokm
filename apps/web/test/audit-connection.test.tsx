import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRoomConnection } from '../src/hooks/useRoomConnection.js';
import type { StoredSession } from '../src/lib.js';

afterEach(cleanup);

/**
 * Reconnect audit.
 *
 * This hook decides whether a player silently stops receiving updates after a
 * dropped connection, which is the worst failure the app can have: the table
 * looks alive but is frozen. The behaviour that matters is that `room:join` is
 * re-sent on *every* connect, because a reconnected socket is a new socket and
 * is no longer a member of the server-side room.
 */

function fakeSocket() {
  const handlers: Record<string, Function[]> = {};
  const managerHandlers: Record<string, Function[]> = {};
  const socket: any = {
    connected: false,
    emit: vi.fn(),
    connect: vi.fn(() => {
      socket.connected = true;
    }),
    disconnect: vi.fn(),
    on: (event: string, fn: Function) => {
      (handlers[event] ??= []).push(fn);
    },
    off: (event: string, fn: Function) => {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== fn);
    },
    io: {
      on: (event: string, fn: Function) => {
        (managerHandlers[event] ??= []).push(fn);
      },
      off: (event: string, fn: Function) => {
        managerHandlers[event] = (managerHandlers[event] ?? []).filter((h) => h !== fn);
      },
    },
    fire: (event: string, ...args: unknown[]) => (handlers[event] ?? []).forEach((h) => h(...args)),
    fireManager: (event: string, ...args: unknown[]) =>
      (managerHandlers[event] ?? []).forEach((h) => h(...args)),
    listenerCount: (event: string) => (handlers[event] ?? []).length,
  };
  return socket;
}

const session: StoredSession = {
  roomId: 'r1',
  playerId: 'p1',
  apiUrl: 'https://api.test',
  token: 'tok',
};

function setup(overrides: Record<string, any> = {}, sess: StoredSession | null = session) {
  const socket = fakeSocket();
  const spies = {
    onConnectionChange: vi.fn(),
    onRoom: vi.fn(),
    onRoomUpdate: vi.fn(),
    onTokenUpgrade: vi.fn(),
    onSessionInvalid: vi.fn(),
    onRoomMissing: vi.fn(),
    onJoinError: vi.fn(),
    ...overrides,
  };
  function Probe() {
    useRoomConnection({ session: sess, socket, ...spies } as any);
    return null;
  }
  const view = render(<Probe />);
  return { socket, spies, view };
}

describe('useRoomConnection', () => {
  it('does nothing at all without a session', () => {
    const { socket } = setup({}, null);
    expect(socket.connect).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('connects when the socket is not yet open', () => {
    const { socket, spies } = setup();
    expect(socket.connect).toHaveBeenCalled();
    expect(spies.onConnectionChange).toHaveBeenCalledWith('connecting');
  });

  it('re-joins the room on EVERY connect, not just the first', () => {
    const { socket } = setup();
    socket.fire('connect');
    socket.fire('connect');
    socket.fire('connect');
    const joins = socket.emit.mock.calls.filter((c: any[]) => c[0] === 'room:join');
    expect(joins).toHaveLength(3);
  });

  it('sends only the session fields the server expects', () => {
    const { socket } = setup();
    socket.fire('connect');
    const [, payload] = socket.emit.mock.calls.find((c: any[]) => c[0] === 'room:join')!;
    expect(payload).toEqual({ roomId: 'r1', playerId: 'p1', token: 'tok' });
    expect(payload).not.toHaveProperty('apiUrl');
  });

  it('delivers the room and marks the connection live', () => {
    const { socket, spies } = setup();
    socket.fire('connect');
    const ack = socket.emit.mock.calls.find((c: any[]) => c[0] === 'room:join')![2];
    ack({ ok: true, room: { id: 'r1' } });
    expect(spies.onRoom).toHaveBeenCalledWith({ id: 'r1' });
    expect(spies.onConnectionChange).toHaveBeenCalledWith('connected');
  });

  it('adopts a refreshed token but ignores an unchanged one', () => {
    const { socket, spies } = setup();
    socket.fire('connect');
    const ack = socket.emit.mock.calls.find((c: any[]) => c[0] === 'room:join')![2];
    ack({ ok: true, room: {}, token: 'tok' });
    expect(spies.onTokenUpgrade).not.toHaveBeenCalled();
    ack({ ok: true, room: {}, token: 'fresh' });
    expect(spies.onTokenUpgrade).toHaveBeenCalledWith('fresh');
  });

  it.each([['INVALID_SESSION'], ['PLAYER_NOT_FOUND']])(
    'treats %s as a dead session',
    (code) => {
      const { socket, spies } = setup();
      socket.fire('connect');
      const ack = socket.emit.mock.calls.find((c: any[]) => c[0] === 'room:join')![2];
      ack({ ok: false, error: code });
      expect(spies.onSessionInvalid).toHaveBeenCalledOnce();
      expect(spies.onSessionInvalid.mock.calls[0]?.[0]).toMatch(/[\u0600-\u06FF]/);
    },
  );

  it('reports a vanished room separately from a dead session', () => {
    const { socket, spies } = setup();
    socket.fire('connect');
    const ack = socket.emit.mock.calls.find((c: any[]) => c[0] === 'room:join')![2];
    ack({ ok: false, error: 'ROOM_NOT_FOUND' });
    expect(spies.onRoomMissing).toHaveBeenCalledOnce();
    expect(spies.onSessionInvalid).not.toHaveBeenCalled();
  });

  it('passes any other failure through to the generic handler', () => {
    const { socket, spies } = setup();
    socket.fire('connect');
    const ack = socket.emit.mock.calls.find((c: any[]) => c[0] === 'room:join')![2];
    ack({ ok: false, error: 'RATE_LIMITED' });
    expect(spies.onJoinError).toHaveBeenCalledWith({ ok: false, error: 'RATE_LIMITED' });
  });

  it('goes offline on disconnect and on connect_error', () => {
    const { socket, spies } = setup();
    spies.onConnectionChange.mockClear();
    socket.fire('disconnect');
    expect(spies.onConnectionChange).toHaveBeenCalledWith('offline');
    spies.onConnectionChange.mockClear();
    socket.fire('connect_error');
    expect(spies.onConnectionChange).toHaveBeenCalledWith('offline');
  });

  it('shows reconnecting while the manager retries', () => {
    const { socket, spies } = setup();
    spies.onConnectionChange.mockClear();
    socket.fireManager('reconnect_attempt');
    expect(spies.onConnectionChange).toHaveBeenCalledWith('connecting');
  });

  it('forwards live room updates', () => {
    const { socket, spies } = setup();
    socket.fire('room:update', { id: 'r1', status: 'playing' });
    expect(spies.onRoomUpdate).toHaveBeenCalledWith({ id: 'r1', status: 'playing' });
  });

  it('removes every listener on unmount so nothing leaks', () => {
    const { socket, view } = setup();
    view.unmount();
    expect(socket.listenerCount('connect')).toBe(0);
    expect(socket.listenerCount('disconnect')).toBe(0);
    expect(socket.listenerCount('room:update')).toBe(0);
    expect(socket.disconnect).toHaveBeenCalled();
  });
});
