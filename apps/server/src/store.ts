import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export type DeviceRecord = {
  id: string;
  userSub: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastSeen: string | null;
};

export class Store {
  readonly db: DatabaseSync;

  constructor(path = config.DATABASE_PATH) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_sub TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_seen TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_devices_user_sub ON devices(user_sub);
      CREATE TABLE IF NOT EXISTS pairing_codes (
        code_hash TEXT PRIMARY KEY,
        user_sub TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_pairing_user_sub ON pairing_codes(user_sub);
    `);
  }

  createPairingCode(userSub: string): { code: string; expiresAt: string } {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const chars = Array.from(randomBytes(8), (b) => alphabet[b % alphabet.length]!);
    const code = `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
    const expires = Date.now() + 10 * 60_000;
    this.db.prepare(
      "INSERT INTO pairing_codes(code_hash,user_sub,expires_at,consumed_at) VALUES(?,?,?,NULL)"
    ).run(hash(code), userSub, expires);
    return { code, expiresAt: new Date(expires).toISOString() };
  }

  consumePairingCode(code: string): string | null {
    const now = Date.now();
    const row = this.db.prepare(
      "SELECT user_sub,expires_at,consumed_at FROM pairing_codes WHERE code_hash=?"
    ).get(hash(code)) as { user_sub: string; expires_at: number; consumed_at: number | null } | undefined;
    if (!row || row.consumed_at !== null || row.expires_at < now) return null;
    this.db.prepare("UPDATE pairing_codes SET consumed_at=? WHERE code_hash=?").run(now, hash(code));
    return row.user_sub;
  }

  createDevice(userSub: string, name: string): { id: string; token: string } {
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    this.db.prepare(
      "INSERT INTO devices(id,user_sub,name,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,NULL)"
    ).run(id, userSub, name, hash(token), now);
    return { id, token };
  }

  findDeviceByToken(token: string): DeviceRecord | null {
    const row = this.db.prepare(
      "SELECT id,user_sub,name,token_hash,created_at,last_seen FROM devices WHERE token_hash=?"
    ).get(hash(token)) as Record<string, unknown> | undefined;
    return row ? mapDevice(row) : null;
  }

  listDevices(userSub: string): DeviceRecord[] {
    const rows = this.db.prepare(
      "SELECT id,user_sub,name,token_hash,created_at,last_seen FROM devices WHERE user_sub=? ORDER BY created_at"
    ).all(userSub) as Record<string, unknown>[];
    return rows.map(mapDevice);
  }

  getDeviceForUser(userSub: string, id: string): DeviceRecord | null {
    const row = this.db.prepare(
      "SELECT id,user_sub,name,token_hash,created_at,last_seen FROM devices WHERE user_sub=? AND id=?"
    ).get(userSub, id) as Record<string, unknown> | undefined;
    return row ? mapDevice(row) : null;
  }

  touchDevice(id: string): void {
    this.db.prepare("UPDATE devices SET last_seen=? WHERE id=?").run(new Date().toISOString(), id);
  }
}

function mapDevice(row: Record<string, unknown>): DeviceRecord {
  return {
    id: String(row.id),
    userSub: String(row.user_sub),
    name: String(row.name),
    tokenHash: String(row.token_hash),
    createdAt: String(row.created_at),
    lastSeen: row.last_seen === null ? null : String(row.last_seen)
  };
}
