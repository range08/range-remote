import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
  type Tool,
  type Transport
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { AgentConfig } from "@range-remote/shared";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { assertAllowedPath } from "./policy.js";

const MAX_SKILL_BYTES = 512 * 1024;
const MAX_SKILLS = 256;
const MAX_RESOURCE_ENTRIES = 256;
const DEFAULT_MCP_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_MCP_TOOL_TIMEOUT_MS = 60_000;

type SkillSource = "project" | "user" | "admin";

type SkillSummary = {
  name: string;
  description: string;
  path: string;
  source: SkillSource;
};

type ResolvedMcpServer = {
  name: string;
  enabled: boolean;
  sourceFiles: string[];
  raw: Record<string, unknown>;
};

type McpTransportKind = "stdio" | "http" | "invalid";

export function listSkills(
  config: AgentConfig,
  cwdInput?: string
): { skills: SkillSummary[] } {
  const candidates = skillRoots(config, cwdInput);
  const seen = new Set<string>();
  const skills: SkillSummary[] = [];

  for (const candidate of candidates) {
    const root = allowedExistingDirectory(candidate.path, config);
    if (!root) continue;

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (skills.length >= MAX_SKILLS) break;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      const skillFile = join(root, entry.name, "SKILL.md");
      const allowed = allowedExistingFile(skillFile, config);
      if (!allowed || seen.has(allowed)) continue;

      const parsed = parseSkill(allowed);
      if (!parsed.name || !parsed.description) continue;

      seen.add(allowed);
      skills.push({
        name: parsed.name,
        description: parsed.description,
        path: allowed,
        source: candidate.source
      });
    }
  }

  return {
    skills: skills.sort((a, b) =>
      a.name.localeCompare(b.name) || a.path.localeCompare(b.path)
    )
  };
}

export function readSkill(
  config: AgentConfig,
  pathInput: string
): {
  path: string;
  name: string;
  description: string;
  instructions: string;
  openai?: unknown;
  resources: string[];
} {
  const path = assertAllowedPath(pathInput, config);
  if (!path.endsWith(sep + "SKILL.md") && !path.endsWith("/SKILL.md")) {
    throw new Error("Skill path must point to SKILL.md");
  }
  const parsed = parseSkill(path);
  if (!parsed.name || !parsed.description) {
    throw new Error("SKILL.md must declare name and description in YAML frontmatter");
  }

  const skillDir = dirname(path);
  const openaiPath = join(skillDir, "agents", "openai.yaml");
  let openai: unknown;
  const allowedOpenAiPath = allowedExistingFile(openaiPath, config);
  if (allowedOpenAiPath) {
    openai = parseYaml(readLimitedUtf8(allowedOpenAiPath, MAX_SKILL_BYTES));
  }

  return {
    path,
    name: parsed.name,
    description: parsed.description,
    instructions: parsed.body,
    ...(openai === undefined ? {} : { openai }),
    resources: collectResourceEntries(skillDir, config)
  };
}

