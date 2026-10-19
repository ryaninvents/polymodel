import type { LanguageModelMiddleware } from "ai";

type CallParams = Parameters<
  NonNullable<LanguageModelMiddleware["transformParams"]>
>[0]["params"];

type OpenRouterEffort =
  "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

function toOpenRouterEffort(
  reasoning: CallParams["reasoning"],
): OpenRouterEffort | undefined {
  if (reasoning === undefined || reasoning === "provider-default")
    return undefined;
  return reasoning === "max" ? "xhigh" : reasoning;
}

/**
 * The OpenRouter provider ignores the AI SDK's standard `reasoning` call option
 * and only reads `providerOptions.openrouter.reasoning`, so a requested effort
 * would otherwise never reach the upstream model.
 */
export const openRouterReasoningMiddleware: LanguageModelMiddleware = {
  transformParams: async ({ params }) => {
    const effort = toOpenRouterEffort(params.reasoning);
    const openrouter = params.providerOptions?.openrouter;
    if (!effort || openrouter?.reasoning !== undefined) return params;
    return {
      ...params,
      providerOptions: {
        ...params.providerOptions,
        openrouter: { ...openrouter, reasoning: { effort } },
      },
    };
  },
};
