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

export type AgentConfig = {
  server: string;
  deviceId: string;
  deviceToken: string;
  name: string;
  allowedRoots: string[];
  allowShell: boolean;
  allowSensitiveFiles: boolean;
  maxReadBytes: number;
  maxWriteBytes: number;
  maxCommandOutputBytes: number;
  maxCommandSeconds: number;
};
