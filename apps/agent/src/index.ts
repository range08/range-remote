#!/usr/bin/env node
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
} else {
  console.error("Usage:");
  console.error("  range-remote-agent pair --server URL --code CODE --name NAME --root PATH [--root PATH] [--allow-shell]");
  console.error("  range-remote-agent start");
  process.exit(2);
}

async function pair(flags: Map<string, string[]>): Promise<void> {
  const server = required(flags, "server").replace(/\/+$/, "");
  const code = required(flags, "code");
  const name = required(flags, "name");
  const roots = (flags.get("root") ?? []).map((root) => resolve(root));
  if (roots.length === 0) throw new Error("At least one --root is required");

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
    allowedRoots: roots,
    allowShell: flags.has("allow-shell"),
    allowSensitiveFiles: false,
    maxReadBytes: 1_048_576,
    maxWriteBytes: 524_288,
    maxCommandOutputBytes: 262_144,
    maxCommandSeconds: 120
  };

  saveConfig(config);
  console.error(`Paired ${name}. Config saved to ${configPath}`);
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

    ws.on("open", () => console.error(`Connected as ${config.name}`));

    ws.on("message", async (raw) => {
      const parsed = RpcRequestSchema.safeParse(JSON.parse(raw.toString()));
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
  for (let i = 0; i < args.length; i++) {
    const item = args[i]!;
    if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
    const key = item.slice(2);
    if (key === "allow-shell") {
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
