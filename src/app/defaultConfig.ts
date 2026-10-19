import { workerBee } from "#domain";
import { PROVIDER_CATALOG, type Env } from "#infra";
import type { PolymodelConfigInput } from "#types";

// openai-compatible needs a base URL, which only a config file provides.
const CANDIDATES = [
  PROVIDER_CATALOG.anthropic,
  PROVIDER_CATALOG.openrouter,
  PROVIDER_CATALOG.openai,
] as const;

export class NoProviderError extends Error {
  readonly code = "NO_PROVIDER" as const;
  constructor() {
    const variables = CANDIDATES.map(({ apiKeyEnv }) => apiKeyEnv);
    super(
      `No config file and no provider credentials found (looked for ${variables.join(", ")}). Run \`polymodel setup\`.`,
    );
    this.name = "NoProviderError";
  }
}

/**
 * Used when no config file exists: one worker-bee polymodel on the first
 * provider whose API key is available.
 */
export function createDefaultConfig(env: Env): PolymodelConfigInput {
  const kind = CANDIDATES.find(({ apiKeyEnv }) => env.lookup(apiKeyEnv));
  if (!kind) throw new NoProviderError();

  const { POLYMODEL_PLANNER_MODEL, POLYMODEL_WORKER_MODEL } = env.values;
  const name = kind.defaultName;
  return {
    providers: {
      [name]: { type: kind.type, apiKey: { env: kind.apiKeyEnv } },
    },
    models: {
      "worker-bee": workerBee({
        planner: `${name}:${POLYMODEL_PLANNER_MODEL ?? kind.suggestedModels.planner}`,
        worker: `${name}:${POLYMODEL_WORKER_MODEL ?? kind.suggestedModels.worker}`,
      }),
    },
  };
}
