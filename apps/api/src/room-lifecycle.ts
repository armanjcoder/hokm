/**
 * Room lifecycle rules: readiness, host transfer and expiry.
 *
 * Kept free of Express/Socket.IO so the rules can be unit tested directly.
 */

export type RoomStatus = 'lobby' | 'playing' | 'finished' | 'abandoned';

export interface LifecyclePlayer {
  id: string;
  seat: number;
  isBot?: boolean;
  ready?: boolean;
  connected?: boolean;
}

export interface LifecycleRoom {
  id: string;
  status: RoomStatus;
  createdAt: string;
  lastActivityAt?: string;
  hostPlayerId?: string;
  players: LifecyclePlayer[];
}

/** How long a room may stay idle in each state before cleanup acts on it. */
export interface CleanupPolicy {
  lobbyIdleMs: number;
  playingIdleMs: number;
  finishedIdleMs: number;
}

export const DEFAULT_CLEANUP_POLICY: CleanupPolicy = {
  lobbyIdleMs: 6 * 60 * 60 * 1000,
  playingIdleMs: 12 * 60 * 60 * 1000,
  finishedIdleMs: 24 * 60 * 60 * 1000,
};

export const REQUIRED_PLAYERS = 4;

export type StartBlockReason = 'ROOM_NOT_FULL' | 'PLAYERS_NOT_READY' | 'ROOM_ALREADY_STARTED';

export interface Readiness {
  /** Human players who still need to press "ready". */
  waitingOn: string[];
  humanCount: number;
  botCount: number;
  canStart: boolean;
  blockedBy?: StartBlockReason;
}

/**
 * A table starts when all four seats are taken and every *human* player is
 * ready. Bots are always considered ready, which is what makes 1, 2 and 3
 * player games work without any special casing.
 */
export function evaluateReadiness(room: LifecycleRoom): Readiness {
  const humans = room.players.filter((player) => !player.isBot);
  const bots = room.players.filter((player) => player.isBot);
  const waitingOn = humans.filter((player) => !player.ready).map((player) => player.id);

  const base = { waitingOn, humanCount: humans.length, botCount: bots.length };

  if (room.status === 'playing' || room.status === 'finished') {
    return { ...base, canStart: false, blockedBy: 'ROOM_ALREADY_STARTED' };
  }
  if (room.players.length !== REQUIRED_PLAYERS) {
    return { ...base, canStart: false, blockedBy: 'ROOM_NOT_FULL' };
  }
  if (waitingOn.length > 0) {
    return { ...base, canStart: false, blockedBy: 'PLAYERS_NOT_READY' };
  }
  return { ...base, canStart: true };
}

/** Lowest free seat index, or undefined when the table is full. */
export function nextFreeSeat(room: LifecycleRoom): number | undefined {
  const taken = new Set(room.players.map((player) => player.seat));
  for (let seat = 0; seat < REQUIRED_PLAYERS; seat += 1) {
    if (!taken.has(seat)) return seat;
  }
  return undefined;
}

/**
 * Picks the next host after the current one leaves.
 * Bots can never host, because nobody would be able to start the game.
 */
export function pickNextHost(room: LifecycleRoom, excludePlayerId?: string): string | undefined {
  const candidates = room.players
    .filter((player) => !player.isBot && player.id !== excludePlayerId)
    .sort((a, b) => Number(b.connected ?? false) - Number(a.connected ?? false) || a.seat - b.seat);
  return candidates[0]?.id;
}

/** True when only bots (or nobody) remain. */
export function hasNoHumans(room: LifecycleRoom): boolean {
  return room.players.every((player) => player.isBot);
}

export type CleanupAction = 'keep' | 'delete' | 'abandon';

/** Decides what the periodic cleanup job should do with a room. */
export function cleanupAction(
  room: LifecycleRoom,
  now: number,
  policy: CleanupPolicy = DEFAULT_CLEANUP_POLICY,
): CleanupAction {
  const last = Date.parse(room.lastActivityAt ?? room.createdAt);
  const idleMs = now - (Number.isFinite(last) ? last : now);

  switch (room.status) {
    case 'finished':
    case 'abandoned':
      return idleMs > policy.finishedIdleMs ? 'delete' : 'keep';
    case 'lobby':
      return idleMs > policy.lobbyIdleMs ? 'delete' : 'keep';
    case 'playing':
      return idleMs > policy.playingIdleMs ? 'abandon' : 'keep';
    default:
      return 'keep';
  }
}
