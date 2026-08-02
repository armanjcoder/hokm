import { request as httpsRequest } from 'node:https';
import type { Agent } from 'node:http';
import { isAllowedPhotoUrl } from '../telegram-auth.js';

/**
 * Server-side fetcher for Telegram profile photos.
 *
 * Telegram's photo CDN is filtered on the same networks that block the Bot API,
 * so a browser inside Iran cannot load `photo_url` directly — it would just show
 * a broken avatar. The API already holds a Telegram-only proxy for the Bot API,
 * and reusing it here means the phone only ever talks to our own origin.
 *
 * Two other properties come for free: the raw CDN URL never reaches clients
 * (nothing to scrape or hotlink), and every fetch is host-restricted, so this
 * endpoint can never be turned into a general-purpose SSRF gadget.
 */

/** Photos are small; anything larger is not a Telegram avatar. */
export const MAX_AVATAR_BYTES = 512 * 1024;

/**
 * Content types we are willing to re-serve from our own origin.
 *
 * Raster formats only, and `image/svg+xml` is deliberately absent: an SVG can
 * contain script, and we serve it back same-origin as the Mini App, so
 * accepting one would turn a profile photo into stored XSS against the game.
 * Telegram only ever serves JPEG here, so nothing real is lost.
 */
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);

/** Normalises `image/jpeg; charset=binary` down to the bare media type. */
function mediaType(header: string): string {
  return header.split(';')[0]!.trim().toLowerCase();
}
const REQUEST_TIMEOUT_MS = 8000;
/** Telegram photo URLs are stable for a long time; an hour is conservative. */
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

export interface AvatarImage {
  body: Buffer;
  contentType: string;
}

interface CacheEntry {
  image: AvatarImage;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Downloads currently in flight, keyed by URL.
 *
 * Four seats around a table request four avatars the moment a room view lands,
 * and every connected client does the same. Without this, one popular avatar
 * becomes N simultaneous downloads over a proxy that is slow precisely because
 * the network is censored. Sharing the promise makes it exactly one.
 */
const inFlight = new Map<string, Promise<AvatarImage | undefined>>();

/** Clears the memo cache. Exists so tests never leak state into each other. */
export function clearAvatarCache(): void {
  cache.clear();
  inFlight.clear();
}

function readCache(url: string, now: number): AvatarImage | undefined {
  const entry = cache.get(url);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    cache.delete(url);
    return undefined;
  }
  // Refresh insertion order so the LRU eviction below keeps hot avatars.
  cache.delete(url);
  cache.set(url, entry);
  return entry.image;
}

function writeCache(url: string, image: AvatarImage, now: number): void {
  cache.set(url, { image, expiresAt: now + CACHE_TTL_MS });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Downloads one avatar, through the Telegram proxy when one is configured.
 *
 * Returns `undefined` for every failure mode — blocked network, 404, oversized
 * body, non-image content. A missing avatar is a normal outcome, not an error:
 * the Mini App simply keeps the initials bubble.
 */
export async function fetchAvatar(
  photoUrl: string,
  agent: Agent | undefined,
  options: { now?: number; timeoutMs?: number } = {},
): Promise<AvatarImage | undefined> {
  if (!isAllowedPhotoUrl(photoUrl)) return undefined;

  const now = options.now ?? Date.now();
  const cached = readCache(photoUrl, now);
  if (cached) return cached;

  const running = inFlight.get(photoUrl);
  if (running) return running;

  const pending = download(photoUrl, agent, options.timeoutMs ?? REQUEST_TIMEOUT_MS)
    .then((image) => {
      if (image) writeCache(photoUrl, image, now);
      return image;
    })
    .finally(() => inFlight.delete(photoUrl));

  inFlight.set(photoUrl, pending);
  return pending;
}

function download(
  photoUrl: string,
  agent: Agent | undefined,
  timeoutMs: number,
): Promise<AvatarImage | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: AvatarImage | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let req: ReturnType<typeof httpsRequest>;
    try {
      req = httpsRequest(
        photoUrl,
        { method: 'GET', ...(agent ? { agent } : {}), timeout: timeoutMs },
        (res) => {
          const status = res.statusCode ?? 0;
          const contentType = String(res.headers['content-type'] ?? '');
          // Redirects are not followed on purpose: the destination would escape
          // the host allow-list that makes this endpoint safe.
          if (status !== 200 || !ALLOWED_CONTENT_TYPES.has(mediaType(contentType))) {
            res.resume();
            finish(undefined);
            return;
          }

          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_AVATAR_BYTES) {
              res.destroy();
              finish(undefined);
              return;
            }
            chunks.push(chunk);
          });
          // Store the normalised type: what we echo back must be exactly one of
          // the values we vetted, not whatever string the CDN sent.
          res.on('end', () => finish({ body: Buffer.concat(chunks), contentType: mediaType(contentType) }));
          res.on('error', () => finish(undefined));
        },
      );
    } catch {
      finish(undefined);
      return;
    }

    req.on('timeout', () => {
      req.destroy();
      finish(undefined);
    });
    req.on('error', () => finish(undefined));
    req.end();
  });
}
