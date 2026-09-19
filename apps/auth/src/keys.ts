import { generateKeyPairSync, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { JWKS } from "oidc-provider";
import { z } from "zod";
import { config } from "./config.js";

const JwkSchema = z.object({
  kty: z.string(),
  crv: z.string().optional(),
  x: z.string().optional(),
  y: z.string().optional(),
  d: z.string().optional(),
  kid: z.string().min(1),
  alg: z.string().min(1),
  use: z.literal("sig")
}).passthrough();

const JwksSchema = z.object({
  keys: z.array(JwkSchema).min(1)
});

export function loadOrCreateJwks(): JWKS {
  try {
    const parsed = JwksSchema.parse(JSON.parse(readFileSync(config.jwksPath, "utf8")));
    return parsed as JWKS;
  } catch (error) {
    if (isMissingFile(error)) return createJwks();
    throw new Error("Invalid AUTH_JWKS_PATH contents", { cause: error });
  }
}

function createJwks(): JWKS {
  mkdirSync(dirname(config.jwksPath), { recursive: true });
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = privateKey.export({ format: "jwk" });
  const key = {
    ...jwk,
    kid: randomUUID(),
    alg: "RS256",
    use: "sig" as const
  };
  const jwks = { keys: [key] };
  writeFileSync(config.jwksPath, JSON.stringify(jwks, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  chmodSync(config.jwksPath, 0o600);
  return jwks;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
