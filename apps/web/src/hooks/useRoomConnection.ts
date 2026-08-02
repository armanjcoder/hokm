import { useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { socketPayload, type StoredSession } from '../lib.js';
import type { ConnectionStatus, RoomView } from '../types.js';

interface Options {
  session: StoredSession | null;
  socket: Socket;
  onConnectionChange: (status: ConnectionStatus) => void;
  onRoom: (room: RoomView) => void;
  onRoomUpdate: (room: RoomView) => void;
  /** Called when the server hands back a freshly adopted session token. */
  onTokenUpgrade: (token: string) => void;
  onSessionInvalid: (message: string) => void;
  onRoomMissing: (message: string) => void;
  onJoinError: (response: unknown) => void;
}

/**
 * Keeps the socket joined to the player's table.
 *
 * The critical detail is that `room:join` runs on *every* connect, not just the
 * first: after a reconnect the socket is a brand new one and is no longer a
 * member of the Socket.IO room, so it would silently stop receiving updates.
 */
export function useRoomConnection({
  session,
  socket,
  onConnectionChange,
  onRoom,
  onRoomUpdate,
  onTokenUpgrade,
  onSessionInvalid,
  onRoomMissing,
  onJoinError,
}: Options): void {
  useEffect(() => {
    if (!session) return;

    const joinRoomOverSocket = () => {
      onConnectionChange('connected');
      socket.emit('room:join', socketPayload(session), (response: any) => {
        if (response?.ok && response.room) {
          onRoom(response.room);
          if (typeof response.token === 'string' && response.token !== session.token) {
            onTokenUpgrade(response.token);
          }
          return;
        }
        if (response?.ok === false) {
          if (response.error === 'INVALID_SESSION' || response.error === 'PLAYER_NOT_FOUND') {
            onSessionInvalid(
              'نشست تو دیگر معتبر نیست. احتمالاً میز پاک شده یا صندلی‌ات آزاد شده. یک میز جدید بساز یا با کد میز دوباره وارد شو.',
            );
            return;
          }
          if (response.error === 'ROOM_NOT_FOUND') {
            onRoomMissing(
              'میز قبلی روی سرور پیدا نشد؛ احتمالاً دیتابیس پاک شده یا لینک قدیمی است. در ربات /newgame بزن.',
            );
            return;
          }
          onJoinError(response);
        }
      });
    };

    const handleDisconnect = () => onConnectionChange('offline');
    const handleReconnectAttempt = () => onConnectionChange('connecting');
    const handleRoomUpdate = (nextRoom: RoomView) => onRoomUpdate(nextRoom);

    socket.on('connect', joinRoomOverSocket);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleDisconnect);
    socket.io.on('reconnect_attempt', handleReconnectAttempt);
    socket.on('room:update', handleRoomUpdate);

    onConnectionChange(socket.connected ? 'connected' : 'connecting');
    if (socket.connected) joinRoomOverSocket();
    else socket.connect();

    return () => {
      socket.off('connect', joinRoomOverSocket);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleDisconnect);
      socket.io.off('reconnect_attempt', handleReconnectAttempt);
      socket.off('room:update', handleRoomUpdate);
      socket.disconnect();
    };
    // Callbacks are re-created each render; the connection only depends on these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, socket]);
}
