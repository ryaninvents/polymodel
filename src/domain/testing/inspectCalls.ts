import type { MockLanguageModelV4 } from "ai/test";

type CallOptions = MockLanguageModelV4["doStreamCalls"][number];
type PromptMessage = CallOptions["prompt"][number];

/**
 * A human-readable view of one upstream model call, so tests can state
 * exactly what a model was shown:
 *
 *   user: Fix the failing test
 *   assistant → bash {"cmd":"ls"}
 *   tool ← bash: a.ts b.ts
 */
export type CallSummary = {
  system: string | undefined;
  conversation: Array<string>;
  tools: Array<string>;
  toolChoice: string | undefined;
  settings: { temperature?: number; maxOutputTokens?: number };
};

function describePart(
  role: string,
  part: PromptMessage["content"][number],
): string {
  if (typeof part === "string") return `${role}: ${part}`;
  switch (part.type) {
    case "text":
      return `${role}: ${part.text}`;
    case "tool-call":
      return `${role} → ${part.toolName} ${JSON.stringify(part.input)}`;
    case "tool-result":
      return `${role} ← ${part.toolName}: ${"value" in part.output ? String(part.output.value) : part.output.type}`;
    default:
      return `${role}: [${part.type}]`;
  }
}

function describeMessage(message: PromptMessage): Array<string> {
  if (message.role === "system") return [];
  return message.content.map((part) => describePart(message.role, part));
}

export function summarizeCall(
  model: MockLanguageModelV4,
  index = 0,
): CallSummary {
  const call = model.doStreamCalls[index];
  if (!call)
    throw new Error(
      `Model was called ${model.doStreamCalls.length} time(s); no call #${index}`,
    );
  const system = call.prompt
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  return {
    system: system || undefined,
    conversation: call.prompt.flatMap(describeMessage),
    tools: (call.tools ?? []).map((tool) => tool.name),
    toolChoice:
      call.toolChoice?.type === "tool"
        ? `tool:${call.toolChoice.toolName}`
        : call.toolChoice?.type,
    settings: {
      ...(call.temperature !== undefined && { temperature: call.temperature }),
      ...(call.maxOutputTokens !== undefined && {
        maxOutputTokens: call.maxOutputTokens,
      }),
    },
  };
}
