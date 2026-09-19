import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export type ToolCallObservation = {
  name: string;
  deviceId?: string;
  durationMs: number;
  success: boolean;
};

export type OAuthSecurityScheme = {
  type: "oauth2";
  scopes: string[];
};

type ToolConfig = {
  title: string;
  description: string;
  inputSchema?: z.ZodType;
  outputSchema?: z.ZodType;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  _meta?: Record<string, unknown>;
};

type ToolDescriptor = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolConfig["annotations"];
  securitySchemes: OAuthSecurityScheme[];
  _meta: Record<string, unknown>;
};

export function createOpenAiToolRegistry(
  server: McpServer,
  securitySchemes: OAuthSecurityScheme[],
  onToolCall?: (observation: ToolCallObservation) => void
) {
  const descriptors: ToolDescriptor[] = [];

  function register(
    name: string,
    config: ToolConfig,
    handler: (args: any) => unknown | Promise<unknown>
  ): void {
    const meta = {
      ...config._meta,
      securitySchemes
    };

    server.registerTool(
      name,
      {
        title: config.title,
        description: config.description,
        inputSchema: config.inputSchema,
        outputSchema: config.outputSchema,
        annotations: config.annotations,
        _meta: meta
      } as any,
      (async (args: unknown) => {
        const startedAt = performance.now();
        let success = false;
        try {
          const result = await handler(args);
          success = !(
            typeof result === "object" &&
            result !== null &&
            "isError" in result &&
            result.isError === true
          );
          return result;
        } finally {
          if (onToolCall) {
            try {
              const record =
                typeof args === "object" && args !== null && !Array.isArray(args)
                  ? args as Record<string, unknown>
                  : {};
              onToolCall({
                name,
                ...(typeof record.device === "string"
                  ? { deviceId: record.device }
                  : {}),
                durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
                success
              });
            } catch {
              // Usage analytics must never break the requested tool call.
            }
          }
        }
      }) as any
    );

    const inputSchema = config.inputSchema
      ? z.toJSONSchema(config.inputSchema)
      : { type: "object", properties: {}, additionalProperties: false };
    const outputSchema = config.outputSchema
      ? z.toJSONSchema(config.outputSchema)
      : undefined;

    descriptors.push({
      name,
      title: config.title,
      description: config.description,
      inputSchema: inputSchema as Record<string, unknown>,
      ...(outputSchema ? { outputSchema: outputSchema as Record<string, unknown> } : {}),
      ...(config.annotations ? { annotations: config.annotations } : {}),
      securitySchemes,
      _meta: meta
    });
  }

  function installListCompatibility(): void {
    const lowLevelServer = server.server as any;
    lowLevelServer.setRequestHandler("tools/list", async () => ({ tools: descriptors }));
  }

  return { register, installListCompatibility };
}
