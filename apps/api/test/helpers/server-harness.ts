import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Boots the real API in a child process so restart/reconnect behaviour can be
 * tested end to end. Each harness gets its own port and SQLite file, which lets
 * a test kill the process and start a new one against the same database.
 */
export class ServerHarness {
  private child: ChildProcess | undefined;
  private readonly dbDir: string;

  private constructor(
    readonly port: number,
    readonly dbPath: string,
  ) {
    this.dbDir = path.dirname(dbPath);
  }

  static async create(): Promise<ServerHarness> {
    const dbDir = mkdtempSync(path.join(os.tmpdir(), 'hokm-e2e-'));
    const harness = new ServerHarness(await findFreePort(), path.join(dbDir, 'hokm.sqlite'));
    return harness;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    if (this.child) throw new Error('Server is already running.');
    this.child = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
      cwd: apiRoot,
      env: {
        ...process.env,
        PORT: String(this.port),
        DB_PATH: this.dbPath,
        SERVE_WEB_DIST: 'false',
        TELEGRAM_BOT_TOKEN: '',
        CORS_ORIGIN: '*',
      },
      stdio: 'ignore',
    });
    await this.waitUntilHealthy();
  }

  /** Hard-kills the process, simulating a crash or an abrupt restart. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await exited;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async dispose(): Promise<void> {
    await this.stop();
    rmSync(this.dbDir, { recursive: true, force: true });
  }

  private async waitUntilHealthy(timeoutMs = 30000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${this.url}/health`);
        if (response.ok) return;
      } catch {
        // Server is not accepting connections yet.
      }
      await delay(150);
    }
    throw new Error(`Server did not become healthy within ${timeoutMs}ms.`);
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until `predicate` holds, polling instead of sleeping a fixed amount. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs = 15000, intervalMs = 100, label = 'condition' } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}.`);
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'string' || address === null) {
        reject(new Error('Could not determine a free port.'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}
