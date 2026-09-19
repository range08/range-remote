import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type WindowsServiceAction = "install" | "uninstall" | "start" | "stop" | "restart" | "status";

export function resolveAgentEntrypoint(modulePath: string): string {
  const directory = dirname(modulePath);
  return extname(modulePath) === ".ts"
    ? resolve(directory, "..", "dist", "index.js")
    : resolve(directory, "index.js");
}

export function resolveWindowsServiceScript(modulePath: string): string {
  return resolve(dirname(modulePath), "..", "..", "..", "scripts", "windows-service.ps1");
}

export function buildPowerShellArguments(
  scriptPath: string,
  action: WindowsServiceAction,
  nodePath: string,
  agentPath: string,
  configPath: string
): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-Action",
    action,
    "-NodePath",
    nodePath,
    "-AgentPath",
    agentPath,
    "-ConfigPath",
    configPath
  ];
}

export function runWindowsServiceCommand(action: WindowsServiceAction, configPath: string): void {
  if (process.platform !== "win32") {
    throw new Error("Windows service commands are available only on Windows");
  }

  const modulePath = fileURLToPath(import.meta.url);
  const scriptPath = resolveWindowsServiceScript(modulePath);
  const agentPath = resolveAgentEntrypoint(modulePath);

  if (!existsSync(scriptPath)) {
    throw new Error("Windows service helper was not found: " + scriptPath);
  }
  if (action === "install" && !existsSync(agentPath)) {
    throw new Error("Built agent was not found. Run npm run build before installing the service");
  }
  if (action === "install" && !existsSync(configPath)) {
    throw new Error("Pairing config was not found. Pair the device before installing the service");
  }

  const result = spawnSync(
    "powershell.exe",
    buildPowerShellArguments(scriptPath, action, process.execPath, agentPath, configPath),
    { stdio: "inherit", windowsHide: false }
  );

  if (result.error) {
    throw new Error("Failed to launch Windows service helper: " + result.error.message);
  }
  if (result.signal) {
    throw new Error("Windows service helper was terminated by signal " + result.signal);
  }
  if (result.status !== 0) {
    throw new Error("Windows service helper failed with exit code " + String(result.status));
  }
}
