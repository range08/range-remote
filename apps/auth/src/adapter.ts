import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Adapter, AdapterPayload } from "oidc-provider";
import { config } from "./config.js";

mkdirSync(dirname(config.databasePath), { recursive: true });

const db = new DatabaseSync(config.databasePath);
chmodSync(config.databasePath, 0o600);
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS oidc (
    model TEXT NOT NULL,
    id TEXT NOT NULL,
    payload TEXT NOT NULL,
    expires_at INTEGER,
    grant_id TEXT,
    user_code TEXT,
    uid TEXT,
    PRIMARY KEY(model, id)
  );
  CREATE INDEX IF NOT EXISTS oidc_grant_idx ON oidc(grant_id);
  CREATE INDEX IF NOT EXISTS oidc_user_code_idx ON oidc(model, user_code);
  CREATE INDEX IF NOT EXISTS oidc_uid_idx ON oidc(model, uid);
`);

export class SqliteAdapter implements Adapter {
  constructor(private readonly model: string) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
    const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;
    db.prepare(`
      INSERT INTO oidc(model,id,payload,expires_at,grant_id,user_code,uid)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(model,id) DO UPDATE SET
        payload=excluded.payload,
        expires_at=excluded.expires_at,
        grant_id=excluded.grant_id,
        user_code=excluded.user_code,
        uid=excluded.uid
    `).run(
      this.model,
      id,
      JSON.stringify(payload),
      expiresAt,
      payload.grantId ?? null,
      payload.userCode ?? null,
      payload.uid ?? null
    );
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    return this.findOne("id", id);
  }
  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    return this.findOne("user_code", userCode);
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    return this.findOne("uid", uid);
  }

  async consume(id: string): Promise<void> {
    const row = db.prepare(
      "SELECT payload FROM oidc WHERE model=? AND id=?"
    ).get(this.model, id) as { payload: string } | undefined;
    if (!row) return;

    const payload = JSON.parse(row.payload) as AdapterPayload;
    payload.consumed = Math.floor(Date.now() / 1000);
    db.prepare(
      "UPDATE oidc SET payload=? WHERE model=? AND id=?"
    ).run(JSON.stringify(payload), this.model, id);
  }

  async destroy(id: string): Promise<void> {
    db.prepare("DELETE FROM oidc WHERE model=? AND id=?").run(this.model, id);
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    db.prepare("DELETE FROM oidc WHERE grant_id=?").run(grantId);
  }

  private async findOne(column: "id" | "user_code" | "uid", value: string) {
    const row = db.prepare(
      `SELECT id,payload,expires_at FROM oidc WHERE model=? AND ${column}=?`
    ).get(this.model, value) as {
      id: string;
      payload: string;
      expires_at: number | null;
    } | undefined;

    if (!row) return undefined;
    if (row.expires_at !== null && row.expires_at <= Date.now()) {
      db.prepare("DELETE FROM oidc WHERE model=? AND id=?").run(this.model, row.id);
      return undefined;
    }
    const payload = JSON.parse(row.payload) as AdapterPayload;
    return this.model === "Client" ? ensureRefreshGrant(payload) : payload;
  }
}

function ensureRefreshGrant(payload: AdapterPayload): AdapterPayload {
  const client = payload as AdapterPayload & { grant_types?: unknown };
  const grants = Array.isArray(client.grant_types)
    ? client.grant_types.filter((grant): grant is string => typeof grant === "string")
    : ["authorization_code"];

  if (!grants.includes("authorization_code") || grants.includes("refresh_token")) {
    return payload;
  }

  return {
    ...payload,
    grant_types: [...grants, "refresh_token"]
  };
}
