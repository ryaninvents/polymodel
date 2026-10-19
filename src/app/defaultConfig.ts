import { plannerExecutor } from "#domain";
import type { Env } from "#infra";
import type { PolymodelConfigInput } from "#types";

/** Used when no config file exists: one Opus→Haiku polymodel routed through LiteLLM. */
export function createDefaultConfig(env: Env): PolymodelConfigInput {
  const {
    LITELLM_BASE_URL,
    LITELLM_API_KEY,
    POLYMODEL_PLANNER_MODEL,
    POLYMODEL_EXECUTOR_MODEL,
  } = env.values;
  return {
    providers: {
      litellm: {
        type: "openai-compatible",
        baseURL: LITELLM_BASE_URL,
        ...(LITELLM_API_KEY && { apiKey: { env: "LITELLM_API_KEY" } }),
      },
    },
    models: {
      "opus-haiku": plannerExecutor({
        planner: `litellm:${POLYMODEL_PLANNER_MODEL}`,
        executor: `litellm:${POLYMODEL_EXECUTOR_MODEL}`,
      }),
    },
  };
}
