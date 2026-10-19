import type {
  OpenAIFinishReason,
  OpenAIUsage,
  PolymodelEvent,
  PolymodelFinishReason,
  PolymodelUsage,
} from "#types";
import { assertNever } from "#util";

function toOpenAIFinishReason(
  reason: PolymodelFinishReason,
): OpenAIFinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool-calls":
      return "tool_calls";
    case "content-filter":
      return "content_filter";
    default:
      return assertNever(reason);
  }
}

function toOpenAIUsage(usage: PolymodelUsage): OpenAIUsage {
  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.inputTokens + usage.outputTokens,
    prompt_tokens_details: { cached_tokens: usage.cachedInputTokens },
    completion_tokens_details: { reasoning_tokens: usage.reasoningTokens },
  };
}

/** Accumulates the response-level facts (usage, finish reason) both encoders need. */
export function createResponseTracker() {
  const usage: PolymodelUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  };
  let toolCallCount = 0;
  let finish: PolymodelFinishReason | undefined;

  return {
    observe(event: PolymodelEvent): void {
      if (event.type === "tool-call") toolCallCount += 1;
      if (event.type === "finish") finish = event.reason;
      if (event.type === "usage") {
        usage.inputTokens += event.usage.inputTokens;
        usage.outputTokens += event.usage.outputTokens;
        usage.cachedInputTokens += event.usage.cachedInputTokens;
        usage.cacheWriteTokens += event.usage.cacheWriteTokens;
        usage.reasoningTokens += event.usage.reasoningTokens;
      }
    },
    get toolCallCount() {
      return toolCallCount;
    },
    finishReason(): OpenAIFinishReason {
      return toOpenAIFinishReason(
        finish ?? (toolCallCount > 0 ? "tool-calls" : "stop"),
      );
    },
    usage(): OpenAIUsage {
      return toOpenAIUsage(usage);
    },
  };
}
