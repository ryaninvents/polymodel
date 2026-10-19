import type { PolymodelEvent } from "#types";
import type { ForwardedToolCall, ForwardResult } from "../forwardStream.ts";

export type RewrittenResult = ForwardResult & {
  /** Calls that were hidden from the client, in their original form. */
  hidden: ReadonlyArray<ForwardedToolCall>;
};

/**
 * Passes a forwarded stream through while rewriting its tool calls. The
 * callback returns the id to emit for a call, or `undefined` to hide the call
 * from the client (a virtual tool only polymodel acts on). Use with `yield*`.
 */
export async function* rewriteToolCalls(
  source: AsyncGenerator<PolymodelEvent, ForwardResult>,
  rewriteId: (call: ForwardedToolCall) => string | undefined,
): AsyncGenerator<PolymodelEvent, RewrittenResult> {
  const ids = new Map<string, string | undefined>();
  function idFor(call: ForwardedToolCall) {
    if (!ids.has(call.toolCallId)) ids.set(call.toolCallId, rewriteId(call));
    return ids.get(call.toolCallId);
  }

  let next = await source.next();
  while (!next.done) {
    const event = next.value;
    if (event.type !== "tool-call") {
      yield event;
    } else {
      const toolCallId = idFor({ ...event, input: event.input });
      if (toolCallId) yield { ...event, toolCallId };
    }
    next = await source.next();
  }

  const toolCalls: Array<ForwardedToolCall> = [];
  const hidden: Array<ForwardedToolCall> = [];
  for (const call of next.value.toolCalls) {
    const toolCallId = idFor(call);
    if (toolCallId) toolCalls.push({ ...call, toolCallId });
    else hidden.push(call);
  }
  return { ...next.value, toolCalls, hidden };
}
