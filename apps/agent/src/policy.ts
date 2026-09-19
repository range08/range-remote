import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentConfig } from "@range-remote/shared";

const sensitiveDirNames = new Set([
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".docker",
  ".kube",
  ".oci",
  ".terraform.d"
]);
const sensitiveFileNames = new Set([
  ".env",
  ".git-credentials",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "id_rsa",
  "id_ed25519",
  "credentials",
  "credentials.json",
  "service-account.json",
  "terraform.tfstate"
]);
const safeEnvTemplates = new Set([".env.example", ".env.sample", ".env.template"]);

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

  if (config.unrestricted) return finalPath;

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
  const normalized = target.replace(/\\/g, "/").toLowerCase();
  const parts = normalized.split("/");
  if (parts.some((part) => sensitiveDirNames.has(part))) return true;
  if (normalized.includes("/.config/gh/") || normalized.includes("/.config/gcloud/")) return true;

  const name = basename(normalized);
  if (safeEnvTemplates.has(name)) return false;
  if (sensitiveFileNames.has(name)) return true;
  if (name.startsWith(".env.")) return true;
  if (name.endsWith(".tfvars") || name.endsWith(".tfstate.backup")) return true;
  return name.endsWith(".pem") || name.endsWith(".key") || name.endsWith(".p12") || name.endsWith(".pfx");
}
