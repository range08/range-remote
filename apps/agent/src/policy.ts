import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentConfig } from "@range-remote/shared";

const sensitiveDirNames = new Set([".ssh", ".gnupg", ".aws", ".kube"]);
const sensitiveFileNames = new Set([
  ".env",
  "id_rsa",
  "id_ed25519",
  "credentials",
  "credentials.json",
  "service-account.json"
]);

export function assertAllowedPath(
  input: string,
  config: AgentConfig,
  options: { forWrite?: boolean } = {}
): string {
  if (!isAbsolute(input)) throw new Error("Path must be absolute");
  const absolute = resolve(input);

  const targetForRealpath =
    options.forWrite && !existsSync(absolute) ? dirname(absolute) : absolute;
  const real = realpathSync(targetForRealpath);
  const finalPath =
    options.forWrite && !existsSync(absolute) ? resolve(real, basename(absolute)) : real;

  const allowed = config.allowedRoots.some((root) => isWithin(finalPath, realpathSync(root)));
  if (!allowed) throw new Error("Path is outside the allowed roots");

  if (!config.allowSensitiveFiles && isSensitive(finalPath)) {
    throw new Error("Sensitive credential path is blocked by local policy");
  }

  return finalPath;
}

function isWithin(target: string, root: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function isSensitive(target: string): boolean {
  const parts = target.split(/[\\/]+/);
  if (parts.some((part) => sensitiveDirNames.has(part.toLowerCase()))) return true;

  const name = basename(target).toLowerCase();
  if (sensitiveFileNames.has(name)) return true;
  if (name.startsWith(".env.")) return true;
  return name.endsWith(".pem") || name.endsWith(".key") || name.endsWith(".p12") || name.endsWith(".pfx");
}
