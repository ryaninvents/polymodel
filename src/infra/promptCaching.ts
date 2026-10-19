import type { LanguageModelMiddleware } from "ai";

export type PromptCachingTtl = "5m" | "1h";

export type PromptCachingOptions = {
  /** Key under `providerOptions` that the AI SDK provider reads. */
  providerKey: "anthropic" | "openrouter";
  ttl: PromptCachingTtl;
  /** Backends that cache on their own may not tolerate a `cache_control` field. */
  appliesTo?: (modelId: string) => boolean;
};

/**
 * Anthropic models only cache when a request carries `cache_control`. A single
 * top-level directive lets Anthropic move the breakpoint forward as the
 * conversation grows, so no knowledge of message structure is needed. An
 * explicit `cacheControl` from a caller is left alone.
 */
export function createPromptCachingMiddleware({
  providerKey,
  ttl,
  appliesTo = () => true,
}: PromptCachingOptions): LanguageModelMiddleware {
  return {
    transformParams: async ({ params, model }) => {
      const options = params.providerOptions?.[providerKey];
      if (options?.cacheControl !== undefined || !appliesTo(model.modelId))
        return params;
      return {
        ...params,
        providerOptions: {
          ...params.providerOptions,
          [providerKey]: {
            ...options,
            cacheControl: { type: "ephemeral", ttl },
          },
        },
      };
    },
  };
}
