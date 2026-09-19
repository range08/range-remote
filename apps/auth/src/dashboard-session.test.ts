import { describe, expect, it } from "vitest";
import {
  createDashboardSession,
  readDashboardSession
} from "./dashboard-session.js";

describe("dashboard session", () => {
  it("round-trips a signed session and rejects tampering or expiry", () => {
    const key = "a".repeat(32);
    const now = Date.parse("2026-09-19T12:00:00Z");
    const token = createDashboardSession("user-1", key, now, 60_000);

    expect(readDashboardSession(token, [key], now + 30_000)).toEqual({
      userSub: "user-1"
    });
    expect(readDashboardSession(token + "x", [key], now + 30_000)).toBeNull();
    expect(readDashboardSession(token, [key], now + 60_001)).toBeNull();
  });

  it("accepts a rotated verification key", () => {
    const oldKey = "b".repeat(32);
    const newKey = "c".repeat(32);
    const token = createDashboardSession("user-2", oldKey, 1_000, 10_000);
    expect(readDashboardSession(token, [newKey, oldKey], 2_000)).toEqual({
      userSub: "user-2"
    });
  });
});
