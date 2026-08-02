import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteRoomStore, type PersistableRoom } from '../src/storage.js';

const tempDirs: string[] = [];

function tempDbPath() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hokm-store-'));
  tempDirs.push(dir);
  return path.join(dir, 'hokm.sqlite');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('SqliteRoomStore', () => {
  it('persists and reloads room snapshots', async () => {
    const dbPath = tempDbPath();
    const room = {
      id: 'room_1',
      code: 'ABCDE',
      status: 'lobby',
      createdAt: '2026-07-30T00:00:00.000Z',
      players: [{ id: 'p1', name: 'آرمان', seat: 0, connected: true }],
    } satisfies PersistableRoom & { players: unknown[] };

    const firstStore = await SqliteRoomStore.open(dbPath);
    firstStore.saveRoom(room);
    firstStore.close();

    const secondStore = await SqliteRoomStore.open(dbPath);
    const rooms = secondStore.loadRooms<typeof room>();
    secondStore.close();

    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject(room);
  });

  it('updates an existing room instead of duplicating it', async () => {
    const dbPath = tempDbPath();
    const store = await SqliteRoomStore.open(dbPath);

    store.saveRoom({ id: 'room_1', code: 'ABCDE', status: 'lobby', createdAt: '2026-07-30T00:00:00.000Z' });
    store.saveRoom({ id: 'room_1', code: 'ABCDE', status: 'playing', createdAt: '2026-07-30T00:00:00.000Z' });

    const rooms = store.loadRooms<PersistableRoom>();
    store.close();

    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.status).toBe('playing');
  });
});
