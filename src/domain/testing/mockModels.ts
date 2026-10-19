import type {
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import type { ModelMessage } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import type {
  PolymodelContext,
  PolymodelEvent,
  PolymodelRequest,
  StateStore,
} from "#types";

type FinishReason = "stop" | "tool-calls" | "length";

function finishPart(unified: FinishReason): LanguageModelV4StreamPart {
  return {
    type: "finish",
    finishReason: { unified, raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    },
  };
}

export function textResponse(text: string): LanguageModelV4StreamResult {
  return {
    stream: convertArrayToReadableStream([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: text },
      { type: "text-end", id: "t1" },
      finishPart("stop"),
    ] satisfies Array<LanguageModelV4StreamPart>),
  };
}

export function toolCallResponse(
  toolCallId: string,
  toolName: string,
  input: object,
): LanguageModelV4StreamResult {
  return {
    stream: convertArrayToReadableStream([
      { type: "stream-start", warnings: [] },
      { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
      finishPart("tool-calls"),
    ] satisfies Array<LanguageModelV4StreamPart>),
  };
}

export function createMockModel(responses: Array<LanguageModelV4StreamResult>) {
  return new MockLanguageModelV4({ doStream: responses });
}

export function createMapStateStore(): StateStore & {
  entries: Map<string, unknown>;
} {
  const entries = new Map<string, unknown>();
  return {
    entries,
    get: (key) => entries.get(key),
    set: (key, value) => void entries.set(key, value),
    delete: (key) => void entries.delete(key),
  };
}

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

export function createTestContext(
  models: Record<string, MockLanguageModelV4>,
  state: StateStore = createMapStateStore(),
): PolymodelContext {
  return {
    resolveModel(reference) {
      const model = models[reference];
      if (!model) throw new Error(`No mock model for ${reference}`);
      return model;
    },
    state,
    logger: silentLogger,
    abortSignal: new AbortController().signal,
  };
}

export function createTestRequest(
  messages: Array<ModelMessage>,
  overrides: Partial<PolymodelRequest> = {},
): PolymodelRequest {
  return {
    model: "test",
    instructions: [],
    messages,
    tools: {},
    toolChoice: undefined,
    settings: {},
    raw: { model: "test", messages: [{ role: "user", content: "raw" }] },
    ...overrides,
  };
}

export async function collectEvents(
  events: AsyncIterable<PolymodelEvent>,
): Promise<Array<PolymodelEvent>> {
  const collected: Array<PolymodelEvent> = [];
  for await (const event of events) collected.push(event);
  return collected;
}
