import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentConfig } from "@range-remote/shared";
import {
  callMcpTool,
  listMcpServers,
  listMcpTools,
  listSkills,
  readSkill
} from "./codex.js";

const originalCodexHome = process.env.CODEX_HOME;
const originalFixtureFromHost = process.env.FIXTURE_FROM_HOST;

afterEach(() => {
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  if (originalFixtureFromHost === undefined) delete process.env.FIXTURE_FROM_HOST;
  else process.env.FIXTURE_FROM_HOST = originalFixtureFromHost;
});

function baseConfig(root: string, allowMcp = false): AgentConfig {
  return {
    server: "https://example.com",
    deviceId: crypto.randomUUID(),
    deviceToken: "x".repeat(32),
    name: "test",
    unrestricted: false,
    allowedRoots: [root],
    allowShell: false,
    allowSensitiveFiles: false,
    allowMcp,
    maxReadBytes: 1024 * 1024,
    maxWriteBytes: 1024 * 1024,
    maxCommandOutputBytes: 1024 * 1024,
    maxCommandSeconds: 30
  };
}

describe("Codex-compatible skill bridge", () => {
  it("discovers metadata first and loads instructions/resources on demand", () => {
    const root = mkdtempSync(join(tmpdir(), "rr-skill-"));
    mkdirSync(join(root, ".git"));
    const skillDir = join(root, ".agents", "skills", "review");
    mkdirSync(join(skillDir, "references"), { recursive: true });
    mkdirSync(join(skillDir, "agents"), { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: review",
        "description: Review a repository safely",
        "---",
        "",
        "# Workflow",
        "Inspect before editing."
      ].join("\n")
    );
    writeFileSync(join(skillDir, "references", "checklist.md"), "check");
    writeFileSync(
      join(skillDir, "agents", "openai.yaml"),
      "interface:\n  display_name: Review\n"
    );

    const config = baseConfig(root);
    const listed = listSkills(config, root);
    expect(listed.skills).toHaveLength(1);
    expect(listed.skills[0]).toMatchObject({
      name: "review",
      description: "Review a repository safely",
      source: "project"
    });
    expect(JSON.stringify(listed)).not.toContain("Inspect before editing.");

    const loaded = readSkill(config, listed.skills[0]!.path);
    expect(loaded.instructions).toContain("Inspect before editing.");
    expect(loaded.resources).toContain("references/checklist.md");
    expect(loaded.openai).toEqual({ interface: { display_name: "Review" } });
  });
});

