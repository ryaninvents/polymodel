import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { wrapLanguageModel, type LanguageModel } from "ai";
import type { ProviderConfig, ProviderType } from "#types";
import { assertNever } from "#util";
import { openRouterReasoningMiddleware } from "./openRouterReasoning.ts";
import { createPromptCachingMiddleware } from "./promptCaching.ts";

const DEFAULT_CACHE_TTL = "5m";

function cachingTtl(config: { promptCaching?: false | { ttl: "5m" | "1h" } }) {
  return config.promptCaching === false
    ? undefined
    : (config.promptCaching?.ttl ?? DEFAULT_CACHE_TTL);
}

export type ModelProvider = { languageModel(modelId: string): LanguageModel };

type ConfigOf<type extends ProviderType> = Extract<
  ProviderConfig,
  { type: type }
>;

export type ProviderKind<type extends ProviderType> = {
  type: type;
  label: string;
  /** Name used for the provider in configs, i.e. the `<provider>` in `"<provider>:<model>"`. */
  defaultName: string;
  /** Conventional environment variable for the API key. */
  apiKeyEnv: string;
  /** Where a user creates an API key; setup can open it in the browser. */
  apiKeyPageURL?: string;
  /** Suggested planner/worker model ids for the default polymodel. */
  suggestedModels: Readonly<{ planner: string; worker: string }>;
  create(
    name: string,
    config: ConfigOf<type>,
    apiKey: string | undefined,
  ): ModelProvider;
};

type ProviderCatalog = { [type in ProviderType]: ProviderKind<type> };

/**
 * Everything polymodel knows about each provider type. The AI SDK provider
 * packages do the actual work; this only adds what setup and the built-in
 * default config need to pick sensible values.
 */
export const PROVIDER_CATALOG = {
  anthropic: {
    type: "anthropic",
    label: "Anthropic",
    defaultName: "anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    apiKeyPageURL: "https://console.anthropic.com/settings/keys",
    suggestedModels: {
      planner: "claude-opus-5-5",
      worker: "claude-haiku-5-5",
    },
    create: (_name, config, apiKey) => {
      const provider = createAnthropic({ baseURL: config.baseURL, apiKey });
      const ttl = cachingTtl(config);
      if (!ttl) return provider;
      const middleware = createPromptCachingMiddleware({
        providerKey: "anthropic",
        ttl,
      });
      return {
        languageModel: (modelId) =>
          wrapLanguageModel({
            model: provider.languageModel(modelId),
            middleware,
          }),
      };
    },
  },
  openrouter: {
    type: "openrouter",
    label: "OpenRouter",
    defaultName: "openrouter",
    apiKeyEnv: "OPENROUTER_API_KEY",
    apiKeyPageURL: "https://openrouter.ai/settings/keys",
    suggestedModels: {
      planner: "anthropic/claude-opus-5.5",
      worker: "anthropic/claude-haiku-5.5",
    },
    create: (_name, config, apiKey) => {
      const provider = createOpenRouter({ baseURL: config.baseURL, apiKey });
      const ttl = cachingTtl(config);
      // Other backends cache automatically and may not tolerate an unknown top-level field.
      const caching = ttl
        ? createPromptCachingMiddleware({
            providerKey: "openrouter",
            ttl,
            appliesTo: (modelId) => modelId.startsWith("anthropic/"),
          })
        : undefined;
      return {
        languageModel: (modelId) =>
          wrapLanguageModel({
            model: provider.languageModel(modelId),
            middleware: caching
              ? [openRouterReasoningMiddleware, caching]
              : openRouterReasoningMiddleware,
          }),
      };
    },
  },
  openai: {
    type: "openai",
    label: "OpenAI",
    defaultName: "openai",
    apiKeyEnv: "OPENAI_API_KEY",
    apiKeyPageURL: "https://platform.openai.com/api-keys",
    suggestedModels: { planner: "gpt-5", worker: "gpt-5-mini" },
    create: (_name, config, apiKey) =>
      createOpenAI({ baseURL: config.baseURL, apiKey }),
  },
  "openai-compatible": {
    type: "openai-compatible",
    label: "OpenAI-compatible endpoint (LiteLLM, vLLM, Ollama, …)",
    defaultName: "litellm",
    apiKeyEnv: "LITELLM_API_KEY",
    suggestedModels: {
      planner: "claude-opus-5-5",
      worker: "claude-haiku-5-5",
    },
    create: (name, config, apiKey) =>
      createOpenAICompatible({
        name,
        baseURL: config.baseURL,
        apiKey,
        headers: config.headers,
        includeUsage: true,
      }),
  },
} as const satisfies ProviderCatalog;

/** Order in which setup lists providers and the built-in default looks for credentials. */
export const PROVIDER_TYPES = [
  "anthropic",
  "openrouter",
  "openai",
  "openai-compatible",
] as const satisfies ReadonlyArray<ProviderType>;

export function createModelProvider(
  name: string,
  config: ProviderConfig,
  apiKey: string | undefined,
): ModelProvider {
  switch (config.type) {
    case "anthropic":
      return PROVIDER_CATALOG.anthropic.create(name, config, apiKey);
    case "openrouter":
      return PROVIDER_CATALOG.openrouter.create(name, config, apiKey);
    case "openai":
      return PROVIDER_CATALOG.openai.create(name, config, apiKey);
    case "openai-compatible":
      return PROVIDER_CATALOG["openai-compatible"].create(name, config, apiKey);
    default:
      return assertNever(config);
  }
}
