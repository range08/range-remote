import { execFile } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { hostname, platform, release, arch } from "node:os";
import { promisify } from "node:util";
import type { AgentConfig, RpcRequest } from "@range-remote/shared";
import { assertAllowedPath } from "./policy.js";

const execFileAsync = promisify(execFile);

export async function execute(request: RpcRequest, config: AgentConfig): Promise<unknown> {
  switch (request.kind) {
    case "system_info":
      return {
        hostname: hostname(),
        platform: platform(),
        release: release(),
        arch: arch(),
        node: process.version
      };

    case "list_directory": {
      const path = assertAllowedPath(asString(request.params.path), config);
      const limit = Math.min(asNumber(request.params.limit, 200), 500);
      return {
        path,
        entries: readdirSync(path, { withFileTypes: true }).slice(0, limit).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other"
        }))
      };
    }

    case "read_file": {
      const path = assertAllowedPath(asString(request.params.path), config);
      const stat = lstatSync(path);
      if (!stat.isFile()) throw new Error("Path is not a regular file");
      const requested = asOptionalNumber(request.params.maxBytes) ?? config.maxReadBytes;
      const limit = Math.min(requested, config.maxReadBytes);
      if (stat.size > limit) throw new Error(`File exceeds read limit of ${limit} bytes`);
      return { path, content: readFileSync(path, "utf8"), bytes: stat.size };
    }

    case "write_file": {
      const path = assertAllowedPath(asString(request.params.path), config, { forWrite: true });
      const content = asString(request.params.content);
      const overwrite = asBoolean(request.params.overwrite, false);
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > config.maxWriteBytes) throw new Error(`Content exceeds write limit of ${config.maxWriteBytes} bytes`);
      if (existsSync(path) && !overwrite) throw new Error("File already exists; set overwrite=true to replace it");
      writeFileSync(path, content, { encoding: "utf8", flag: overwrite ? "w" : "wx" });
      return { path, bytes, overwritten: overwrite };
    }

    case "git_status":
      return runGit(config, asString(request.params.cwd), ["status", "--short", "--branch"]);

    case "git_diff": {
      const cwd = asString(request.params.cwd);
      const staged = asBoolean(request.params.staged, false);
      const maxBytes = Math.min(asNumber(request.params.maxBytes, 262_144), config.maxCommandOutputBytes);
      return runGit(config, cwd, ["diff", ...(staged ? ["--cached"] : [])], maxBytes);
    }

    case "run_command": {
      if (!config.allowShell) throw new Error("Shell execution is disabled by local policy");
      const cwd = assertAllowedPath(asString(request.params.cwd), config);
      const command = asString(request.params.command);
      const timeoutSeconds = Math.min(asNumber(request.params.timeoutSeconds, 30), config.maxCommandSeconds);
      return runShell(command, cwd, timeoutSeconds, config.maxCommandOutputBytes);
    }
  }
}

async function runGit(config: AgentConfig, cwdInput: string, args: string[], maxBytes = config.maxCommandOutputBytes) {
  const cwd = assertAllowedPath(cwdInput, config);
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    timeout: config.maxCommandSeconds * 1000,
    maxBuffer: maxBytes
  });
  return { cwd, stdout, stderr, exitCode: 0 };
}

async function runShell(command: string, cwd: string, timeoutSeconds: number, maxBytes: number) {
  const shell =
    process.platform === "win32"
      ? { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", command] }
      : { file: "/bin/bash", args: ["-lc", command] };

  try {
    const { stdout, stderr } = await execFileAsync(shell.file, shell.args, {
      cwd,
      timeout: timeoutSeconds * 1000,
      maxBuffer: maxBytes,
      env: sanitizedEnvironment()
    });
    return { cwd, stdout, stderr, exitCode: 0 };
  } catch (error) {
    const e = error as Error & { stdout?: string; stderr?: string; code?: number | string };
    return {
      cwd,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message,
      exitCode: typeof e.code === "number" ? e.code : 1
    };
  }
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SystemRoot", "ComSpec"];
  return Object.fromEntries(keep.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
}

function asString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("Expected non-empty string");
  return value;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
