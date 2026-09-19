import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "./rate-limit.js";

describe("FixedWindowRateLimiter", () => {
  it("enforces a fixed-window limit and resets after the window", () => {
    const limiter = new FixedWindowRateLimiter();
    expect(limiter.allow("user", 2, 1000, 0)).toBe(true);
    expect(limiter.allow("user", 2, 1000, 1)).toBe(true);
    expect(limiter.allow("user", 2, 1000, 2)).toBe(false);
    expect(limiter.allow("user", 2, 1000, 1000)).toBe(true);
  });

  it("bounds attacker-controlled key cardinality", () => {
    const limiter = new FixedWindowRateLimiter(16);
    for (let i = 0; i < 100; i += 1) {
      expect(limiter.allow(`ip-${i}`, 1, 60_000, 0)).toBe(true);
    }
    expect(limiter.size).toBeLessThanOrEqual(16);
  });
});
