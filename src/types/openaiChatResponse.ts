import type { OpenAIToolCall } from "./openaiChatRequest.ts";

// Outbound shapes are produced by polymodel itself, so they are plain types
// rather than Zod schemas (nothing external needs validating).

export type OpenAIFinishReason =
  "stop" | "length" | "tool_calls" | "content_filter";

export type OpenAIUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens: number };
  completion_tokens_details?: { reasoning_tokens: number };
};

export type OpenAIChunkToolCallDelta = {
  index: number;
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAIChatCompletionChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    delta: {
      role?: "assistant";
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<OpenAIChunkToolCallDelta>;
    };
    finish_reason: OpenAIFinishReason | null;
  }>;
  usage?: OpenAIUsage | null;
};

export type OpenAIChatCompletion = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    message: {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      tool_calls?: Array<OpenAIToolCall>;
    };
    finish_reason: OpenAIFinishReason;
  }>;
  usage: OpenAIUsage;
};

export type OpenAIErrorBody = {
  error: {
    message: string;
    type: string;
    code: string | null;
    param: string | null;
  };
};
