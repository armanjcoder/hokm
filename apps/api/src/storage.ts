import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

export interface PersistableRoom {
  id: string;
  code: string;
  status: string;
  createdAt: string;
}

export class SqliteRoomStore {
  private constructor(
    private readonly db: Database,
    private readonly dbPath: string,
  ) {}

  static async open(dbPath: string): Promise<SqliteRoomStore> {
    const SQL = await loadSqlJs();
    const resolvedPath = path.resolve(dbPath);
    mkdirSync(path.dirname(resolvedPath), { recursive: true });

    // A corrupt file must not stop the server from booting: back it up and
    // start fresh rather than crash-looping on every restart.
    let db: Database;
    if (existsSync(resolvedPath)) {
      try {
        db = new SQL.Database(readFileSync(resolvedPath));
        db.exec('SELECT 1');
      } catch (error) {
        const backupPath = `${resolvedPath}.corrupt-${Date.now()}`;
        renameSync(resolvedPath, backupPath);
        console.error(`Database at ${resolvedPath} was unreadable; moved to ${backupPath}.`, error);
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }

    const store = new SqliteRoomStore(db, resolvedPath);
    store.migrate();
    store.flush();
    return store;
  }

  saveRoom<T extends PersistableRoom>(room: T): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO rooms (id, code, status, created_at, updated_at, snapshot_json)
       VALUES ($id, $code, $status, $createdAt, $updatedAt, $snapshot)
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code,
         status = excluded.status,
         updated_at = excluded.updated_at,
         snapshot_json = excluded.snapshot_json`,
      {
        $id: room.id,
        $code: room.code,
        $status: room.status,
        $createdAt: room.createdAt,
        $updatedAt: now,
        $snapshot: JSON.stringify(room),
      },
    );
    this.flush();
  }

  loadRooms<T extends PersistableRoom>(): T[] {
    const rows = this.db.exec('SELECT snapshot_json FROM rooms ORDER BY created_at ASC');
    const table = rows[0];
    if (!table) return [];
    return table.values.map((row) => JSON.parse(String(row[0])) as T);
  }

  deleteRoom(roomId: string): void {
    this.db.run('DELETE FROM rooms WHERE id = $id', { $id: roomId });
    this.flush();
  }

  close(): void {
    this.flush();
    this.db.close();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        snapshot_json TEXT NOT NULL
      );
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON rooms(created_at);');
  }

  /**
   * Writes the database atomically.
   *
   * sql.js keeps everything in memory and re-serialises the whole file on every
   * save, so writing straight to `dbPath` means a crash mid-write truncates the
   * file and loses every room. Writing to a temp file and renaming makes the
   * swap atomic on POSIX and Windows.
   */
  private flush(): void {
    const tempPath = `${this.dbPath}.tmp`;
    try {
      writeFileSync(tempPath, Buffer.from(this.db.export()));
      renameSync(tempPath, this.dbPath);
    } catch (error) {
      rmSync(tempPath, { force: true });
      throw error;
    }
  }
}

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: locateSqlJsFile });
  }
  return sqlJsPromise;
}

function locateSqlJsFile(file: string): string {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.wasm')), file);
}
