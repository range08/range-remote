import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  buildPowerShellArguments,
  resolveAgentEntrypoint,
  resolveWindowsServiceScript
} from "./windows-service.js";

describe("Windows service helpers", () => {
  it("resolves the compiled agent when invoked from source", () => {
    const modulePath = resolve("repo", "apps", "agent", "src", "windows-service.ts");
    expect(resolveAgentEntrypoint(modulePath)).toBe(
      resolve("repo", "apps", "agent", "dist", "index.js")
    );
  });

  it("keeps the compiled entrypoint beside the compiled helper", () => {
    const modulePath = resolve("repo", "apps", "agent", "dist", "windows-service.js");
    expect(resolveAgentEntrypoint(modulePath)).toBe(
      resolve("repo", "apps", "agent", "dist", "index.js")
    );
  });

  it("resolves the PowerShell service helper from either source or dist", () => {
    const sourcePath = resolve("repo", "apps", "agent", "src", "windows-service.ts");
    const distPath = resolve("repo", "apps", "agent", "dist", "windows-service.js");
    const expected = resolve("repo", "scripts", "windows-service.ps1");

    expect(resolveWindowsServiceScript(sourcePath)).toBe(expected);
    expect(resolveWindowsServiceScript(distPath)).toBe(expected);
  });

  it("passes service parameters as separate PowerShell arguments", () => {
    expect(
      buildPowerShellArguments(
        "C:\\Repo With Spaces\\scripts\\windows-service.ps1",
        "install",
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\Repo With Spaces\\apps\\agent\\dist\\index.js",
        "C:\\Users\\Range\\.config\\range-remote\\config.json"
      )
    ).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\Repo With Spaces\\scripts\\windows-service.ps1",
      "-Action",
      "install",
      "-NodePath",
      "C:\\Program Files\\nodejs\\node.exe",
      "-AgentPath",
      "C:\\Repo With Spaces\\apps\\agent\\dist\\index.js",
      "-ConfigPath",
      "C:\\Users\\Range\\.config\\range-remote\\config.json"
    ]);
  });
});
