import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createOpenAiToolRegistry } from "./openai-compat.js";

describe("OpenAI tool compatibility", () => {
  it("exposes security schemes and annotations through tools/list", async () => {
    let listHandler: (() => Promise<unknown>) | undefined;
    const fakeServer = {
      registerTool: () => undefined,
      server: {
        setRequestHandler: (method: string, handler: () => Promise<unknown>) => {
          expect(method).toBe("tools/list");
          listHandler = handler;
        }
      }
    };

    const securitySchemes = [{ type: "oauth2" as const, scopes: ["remote:use"] }];
    const registry = createOpenAiToolRegistry(fakeServer as any, securitySchemes);
    registry.register("example", {
      title: "Example",
      description: "Example tool",
      outputSchema: z.object({ id: z.string().min(1) }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    }, async () => ({ content: [] }));
    registry.installListCompatibility();

    expect(listHandler).toBeDefined();
    const result = await listHandler!() as { tools: Array<Record<string, any>> };
    expect(result.tools[0]?.securitySchemes).toEqual(securitySchemes);
    expect(result.tools[0]?._meta?.securitySchemes).toEqual(securitySchemes);
    expect(result.tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(result.tools[0]?.outputSchema?.type).toBe("object");
    expect(result.tools[0]?.outputSchema?.properties?.id?.type).toBe("string");
    expect(result.tools[0]?.outputSchema?.required).toEqual(["id"]);
    expect(result.tools[0]?.outputSchema?.additionalProperties).toBe(false);
  });
});
