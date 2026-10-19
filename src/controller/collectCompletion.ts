import type {
  OpenAIChatCompletion,
  OpenAIToolCall,
  PolymodelEvent,
} from "#types";
import type { ResponseMeta } from "./encodeChunks.ts";
import { createResponseTracker } from "./responseTracker.ts";

export async function collectCompletion(
  events: AsyncIterable<PolymodelEvent>,
  meta: ResponseMeta,
): Promise<OpenAIChatCompletion> {
  const tracker = createResponseTracker();
  let content = "";
  let reasoning = "";
  const toolCalls: Array<OpenAIToolCall> = [];

  for await (const event of events) {
    tracker.observe(event);
    if (event.type === "text-delta") content += event.text;
    if (event.type === "reasoning-delta") reasoning += event.text;
    if (event.type === "tool-call") {
      toolCalls.push({
        id: event.toolCallId,
        type: "function",
        function: { name: event.toolName, arguments: event.input },
      });
    }
  }

  return {
    id: meta.id,
    object: "chat.completion",
    created: meta.created,
    model: meta.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || (toolCalls.length > 0 ? null : ""),
          ...(reasoning && { reasoning_content: reasoning }),
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        },
        finish_reason: tracker.finishReason(),
      },
    ],
    usage: tracker.usage(),
  };
}
