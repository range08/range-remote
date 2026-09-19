import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentConfig } from "@range-remote/shared";
import { assertAllowedPath } from "./policy.js";

function config(root: string): AgentConfig {
  return {
    server: "https://example.com",
    deviceId: crypto.randomUUID(),
    deviceToken: "token",
    name: "test",
    allowedRoots: [root],
    allowShell: false,
    allowSensitiveFiles: false,
    maxReadBytes: 1024,
    maxWriteBytes: 1024,
    maxCommandOutputBytes: 1024,
    maxCommandSeconds: 10
  };
}

describe("path policy", () => {
  it("allows a normal file under a configured root", () => {
    const root = mkdtempSync(join(tmpdir(), "rr-"));
    const file = join(root, "hello.txt");
    writeFileSync(file, "hello");
    expect(assertAllowedPath(file, config(root))).toBe(file);
  });

  it("blocks .env by default", () => {
    const root = mkdtempSync(join(tmpdir(), "rr-"));
    const file = join(root, ".env");
    writeFileSync(file, "SECRET=x");
    expect(() => assertAllowedPath(file, config(root))).toThrow(/Sensitive/);
  });

  it("allows documented environment templates", () => {
    const root = mkdtempSync(join(tmpdir(), "rr-"));
    const file = join(root, ".env.example");
    writeFileSync(file, "API_URL=https://example.com");
    expect(assertAllowedPath(file, config(root))).toBe(file);
  });

  it("blocks OCI credential directories by default", () => {
    const root = mkdtempSync(join(tmpdir(), "rr-"));
    const dir = join(root, ".oci");
    mkdirSync(dir);
    const file = join(dir, "config");
    writeFileSync(file, "user=secret");
    expect(() => assertAllowedPath(file, config(root))).toThrow(/Sensitive/);
  });

  it("blocks traversal outside an allowed root", () => {
    const root = mkdtempSync(join(tmpdir(), "rr-"));
    const outside = mkdtempSync(join(tmpdir(), "rr-out-"));
    const file = join(outside, "x.txt");
    writeFileSync(file, "x");
    expect(() => assertAllowedPath(file, config(root))).toThrow(/outside/);
  });

  it("allows creating a new file under the root", () => {
    const root = mkdtempSync(join(tmpdir(), "rr-"));
    const dir = join(root, "nested");
    mkdirSync(dir);
    const file = join(dir, "new.txt");
    expect(assertAllowedPath(file, config(root), { forWrite: true })).toBe(file);
  });
});
