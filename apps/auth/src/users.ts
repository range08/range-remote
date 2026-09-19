import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

mkdirSync(dirname(config.databasePath), { recursive: true });

const db = new DatabaseSync(config.databasePath);
chmodSync(config.databasePath, 0o600);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

export type User = {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
};

export function registerUser(username: string, email: string, password: string): User {
  const normalizedUsername = username.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(normalizedUsername)) {
    throw new Error("Username must be 3-40 characters using letters, digits, dot, underscore, or hyphen");
  }
  if (normalizedEmail.length > 254 || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    throw new Error("Invalid email address");
  }
  if (password.length < 8 || password.length > 256) {
    throw new Error("Password must be between 8 and 256 characters");
  }

  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  const id = randomUUID();
  try {
    db.prepare(`
      INSERT INTO users(id,username,email,password_salt,password_hash,email_verified,created_at)
      VALUES(?,?,?,?,?,0,?)
    `).run(
      id,
      normalizedUsername,
      normalizedEmail,
      salt.toString("base64url"),
      hash.toString("base64url"),
      new Date().toISOString()
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      throw new Error("Username or email is already registered");
    }
    throw new Error("Registration failed");
  }

  return { id, username: normalizedUsername, email: normalizedEmail, emailVerified: false };
}

export function verifyUser(login: string, password: string): User | null {
  const value = login.trim().toLowerCase();
  const row = db.prepare(`
    SELECT id,username,email,password_salt,password_hash,email_verified
    FROM users WHERE username=? OR email=?
  `).get(value, value) as Record<string, unknown> | undefined;
  if (!row) return null;

  const salt = Buffer.from(String(row.password_salt), "base64url");
  const expected = Buffer.from(String(row.password_hash), "base64url");
  const actual = scryptSync(password, salt, expected.length);
  if (!timingSafeEqual(actual, expected)) return null;
  return mapUser(row);
}

export function findUser(id: string): User | null {
  const row = db.prepare(`
    SELECT id,username,email,email_verified FROM users WHERE id=?
  `).get(id) as Record<string, unknown> | undefined;
  return row ? mapUser(row) : null;
}

function mapUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    username: String(row.username),
    email: String(row.email),
    emailVerified: Number(row.email_verified) === 1
  };
}
