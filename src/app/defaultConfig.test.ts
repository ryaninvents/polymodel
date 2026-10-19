import { describe, expect, it } from "vitest";
import { createEnv } from "#infra";
import { createDefaultConfig, NoProviderError } from "./defaultConfig.ts";

describe("createDefaultConfig", () => {
  it("uses the first provider with an API key", () => {
    const config = createDefaultConfig(
      createEnv({ OPENAI_API_KEY: "sk", OPENROUTER_API_KEY: "sk-or" }),
    );

    expect(config.providers).toEqual({
      openrouter: { type: "openrouter", apiKey: { env: "OPENROUTER_API_KEY" } },
    });
    expect(config.models["worker-bee"]?.description).toBe(
      "Plans with openrouter:anthropic/claude-opus-5.5, delegates to openrouter:anthropic/claude-haiku-5.5",
    );
  });

  it("applies model overrides from the environment", () => {
    const config = createDefaultConfig(
      createEnv({
        ANTHROPIC_API_KEY: "sk-ant",
        POLYMODEL_PLANNER_MODEL: "claude-sonnet-5-5",
      }),
    );

    expect(config.models["worker-bee"]?.description).toBe(
      "Plans with anthropic:claude-sonnet-5-5, delegates to anthropic:claude-haiku-5-5",
    );
  });

  it("points at setup when no credentials exist", () => {
    expect(() => createDefaultConfig(createEnv({}))).toThrow(NoProviderError);
  });
});
