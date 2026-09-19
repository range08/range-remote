import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.PUBLIC_BASE_URL ??= "https://remote.example.com";
process.env.AUTH_ISSUER ??= "https://example.auth0.com/";
process.env.AUTH_AUDIENCE ??= "https://remote.example.com";
process.env.AUTH_JWKS_URL ??= "https://example.auth0.com/.well-known/jwks.json";
process.env.MAX_DEVICES_PER_USER ??= "2";

const { Store } = await import("./store.js");

describe("Store", () => {
  it("consumes a pairing code exactly once", () => {
    const dir = mkdtempSync(join(tmpdir(), "range-remote-"));
    const store = new Store(join(dir, "db.sqlite"));
    const pair = store.createPairingCode("user-1");
    expect(store.consumePairingCode(pair.code)).toBe("user-1");
    expect(store.consumePairingCode(pair.code)).toBeNull();
  });

  it("stores only a hash of the device token", () => {
    const dir = mkdtempSync(join(tmpdir(), "range-remote-"));
    const store = new Store(join(dir, "db.sqlite"));
    const created = store.createDevice("user-1", "demo");
    const found = store.findDeviceByToken(created.token);
    expect(found?.id).toBe(created.id);
    expect(found?.tokenHash).not.toContain(created.token);
  });
  it("removes only a device owned by the authenticated user", () => {
    const dir = mkdtempSync(join(tmpdir(), "range-remote-"));
    const store = new Store(join(dir, "db.sqlite"));
    const own = store.createDevice("user-1", "own");
    const other = store.createDevice("user-2", "other");

    expect(store.deleteDeviceForUser("user-1", own.id)).toBe(true);
    expect(store.getDeviceForUser("user-1", own.id)).toBeNull();
    expect(store.getDeviceForUser("user-2", other.id)?.id).toBe(other.id);
  });

  it("removes all devices and pairing codes for one user", () => {
    const dir = mkdtempSync(join(tmpdir(), "range-remote-"));
    const store = new Store(join(dir, "db.sqlite"));
    store.createDevice("user-1", "a");
    store.createDevice("user-1", "b");
    const pair = store.createPairingCode("user-1");

    expect(store.removeAllForUser("user-1")).toBe(2);
    expect(store.listDevices("user-1")).toHaveLength(0);
    expect(store.consumePairingCode(pair.code)).toBeNull();
  });

  it("keeps only the newest unconsumed pairing code for a user", () => {
    const dir = mkdtempSync(join(tmpdir(), "range-remote-"));
    const store = new Store(join(dir, "db.sqlite"));
    const first = store.createPairingCode("user-1");
    const second = store.createPairingCode("user-1");
    expect(store.consumePairingCode(first.code)).toBeNull();
    expect(store.consumePairingCode(second.code)).toBe("user-1");
  });

  it("caps persistent devices per account", () => {
    const dir = mkdtempSync(join(tmpdir(), "range-remote-"));
    const store = new Store(join(dir, "db.sqlite"));
    store.createDevice("user-1", "one");
    store.createDevice("user-1", "two");
    expect(() => store.createDevice("user-1", "three")).toThrow(/Device limit/);
    expect(() => store.createDevice("user-2", "other")).not.toThrow();
  });

});

describe("usage analytics", () => {
  it("aggregates monthly, daily, tool, latency, and recent usage without payloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "range-remote-usage-"));
    const store = new Store(join(dir, "db.sqlite"));
    const device = store.createDevice("user-1", "workstation");
    const now = Date.parse("2026-09-19T12:00:00.000Z");

    store.recordToolUsage({
      userSub: "user-1",
      clientId: "chatgpt",
      toolName: "read_file",
      deviceId: device.id,
      occurredAt: Date.parse("2026-09-19T10:00:00.000Z"),
      durationMs: 100,
      success: true
    });
    store.recordToolUsage({
      userSub: "user-1",
      clientId: "chatgpt",
      toolName: "read_file",
      deviceId: device.id,
      occurredAt: Date.parse("2026-09-18T10:00:00.000Z"),
      durationMs: 300,
      success: false
    });
    store.recordToolUsage({
      userSub: "user-1",
      clientId: "chatgpt",
      toolName: "git_status",
      deviceId: device.id,
      occurredAt: Date.parse("2026-09-18T11:00:00.000Z"),
      durationMs: 200,
      success: true
    });
    store.recordToolUsage({
      userSub: "user-1",
      toolName: "old_call",
      occurredAt: Date.parse("2026-08-01T00:00:00.000Z"),
      durationMs: 50,
      success: true
    });
    store.recordToolUsage({
      userSub: "user-2",
      toolName: "not-visible",
      occurredAt: now,
      durationMs: 1,
      success: true
    });

    const stats = store.getUsageStats("user-1", now);
    expect(stats.thisMonth).toEqual({
      calls: 3,
      successes: 2,
      failures: 1,
      successRate: 2 / 3,
      avgDurationMs: 200
    });
    expect(stats.todayCalls).toBe(1);
    expect(stats.totalCalls).toBe(4);
    expect(stats.activeDays).toBe(3);
    expect(stats.topTools[0]).toMatchObject({
      name: "read_file",
      calls: 2,
      successRate: 0.5,
      avgDurationMs: 200
    });
    expect(stats.recent[0]).toMatchObject({
      toolName: "read_file",
      deviceName: "workstation",
      success: true,
      durationMs: 100
    });
    expect(stats.daily.at(-1)).toMatchObject({ date: "2026-09-19", calls: 1 });
    expect(JSON.stringify(stats)).not.toContain("not-visible");
  });
});