export function listMcpServers(
  config: AgentConfig,
  cwdInput?: string
): { servers: ReturnType<typeof describeMcpServer>[] } {
  assertMcpAllowed(config);
  const servers = resolveMcpServers(config, cwdInput);
  return {
    servers: [...servers.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((server) => describeMcpServer(server))
  };
}

export async function listMcpTools(
  config: AgentConfig,
  serverName: string,
  cwdInput?: string
): Promise<{ server: string; instructions?: string; tools: Tool[] }> {
  assertMcpAllowed(config);
  const resolved = getEnabledMcpServer(config, serverName, cwdInput);
  const connection = await connectMcpServer(config, resolved, cwdInput);

  try {
    const response = await connection.client.listTools(undefined, {
      timeout: connection.listTimeoutMs
    });
    const tools = filterTools(response.tools, resolved.raw);
    const instructions = connection.client.getInstructions();
    return {
      server: serverName,
      ...(instructions ? { instructions: instructions.slice(0, 16_384) } : {}),
      tools
    };
  } finally {
    await closeQuietly(connection.client);
  }
}

export async function callMcpTool(
  config: AgentConfig,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  cwdInput?: string
): Promise<{ server: string; tool: string; result: unknown }> {
  assertMcpAllowed(config);
  const resolved = getEnabledMcpServer(config, serverName, cwdInput);
  const connection = await connectMcpServer(config, resolved, cwdInput);

  try {
    const response = await connection.client.listTools(undefined, {
      timeout: connection.listTimeoutMs
    });
    const tool = filterTools(response.tools, resolved.raw).find(
      (item) => item.name === toolName
    );
    if (!tool) {
      throw new Error("MCP tool is not enabled or does not exist: " + toolName);
    }

    const result = await connection.client.callTool(
      { name: toolName, arguments: args },
      { timeout: connection.toolTimeoutMs, toolDefinition: tool }
    );
    enforceResultSize(result, config.maxCommandOutputBytes);
    return { server: serverName, tool: toolName, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/401|unauthorized|authorization/i.test(message)) {
      throw new Error(
        'MCP server "' + serverName +
        '" requires authentication that the Range Remote bridge could not complete. ' +
        "Use bearer_token_env_var or configured headers, or authenticate the server locally first."
      );
    }
    throw error;
  } finally {
    await closeQuietly(connection.client);
  }
}

function skillRoots(
  config: AgentConfig,
  cwdInput?: string
): Array<{ path: string; source: SkillSource }> {
  const roots: Array<{ path: string; source: SkillSource }> = [];

  if (cwdInput) {
    const cwd = assertAllowedPath(cwdInput, config);
    const projectRoot = findProjectRoot(cwd);
    for (const directory of pathChain(projectRoot, cwd)) {
      roots.push({ path: join(directory, ".agents", "skills"), source: "project" });
    }
  }

  roots.push({ path: join(homedir(), ".agents", "skills"), source: "user" });
  if (process.platform !== "win32") {
    roots.push({ path: "/etc/codex/skills", source: "admin" });
  }
  return roots;
}

function parseSkill(path: string): {
  name?: string;
  description?: string;
  body: string;
} {
  const text = readLimitedUtf8(path, MAX_SKILL_BYTES);
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { body: text };

  let metadata: unknown;
  try {
    metadata = parseYaml(match[1] ?? "");
  } catch (error) {
    throw new Error(
      "Invalid SKILL.md YAML frontmatter at " + path + ": " +
      (error instanceof Error ? error.message : String(error))
    );
  }

  const record = isRecord(metadata) ? metadata : {};
  return {
    ...(typeof record.name === "string" ? { name: record.name.trim() } : {}),
    ...(typeof record.description === "string"
      ? { description: record.description.trim() }
      : {}),
    body: text.slice(match[0].length).trim()
  };
}

function collectResourceEntries(skillDir: string, config: AgentConfig): string[] {
  const result: string[] = [];
  for (const child of ["scripts", "references", "assets"]) {
    const root = allowedExistingDirectory(join(skillDir, child), config);
    if (!root) continue;
    walk(root);
    if (result.length >= MAX_RESOURCE_ENTRIES) break;
  }
  return result.sort();

  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (result.length >= MAX_RESOURCE_ENTRIES) return;
      const full = join(directory, entry.name);
      let allowed: string;
      try {
        allowed = assertAllowedPath(full, config);
      } catch {
        continue;
      }
      if (entry.isDirectory()) {
        walk(allowed);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        result.push(relative(skillDir, allowed).replace(/\\/g, "/"));
      }
    }
  }
}

function resolveMcpServers(
  config: AgentConfig,
  cwdInput?: string
): Map<string, ResolvedMcpServer> {
  const layers = mcpConfigLayers(config, cwdInput);
  const servers = new Map<string, ResolvedMcpServer>();

  for (const configFile of layers) {
    const parsed = parseToml(readLimitedUtf8(configFile, MAX_SKILL_BYTES));
    if (!isRecord(parsed.mcp_servers)) continue;

    for (const [name, value] of Object.entries(parsed.mcp_servers)) {
      if (!isRecord(value)) continue;
      const normalized = normalizeServerConfig(value, configFile);
      const current = servers.get(name);
      servers.set(name, {
        name,
        enabled: normalized.enabled !== false,
        sourceFiles: [...(current?.sourceFiles ?? []), configFile],
        raw: current ? deepMerge(current.raw, normalized) : normalized
      });
    }
  }

  for (const server of servers.values()) {
    server.enabled = server.raw.enabled !== false;
  }
  return servers;
}

function mcpConfigLayers(config: AgentConfig, cwdInput?: string): string[] {
  const candidates: string[] = [];
  if (process.platform !== "win32") candidates.push("/etc/codex/config.toml");

  const codexHome = process.env.CODEX_HOME
    ? resolve(process.env.CODEX_HOME)
    : join(homedir(), ".codex");
  candidates.push(join(codexHome, "config.toml"));

  if (cwdInput) {
    const cwd = assertAllowedPath(cwdInput, config);
    const projectRoot = findProjectRoot(cwd);
    for (const directory of pathChain(projectRoot, cwd)) {
      candidates.push(join(directory, ".codex", "config.toml"));
    }
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const allowed = allowedExistingFile(candidate, config);
    if (!allowed || seen.has(allowed)) continue;
    seen.add(allowed);
    result.push(allowed);
  }
  return result;
}

