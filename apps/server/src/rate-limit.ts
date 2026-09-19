import type { RequestHandler } from "express";

type WindowEntry = {
  count: number;
  resetAt: number;
};

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, WindowEntry>();

  constructor(private readonly maxEntries = 4096) {
    if (!Number.isInteger(maxEntries) || maxEntries < 16) {
      throw new Error("maxEntries must be an integer of at least 16");
    }
  }

  allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const current = this.entries.get(key);

    if (!current || current.resetAt <= now) {
      if (!current) this.makeRoom(now);
      this.entries.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }

  get size(): number {
    return this.entries.size;
  }

  private makeRoom(now: number): void {
    if (this.entries.size < this.maxEntries) return;

    for (const [key, value] of this.entries) {
      if (value.resetAt <= now) this.entries.delete(key);
    }

    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export function fixedWindowRateLimit(limit: number, windowMs: number): RequestHandler {
  const limiter = new FixedWindowRateLimiter();

  return (req, res, next) => {
    const key = req.header("cf-connecting-ip") ?? req.ip ?? "unknown";
    if (limiter.allow(key, limit, windowMs)) {
      next();
      return;
    }

    res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
    res.status(429).json({ error: "rate_limited" });
  };
}
