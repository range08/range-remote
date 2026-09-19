import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8790),
  AUTH_ISSUER: z.string().url(),
  MCP_RESOURCE: z.string().url(),
  AUTH_DATABASE_PATH: z.string().default("./data/auth.sqlite"),
  AUTH_JWKS_PATH: z.string().default("./data/jwks.json"),
  AUTH_COOKIE_KEYS: z.string().min(32),
  MCP_INTERNAL_URL: z.string().url().default("http://range-remote:8787"),
  INTERNAL_API_TOKEN: z.string().min(32).optional(),
  AUTH_ALLOW_REGISTRATION: z.enum(["true", "false"]).default("false")
});

const env = EnvSchema.parse(process.env);
if ((!env.INTERNAL_API_TOKEN || env.INTERNAL_API_TOKEN.startsWith("replace-with")) && process.env.NODE_ENV !== "test") {
  throw new Error("INTERNAL_API_TOKEN must be set to a private random value outside tests");
}

export const config = {
  port: env.PORT,
  issuer: env.AUTH_ISSUER.replace(/\/+$/, ""),
  resource: new URL(env.MCP_RESOURCE).origin,
  databasePath: env.AUTH_DATABASE_PATH,
  jwksPath: env.AUTH_JWKS_PATH,
  cookieKeys: env.AUTH_COOKIE_KEYS.split(",").map((v) => v.trim()).filter(Boolean),
  mcpInternalUrl: env.MCP_INTERNAL_URL.replace(/\/+$/, ""),
  internalApiToken: env.INTERNAL_API_TOKEN ?? "test-only-internal-token-00000000",
  allowRegistration: env.AUTH_ALLOW_REGISTRATION === "true"
};

if (config.cookieKeys.length < 2 || config.cookieKeys.some((key) => key.length < 32)) {
  throw new Error("AUTH_COOKIE_KEYS must contain at least two comma-separated keys of 32+ characters each");
}
if (new Set(config.cookieKeys).size !== config.cookieKeys.length) {
  throw new Error("AUTH_COOKIE_KEYS must contain distinct signing keys");
}
