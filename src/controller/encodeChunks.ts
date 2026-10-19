import type { OpenAIChatCompletionChunk, PolymodelEvent } from "#types";
import { createResponseTracker } from "./responseTracker.ts";

export type ResponseMeta = { id: string; created: number; model: string };

type Delta = OpenAIChatCompletionChunk["choices"][number]["delta"];

function chunk(
  meta: ResponseMeta,
  delta: Delta,
  finishReason: OpenAIChatCompletionChunk["choices"][number]["finish_reason"] = null,
): OpenAIChatCompletionChunk {
  return {
    id: meta.id,
    object: "chat.completion.chunk",
    created: meta.created,
    model: meta.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

/**
 * Encodes events as one uninterrupted assistant message, regardless of how many
 * upstream models produced them: a single id/model and a single `role` delta.
 */
export async function* encodeChunks(
  events: AsyncIterable<PolymodelEvent>,
  meta: ResponseMeta,
  { includeUsage }: { includeUsage: boolean },
): AsyncGenerator<OpenAIChatCompletionChunk> {
  const tracker = createResponseTracker();
  yield chunk(meta, { role: "assistant", content: "" });

  for await (const event of events) {
    const toolIndex = tracker.toolCallCount;
    tracker.observe(event);
    switch (event.type) {
      case "text-delta":
        yield chunk(meta, { content: event.text });
        break;
      case "reasoning-delta":
        yield chunk(meta, { reasoning_content: event.text });
        break;
      case "tool-call":
        yield chunk(meta, {
          tool_calls: [
            {
              index: toolIndex,
              id: event.toolCallId,
              type: "function",
              function: { name: event.toolName, arguments: event.input },
            },
          ],
        });
        break;
      default:
        break;
    }
  }

  yield chunk(meta, {}, tracker.finishReason());
  if (includeUsage)
    yield { ...chunk(meta, {}), choices: [], usage: tracker.usage() };
}
