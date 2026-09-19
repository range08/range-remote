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

describe("tool call observation", () => {
  it("records only safe call metadata and marks MCP error results as failures", async () => {
    let registeredHandler: ((args: unknown) => Promise<unknown>) | undefined;
    const observations: Array<Record<string, unknown>> = [];
    const fakeServer = {
      registerTool: (_name: string, _config: unknown, handler: (args: unknown) => Promise<unknown>) => {
        registeredHandler = handler;
      },
      server: { setRequestHandler: () => undefined }
    };
    const registry = createOpenAiToolRegistry(
      fakeServer as any,
      [{ type: "oauth2", scopes: ["remote:use"] }],
      (observation) => observations.push(observation)
    );
    registry.register("read_file", {
      title: "Read",
      description: "Read"
    }, async () => ({ content: [], isError: true }));

    expect(registeredHandler).toBeDefined();
    await registeredHandler!({
      device: "device-1",
      path: "/workspace/example.txt",
      marker: "payload-value"
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      name: "read_file",
      deviceId: "device-1",
      success: false
    });
    expect(typeof observations[0]?.durationMs).toBe("number");
    expect(JSON.stringify(observations[0])).not.toContain("/workspace/example.txt");
    expect(JSON.stringify(observations[0])).not.toContain("payload-value");
  });
});
