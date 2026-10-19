// The vocabulary a polymodel speaks back to the server. It is deliberately
// provider-neutral: the controller decides how to encode it on the wire.

export type PolymodelUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Tokens written to the prompt cache; billed above the base input price. */
  cacheWriteTokens: number;
  reasoningTokens: number;
};

export type PolymodelFinishReason =
  "stop" | "length" | "tool-calls" | "content-filter";

export type PolymodelEvent =
  | { type: "reasoning-delta"; text: string }
  | { type: "text-delta"; text: string }
  /** `input` is the JSON-encoded tool arguments, exactly as sent to the client. */
  | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
  /** Usage events are additive; emit one per upstream call. */
  | { type: "usage"; usage: PolymodelUsage }
  /** Optional. When omitted, the reason is inferred from whether tool calls were emitted. */
  | { type: "finish"; reason: PolymodelFinishReason };
