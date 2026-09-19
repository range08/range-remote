import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.PUBLIC_BASE_URL ??= "https://remote.example.com";
process.env.AUTH_ISSUER ??= "https://example.auth0.com/";
process.env.AUTH_AUDIENCE ??= "https://remote.example.com";
process.env.AUTH_JWKS_URL ??= "https://example.auth0.com/.well-known/jwks.json";

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

});
