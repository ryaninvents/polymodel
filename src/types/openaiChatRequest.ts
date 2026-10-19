import { z } from "zod";

// Only the subset of the OpenAI Chat Completions API that polymodel can faithfully
// translate. Unknown top-level fields are tolerated because clients (and LiteLLM)
// routinely send vendor extensions.

const TextContentPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const ImageContentPartSchema = z.object({
  type: z.literal("image_url"),
  image_url: z.object({
    url: z.string(),
    detail: z.enum(["auto", "low", "high"]).optional(),
  }),
});

const TextOnlyContentSchema = z.union([
  z.string(),
  z.array(TextContentPartSchema),
]);

const SystemMessageSchema = z.object({
  role: z.enum(["system", "developer"]),
  content: TextOnlyContentSchema,
});

const UserMessageSchema = z.object({
  role: z.literal("user"),
  content: z.union([
    z.string(),
    z.array(
      z.discriminatedUnion("type", [
        TextContentPartSchema,
        ImageContentPartSchema,
      ]),
    ),
  ]),
});

export const OpenAIToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const AssistantMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z
    .union([
      z.string(),
      z.array(
        z.discriminatedUnion("type", [
          TextContentPartSchema,
          z.object({ type: z.literal("refusal"), refusal: z.string() }),
        ]),
      ),
    ])
    .nullish(),
  tool_calls: z.array(OpenAIToolCallSchema).nullish(),
});

const ToolMessageSchema = z.object({
  role: z.literal("tool"),
  tool_call_id: z.string(),
  content: TextOnlyContentSchema,
});

export const OpenAIChatMessageSchema = z.discriminatedUnion("role", [
  SystemMessageSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
]);

export const OpenAIToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().nullish(),
  }),
});

export const OpenAIToolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z.object({
    type: z.literal("function"),
    function: z.object({ name: z.string() }),
  }),
]);

export const OpenAIChatRequestSchema = z.looseObject({
  model: z.string().min(1),
  messages: z.array(OpenAIChatMessageSchema).min(1),
  tools: z.array(OpenAIToolSchema).nullish(),
  tool_choice: OpenAIToolChoiceSchema.nullish(),
  stream: z.boolean().nullish(),
  stream_options: z.object({ include_usage: z.boolean().nullish() }).nullish(),
  n: z.literal(1).nullish(),
  temperature: z.number().nullish(),
  top_p: z.number().nullish(),
  max_tokens: z.number().int().positive().nullish(),
  max_completion_tokens: z.number().int().positive().nullish(),
  stop: z.union([z.string(), z.array(z.string())]).nullish(),
  seed: z.number().int().nullish(),
  presence_penalty: z.number().nullish(),
  frequency_penalty: z.number().nullish(),
  reasoning_effort: z
    .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
    .nullish(),
});

export type OpenAIChatMessage = z.infer<typeof OpenAIChatMessageSchema>;
export type OpenAIToolCall = z.infer<typeof OpenAIToolCallSchema>;
export type OpenAITool = z.infer<typeof OpenAIToolSchema>;
export type OpenAIToolChoice = z.infer<typeof OpenAIToolChoiceSchema>;
export type OpenAIChatRequest = z.infer<typeof OpenAIChatRequestSchema>;
