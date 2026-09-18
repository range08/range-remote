import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  PUBLIC_BASE_URL: z.string().url(),
  DATABASE_PATH: z.string().default("./data/range-remote.sqlite"),
  AUTH_ISSUER: z.string().url(),
  AUTH_AUDIENCE: z.string().url(),
  AUTH_JWKS_URL: z.string().url(),
  AUTH_REQUIRED_SCOPE: z.string().min(1).default("remote:use"),
  AGENT_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000)
});

export const config = EnvSchema.parse(process.env);

export const mcpResource = new URL("/", config.PUBLIC_BASE_URL).toString();
export const protectedResourceMetadataUrl = new URL(
  "/.well-known/oauth-protected-resource",
  config.PUBLIC_BASE_URL
).toString();
