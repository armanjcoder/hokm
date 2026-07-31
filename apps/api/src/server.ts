import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { createApp } from './http/app.js';
import { corsOriginHandler } from './http/middleware.js';
import { scheduleRoomCleanup } from './jobs/cleanup.js';
import { registerSocketServer } from './realtime/broadcast.js';
import { registerSocketHandlers } from './realtime/handlers.js';
import { loadedRoomCount, roomStore } from './state.js';
import { startTelegramBot } from './telegram/bot.js';

/** Composition root: wires the modules together and starts listening. */

console.log(
  `Hokm config: web=${config.webAppUrl} api=${config.publicApiUrl} db=${config.dbPath} loadedRooms=${loadedRoomCount}`,
);
console.log(
  config.telegramAuthEnabled
    ? 'Telegram auth: ENABLED (initData signatures are verified).'
    : 'Telegram auth: DISABLED (guest mode). Set TELEGRAM_BOT_TOKEN to verify real Telegram users.',
);

const httpServer = createServer(createApp());
const io = new Server(httpServer, { cors: { origin: corsOriginHandler, credentials: true } });

registerSocketServer(io);
registerSocketHandlers(io);

httpServer.listen(config.port, () => {
  console.log(`Hokm API listening on http://localhost:${config.port}`);
});

scheduleRoomCleanup();

// The bot is optional infrastructure: if Telegram is unreachable the game API
// must keep serving, so failures here are logged instead of crashing the process.
void startTelegramBot().catch((error) => {
  console.error('Telegram bot could not start; the API keeps running without it.', error);
});

installShutdownHandlers();

/**
 * sql.js re-serialises the whole database on every save, so the process must
 * not be killed mid-write. Close cleanly on the usual termination signals.
 */
function installShutdownHandlers(): void {
  let shuttingDown = false;

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`Received ${signal}; shutting down cleanly...`);

      const finish = () => {
        try {
          roomStore.close();
        } catch (error) {
          console.error('Failed to close the database cleanly.', error);
        }
        process.exit(0);
      };

      // Never hang forever if a socket refuses to close.
      const forceTimer = setTimeout(finish, 5000);
      forceTimer.unref();

      io.close(() => {
        httpServer.close(() => {
          clearTimeout(forceTimer);
          finish();
        });
      });
    });
  }
}
