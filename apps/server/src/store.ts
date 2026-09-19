import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
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
    chmodSync(path, 0o600);
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
      CREATE TABLE IF NOT EXISTS tool_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_sub TEXT NOT NULL,
        client_id TEXT,
        tool_name TEXT NOT NULL,
        device_id TEXT,
        occurred_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        success INTEGER NOT NULL CHECK(success IN (0,1))
      );
      CREATE INDEX IF NOT EXISTS idx_tool_usage_user_time
        ON tool_usage(user_sub, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_tool_usage_user_tool_time
        ON tool_usage(user_sub, tool_name, occurred_at);
    `);
  }

  createPairingCode(userSub: string): { code: string; expiresAt: string } {
    const now = Date.now();
    this.db.prepare(
      "DELETE FROM pairing_codes WHERE expires_at < ? OR consumed_at IS NOT NULL OR user_sub = ?"
    ).run(now, userSub);

    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const chars = Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]!);
    const code = `${chars.slice(0, 6).join("")}-${chars.slice(6).join("")}`;
    const expires = now + 10 * 60_000;

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
    const count = this.db.prepare(
      "SELECT COUNT(*) AS count FROM devices WHERE user_sub=?"
    ).get(userSub) as { count: number };
    if (Number(count.count) >= config.MAX_DEVICES_PER_USER) {
      throw new Error("Device limit reached for this account");
    }

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

  deleteDeviceForUser(userSub: string, id: string): boolean {
    const result = this.db.prepare(
      "DELETE FROM devices WHERE user_sub=? AND id=?"
    ).run(userSub, id);

    return Number(result.changes) === 1;
  }

  removeAllForUser(userSub: string): number {
    this.db.prepare("DELETE FROM pairing_codes WHERE user_sub=?").run(userSub);
    const result = this.db.prepare("DELETE FROM devices WHERE user_sub=?").run(userSub);
    return Number(result.changes);
  }

  touchDevice(id: string): void {
    this.db.prepare("UPDATE devices SET last_seen=? WHERE id=?").run(new Date().toISOString(), id);
  }

  recordToolUsage(input: {
    userSub: string;
    clientId?: string;
    toolName: string;
    deviceId?: string;
    occurredAt?: number;
    durationMs: number;
    success: boolean;
  }): void {
    this.db.prepare(`
      INSERT INTO tool_usage(
        user_sub,client_id,tool_name,device_id,occurred_at,duration_ms,success
      ) VALUES(?,?,?,?,?,?,?)
    `).run(
      input.userSub,
      input.clientId ?? null,
      input.toolName,
      input.deviceId ?? null,
      input.occurredAt ?? Date.now(),
      Math.max(0, Math.round(input.durationMs)),
      input.success ? 1 : 0
    );
  }

  getUsageStats(userSub: string, now = Date.now()) {
    const current = new Date(now);
    const monthStart = Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      1
    );
    const todayStart = Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      current.getUTCDate()
    );
    const dailyStart = todayStart - 29 * 24 * 60 * 60_000;

    const month = this.db.prepare(`
      SELECT
        COUNT(*) AS calls,
        COALESCE(SUM(success), 0) AS successes,
        COALESCE(AVG(duration_ms), 0) AS avg_duration_ms
      FROM tool_usage
      WHERE user_sub=? AND occurred_at>=?
    `).get(userSub, monthStart) as Record<string, unknown>;

    const totals = this.db.prepare(`
      SELECT
        COUNT(*) AS calls,
        COUNT(DISTINCT date(occurred_at / 1000, 'unixepoch')) AS active_days,
        MIN(occurred_at) AS tracking_since
      FROM tool_usage
      WHERE user_sub=?
    `).get(userSub) as Record<string, unknown>;

    const today = this.db.prepare(`
      SELECT COUNT(*) AS calls
      FROM tool_usage
      WHERE user_sub=? AND occurred_at>=?
    `).get(userSub, todayStart) as Record<string, unknown>;

    const topTools = this.db.prepare(`
      SELECT
        tool_name,
        COUNT(*) AS calls,
        COALESCE(SUM(success), 0) AS successes,
        COALESCE(AVG(duration_ms), 0) AS avg_duration_ms
      FROM tool_usage
      WHERE user_sub=? AND occurred_at>=?
      GROUP BY tool_name
      ORDER BY calls DESC, tool_name ASC
      LIMIT 12
    `).all(userSub, monthStart) as Record<string, unknown>[];

    const dailyRows = this.db.prepare(`
      SELECT
        date(occurred_at / 1000, 'unixepoch') AS day,
        COUNT(*) AS calls,
        SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) AS failures
      FROM tool_usage
      WHERE user_sub=? AND occurred_at>=?
      GROUP BY day
      ORDER BY day ASC
    `).all(userSub, dailyStart) as Record<string, unknown>[];

    const recent = this.db.prepare(`
      SELECT
        u.occurred_at,
        u.tool_name,
        u.device_id,
        d.name AS device_name,
        u.duration_ms,
        u.success
      FROM tool_usage AS u
      LEFT JOIN devices AS d
        ON d.id=u.device_id AND d.user_sub=u.user_sub
      WHERE u.user_sub=?
      ORDER BY u.occurred_at DESC, u.id DESC
      LIMIT 12
    `).all(userSub) as Record<string, unknown>[];

    const monthCalls = Number(month.calls);
    const monthSuccesses = Number(month.successes);
    const dailyMap = new Map(
      dailyRows.map((row) => [
        String(row.day),
        {
          calls: Number(row.calls),
          failures: Number(row.failures)
        }
      ])
    );

    const daily = Array.from({ length: 30 }, (_, index) => {
      const timestamp = dailyStart + index * 24 * 60 * 60_000;
      const date = new Date(timestamp).toISOString().slice(0, 10);
      const row = dailyMap.get(date);
      return {
        date,
        calls: row?.calls ?? 0,
        failures: row?.failures ?? 0
      };
    });

    return {
      period: {
        timezone: "UTC",
        monthStart: new Date(monthStart).toISOString(),
        generatedAt: new Date(now).toISOString()
      },
      trackingSince:
        totals.tracking_since === null || totals.tracking_since === undefined
          ? null
          : new Date(Number(totals.tracking_since)).toISOString(),
      thisMonth: {
        calls: monthCalls,
        successes: monthSuccesses,
        failures: Math.max(0, monthCalls - monthSuccesses),
        successRate: monthCalls === 0 ? 100 : monthSuccesses / monthCalls,
        avgDurationMs: Math.round(Number(month.avg_duration_ms))
      },
      todayCalls: Number(today.calls),
      totalCalls: Number(totals.calls),
      activeDays: Number(totals.active_days),
      topTools: topTools.map((row) => {
        const calls = Number(row.calls);
        const successes = Number(row.successes);
        return {
          name: String(row.tool_name),
          calls,
          successRate: calls === 0 ? 100 : successes / calls,
          avgDurationMs: Math.round(Number(row.avg_duration_ms))
        };
      }),
      daily,
      recent: recent.map((row) => ({
        at: new Date(Number(row.occurred_at)).toISOString(),
        toolName: String(row.tool_name),
        deviceId: row.device_id === null ? null : String(row.device_id),
        deviceName: row.device_name === null ? null : String(row.device_name),
        durationMs: Number(row.duration_ms),
        success: Number(row.success) === 1
      }))
    };
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
