import type {
  LanguageModel,
  LanguageModelCallOptions,
  ModelMessage,
  SystemModelMessage,
  ToolChoice,
  ToolSet,
} from "ai";
import type { OpenAIChatRequest } from "./openaiChatRequest.ts";
import type { PolymodelEvent } from "./polymodelEvent.ts";

export type PolymodelCallSettings = {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: Array<string>;
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  /** Reasoning effort; `"none"` disables reasoning where the provider allows it. */
  reasoning?: LanguageModelCallOptions["reasoning"];
};

export type PolymodelRequest = {
  /** The polymodel id the client asked for. */
  model: string;
  /** All system/developer messages from the request, in order. */
  instructions: ReadonlyArray<SystemModelMessage>;
  /** The conversation, excluding system messages. */
  messages: ReadonlyArray<ModelMessage>;
  /** Client-defined tools. They have no `execute`: calls are returned to the client. */
  tools: ToolSet;
  toolChoice: ToolChoice<ToolSet> | undefined;
  settings: PolymodelCallSettings;
  /** The original OpenAI-format request, for plugins that need vendor extensions. */
  raw: OpenAIChatRequest;
};

/** Durable-for-the-process key/value state, namespaced per polymodel. */
export type StateStore = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
};

export type PolymodelLogger = {
  trace(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
};

export type PolymodelContext = {
  /** Resolves a `"<provider>:<model>"` reference from the config's `providers`. */
  resolveModel(reference: string): LanguageModel;
  state: StateStore;
  logger: PolymodelLogger;
  /** Aborted when the client disconnects. Pass it to every upstream call. */
  abortSignal: AbortSignal;
};

/**
 * A polymodel is a strategy for answering one chat-completion request, usually
 * by orchestrating several upstream models.
 */
export type Polymodel = {
  description?: string;
  run(
    request: PolymodelRequest,
    context: PolymodelContext,
  ): AsyncIterable<PolymodelEvent>;
};
