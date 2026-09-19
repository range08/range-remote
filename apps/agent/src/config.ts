import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AgentConfigSchema, type AgentConfig } from "@range-remote/shared";

export const configPath =
  process.env.RANGE_REMOTE_CONFIG ??
  join(homedir(), ".config", "range-remote", "config.json");

export function loadConfig(): AgentConfig {
  return AgentConfigSchema.parse(JSON.parse(readFileSync(configPath, "utf8")));
}

export function saveConfig(config: AgentConfig): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(configPath, 0o600);
  } catch {
    // Windows does not implement POSIX permissions in the same way.
  }
}
