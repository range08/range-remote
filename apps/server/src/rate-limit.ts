import type { RequestHandler } from "express";

type WindowEntry = {
  count: number;
  resetAt: number;
};

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, WindowEntry>();

  allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const current = this.entries.get(key);

    if (!current || current.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + windowMs });
      this.prune(now);
      return true;
    }

    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }

  private prune(now: number): void {
    if (this.entries.size < 1024) return;
    for (const [key, value] of this.entries) {
      if (value.resetAt <= now) this.entries.delete(key);
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
