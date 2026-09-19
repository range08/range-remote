import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dbPath = join(tmpdir(), `range-remote-auth-${process.pid}.sqlite`);
const jwksPath = join(tmpdir(), `range-remote-auth-${process.pid}.jwks.json`);

let registerUser: typeof import("./users.js").registerUser;
let verifyUser: typeof import("./users.js").verifyUser;
let findUser: typeof import("./users.js").findUser;
let SqliteAdapter: typeof import("./adapter.js").SqliteAdapter;
let loadOrCreateJwks: typeof import("./keys.js").loadOrCreateJwks;

beforeAll(async () => {
  process.env.AUTH_ISSUER = "https://auth.example.com";
  process.env.MCP_RESOURCE = "https://remote.example.com";
  process.env.AUTH_DATABASE_PATH = dbPath;
  process.env.AUTH_JWKS_PATH = jwksPath;
  process.env.AUTH_COOKIE_KEYS = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  ({ registerUser, verifyUser, findUser } = await import("./users.js"));
  ({ SqliteAdapter } = await import("./adapter.js"));
  ({ loadOrCreateJwks } = await import("./keys.js"));
});

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    const path = dbPath + suffix;
    if (existsSync(path)) rmSync(path, { force: true });
  }
  if (existsSync(jwksPath)) rmSync(jwksPath, { force: true });
});

describe("authorization persistence", () => {
  it("registers and verifies users without storing plaintext passwords", () => {
    const user = registerUser("reviewer", "reviewer@example.com", "correct-horse-battery");
    expect(verifyUser("reviewer", "wrong-password-value")).toBeNull();
    expect(verifyUser("reviewer@example.com", "correct-horse-battery")?.id).toBe(user.id);
    expect(findUser(user.id)?.emailVerified).toBe(false);
  });

  it("does not expose SQLite details for duplicate registration", () => {
    expect(() => registerUser("reviewer", "other@example.com", "correct-horse-battery"))
      .toThrow("Username or email is already registered");
  });

  it("accepts 8-character passwords and rejects shorter passwords", () => {
    const user = registerUser("eightchars", "eight@example.com", "12345678");
    expect(verifyUser("eightchars", "12345678")?.id).toBe(user.id);
    expect(() => registerUser("too-short", "short@example.com", "1234567"))
      .toThrow("Password must be between 8 and 256 characters");
  });

  it("creates a persistent private JWKS with restrictive permissions", () => {
    const first = loadOrCreateJwks();
    const second = loadOrCreateJwks();
    expect(first.keys[0]?.kid).toBe(second.keys[0]?.kid);
    const key = first.keys[0];
    if (!key || !("d" in key)) throw new Error("Expected a private JWK");
    expect(key.d).toBeTruthy();
    expect(statSync(jwksPath).mode & 0o777).toBe(0o600);
  });

  it("persists and consumes OIDC adapter payloads", async () => {
    const adapter = new SqliteAdapter("AuthorizationCode");
    await adapter.upsert("code-1", { grantId: "grant-1", uid: "uid-1", foo: "bar" }, 60);

    expect((await adapter.find("code-1"))?.foo).toBe("bar");
    expect((await adapter.findByUid("uid-1"))?.grantId).toBe("grant-1");

    await adapter.consume("code-1");
    expect(typeof (await adapter.find("code-1"))?.consumed).toBe("number");

    await adapter.revokeByGrantId("grant-1");
    expect(await adapter.find("code-1")).toBeUndefined();
  });
});
