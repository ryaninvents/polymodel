import type {
  FinishReason,
  LanguageModelUsage,
  TextStreamPart,
  ToolSet,
} from "ai";
import type {
  PolymodelEvent,
  PolymodelFinishReason,
  PolymodelUsage,
} from "#types";

export type ForwardedToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

export type ForwardResult = {
  text: string;
  reasoning: string;
  toolCalls: ReadonlyArray<ForwardedToolCall>;
  finishReason: FinishReason;
};

export type ForwardOptions = {
  /**
   * Where the model's answer text goes. A planner's text is usually surfaced as
   * `reasoning` so clients render it apart from the final answer.
   */
  textAs?: "text" | "reasoning";
};

export function toPolymodelUsage(usage: LanguageModelUsage): PolymodelUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? 0,
  };
}

export function toPolymodelFinishReason(
  reason: FinishReason,
): PolymodelFinishReason {
  switch (reason) {
    case "length":
    case "tool-calls":
    case "content-filter":
      return reason;
    default:
      return "stop";
  }
}

/**
 * Re-emits an AI SDK `fullStream` as polymodel events, and returns what the model
 * produced so the caller can decide what to do next (e.g. hand a plan to another
 * model). Use with `yield*`:
 *
 *   const result = yield* forwardStream(streamText({ ... }).fullStream);
 */
export async function* forwardStream<toolSet extends ToolSet>(
  stream: AsyncIterable<TextStreamPart<toolSet>>,
  { textAs = "text" }: ForwardOptions = {},
): AsyncGenerator<PolymodelEvent, ForwardResult> {
  let text = "";
  let reasoning = "";
  let finishReason: FinishReason = "other";
  const toolCalls: Array<ForwardedToolCall> = [];

  for await (const part of stream) {
    switch (part.type) {
      case "text-delta":
        text += part.text;
        yield {
          type: textAs === "text" ? "text-delta" : "reasoning-delta",
          text: part.text,
        };
        break;
      case "reasoning-delta":
        reasoning += part.text;
        yield { type: "reasoning-delta", text: part.text };
        break;
      case "tool-call": {
        const { toolCallId, toolName, input } = part;
        toolCalls.push({ toolCallId, toolName, input });
        yield {
          type: "tool-call",
          toolCallId,
          toolName,
          input: JSON.stringify(input ?? {}),
        };
        break;
      }
      case "finish":
        finishReason = part.finishReason;
        yield { type: "usage", usage: toPolymodelUsage(part.totalUsage) };
        break;
      case "error":
        throw part.error;
      default:
        // Step boundaries, tool-input streaming, sources, etc. have no
        // chat-completions equivalent; complete tool calls arrive as `tool-call`.
        break;
    }
  }

  return { text, reasoning, toolCalls, finishReason };
}
