import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AgentHub } from "./agent-hub.js";
import { createOpenAiToolRegistry } from "./openai-compat.js";
import type { Store } from "./store.js";
import { config } from "./config.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";

const securitySchemes = [{ type: "oauth2" as const, scopes: [config.AUTH_REQUIRED_SCOPE] }];
const userDeviceRateLimiter = new FixedWindowRateLimiter(8192);
const userConcurrentDeviceRequests = new Map<string, number>();

function meta(invoking: string, invoked: string, extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked
  };
}

function text(value: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
    }]
  };
}

function errorResult(error: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: error instanceof Error ? error.message : String(error)
    }],
    isError: true
  };
}

export function buildMcpServer(
  userSub: string,
  clientId: string,
  store: Store,
  hub: AgentHub
): McpServer {
  const server = new McpServer(
    { name: "Range Remote", version: "0.1.0" },
    {
      instructions:
        "Use read-only tools before write or shell tools. Respect the local mode selected by the user. Restricted agents enforce path, sensitive-file, shell, and MCP policy; unrestricted agents intentionally expose the operating-system permissions of the agent process. For substantial device work where a reusable workflow may apply, call list_skills with the working directory, inspect only the returned metadata, and read only a relevant skill with read_skill. If that workflow or the task can benefit from a locally configured MCP server, use list_mcp_servers and list_mcp_tools before call_mcp_tool. Do not request or expose downstream MCP secret values."
    }
  );

  const tools = createOpenAiToolRegistry(
    server,
    securitySchemes,
    ({ name, deviceId, durationMs, success }) => {
      if (name === "get_usage_statistics") return;
      store.recordToolUsage({
        userSub,
        clientId,
        toolName: name,
        ...(deviceId ? { deviceId } : {}),
        durationMs,
        success
      });
    }
  );

  const profileSchema = z.object({
    id: z.string().min(1).regex(/\S/).describe(
      "Opaque profile identifier that remains stable across token refresh and reconnection."
    )
  }).strict();

  tools.register("profile", {
    title: "Connection profile",
    description: "Returns the profile represented by this request's authenticated credentials.",
    outputSchema: profileSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Reading profile…", "Profile ready", { "openai/profile": true })
  }, async () => {
    const profile = { id: userSub };
    return {
      structuredContent: profile,
      content: [{ type: "text" as const, text: JSON.stringify(profile) }]
    };
  });

  tools.register("list_devices", {
    title: "List paired devices",
    description: "Lists devices paired to the authenticated user and whether each device is currently online.",
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

  tools.register("remove_device", {
    title: "Remove paired device",
    description: "Permanently removes one paired device from the authenticated account and disconnects it immediately.",
    inputSchema: z.object({
      device: z.string().uuid().describe("Device id from list_devices")
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
      idempotentHint: true
    },
    _meta: meta("Removing device…", "Device removed")
  }, async ({ device }) => {
    const removed = store.deleteDeviceForUser(userSub, device);
    if (removed) hub.disconnect(device);
    return text({ removed });
  });

  tools.register("remove_all_devices", {
    title: "Remove all paired devices",
    description: "Permanently removes every paired device and outstanding pairing code for the authenticated account.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
      idempotentHint: true
    },
    _meta: meta("Removing devices…", "Devices removed")
  }, async () => {
    const devices = store.listDevices(userSub);
    const removed = store.removeAllForUser(userSub);
    for (const device of devices) hub.disconnect(device.id);
    return text({ removed });
  });

  tools.register("create_pairing_code", {
    title: "Create device pairing code",
    description: "Creates a single-use pairing code that expires in 10 minutes. The user must enter the code locally on a device.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false
    },
    _meta: meta("Creating pairing code…", "Pairing code ready")
  }, async () => text(store.createPairingCode(userSub)));

  tools.register("system_info", {
    title: "Read device system information",
    description: "Returns basic operating-system and runtime information from one paired device.",
    inputSchema: z.object({
      device: z.string().uuid().describe("Device id from list_devices")
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Reading system info…", "System info ready")
  }, async ({ device }) => withDevice(userSub, device, store, hub, "system_info", {}));

  tools.register("list_directory", {
    title: "List directory",
    description: "Lists entries inside a directory that the local agent policy allows.",
    inputSchema: z.object({
      device: z.string().uuid(),
      path: z.string().min(1),
      limit: z.number().int().min(1).max(500).default(200)
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Listing directory…", "Directory ready")
  }, async ({ device, path, limit }) =>
    withDevice(userSub, device, store, hub, "list_directory", { path, limit }));

  tools.register("read_file", {
    title: "Read text file",
    description: "Reads a UTF-8 text file. Restricted agents enforce allowed roots and sensitive-file policy; unrestricted agents allow any path the local OS user can read.",
    inputSchema: z.object({
      device: z.string().uuid(),
      path: z.string().min(1),
      maxBytes: z.number().int().min(1).max(1_048_576).optional()
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Reading file…", "File ready")
  }, async ({ device, path, maxBytes }) =>
    withDevice(userSub, device, store, hub, "read_file", {
      path,
      ...(maxBytes === undefined ? {} : { maxBytes })
    }));

  tools.register("git_status", {
    title: "Read Git status",
    description: "Runs a read-only Git status query in an allowed working directory.",
    inputSchema: z.object({
      device: z.string().uuid(),
      cwd: z.string().min(1)
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Reading Git status…", "Git status ready")
  }, async ({ device, cwd }) =>
    withDevice(userSub, device, store, hub, "git_status", { cwd }));

  tools.register("git_diff", {
    title: "Read Git diff",
    description: "Returns an unstaged or staged Git diff. Restricted agents require local sensitive-file opt-in and scope the diff to the requested working subtree; unrestricted agents allow the full repository diff visible to the local OS user.",
    inputSchema: z.object({
      device: z.string().uuid(),
      cwd: z.string().min(1),
      staged: z.boolean().default(false),
      maxBytes: z.number().int().min(1).max(524_288).default(262_144)
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Reading Git diff…", "Git diff ready")
  }, async ({ device, cwd, staged, maxBytes }) =>
    withDevice(userSub, device, store, hub, "git_diff", { cwd, staged, maxBytes }));

  tools.register("write_file", {
    title: "Write text file",
    description: "Creates or overwrites one UTF-8 text file. Restricted agents enforce allowed roots; unrestricted agents allow any path the local OS user can write. This can destroy existing file content when overwrite is true.",
    inputSchema: z.object({
      device: z.string().uuid(),
      path: z.string().min(1),
      content: z.string().max(524_288),
      overwrite: z.boolean().default(false)
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
      idempotentHint: true
    },
    _meta: meta("Writing file…", "File written")
  }, async ({ device, path, content, overwrite }) =>
    withDevice(userSub, device, store, hub, "write_file", { path, content, overwrite }));

  tools.register("run_command", {
    title: "Run device shell command",
    description: "Runs one shell command. Restricted agents require local shell opt-in and an allowed working directory. Unrestricted agents intentionally run with the full operating-system permissions and environment of the agent process.",
    inputSchema: z.object({
      device: z.string().uuid(),
      cwd: z.string().min(1),
      command: z.string().min(1).max(8000),
      timeoutSeconds: z.number().int().min(1).max(120).default(30)
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
      idempotentHint: false
    },
    _meta: meta("Running command…", "Command finished")
  }, async ({ device, cwd, command, timeoutSeconds }) =>
    withDevice(userSub, device, store, hub, "run_command", {
      cwd,
      command,
      timeoutSeconds
    }));

  tools.register("list_skills", {
    title: "List Codex skills",
    description: "Lists Codex-compatible skills visible on a paired device. Only skill metadata is returned; use read_skill to load instructions when needed.",
    inputSchema: z.object({
      device: z.string().uuid(),
      cwd: z.string().min(1).optional()
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Finding skills…", "Skills ready")
  }, async ({ device, cwd }) =>
    withDevice(userSub, device, store, hub, "list_skills", {
      ...(cwd === undefined ? {} : { cwd })
    }));

  tools.register("read_skill", {
    title: "Read Codex skill",
    description: "Loads one Codex-compatible SKILL.md plus optional OpenAI metadata and resource names from a paired device.",
    inputSchema: z.object({
      device: z.string().uuid(),
      path: z.string().min(1)
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Reading skill…", "Skill ready")
  }, async ({ device, path }) =>
    withDevice(userSub, device, store, hub, "read_skill", { path }));

  tools.register("list_mcp_servers", {
    title: "List device MCP servers",
    description: "Lists Codex MCP server configurations visible on a paired device without returning secret environment or header values. Local MCP execution must be enabled on the agent.",
    inputSchema: z.object({
      device: z.string().uuid(),
      cwd: z.string().min(1).optional()
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: meta("Reading MCP configuration…", "MCP servers ready")
  }, async ({ device, cwd }) =>
    withDevice(userSub, device, store, hub, "list_mcp_servers", {
      ...(cwd === undefined ? {} : { cwd })
    }));

  tools.register("list_mcp_tools", {
    title: "List tools from a device MCP server",
    description: "Connects to one locally configured MCP server on a paired device and returns the tools it exposes. Supports STDIO and Streamable HTTP configurations.",
    inputSchema: z.object({
      device: z.string().uuid(),
      server: z.string().min(1),
      cwd: z.string().min(1).optional()
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: meta("Connecting to MCP server…", "MCP tools ready")
  }, async ({ device, server: mcpServer, cwd }) =>
    withDevice(userSub, device, store, hub, "list_mcp_tools", {
      server: mcpServer,
      ...(cwd === undefined ? {} : { cwd })
    }));

  tools.register("call_mcp_tool", {
    title: "Call tool on a device MCP server",
    description: "Calls a named tool on a locally configured MCP server through the paired device. The remote MCP tool may read, write, execute code, or access external services according to that server's own capabilities.",
    inputSchema: z.object({
      device: z.string().uuid(),
      server: z.string().min(1),
      tool: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()).default({}),
      cwd: z.string().min(1).optional()
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
      idempotentHint: false
    },
    _meta: meta("Calling MCP tool…", "MCP tool finished")
  }, async ({ device, server: mcpServer, tool, arguments: toolArguments, cwd }) =>
    withDevice(userSub, device, store, hub, "call_mcp_tool", {
      server: mcpServer,
      tool,
      arguments: toolArguments,
      ...(cwd === undefined ? {} : { cwd })
    }));

  tools.register("get_usage_statistics", {
    title: "Get usage statistics",
    description: "Returns this account's Range Remote tool-call usage, success/failure rate, performance summary, top tools, 30-day activity, and recent tool activity. This analytics query does not count itself.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true
    },
    _meta: meta("Reading usage…", "Usage ready")
  }, async () => text(store.getUsageStats(userSub)));

  tools.installListCompatibility();
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
  let release: (() => void) | undefined;
  try {
    const device = store.getDeviceForUser(userSub, deviceId);
    if (!device) throw new Error("Device not found");
    release = acquireUserDeviceSlot(userSub);
    const mcpBridgeKinds = new Set<Parameters<AgentHub["call"]>[1]>([
      "list_mcp_tools",
      "call_mcp_tool"
    ]);
    const result = await hub.call(
      device.id,
      kind,
      params,
      mcpBridgeKinds.has(kind)
        ? config.MCP_AGENT_REQUEST_TIMEOUT_MS
        : config.AGENT_REQUEST_TIMEOUT_MS
    );
    return text(result);
  } catch (error) {
    return errorResult(error);
  } finally {
    release?.();
  }
}

function acquireUserDeviceSlot(userSub: string): () => void {
  if (!userDeviceRateLimiter.allow(
    userSub,
    config.USER_DEVICE_REQUESTS_PER_MINUTE,
    60_000
  )) {
    throw new Error("Relay request rate exceeded; try again shortly");
  }

  const active = userConcurrentDeviceRequests.get(userSub) ?? 0;
  if (active >= config.USER_CONCURRENT_DEVICE_REQUESTS) {
    throw new Error("Too many concurrent device requests for this account");
  }
  userConcurrentDeviceRequests.set(userSub, active + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = userConcurrentDeviceRequests.get(userSub) ?? 1;
    if (current <= 1) userConcurrentDeviceRequests.delete(userSub);
    else userConcurrentDeviceRequests.set(userSub, current - 1);
  };
}
