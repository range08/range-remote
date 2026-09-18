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
});
