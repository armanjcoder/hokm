import cors from 'cors';
import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { corsOriginHandler, errorHandler } from './middleware.js';
import { roomsRouter } from './rooms.routes.js';

/** Builds the Express app: middleware, routes, static Mini App, error handling. */
export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: corsOriginHandler, credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  app.set('trust proxy', true);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'hokm-api', now: new Date().toISOString() });
  });

  app.use(roomsRouter);

  if (config.shouldServeWebDist) mountWebDist(app);

  // Must be registered last so it can catch everything above.
  app.use(errorHandler);
  return app;
}

/** Serves the built Mini App from the same origin, which keeps CORS simple. */
function mountWebDist(app: Express): void {
  if (!existsSync(config.webDistPath)) {
    console.warn(
      `SERVE_WEB_DIST=true but web dist was not found at ${config.webDistPath}. Run npm run build first.`,
    );
    return;
  }

  app.use((_req, res, next) => {
    // The tunnel URL changes between sessions, so never let a stale bundle stick.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });
  app.use(express.static(config.webDistPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(config.webDistPath, 'index.html'));
  });
}