function normalizeServerConfig(
  input: Record<string, unknown>,
  configFile: string
): Record<string, unknown> {
  const copy = structuredClone(input);
  if (typeof copy.cwd === "string" && !isAbsolute(copy.cwd)) {
    copy.cwd = resolve(dirname(configFile), copy.cwd);
  }
  return copy;
}

function getEnabledMcpServer(
  config: AgentConfig,
  name: string,
  cwdInput?: string
): ResolvedMcpServer {
  const server = resolveMcpServers(config, cwdInput).get(name);
  if (!server) throw new Error("MCP server is not configured: " + name);
  if (!server.enabled) throw new Error("MCP server is disabled: " + name);
  return server;
}

async function connectMcpServer(
  config: AgentConfig,
  server: ResolvedMcpServer,
  cwdInput?: string
): Promise<{ client: Client; transport: Transport; listTimeoutMs: number; toolTimeoutMs: number }> {
  const raw = server.raw;
  const startupTimeoutMs = timeoutMs(
    raw.startup_timeout_sec,
    DEFAULT_MCP_STARTUP_TIMEOUT_MS
  );
  const toolTimeoutMs = timeoutMs(raw.tool_timeout_sec, DEFAULT_MCP_TOOL_TIMEOUT_MS);
  const listTimeoutMs = Math.min(toolTimeoutMs, 15_000);
  const client = new Client(
    { name: "range-remote-agent", version: "0.1.0" },
    { capabilities: {} }
  );

  let transport: Transport;
  if (typeof raw.command === "string") {
    if (typeof raw.url === "string") {
      throw new Error(
        'MCP server "' + server.name + '" cannot define both command and url'
      );
    }
    transport = new StdioClientTransport({
      command: raw.command,
      args: stringArray(raw.args),
      env: buildMcpEnvironment(config, raw),
      cwd: resolveMcpCwd(config, raw.cwd, cwdInput),
      stderr: "ignore",
      maxBufferSize: Math.max(config.maxCommandOutputBytes * 2, 1024 * 1024)
    });
  } else if (typeof raw.url === "string") {
    const headers = resolveHttpHeaders(raw);
    const bearerEnv = stringValue(raw.bearer_token_env_var);
    const bearerToken = bearerEnv ? process.env[bearerEnv] : undefined;
    if (bearerEnv && !bearerToken) {
      throw new Error(
        'MCP server "' + server.name + '" requires environment variable ' + bearerEnv
      );
    }
    if (raw.http_headers_helper !== undefined) {
      throw new Error(
        'MCP server "' + server.name +
        '" uses http_headers_helper, which is not supported by Range Remote yet'
      );
    }
    transport = new StreamableHTTPClientTransport(new URL(raw.url), {
      ...(Object.keys(headers).length === 0 ? {} : { requestInit: { headers } }),
      ...(bearerToken ? { authProvider: { token: async () => bearerToken } } : {})
    });
  } else {
    throw new Error(
      'MCP server "' + server.name +
      '" must define either command (STDIO) or url (Streamable HTTP)'
    );
  }

  try {
    await client.connect(transport, { timeout: startupTimeoutMs });
    return { client, transport, listTimeoutMs, toolTimeoutMs };
  } catch (error) {
    await closeQuietly(client);
    throw error;
  }
}

function resolveMcpCwd(
  config: AgentConfig,
  configured: unknown,
  requested?: string
): string {
  if (typeof configured === "string") {
    return assertAllowedPath(configured, config);
  }
  if (requested) return assertAllowedPath(requested, config);
  if (config.unrestricted) return process.cwd();
  return assertAllowedPath(config.allowedRoots[0]!, config);
}

