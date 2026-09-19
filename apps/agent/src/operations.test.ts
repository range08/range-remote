import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentConfig, RpcRequest } from "@range-remote/shared";
import { execute } from "./operations.js";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

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

  it("blocks git diff in restricted mode unless sensitive files are explicitly allowed", async () => {
    const root = mkdtempSync(join(tmpdir(), "rr-git-"));
    const request: RpcRequest = {
      id: "git-diff-blocked",
      kind: "git_diff",
      params: { cwd: root }
    };
    await expect(execute(request, baseConfig(root))).rejects.toThrow(/tracked diffs can expose sensitive/);
  });

  it("scopes restricted git status and diff to the allowed working subtree", async () => {
    const repo = mkdtempSync(join(tmpdir(), "rr-git-"));
    const allowed = join(repo, "allowed");
    mkdirSync(allowed);
    writeFileSync(join(allowed, "inside.txt"), "one\n");
    writeFileSync(join(repo, "outside.txt"), "one\n");
    git(repo, ["init"]);
    git(repo, ["add", "."]);
    git(repo, ["-c", "user.name=Range Remote", "-c", "user.email=test@example.com", "commit", "-m", "init"]);
    writeFileSync(join(allowed, "inside.txt"), "two\n");
    writeFileSync(join(repo, "outside.txt"), "two\n");

    const restricted = { ...baseConfig(allowed), allowSensitiveFiles: true };
    const status = await execute({
      id: "git-status-scoped",
      kind: "git_status",
      params: { cwd: allowed }
    }, restricted) as { stdout: string };
    expect(status.stdout).toContain("inside.txt");
    expect(status.stdout).not.toContain("outside.txt");

    const diff = await execute({
      id: "git-diff-scoped",
      kind: "git_diff",
      params: { cwd: allowed }
    }, restricted) as { stdout: string };
    expect(diff.stdout).toContain("inside.txt");
    expect(diff.stdout).not.toContain("outside.txt");
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
