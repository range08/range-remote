import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60_000;

type DashboardPayload = {
  sub: string;
  exp: number;
};

export function createDashboardSession(
  userSub: string,
  signingKey: string,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS
): string {
  const payload: DashboardPayload = {
    sub: userSub,
    exp: now + ttlMs
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encoded, signingKey);
  return encoded + "." + signature;
}

export function readDashboardSession(
  value: string,
  verificationKeys: string[],
  now = Date.now()
): { userSub: string } | null {
  if (!value || value.length > 4096) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return null;

  const valid = verificationKeys.some((key) =>
    safeEqual(signature, sign(encoded, key))
  );
  if (!valid) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as Partial<DashboardPayload>;
    if (
      typeof payload.sub !== "string" ||
      payload.sub.length === 0 ||
      payload.sub.length > 200 ||
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= now
    ) {
      return null;
    }
    return { userSub: payload.sub };
  } catch {
    return null;
  }
}

function sign(value: string, key: string): string {
  return createHmac("sha256", key).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
