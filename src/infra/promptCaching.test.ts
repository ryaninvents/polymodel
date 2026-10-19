import type { LanguageModelMiddleware } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import {
  createPromptCachingMiddleware,
  type PromptCachingOptions,
} from "./promptCaching.ts";

type CallParams = Parameters<
  NonNullable<LanguageModelMiddleware["transformParams"]>
>[0]["params"];

async function transform(
  options: PromptCachingOptions,
  params: Partial<CallParams> = {},
  modelId = "claude-opus-5-5",
) {
  const transformParams =
    createPromptCachingMiddleware(options).transformParams;
  if (!transformParams) throw new Error("transformParams is missing");
  return transformParams({
    type: "stream",
    params: { prompt: [], ...params },
    model: new MockLanguageModelV4({ modelId }),
  });
}

describe("createPromptCachingMiddleware", () => {
  it("requests ephemeral caching when the caller hasn't", async () => {
    const params = await transform(
      { providerKey: "anthropic", ttl: "1h" },
      { providerOptions: { anthropic: { sendReasoning: true } } },
    );

    expect(params.providerOptions).toEqual({
      anthropic: {
        sendReasoning: true,
        cacheControl: { type: "ephemeral", ttl: "1h" },
      },
    });
  });

  it("respects an explicit cacheControl", async () => {
    const explicit = {
      openrouter: { cacheControl: { type: "ephemeral" } },
    };

    const params = await transform(
      { providerKey: "openrouter", ttl: "5m" },
      { providerOptions: explicit },
    );

    expect(params.providerOptions).toBe(explicit);
  });

  it("skips models the filter rejects", async () => {
    const params = await transform(
      {
        providerKey: "openrouter",
        ttl: "5m",
        appliesTo: (id) => id.startsWith("anthropic/"),
      },
      {},
      "openai/gpt-5",
    );

    expect(params.providerOptions).toBeUndefined();
  });
});
