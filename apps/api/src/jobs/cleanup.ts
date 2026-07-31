import { config } from '../config.js';
import { cleanupAction } from '../room-lifecycle.js';
import { persistRoom, rooms, roomStore, touchRoom } from '../state.js';

/**
 * Deletes expired rooms and abandons stalled games.
 * Runs once at boot (to clear anything accumulated while the server was down)
 * and then on a timer.
 */
export function runRoomCleanup(now = Date.now()): { deleted: number; abandoned: number } {
  let deleted = 0;
  let abandoned = 0;

  for (const room of [...rooms.values()]) {
    const action = cleanupAction(room, now, config.cleanupPolicy);
    if (action === 'delete') {
      rooms.delete(room.id);
      roomStore.deleteRoom(room.id);
      deleted += 1;
    } else if (action === 'abandon' && room.status !== 'abandoned') {
      room.status = 'abandoned';
      touchRoom(room);
      persistRoom(room);
      abandoned += 1;
    }
  }

  if (deleted > 0 || abandoned > 0) {
    console.log(`Room cleanup: deleted=${deleted} abandoned=${abandoned} remaining=${rooms.size}`);
  }
  return { deleted, abandoned };
}

/** Runs cleanup immediately, then on an interval that never holds the process open. */
export function scheduleRoomCleanup(): void {
  runRoomCleanup();
  setInterval(() => runRoomCleanup(), config.cleanupIntervalMs).unref();
}
