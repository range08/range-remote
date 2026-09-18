import { McpServer } from "@modelcontextprotocol/server";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import type { AgentHub } from "./agent-hub.js";
import type { Store } from "./store.js";
import { config } from "./config.js";

const securitySchemes = [{ type: "oauth2" as const, scopes: [config.AUTH_REQUIRED_SCOPE] }];

function meta(invoking: string, invoked: string) {
  return {
    securitySchemes,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked
  };
}

function text(value: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }]
  };
}

function errorResult(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true
  };
}

export function buildMcpServer(userSub: string, store: Store, hub: AgentHub): McpServer {
  const server = new McpServer(
    { name: "Range Remote", version: "0.1.0" },
    {
      instructions:
        "Use read-only tools before write or shell tools. Respect local agent policy. Never try to bypass blocked paths, sensitive-file restrictions, disabled shell access, or allowed-root boundaries."
    }
  );

  registerAppTool(server, "profile", {
    title: "Connection profile",
    description: "Returns the authenticated Range Remote profile identifier without inspecting any device.",
    securitySchemes,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Reading profile…", "Profile ready")
  }, async () => text({ profile: userSub }));

  registerAppTool(server, "list_devices", {
    title: "List paired devices",
    description: "Lists devices paired to the authenticated user and whether each device is currently online.",
    securitySchemes,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Checking devices…", "Devices ready")
  }, async () => {
    const devices = store.listDevices(userSub).map((device) => ({
      id: device.id,
      name: device.name,
      online: hub.isOnline(device.id),
      lastSeen: device.lastSeen
    }));
    return text({ devices });
  });

  registerAppTool(server, "create_pairing_code", {
    title: "Create device pairing code",
    description: "Creates a single-use pairing code that expires in 10 minutes. The user must enter the code locally on a device.",
    securitySchemes,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    _meta: meta("Creating pairing code…", "Pairing code ready")
  }, async () => text(store.createPairingCode(userSub)));

  const deviceSchema = z.object({
    device: z.string().uuid().describe("Device id from list_devices")
  });

  registerAppTool(server, "system_info", {
    title: "Read device system information",
    description: "Returns basic operating-system and runtime information from one paired device.",
    inputSchema: deviceSchema,
    securitySchemes,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Reading system info…", "System info ready")
  }, async ({ device }) => withDevice(userSub, device, store, hub, "system_info", {}));

  registerAppTool(server, "list_directory", {
    title: "List directory",
    description: "Lists entries inside a directory that the local agent policy allows.",
    inputSchema: z.object({
      device: z.string().uuid(),
      path: z.string().min(1),
      limit: z.number().int().min(1).max(500).default(200)
    }),
    securitySchemes,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Listing directory…", "Directory ready")
  }, async ({ device, path, limit }) =>
    withDevice(userSub, device, store, hub, "list_directory", { path, limit }));

  registerAppTool(server, "read_file", {
    title: "Read text file",
    description: "Reads a UTF-8 text file inside an allowed root. Sensitive credential paths are denied by the local agent by default.",
    inputSchema: z.object({
      device: z.string().uuid(),
      path: z.string().min(1),
      maxBytes: z.number().int().min(1).max(1_048_576).optional()
    }),
    securitySchemes,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Reading file…", "File ready")
  }, async ({ device, path, maxBytes }) =>
    withDevice(userSub, device, store, hub, "read_file", {
      path,
      ...(maxBytes === undefined ? {} : { maxBytes })
    }));

  registerAppTool(server, "git_status", {
    title: "Read Git status",
    description: "Runs a read-only Git status query in an allowed working directory.",
    inputSchema: z.object({ device: z.string().uuid(), cwd: z.string().min(1) }),
    securitySchemes,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Reading Git status…", "Git status ready")
  }, async ({ device, cwd }) =>
    withDevice(userSub, device, store, hub, "git_status", { cwd }));

  registerAppTool(server, "git_diff", {
    title: "Read Git diff",
    description: "Returns an unstaged or staged Git diff from an allowed working directory.",
    inputSchema: z.object({
      device: z.string().uuid(),
      cwd: z.string().min(1),
      staged: z.boolean().default(false),
      maxBytes: z.number().int().min(1).max(524_288).default(262_144)
    }),
    securitySchemes,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Reading Git diff…", "Git diff ready")
  }, async ({ device, cwd, staged, maxBytes }) =>
    withDevice(userSub, device, store, hub, "git_diff", { cwd, staged, maxBytes }));

  registerAppTool(server, "write_file", {
    title: "Write text file",
    description: "Creates or overwrites one UTF-8 text file inside an allowed root. This can destroy existing file content when overwrite is true.",
    inputSchema: z.object({
      device: z.string().uuid(),
      path: z.string().min(1),
      content: z.string().max(524_288),
      overwrite: z.boolean().default(false)
    }),
    securitySchemes,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    _meta: meta("Writing file…", "File written")
  }, async ({ device, path, content, overwrite }) =>
    withDevice(userSub, device, store, hub, "write_file", { path, content, overwrite }));

  registerAppTool(server, "run_command", {
    title: "Run device shell command",
    description: "Runs one shell command in an allowed working directory only when shell access was explicitly enabled in the local agent. Commands can modify data or access the network.",
    inputSchema: z.object({
      device: z.string().uuid(),
      cwd: z.string().min(1),
      command: z.string().min(1).max(8000),
      timeoutSeconds: z.number().int().min(1).max(120).default(30)
    }),
    securitySchemes,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    _meta: meta("Running command…", "Command finished")
  }, async ({ device, cwd, command, timeoutSeconds }) =>
    withDevice(userSub, device, store, hub, "run_command", { cwd, command, timeoutSeconds }));

  return server;
}

async function withDevice(
  userSub: string,
  deviceId: string,
  store: Store,
  hub: AgentHub,
  kind: Parameters<AgentHub["call"]>[1],
  params: Record<string, unknown>
) {
  try {
    const device = store.getDeviceForUser(userSub, deviceId);
    if (!device) throw new Error("Device not found");
    const result = await hub.call(device.id, kind, params);
    return text(result);
  } catch (error) {
    return errorResult(error);
  }
}
