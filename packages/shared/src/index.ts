import { z } from "zod";

export const RpcRequestSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "system_info",
    "list_directory",
    "read_file",
    "write_file",
    "git_status",
    "git_diff",
    "run_command"
  ]),
  params: z.record(z.string(), z.unknown())
});

export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcResponseSchema = z.object({
  id: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional()
});

export type RpcResponse = z.infer<typeof RpcResponseSchema>;

export const PairRequestSchema = z.object({
  code: z.string().regex(/^[A-Z2-9]{6}-[A-Z2-9]{6}$/),
  name: z.string().trim().min(1).max(80)
});

export type PairRequest = z.infer<typeof PairRequestSchema>;

export const AgentConfigSchema = z.object({
  server: z.string().url(),
  deviceId: z.string().uuid(),
  deviceToken: z.string().min(32),
  name: z.string().min(1).max(80),
  allowedRoots: z.array(z.string().min(1)).min(1),
  allowShell: z.boolean(),
  allowSensitiveFiles: z.boolean(),
  maxReadBytes: z.number().int().positive().max(16 * 1024 * 1024),
  maxWriteBytes: z.number().int().positive().max(16 * 1024 * 1024),
  maxCommandOutputBytes: z.number().int().positive().max(16 * 1024 * 1024),
  maxCommandSeconds: z.number().int().positive().max(600)
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
