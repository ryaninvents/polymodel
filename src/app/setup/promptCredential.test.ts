import { describe, expect, it } from "vitest";
import { PROVIDER_CATALOG } from "#infra";
import { apiKeyVariable } from "./promptCredential.ts";

describe("apiKeyVariable", () => {
  it("uses the conventional variable for known providers", () => {
    expect(apiKeyVariable(PROVIDER_CATALOG.openrouter, "router")).toBe(
      "OPENROUTER_API_KEY",
    );
  });

  it("derives one from the name for OpenAI-compatible endpoints", () => {
    expect(
      apiKeyVariable(PROVIDER_CATALOG["openai-compatible"], "my-vllm"),
    ).toBe("MY_VLLM_API_KEY");
  });
});
