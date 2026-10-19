import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ProviderConfig } from "#types";
import { assertNever } from "#util";
import type { Env } from "./env.ts";

type ModelProvider = { languageModel(modelId: string): LanguageModel };

export class ModelReferenceError extends Error {
  readonly code = "MODEL_REFERENCE_INVALID" as const;
  constructor(reference: string, knownProviders: ReadonlyArray<string>) {
    super(
      `Invalid model reference "${reference}". Expected "<provider>:<model>" where provider is one of: ${knownProviders.join(", ") || "(none configured)"}`,
    );
    this.name = "ModelReferenceError";
  }
}

function createProvider(
  name: string,
  config: ProviderConfig,
  env: Env,
): ModelProvider {
  const apiKey =
    config.apiKey === undefined ? undefined : env.resolveSecret(config.apiKey);
  switch (config.type) {
    case "openai-compatible":
      return createOpenAICompatible({
        name,
        baseURL: config.baseURL,
        apiKey,
        headers: config.headers,
        includeUsage: true,
      });
    case "anthropic":
      return createAnthropic({ baseURL: config.baseURL, apiKey });
    case "openai":
      return createOpenAI({ baseURL: config.baseURL, apiKey });
    default:
      return assertNever(config);
  }
}

/** Turns `"<provider>:<model>"` references into AI SDK language models. */
export function createModelResolver(
  providers: Readonly<Record<string, ProviderConfig>>,
  env: Env,
): (reference: string) => LanguageModel {
  const instances = new Map(
    Object.entries(providers).map(([name, config]) => [
      name,
      createProvider(name, config, env),
    ]),
  );
  return (reference) => {
    const separator = reference.indexOf(":");
    const provider =
      separator > 0 ? instances.get(reference.slice(0, separator)) : undefined;
    const modelId = reference.slice(separator + 1);
    if (!provider || !modelId)
      throw new ModelReferenceError(reference, [...instances.keys()]);
    return provider.languageModel(modelId);
  };
}
