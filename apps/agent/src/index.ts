#!/usr/bin/env node
import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocket } from "ws";
import { RpcRequestSchema, type AgentConfig } from "@range-remote/shared";
import { configPath, loadConfig, saveConfig } from "./config.js";
import { execute } from "./operations.js";

const [command, ...args] = process.argv.slice(2);

if (command === "pair") {
  await pair(parseArgs(args));
} else if (command === "start") {
  await start();
} else if (command === "status") {
  status();
} else {
  console.error("Usage:");
  console.error("  range-remote-agent pair --server URL --code CODE --name NAME --unrestricted");
  console.error("  range-remote-agent pair --server URL --code CODE --name NAME --root PATH [--root PATH] [--allow-shell] [--allow-sensitive-files]");
  console.error("  range-remote-agent start");
  console.error("  range-remote-agent status");
  process.exit(2);
}

async function pair(flags: Map<string, string[]>): Promise<void> {
  const serverUrl = new URL(required(flags, "server"));
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (serverUrl.protocol !== "https:" && !(serverUrl.protocol === "http:" && localHosts.has(serverUrl.hostname))) {
    throw new Error("Remote agent servers must use HTTPS; HTTP is allowed only for localhost development");
  }
  const server = serverUrl.toString().replace(/\/+$/, "");
  const code = required(flags, "code");
  const name = required(flags, "name");
  const unrestricted = flags.has("unrestricted");
  const roots = (flags.get("root") ?? []).map((root) => {
    const absolute = resolve(root);
    const stat = statSync(absolute);
    if (!stat.isDirectory()) throw new Error(`Allowed root is not a directory: ${absolute}`);
    return realpathSync(absolute);
  });
  if (!unrestricted && roots.length === 0) {
    throw new Error("At least one --root is required unless --unrestricted is used");
  }

  const response = await fetch(`${server}/agent/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name })
  });

  if (!response.ok) throw new Error(`Pairing failed: HTTP ${response.status}`);
  const payload = await response.json() as { deviceId: string; deviceToken: string };

  const config: AgentConfig = {
    server,
    deviceId: payload.deviceId,
    deviceToken: payload.deviceToken,
    name,
    unrestricted,
    allowedRoots: roots,
    allowShell: unrestricted || flags.has("allow-shell"),
    allowSensitiveFiles: unrestricted || flags.has("allow-sensitive-files"),
    maxReadBytes: 1_048_576,
    maxWriteBytes: 524_288,
    maxCommandOutputBytes: 262_144,
    maxCommandSeconds: 120
  };

  saveConfig(config);
  console.error(
    unrestricted
      ? `Paired ${name} in unrestricted mode. Config saved to ${configPath}`
      : `Paired ${name}. Config saved to ${configPath}`
  );
}

function status(): void {
  const config = loadConfig();
  console.log(JSON.stringify({
    configPath,
    name: config.name,
    server: config.server,
    unrestricted: config.unrestricted,
    allowedRoots: config.allowedRoots,
    allowShell: config.allowShell,
    allowSensitiveFiles: config.allowSensitiveFiles,
    paired: Boolean(config.deviceId && config.deviceToken)
  }, null, 2));
}

async function start(): Promise<void> {
  const config = loadConfig();
  const wsUrl = new URL("/agent/ws", config.server);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

  for (;;) {
    try {
      await connectOnce(config, wsUrl);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 3000));
  }
}

async function connectOnce(config: AgentConfig, wsUrl: URL): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: { authorization: `Bearer ${config.deviceToken}` }
    });

    ws.on("open", () => console.error(
      config.unrestricted
        ? `Connected as ${config.name} (unrestricted local access)`
        : `Connected as ${config.name}`
    ));

    ws.on("message", async (raw) => {
      let parsed;
      try {
        parsed = RpcRequestSchema.safeParse(JSON.parse(raw.toString()));
      } catch {
        ws.close(1003, "Invalid request");
        return;
      }
      if (!parsed.success) {
        ws.close(1003, "Invalid request");
        return;
      }

      try {
        const result = await execute(parsed.data, config);
        ws.send(JSON.stringify({ id: parsed.data.id, ok: true, result }));
      } catch (error) {
        ws.send(JSON.stringify({
          id: parsed.data.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    });

    ws.on("close", () => resolvePromise());
    ws.on("error", (error) => reject(error));
  });
}

function parseArgs(args: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const booleanFlags = new Set(["allow-shell", "allow-sensitive-files", "unrestricted"]);
  for (let i = 0; i < args.length; i++) {
    const item = args[i]!;
    if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
    const key = item.slice(2);
    if (booleanFlags.has(key)) {
      result.set(key, ["true"]);
      continue;
    }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    result.set(key, [...(result.get(key) ?? []), value]);
  }
  return result;
}

function required(flags: Map<string, string[]>, key: string): string {
  const value = flags.get(key)?.at(-1);
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}
