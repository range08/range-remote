import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export type OAuthSecurityScheme = {
  type: "oauth2";
  scopes: string[];
};

type ToolConfig = {
  title: string;
  description: string;
  inputSchema?: z.ZodType;
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
  annotations?: ToolConfig["annotations"];
  securitySchemes: OAuthSecurityScheme[];
  _meta: Record<string, unknown>;
};

export function createOpenAiToolRegistry(
  server: McpServer,
  securitySchemes: OAuthSecurityScheme[]
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
        annotations: config.annotations,
        _meta: meta
      } as any,
      handler as any
    );

    const inputSchema = config.inputSchema
      ? z.toJSONSchema(config.inputSchema)
      : { type: "object", properties: {}, additionalProperties: false };

    descriptors.push({
      name,
      title: config.title,
      description: config.description,
      inputSchema: inputSchema as Record<string, unknown>,
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
