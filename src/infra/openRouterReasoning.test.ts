import type { LanguageModelMiddleware } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { openRouterReasoningMiddleware } from "./openRouterReasoning.ts";

type CallParams = Parameters<
  NonNullable<LanguageModelMiddleware["transformParams"]>
>[0]["params"];

async function transform(params: Partial<CallParams>) {
  const transformParams = openRouterReasoningMiddleware.transformParams;
  if (!transformParams) throw new Error("transformParams is missing");
  return transformParams({
    type: "stream",
    params: { prompt: [], ...params },
    model: new MockLanguageModelV4(),
  });
}

describe("openRouterReasoningMiddleware", () => {
  it("moves the reasoning effort into OpenRouter's provider options", async () => {
    const params = await transform({
      reasoning: "none",
      providerOptions: { openrouter: { user: "u" } },
    });

    expect(params.providerOptions).toEqual({
      openrouter: { user: "u", reasoning: { effort: "none" } },
    });
  });

  it("maps max to OpenRouter's highest effort", async () => {
    const params = await transform({ reasoning: "max" });

    expect(params.providerOptions?.openrouter?.reasoning).toEqual({
      effort: "xhigh",
    });
  });

  it("leaves explicit OpenRouter reasoning and provider defaults alone", async () => {
    const explicit = { openrouter: { reasoning: { max_tokens: 100 } } };

    expect(
      (await transform({ reasoning: "low", providerOptions: explicit }))
        .providerOptions,
    ).toBe(explicit);
    expect(
      (await transform({ reasoning: "provider-default" })).providerOptions,
    ).toBeUndefined();
  });
});
