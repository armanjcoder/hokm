import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Player session tokens.
 *
 * A `playerId` is public (it appears in every room snapshot sent to all seats),
 * so it can never be used on its own to prove identity. Each player therefore
 * also gets a secret `token` that is returned exactly once, to that player, and
 * is stripped from every broadcast room view.
 */

export interface SessionPlayer {
  id: string;
  token?: string;
  isBot?: boolean;
}

export type SessionCheck =
  | { ok: true; adoptedToken?: string }
  | { ok: false; code: 'PLAYER_NOT_FOUND' | 'INVALID_SESSION' };

/** Creates a new opaque session token. */
export function createPlayerToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time token comparison that is safe for differing lengths. */
export function tokensMatch(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verifies that `token` belongs to `playerId` inside the given player list.
 *
 * Backward compatibility: rooms persisted before tokens existed have players
 * without a token. The first client to claim such a seat adopts a freshly
 * generated token (returned as `adoptedToken`), after which the seat is locked
 * to that token like any other.
 */
export function verifyPlayerSession<T extends SessionPlayer>(
  players: T[],
  playerId: string,
  token: string | undefined,
): SessionCheck {
  const player = players.find((candidate) => candidate.id === playerId);
  if (!player) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  if (player.isBot) return { ok: false, code: 'INVALID_SESSION' };

  if (!player.token) {
    const adoptedToken = createPlayerToken();
    player.token = adoptedToken;
    return { ok: true, adoptedToken };
  }

  if (!tokensMatch(player.token, token)) return { ok: false, code: 'INVALID_SESSION' };
  return { ok: true };
}

/** Removes secret fields before a value is sent to clients. */
export function withoutToken<T extends SessionPlayer>(player: T): Omit<T, 'token'> {
  const { token: _token, ...rest } = player;
  return rest;
}
