import { streamText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelProvider } from "./providerCatalog.ts";

function captureRequestBody(): {
  fetch: typeof globalThis.fetch;
  body: () => unknown;
} {
  let body: unknown;
  return {
    fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return new Response("upstream unavailable", { status: 500 });
    },
    body: () => body,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openrouter provider", () => {
  it("sends the requested reasoning effort upstream", async () => {
    const capture = captureRequestBody();
    vi.stubGlobal("fetch", capture.fetch);
    const provider = createModelProvider(
      "openrouter",
      { type: "openrouter" },
      "key",
    );
    await streamText({
      model: provider.languageModel("some/model"),
      prompt: "hi",
      reasoning: "none",
      maxRetries: 0,
      // Only the request body matters; the stubbed upstream always fails.
      onError: () => {},
    }).consumeStream();

    expect(capture.body()).toMatchObject({ reasoning: { effort: "none" } });
  });
});

describe("prompt caching", () => {
  async function requestBodyFor(
    config: Parameters<typeof createModelProvider>[1],
    modelId: string,
  ) {
    const capture = captureRequestBody();
    vi.stubGlobal("fetch", capture.fetch);
    const provider = createModelProvider("p", config, "key");
    await streamText({
      model: provider.languageModel(modelId),
      prompt: "hi",
      maxRetries: 0,
      onError: () => {},
    }).consumeStream();
    return capture.body();
  }

  it("asks Anthropic for caching by default", async () => {
    expect(
      await requestBodyFor({ type: "anthropic" }, "claude-opus-5-5"),
    ).toMatchObject({ cache_control: { type: "ephemeral", ttl: "5m" } });
  });

  it("asks OpenRouter for caching on Anthropic models only", async () => {
    expect(
      await requestBodyFor({ type: "openrouter" }, "anthropic/claude-opus-5.5"),
    ).toMatchObject({ cache_control: { type: "ephemeral", ttl: "5m" } });
    expect(
      await requestBodyFor({ type: "openrouter" }, "openai/gpt-5"),
    ).not.toHaveProperty("cache_control");
  });

  it("can be turned off or given a longer TTL", async () => {
    expect(
      await requestBodyFor(
        { type: "anthropic", promptCaching: false },
        "claude-opus-5-5",
      ),
    ).not.toHaveProperty("cache_control");
    expect(
      await requestBodyFor(
        { type: "anthropic", promptCaching: { ttl: "1h" } },
        "claude-opus-5-5",
      ),
    ).toMatchObject({ cache_control: { ttl: "1h" } });
  });
});
