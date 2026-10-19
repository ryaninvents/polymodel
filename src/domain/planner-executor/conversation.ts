import type { ModelMessage } from "ai";
import { sha256Hex } from "#util";
import { PLAN_TOOL_NAME } from "./prompts.ts";

function lastUserIndex(messages: ReadonlyArray<ModelMessage>): number {
  return messages.findLastIndex((message) => message.role === "user");
}

export function isNewUserTurn(messages: ReadonlyArray<ModelMessage>): boolean {
  return messages.at(-1)?.role === "user";
}

/**
 * Identifies a turn by the conversation up to and including its user message.
 * Every follow-up request in the turn (tool results, etc.) shares this prefix.
 * System instructions are left out because some clients rewrite them between
 * requests (timestamps, environment snapshots).
 */
export async function computeTurnKey(
  messages: ReadonlyArray<ModelMessage>,
): Promise<string> {
  return sha256Hex(
    JSON.stringify(messages.slice(0, lastUserIndex(messages) + 1)),
  );
}

export function planToolCallId(turnKey: string): string {
  // Deterministic so repeated requests share an identical prefix for upstream prompt caching.
  return `call_polymodel_plan_${turnKey.slice(0, 24)}`;
}

/**
 * Splices a synthetic tool call/result pair carrying the plan into the
 * conversation, so the executor reads the plan as its own prior work.
 */
export function injectPlan(
  messages: ReadonlyArray<ModelMessage>,
  plan: { text: string; index: number; toolCallId: string },
): Array<ModelMessage> {
  const index = Math.min(plan.index, messages.length);
  const pair: Array<ModelMessage> = [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: plan.toolCallId,
          toolName: PLAN_TOOL_NAME,
          input: {},
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: plan.toolCallId,
          toolName: PLAN_TOOL_NAME,
          output: { type: "text", value: plan.text },
        },
      ],
    },
  ];
  return [...messages.slice(0, index), ...pair, ...messages.slice(index)];
}
