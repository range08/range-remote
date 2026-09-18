import { createServer } from "node:http";
import { createMcpExpressApp, requireBearerAuth } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { PairRequestSchema } from "@range-remote/shared";
import { AgentHub } from "./agent-hub.js";
import { tokenVerifier } from "./auth.js";
import { config, mcpResource, protectedResourceMetadataUrl } from "./config.js";
import { buildMcpServer } from "./mcp.js";
import { Store } from "./store.js";

const store = new Store();
const hub = new AgentHub(store);

const app = createMcpExpressApp({
  host: "0.0.0.0",
  allowedHosts: [new URL(config.PUBLIC_BASE_URL).host, "localhost", "127.0.0.1"]
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "range-remote", version: "0.1.0" });
});

app.get("/privacy", (_req, res) => {
  res.type("text/plain").send(
    "Range Remote privacy policy: https://github.com/range08/range-remote/blob/main/PRIVACY.md"
  );
});

app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json({
    resource: mcpResource,
    authorization_servers: [config.AUTH_ISSUER],
    scopes_supported: [config.AUTH_REQUIRED_SCOPE],
    bearer_methods_supported: ["header"]
  });
});

app.post("/agent/pair", (req, res) => {
  const parsed = PairRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const userSub = store.consumePairingCode(parsed.data.code);
  if (!userSub) {
    res.status(401).json({ error: "invalid_or_expired_pairing_code" });
    return;
  }
  const device = store.createDevice(userSub, parsed.data.name);
  res.json({ deviceId: device.id, deviceToken: device.token });
});

const handler = createMcpHandler(
  ({ authInfo }) => {
    if (!authInfo) throw new Error("Authentication context missing");
    return buildMcpServer(authInfo.clientId, store, hub);
  },
  { responseMode: "json" }
);

const mcpNodeHandler = toNodeHandler(handler);
const auth = requireBearerAuth({
  verifier: tokenVerifier,
  requiredScopes: [config.AUTH_REQUIRED_SCOPE],
  resourceMetadataUrl: new URL(protectedResourceMetadataUrl)
});

app.all("/mcp", auth, (req, res) => {
  void mcpNodeHandler(req, res, req.body);
});

const server = createServer(app);
hub.attach(server);

server.listen(config.PORT, "0.0.0.0", () => {
  console.error(`Range Remote listening on :${config.PORT}`);
});

async function shutdown() {
  await handler.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
