import type { ModelMessage } from "ai";

/** Readable builders for AI SDK conversations used across routing tests. */

export function user(text: string): ModelMessage {
  return { role: "user", content: text };
}

export function assistant(text: string): ModelMessage {
  return { role: "assistant", content: text };
}

/** An assistant tool call followed by the client's result for it. */
export function toolRound(
  toolCallId: string,
  call: { tool: string; input: object; output: string },
): Array<ModelMessage> {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId,
          toolName: call.tool,
          input: call.input,
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId,
          toolName: call.tool,
          output: { type: "text", value: call.output },
        },
      ],
    },
  ];
}
