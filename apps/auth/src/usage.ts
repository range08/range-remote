import { z } from "zod";
import { config } from "./config.js";

const UsageStatsSchema = z.object({
  period: z.object({
    timezone: z.string(),
    monthStart: z.string(),
    generatedAt: z.string()
  }),
  trackingSince: z.string().nullable(),
  thisMonth: z.object({
    calls: z.number().int().nonnegative(),
    successes: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(1),
    avgDurationMs: z.number().int().nonnegative()
  }),
  todayCalls: z.number().int().nonnegative(),
  totalCalls: z.number().int().nonnegative(),
  activeDays: z.number().int().nonnegative(),
  topTools: z.array(z.object({
    name: z.string(),
    calls: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(1),
    avgDurationMs: z.number().int().nonnegative()
  })),
  daily: z.array(z.object({
    date: z.string(),
    calls: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative()
  })),
  recent: z.array(z.object({
    at: z.string(),
    toolName: z.string(),
    deviceId: z.string().nullable(),
    deviceName: z.string().nullable(),
    durationMs: z.number().int().nonnegative(),
    success: z.boolean()
  }))
});

export type UsageStats = z.infer<typeof UsageStatsSchema>;

export async function fetchUsageStats(userSub: string): Promise<UsageStats> {
  const url = new URL("/internal/usage", config.mcpInternalUrl);
  url.searchParams.set("userSub", userSub);
  const response = await fetch(url, {
    headers: {
      "x-range-remote-internal-token": config.internalApiToken
    },
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) {
    throw new Error("Usage service returned HTTP " + response.status);
  }
  return UsageStatsSchema.parse(await response.json());
}
