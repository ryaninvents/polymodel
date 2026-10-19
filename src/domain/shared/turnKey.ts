import type { ModelMessage } from "ai";
import { sha256Hex } from "#util";

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
