import { io, type Socket } from 'socket.io-client';

/**
 * Creates the game socket.
 *
 * Reconnection is deliberately aggressive: the backend runs on a laptop behind
 * a tunnel that restarts often, and a player should never have to reload.
 */
export function createGameSocket(apiUrl: string): Socket {
  return io(apiUrl, {
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    // Spreads retries out so every client does not hammer the tunnel at once.
    randomizationFactor: 0.5,
    timeout: 10000,
  });
}
