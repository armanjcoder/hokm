/**
 * Small in-memory rate limiter.
 *
 * The backend is exposed through a public HTTPS tunnel to a laptop, so an
 * unthrottled write endpoint can fill the disk with rooms in seconds. A real
 * deployment would use Redis; for a single process a sliding window is enough
 * and keeps the dependency list empty.
 */

export interface RateLimitRule {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum number of allowed hits inside the window. */
  max: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  /** Seconds until the caller may retry; only meaningful when blocked. */
  retryAfterSeconds: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(private readonly rule: RateLimitRule) {}

  check(key: string, now = Date.now()): RateLimitVerdict {
    this.sweep(now);

    const windowStart = now - this.rule.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((time) => time > windowStart);

    if (recent.length >= this.rule.max) {
      const oldest = recent[0] ?? now;
      const retryAfterMs = Math.max(0, oldest + this.rule.windowMs - now);
      this.hits.set(key, recent);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, remaining: this.rule.max - recent.length, retryAfterSeconds: 0 };
  }

  reset(key?: string): void {
    if (key === undefined) this.hits.clear();
    else this.hits.delete(key);
  }

  /** Drops empty/expired buckets so the map cannot grow without bound. */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.rule.windowMs) return;
    this.lastSweep = now;
    const windowStart = now - this.rule.windowMs;
    for (const [key, times] of this.hits) {
      const recent = times.filter((time) => time > windowStart);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }
}