function buildMcpEnvironment(
  config: AgentConfig,
  raw: Record<string, unknown>
): Record<string, string> {
  const env = config.unrestricted ? fullEnvironment() : safeEnvironment();
  if (isRecord(raw.env)) {
    for (const [key, value] of Object.entries(raw.env)) {
      if (typeof value === "string") env[key] = value;
    }
  }
  for (const name of stringArray(raw.env_vars)) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function resolveHttpHeaders(raw: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  if (isRecord(raw.http_headers)) {
    for (const [key, value] of Object.entries(raw.http_headers)) {
      if (typeof value === "string") headers[key] = value;
    }
  }
  if (isRecord(raw.env_http_headers)) {
    for (const [header, envName] of Object.entries(raw.env_http_headers)) {
      if (typeof envName !== "string") continue;
      const value = process.env[envName];
      if (value !== undefined) headers[header] = value;
    }
  }
  return headers;
}

function describeMcpServer(server: ResolvedMcpServer) {
  const raw = server.raw;
  const command = stringValue(raw.command);
  const url = stringValue(raw.url);
  const warnings: string[] = [];

  if (command && url) warnings.push("Both command and url are configured");
  if (!command && !url) warnings.push("Neither command nor url is configured");
  if (raw.http_headers_helper !== undefined) {
    warnings.push("http_headers_helper is not supported by Range Remote");
  }
  if (raw.oauth !== undefined && !raw.bearer_token_env_var) {
    warnings.push(
      "Interactive OAuth is not implemented by the Range Remote bridge; a preconfigured token/header may be required"
    );
  }

  const transport: McpTransportKind =
    command && !url ? "stdio" : url && !command ? "http" : "invalid";

  return {
    name: server.name,
    enabled: server.enabled,
    transport,
    ...(command ? { command } : {}),
    ...(command && stringArray(raw.args).length > 0
      ? { argCount: stringArray(raw.args).length }
      : {}),
    ...(url ? { url: redactUrl(url) } : {}),
    ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}),
    envKeys: isRecord(raw.env) ? Object.keys(raw.env).sort() : [],
    envVars: stringArray(raw.env_vars).sort(),
    headerNames: isRecord(raw.http_headers) ? Object.keys(raw.http_headers).sort() : [],
    envHeaderNames: isRecord(raw.env_http_headers)
      ? Object.keys(raw.env_http_headers).sort()
      : [],
    ...(stringValue(raw.bearer_token_env_var)
      ? { bearerTokenEnvVar: stringValue(raw.bearer_token_env_var)! }
      : {}),
    ...(stringArray(raw.enabled_tools).length > 0
      ? { enabledTools: stringArray(raw.enabled_tools) }
      : {}),
    ...(stringArray(raw.disabled_tools).length > 0
      ? { disabledTools: stringArray(raw.disabled_tools) }
      : {}),
    ...(typeof raw.startup_timeout_sec === "number"
      ? { startupTimeoutSec: raw.startup_timeout_sec }
      : {}),
    ...(typeof raw.tool_timeout_sec === "number"
      ? { toolTimeoutSec: raw.tool_timeout_sec }
      : {}),
    sourceFiles: server.sourceFiles,
    compatibilityWarnings: warnings
  };
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<invalid-url>";
  }
}

function filterTools(tools: Tool[], raw: Record<string, unknown>): Tool[] {
  const enabled = stringArray(raw.enabled_tools);
  const disabled = new Set(stringArray(raw.disabled_tools));
  return tools.filter(
    (tool) =>
      (enabled.length === 0 || enabled.includes(tool.name)) &&
      !disabled.has(tool.name)
  );
}

function timeoutMs(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(value * 1000), 1000), 120_000);
}

function findProjectRoot(start: string): string {
  let current = start;
  for (;;) {
    if (
      existsSync(join(current, ".git")) ||
      existsSync(join(current, ".hg")) ||
      existsSync(join(current, ".svn"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

function pathChain(root: string, target: string): string[] {
  const rel = relative(root, target);
  if (rel === "" || rel === ".") return [root];
  if (rel.startsWith(".." + sep) || rel === ".." || isAbsolute(rel)) return [target];

  const result = [root];
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    result.push(current);
  }
  return result;
}

function allowedExistingDirectory(
  path: string,
  config: AgentConfig
): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const allowed = assertAllowedPath(path, config);
    return statSync(allowed).isDirectory() ? allowed : undefined;
  } catch {
    return undefined;
  }
}

function allowedExistingFile(path: string, config: AgentConfig): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const allowed = assertAllowedPath(path, config);
    return lstatSync(allowed).isFile() ? allowed : undefined;
  } catch {
    return undefined;
  }
}

function readLimitedUtf8(path: string, maxBytes: number): string {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error("Path is not a regular file: " + path);
  if (stat.size > maxBytes) {
    throw new Error("File exceeds limit of " + maxBytes + " bytes: " + path);
  }
  return readFileSync(path, "utf8");
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const output: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(value) && isRecord(output[key])) {
      output[key] = deepMerge(output[key] as Record<string, unknown>, value);
    } else {
      output[key] = structuredClone(value);
    }
  }
  return output;
}

function enforceResultSize(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > maxBytes) {
    throw new Error("MCP result exceeds output limit of " + maxBytes + " bytes");
  }
}

function assertMcpAllowed(config: AgentConfig): void {
  if (!config.allowMcp) {
    throw new Error(
      "MCP bridge execution is disabled by local policy; pair the agent with --allow-mcp or --unrestricted"
    );
  }
}

function safeEnvironment(): Record<string, string> {
  const keep = [
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL",
    "TMPDIR", "TEMP", "TMP", "SystemRoot", "ComSpec", "APPDATA",
    "LOCALAPPDATA", "USERPROFILE"
  ];
  const result: Record<string, string> = {};
  for (const key of keep) {
    const value = process.env[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function fullEnvironment(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function closeQuietly(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    // Best-effort cleanup after a failed or completed MCP session.
  }
}
