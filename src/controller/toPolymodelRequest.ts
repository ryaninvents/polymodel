import {
  jsonSchema,
  type ModelMessage,
  type SystemModelMessage,
  type ToolChoice,
  type ToolSet,
} from "ai";
import { createInvalidPolymodelRequestError } from "#domain";
import type {
  OpenAIChatMessage,
  OpenAIChatRequest,
  OpenAITool,
  OpenAIToolChoice,
  PolymodelCallSettings,
  PolymodelRequest,
} from "#types";

type ToolMessage = Extract<OpenAIChatMessage, { role: "tool" }>;
type UserMessage = Extract<OpenAIChatMessage, { role: "user" }>;
type AssistantMessage = Extract<OpenAIChatMessage, { role: "assistant" }>;

function joinText(content: string | ReadonlyArray<{ text: string }>): string {
  return typeof content === "string"
    ? content
    : content.map((part) => part.text).join("");
}

function parseUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw createInvalidPolymodelRequestError(
      `Invalid image URL: ${url.slice(0, 64)}`,
    );
  }
}

function toUserMessage({ content }: UserMessage): ModelMessage {
  if (typeof content === "string") return { role: "user", content };
  return {
    role: "user",
    content: content.map((part) =>
      part.type === "text"
        ? { type: "text", text: part.text }
        : { type: "image", image: parseUrl(part.image_url.url) },
    ),
  };
}

function parseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    // Pass malformed arguments through verbatim so the model can see its own mistake.
    return raw;
  }
}

function toAssistantMessage({
  content,
  tool_calls,
}: AssistantMessage): ModelMessage {
  const text =
    typeof content === "string"
      ? content
      : (content ?? [])
          .map((part) => (part.type === "text" ? part.text : part.refusal))
          .join("");
  const toolCalls = (tool_calls ?? []).map((call) => ({
    type: "tool-call" as const,
    toolCallId: call.id,
    toolName: call.function.name,
    input: parseToolArguments(call.function.arguments),
  }));
  if (toolCalls.length === 0) return { role: "assistant", content: text };
  return {
    role: "assistant",
    content: [...(text ? [{ type: "text" as const, text }] : []), ...toolCalls],
  };
}

function toToolResult(
  message: ToolMessage,
  toolNames: ReadonlyMap<string, string>,
) {
  const toolName = toolNames.get(message.tool_call_id);
  if (!toolName) {
    throw createInvalidPolymodelRequestError(
      `Tool message references unknown tool_call_id "${message.tool_call_id}"`,
    );
  }
  return {
    type: "tool-result" as const,
    toolCallId: message.tool_call_id,
    toolName,
    output: { type: "text" as const, value: joinText(message.content) },
  };
}

/** OpenAI sends one message per tool result; the AI SDK groups a round's results together. */
function toConversation(messages: ReadonlyArray<OpenAIChatMessage>): {
  instructions: Array<SystemModelMessage>;
  messages: Array<ModelMessage>;
} {
  const instructions: Array<SystemModelMessage> = [];
  const conversation: Array<ModelMessage> = [];
  const toolNames = new Map<string, string>();

  for (const message of messages) {
    switch (message.role) {
      case "system":
      case "developer":
        instructions.push({
          role: "system",
          content: joinText(message.content),
        });
        break;
      case "user":
        conversation.push(toUserMessage(message));
        break;
      case "assistant":
        for (const call of message.tool_calls ?? [])
          toolNames.set(call.id, call.function.name);
        conversation.push(toAssistantMessage(message));
        break;
      case "tool": {
        const result = toToolResult(message, toolNames);
        const previous = conversation.at(-1);
        if (previous?.role === "tool") {
          conversation[conversation.length - 1] = {
            ...previous,
            content: [...previous.content, result],
          };
        } else {
          conversation.push({ role: "tool", content: [result] });
        }
        break;
      }
    }
  }
  return { instructions, messages: conversation };
}

function toToolSet(tools: ReadonlyArray<OpenAITool>): ToolSet {
  return Object.fromEntries(
    tools.map(({ function: definition }) => [
      definition.name,
      {
        description: definition.description,
        inputSchema: jsonSchema(
          definition.parameters ?? { type: "object", properties: {} },
        ),
      },
    ]),
  );
}

function toToolChoice(
  choice: OpenAIToolChoice | null | undefined,
): ToolChoice<ToolSet> | undefined {
  if (!choice) return undefined;
  if (typeof choice === "string") return choice;
  return { type: "tool", toolName: choice.function.name };
}

function definedEntries<value extends object>(input: value): Partial<value> {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([, entry]) => entry !== undefined && entry !== null,
    ),
  ) as Partial<value>;
}

function toSettings(request: OpenAIChatRequest): PolymodelCallSettings {
  return definedEntries({
    temperature: request.temperature ?? undefined,
    topP: request.top_p ?? undefined,
    maxOutputTokens:
      request.max_completion_tokens ?? request.max_tokens ?? undefined,
    stopSequences:
      typeof request.stop === "string"
        ? [request.stop]
        : (request.stop ?? undefined),
    seed: request.seed ?? undefined,
    presencePenalty: request.presence_penalty ?? undefined,
    frequencyPenalty: request.frequency_penalty ?? undefined,
  });
}

export function toPolymodelRequest(
  request: OpenAIChatRequest,
): PolymodelRequest {
  return {
    model: request.model,
    ...toConversation(request.messages),
    tools: toToolSet(request.tools ?? []),
    toolChoice: toToolChoice(request.tool_choice),
    settings: toSettings(request),
    raw: request,
  };
}
