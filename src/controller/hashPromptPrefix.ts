import { sha256Hex } from "#util";
import type { OpenAIChatRequest } from "#types";

async function shortHash(value: unknown): Promise<string> {
  return (await sha256Hex(JSON.stringify(value ?? null))).slice(0, 12);
}

/**
 * Upstream prompt caching needs a byte-identical prefix (tools, then system).
 * Some clients rewrite those between requests (timestamps, environment
 * snapshots); logging their hashes shows when that is why caching misses.
 */
export async function hashPromptPrefix(request: OpenAIChatRequest) {
  const instructions = request.messages.filter(
    (message) => message.role === "system" || message.role === "developer",
  );
  return {
    instructionsHash: await shortHash(instructions),
    toolsHash: await shortHash(request.tools),
  };
}
