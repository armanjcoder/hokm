import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:https';
import { Agent } from 'node:https';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clearAvatarCache, fetchAvatar, MAX_AVATAR_BYTES } from '../src/telegram/avatar-proxy.js';
import { isAllowedPhotoUrl } from '../src/telegram-auth.js';

/**
 * Real-network tests for the avatar proxy.
 *
 * These deliberately start an actual TLS server and speak real HTTPS to it
 * rather than stubbing `https.request`. The whole point of this module is what
 * happens on the wire — oversized bodies, wrong content types, timeouts,
 * connection failures — and a mock would only prove that the mock was called.
 *
 * The server presents a self-signed certificate for `cdn.telesco.pe`, and the
 * agent under test is pointed at it, which is exactly the shape of the real
 * deployment: a proxy agent that resolves Telegram's host somewhere else.
 */

let server: Server;
let port: number;
let ca: Buffer;
let mode: 'ok' | 'notfound' | 'huge' | 'html' | 'hang' | 'slow' | 'svg' | 'jpegcharset' = 'ok';
/** Counts real requests, so "never touched the network" can be asserted. */
let hits = 0;

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hokm-cert-'));
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', keyPath, '-out', certPath,
    '-days', '2', '-nodes',
    '-subj', '/CN=cdn.telesco.pe',
    '-addext', 'subjectAltName=DNS:cdn.telesco.pe',
  ], { stdio: 'ignore' });

  ca = readFileSync(certPath);
  server = createServer({ key: readFileSync(keyPath), cert: ca }, (_req, res) => {
    hits += 1;
    if (mode === 'notfound') {
      res.writeHead(404).end('nope');
      return;
    }
    if (mode === 'hang') {
      // Headers sent, body never finished: exercises the socket timeout.
      res.writeHead(200, { 'content-type': 'image/png' });
      return;
    }
    if (mode === 'slow') {
      res.writeHead(200, { 'content-type': 'image/png' });
      setTimeout(() => res.end('PNGDATA'), 120);
      return;
    }
    if (mode === 'svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml' }).end('<svg onload="alert(1)"/>');
      return;
    }
    if (mode === 'jpegcharset') {
      res.writeHead(200, { 'content-type': 'IMAGE/JPEG; charset=binary' }).end('JPEGDATA');
      return;
    }
    if (mode === 'html') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<h1>hi</h1>');
      return;
    }
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(mode === 'huge' ? Buffer.alloc(MAX_AVATAR_BYTES + 1024) : Buffer.from('PNGDATA'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterEach(() => {
  clearAvatarCache();
  mode = 'ok';
  hits = 0;
});

/** Agent that sends every request to the local TLS server. */
function testAgent(): any {
  const agent = new Agent({ ca, servername: 'cdn.telesco.pe' });
  const original = agent.createConnection.bind(agent);
  (agent as any).createConnection = (options: any, cb: any) =>
    original({ ...options, host: '127.0.0.1', port, servername: 'cdn.telesco.pe' }, cb);
  return agent;
}

const URL_OK = 'https://cdn.telesco.pe/file/avatar.jpg';

describe('fetchAvatar over a real connection', () => {
  it('downloads an image and reports its content type', async () => {
    const image = await fetchAvatar(URL_OK, testAgent());
    expect(image?.contentType).toBe('image/png');
    expect(image?.body.toString()).toBe('PNGDATA');
  });

  it('returns undefined for a 404', async () => {
    mode = 'notfound';
    expect(await fetchAvatar(URL_OK, testAgent())).toBeUndefined();
  });

  it('refuses a non-image response even with status 200', async () => {
    mode = 'html';
    expect(await fetchAvatar(URL_OK, testAgent())).toBeUndefined();
  });

  it('refuses an SVG, which would be scriptable XSS on our own origin', async () => {
    // The image is re-served same-origin as the Mini App, so an SVG that the
    // CDN happily labelled `image/*` would run script inside the game.
    mode = 'svg';
    expect(await fetchAvatar(URL_OK, testAgent())).toBeUndefined();
  });

  it('normalises the content type instead of echoing the CDN header back', async () => {
    mode = 'jpegcharset';
    const image = await fetchAvatar(URL_OK, testAgent());
    expect(image?.contentType).toBe('image/jpeg');
  });

  it('aborts a body larger than the avatar limit', async () => {
    mode = 'huge';
    expect(await fetchAvatar(URL_OK, testAgent())).toBeUndefined();
  });

  it('returns undefined when the connection cannot be made', async () => {
    // No agent: the real cdn.telesco.pe is unreachable from the sandbox, and an
    // unreachable host must never reject, only resolve undefined.
    expect(await fetchAvatar('https://cdn.telesco.pe/nothing.jpg', undefined)).toBeUndefined();
  }, 20000);
});

describe('host allow-list', () => {
  const rejected = [
    'http://cdn.telesco.pe/a.jpg',
    'https://evil.example.com/a.jpg',
    'https://cdn.telesco.pe.evil.com/a.jpg',
    'https://127.0.0.1/a.jpg',
    'https://localhost:4000/health',
    'https://user:pass@cdn.telesco.pe/a.jpg',
    'not a url',
  ];

  for (const url of rejected) {
    it(`refuses ${url} without opening a connection`, async () => {
      // The agent forces every connection onto the local test server, which
      // counts its hits. So this asserts the real property — no request was
      // ever made — instead of merely that the result was undefined, which a
      // failed DNS lookup would also produce.
      expect(await fetchAvatar(url, testAgent())).toBeUndefined();
      expect(hits).toBe(0);
    });

    it(`classifies ${url} as disallowed`, () => {
      expect(isAllowedPhotoUrl(url)).toBe(false);
    });
  }

  it('proves the hit counter can actually go up', () => {
    // Guards the assertion above: if the server never counted anything, every
    // "no connection" test would pass vacuously.
    expect(hits).toBe(0);
    return fetchAvatar(URL_OK, testAgent()).then(() => expect(hits).toBe(1));
  });

  it('accepts the Telegram hosts we expect', () => {
    expect(isAllowedPhotoUrl('https://t.me/i/userpic/320/x.jpg')).toBe(true);
    expect(isAllowedPhotoUrl('https://cdn4.cdn-telegram.org/file/x.jpg')).toBe(true);
    expect(isAllowedPhotoUrl('https://api.telegram.org/file/x.jpg')).toBe(true);
    expect(isAllowedPhotoUrl('https://cdn.telesco.pe/file/x.jpg')).toBe(true);
  });
});

describe('caching', () => {
  it('serves a second request without touching the network', async () => {
    const first = await fetchAvatar(URL_OK, testAgent());
    expect(first).toBeDefined();

    // Server now answers 404; a cached hit must still return the old image.
    mode = 'notfound';
    const second = await fetchAvatar(URL_OK, testAgent());
    expect(second?.body.toString()).toBe('PNGDATA');
  });

  it('expires an entry once its TTL passes', async () => {
    const t0 = Date.now();
    expect(await fetchAvatar(URL_OK, testAgent(), { now: t0 })).toBeDefined();

    mode = 'notfound';
    const later = t0 + 60 * 60 * 1000 + 1;
    expect(await fetchAvatar(URL_OK, testAgent(), { now: later })).toBeUndefined();
  });

  it('does not cache a failure', async () => {
    mode = 'notfound';
    expect(await fetchAvatar(URL_OK, testAgent())).toBeUndefined();
    mode = 'ok';
    expect(await fetchAvatar(URL_OK, testAgent())).toBeDefined();
  });
});

describe('timeout and failure handling', () => {
  it('gives up on a stalled response instead of holding the request open', async () => {
    mode = 'hang';
    const started = Date.now();
    const image = await fetchAvatar(URL_OK, testAgent(), { timeoutMs: 300 });
    expect(image).toBeUndefined();
    // Measured, not assumed: it must return near the timeout, not hang forever.
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(Date.now() - started).toBeLessThan(3000);
  }, 10000);

  it('resolves undefined when the connection is refused', async () => {
    // A closed port is the fastest honest stand-in for a blocked CDN.
    const dead = new Agent({ ca });
    const original = dead.createConnection.bind(dead);
    (dead as any).createConnection = (options: any, cb: any) =>
      original({ ...options, host: '127.0.0.1', port: 1, servername: 'cdn.telesco.pe' }, cb);
    expect(await fetchAvatar(URL_OK, dead as any)).toBeUndefined();
  });

  it('does not cache a timeout, so a recovered CDN works immediately', async () => {
    mode = 'hang';
    expect(await fetchAvatar(URL_OK, testAgent(), { timeoutMs: 200 })).toBeUndefined();
    mode = 'ok';
    expect(await fetchAvatar(URL_OK, testAgent())).toBeDefined();
  }, 10000);
});

describe('request coalescing', () => {
  it('collapses four simultaneous requests for one avatar into a single download', async () => {
    mode = 'slow';
    const results = await Promise.all([
      fetchAvatar(URL_OK, testAgent()),
      fetchAvatar(URL_OK, testAgent()),
      fetchAvatar(URL_OK, testAgent()),
      fetchAvatar(URL_OK, testAgent()),
    ]);
    expect(results.every((image) => image?.body.toString() === 'PNGDATA')).toBe(true);
    // A full table of four seats must cost the censored network one request.
    expect(hits).toBe(1);
  }, 10000);

  it('still fetches separately for different avatars', async () => {
    mode = 'slow';
    await Promise.all([
      fetchAvatar('https://cdn.telesco.pe/a.jpg', testAgent()),
      fetchAvatar('https://cdn.telesco.pe/b.jpg', testAgent()),
    ]);
    expect(hits).toBe(2);
  }, 10000);

  it('clears the in-flight entry so a later request is not stuck on a dead promise', async () => {
    mode = 'notfound';
    expect(await fetchAvatar(URL_OK, testAgent())).toBeUndefined();
    mode = 'ok';
    expect(await fetchAvatar(URL_OK, testAgent())).toBeDefined();
    expect(hits).toBe(2);
  });
});

describe('cache bounds', () => {
  it('evicts the oldest entries instead of growing without limit', async () => {
    // 301 distinct avatars, one over the cap. The first must have been dropped.
    for (let i = 0; i < 301; i += 1) {
      await fetchAvatar(`https://cdn.telesco.pe/a${i}.jpg`, testAgent());
    }
    const before = hits;
    // A cached URL costs nothing...
    await fetchAvatar('https://cdn.telesco.pe/a300.jpg', testAgent());
    expect(hits).toBe(before);
    // ...while the evicted one has to be fetched again.
    await fetchAvatar('https://cdn.telesco.pe/a0.jpg', testAgent());
    expect(hits).toBe(before + 1);
  }, 30000);
});

describe('cleanup', () => {
  it('closes the test server', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(true).toBe(true);
  });
});
