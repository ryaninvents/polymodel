import type { LanguageModel } from "ai";
import type { ProviderConfig } from "#types";
import type { Env } from "./env.ts";
import { createModelProvider } from "./providerCatalog.ts";

export class ModelReferenceError extends Error {
  readonly code = "MODEL_REFERENCE_INVALID" as const;
  constructor(reference: string, knownProviders: ReadonlyArray<string>) {
    super(
      `Invalid model reference "${reference}". Expected "<provider>:<model>" where provider is one of: ${knownProviders.join(", ") || "(none configured)"}`,
    );
    this.name = "ModelReferenceError";
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
      createModelProvider(
        name,
        config,
        config.apiKey === undefined
          ? undefined
          : env.resolveSecret(config.apiKey),
      ),
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
