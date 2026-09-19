import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentConfig, RpcRequest } from "@range-remote/shared";
import { execute } from "./operations.js";

function baseConfig(root: string): AgentConfig {
  return {
    server: "https://example.com",
    deviceId: crypto.randomUUID(),
    deviceToken: "x".repeat(32),
    name: "test",
    unrestricted: false,
    allowedRoots: [root],
    allowShell: false,
    allowSensitiveFiles: false,
    maxReadBytes: 1024,
    maxWriteBytes: 1024,
    maxCommandOutputBytes: 4096,
    maxCommandSeconds: 10
  };
}

describe("agent operations", () => {
  it("keeps shell disabled in restricted mode", async () => {
    const root = mkdtempSync(join(tmpdir(), "rr-op-"));
    const request: RpcRequest = {
      id: "1",
      kind: "run_command",
      params: { cwd: root, command: "node --version" }
    };
    await expect(execute(request, baseConfig(root))).rejects.toThrow(/disabled/);
  });

  it("runs shell and preserves the process environment in unrestricted mode", async () => {
    const root = mkdtempSync(join(tmpdir(), "rr-op-"));
    process.env.RANGE_REMOTE_UNRESTRICTED_TEST = "visible";
    const request: RpcRequest = {
      id: "2",
      kind: "run_command",
      params: {
        cwd: root,
        command: 'node -p "process.env.RANGE_REMOTE_UNRESTRICTED_TEST"'
      }
    };
    const result = await execute(request, {
      ...baseConfig(root),
      unrestricted: true,
      allowedRoots: [],
      allowShell: false,
      allowSensitiveFiles: false
    }) as { stdout: string; exitCode: number };

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("visible");
    delete process.env.RANGE_REMOTE_UNRESTRICTED_TEST;
  });
});
