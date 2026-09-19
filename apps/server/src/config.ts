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
  AGENT_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  MCP_AGENT_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(300000),
  MAX_PENDING_AGENT_REQUESTS: z.coerce.number().int().min(16).max(4096).default(256),
  MAX_PENDING_AGENT_REQUESTS_PER_DEVICE: z.coerce.number().int().min(1).max(64).default(8),
  MAX_AGENT_CONNECTIONS: z.coerce.number().int().min(1).max(10000).default(1000),
  AGENT_WS_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(65536).max(8 * 1024 * 1024).default(2 * 1024 * 1024),
  AGENT_WS_HEARTBEAT_MS: z.coerce.number().int().min(10000).max(120000).default(30000),
  USER_DEVICE_REQUESTS_PER_MINUTE: z.coerce.number().int().min(10).max(10000).default(300),
  USER_CONCURRENT_DEVICE_REQUESTS: z.coerce.number().int().min(1).max(128).default(16),
  MAX_DEVICES_PER_USER: z.coerce.number().int().min(1).max(1000).default(100)
});

export const config = EnvSchema.parse(process.env);

export const mcpResource = new URL(config.PUBLIC_BASE_URL).origin;
export const protectedResourceMetadataUrl = new URL(
  "/.well-known/oauth-protected-resource",
  config.PUBLIC_BASE_URL
).toString();