describe("Codex-compatible MCP bridge", () => {
  it("requires an explicit local MCP opt-in", () => {
    const root = mkdtempSync(join(tmpdir(), "rr-mcp-"));
    process.env.CODEX_HOME = join(root, ".codex");
    expect(() => listMcpServers(baseConfig(root), root)).toThrow(/disabled by local policy/);
  });

  it("merges Codex config layers and redacts argument and URL credentials", () => {
    const root = mkdtempSync(join(tmpdir(), "rr-mcp-layers-"));
    mkdirSync(join(root, ".git"));
    const nested = join(root, "packages", "app");
    mkdirSync(join(nested, ".codex"), { recursive: true });
    mkdirSync(join(root, ".codex"));
    const userCodexHome = join(root, "user-codex");
    mkdirSync(userCodexHome);
    process.env.CODEX_HOME = userCodexHome;

    const hiddenArg = "arg-secret-value";
    const hiddenQuery = "query-secret-value";
    writeFileSync(
      join(userCodexHome, "config.toml"),
      [
        "[mcp_servers.demo]",
        'command = "user-command"',
        "args = [" + JSON.stringify(hiddenArg) + "]",
        "",
        "[mcp_servers.http]",
        'url = "https://user:password@example.com/mcp?token=' + hiddenQuery + '"',
        "enabled = false"
      ].join("\n")
    );
    writeFileSync(
      join(root, ".codex", "config.toml"),
      [
        "[mcp_servers.demo]",
        'command = "root-command"',
        'enabled_tools = ["echo"]'
      ].join("\n")
    );
    writeFileSync(
      join(nested, ".codex", "config.toml"),
      [
        "[mcp_servers.demo]",
        'command = "nested-command"'
      ].join("\n")
    );

    const servers = listMcpServers(baseConfig(root, true), nested);
    const demo = servers.servers.find((server) => server.name === "demo");
    const http = servers.servers.find((server) => server.name === "http");
    expect(demo).toMatchObject({
      command: "nested-command",
      argCount: 1,
      enabledTools: ["echo"]
    });
    expect(demo?.sourceFiles).toHaveLength(3);
    expect(http).toMatchObject({
      enabled: false,
      transport: "http",
      url: "https://example.com/mcp"
    });
    const serialized = JSON.stringify(servers);
    expect(serialized).not.toContain(hiddenArg);
    expect(serialized).not.toContain(hiddenQuery);
    expect(serialized).not.toContain("password");
  });

  it("reports unsupported Codex remote-executor MCP settings without attempting to run them", async () => {
    const root = mkdtempSync(join(tmpdir(), "rr-mcp-remote-"));
    mkdirSync(join(root, ".git"));
    const codexHome = join(root, ".codex");
    mkdirSync(codexHome);
    process.env.CODEX_HOME = codexHome;

    writeFileSync(
      join(codexHome, "config.toml"),
      [
        "[mcp_servers.remote]",
        'command = "never-run"',
        'experimental_environment = "remote"',
        'env_vars = [{ name = "REMOTE_TOKEN", source = "remote" }]'
      ].join("\n")
    );

    const config = baseConfig(root, true);
    const listed = listMcpServers(config, root);
    expect(listed.servers[0]?.envVars).toEqual(["REMOTE_TOKEN"]);
    expect(listed.servers[0]?.compatibilityWarnings.join(" ")).toMatch(
      /remote execution|source="remote"/
    );
    await expect(listMcpTools(config, "remote", root)).rejects.toThrow(
      /remote-executor context/
    );
  });

  it("lists and calls an enabled STDIO MCP tool while redacting secret values", async () => {
    const root = mkdtempSync(join(tmpdir(), "rr-mcp-"));
    mkdirSync(join(root, ".git"));
    const codexHome = join(root, ".codex");
    mkdirSync(codexHome);
    process.env.CODEX_HOME = codexHome;

    const serverModule = import.meta.resolve("@modelcontextprotocol/server");
    const stdioModule = import.meta.resolve("@modelcontextprotocol/server/stdio");
    const zodModule = import.meta.resolve("zod");
    const fixture = join(root, "fixture-mcp.mjs");
    writeFileSync(
      fixture,
      [
        'import { McpServer } from ' + JSON.stringify(serverModule) + ';',
        'import { StdioServerTransport } from ' + JSON.stringify(stdioModule) + ';',
        'import { z } from ' + JSON.stringify(zodModule) + ';',
        'const server = new McpServer({ name: "fixture", version: "1.0.0" }, { instructions: "Fixture instructions" });',
        'server.registerTool("echo", { description: "Echo text", inputSchema: z.object({ text: z.string() }) }, async ({ text }) => ({ content: [{ type: "text", text }] }));',
        'server.registerTool("read_env", { description: "Read host forwarded env" }, async () => ({ content: [{ type: "text", text: process.env.FIXTURE_FROM_HOST ?? "" }] }));',
        'server.registerTool("hidden", { description: "Hidden tool" }, async () => ({ content: [{ type: "text", text: "hidden" }] }));',
        'await server.connect(new StdioServerTransport());'
      ].join("\n")
    );

    const secret = "do-not-return-this-value";
    process.env.FIXTURE_FROM_HOST = "forwarded-host-value";
    writeFileSync(
      join(codexHome, "config.toml"),
      [
        "[mcp_servers.fixture]",
        "command = " + JSON.stringify(process.execPath),
        "args = [" + JSON.stringify(fixture) + "]",
        "cwd = " + JSON.stringify(root),
        'enabled_tools = ["echo", "read_env"]',
        'env_vars = [{ name = "FIXTURE_FROM_HOST", source = "local" }]',
        "startup_timeout_ms = 10000",
        "tool_timeout_sec = 10",
        "",
        "[mcp_servers.fixture.env]",
        "FIXTURE_SECRET = " + JSON.stringify(secret)
      ].join("\n")
    );

    const config = baseConfig(root, true);
    const servers = listMcpServers(config, root);
    expect(servers.servers).toHaveLength(1);
    expect(servers.servers[0]).toMatchObject({
      name: "fixture",
      enabled: true,
      transport: "stdio",
      envKeys: ["FIXTURE_SECRET"],
      envVars: ["FIXTURE_FROM_HOST"],
      enabledTools: ["echo", "read_env"],
      startupTimeoutMs: 10000
    });
    expect(JSON.stringify(servers)).not.toContain(secret);

    const tools = await listMcpTools(config, "fixture", root);
    expect(tools.instructions).toBe("Fixture instructions");
    expect(tools.tools.map((tool) => tool.name)).toEqual(["echo", "read_env"]);

    const envCalled = await callMcpTool(config, "fixture", "read_env", {}, root);
    expect(JSON.stringify(envCalled.result)).toContain("forwarded-host-value");

    const called = await callMcpTool(
      config,
      "fixture",
      "echo",
      { text: "hello" },
      root
    );
    expect(JSON.stringify(called.result)).toContain("hello");
    await expect(
      callMcpTool(config, "fixture", "hidden", {}, root)
    ).rejects.toThrow(/not enabled or does not exist/);
  });
});
