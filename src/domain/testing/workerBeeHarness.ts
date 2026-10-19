import type { LanguageModelV4StreamResult } from "@ai-sdk/provider";
import type { MockLanguageModelV4 } from "ai/test";
import type { ModelMessage } from "ai";
import {
  DelegatingSessionSchema,
  type PolymodelEvent,
  type PolymodelRequest,
} from "#types";
import { computeTurnKey } from "../shared/index.ts";
import { workerBee, type WorkerBeeOptions } from "../worker-bee/index.ts";
import {
  collectEvents,
  createMapStateStore,
  createMockModel,
  createTestContext,
  createTestRequest,
} from "./mockModels.ts";

export type HarnessOptions = {
  /** Scripted planner replies, consumed one per planner call. */
  planner?: Array<LanguageModelV4StreamResult>;
  /** Scripted worker replies, consumed one per worker call. */
  worker?: Array<LanguageModelV4StreamResult> | MockLanguageModelV4;
  options?: Partial<WorkerBeeOptions>;
};

/** Short prompts so test expectations can spell out the full system prompt. */
export const PLANNER_PROMPT = "PLANNER PROMPT";
export const WORKER_PROMPT = "WORKER PROMPT";

/**
 * A worker-bee polymodel wired to two scripted mock models and an
 * inspectable state store. `send` plays the part of the client: one call is
 * one chat-completion request.
 */
export function createWorkerBeeHarness({
  planner = [],
  worker = [],
  options = {},
}: HarnessOptions = {}) {
  const plannerModel = createMockModel(planner);
  const workerModel = Array.isArray(worker) ? createMockModel(worker) : worker;
  const state = createMapStateStore();
  const context = createTestContext(
    { "mock:planner": plannerModel, "mock:worker": workerModel },
    state,
  );
  const model = workerBee({
    planner: "mock:planner",
    worker: "mock:worker",
    plannerInstructions: PLANNER_PROMPT,
    workerInstructions: WORKER_PROMPT,
    ...options,
  });

  return {
    planner: plannerModel,
    worker: workerModel,
    state,

    async send(
      messages: Array<ModelMessage>,
      overrides: Partial<PolymodelRequest> = {},
    ) {
      return collectEvents(
        model.run(createTestRequest(messages, overrides), context),
      );
    },

    /** The stored session for the turn that `messages` belongs to. */
    async sessionFor(messages: Array<ModelMessage>) {
      return DelegatingSessionSchema.optional().parse(
        state.get(await computeTurnKey(messages)),
      );
    },
  };
}

/** Drops usage events, which every upstream call emits and most tests don't care about. */
export function withoutUsage(
  events: ReadonlyArray<PolymodelEvent>,
): Array<PolymodelEvent> {
  return events.filter((event) => event.type !== "usage");
}

/** The id of the first tool call in a response, as the client saw it. */
export function firstToolCallId(events: ReadonlyArray<PolymodelEvent>): string {
  const call = events.find((event) => event.type === "tool-call");
  if (call?.type !== "tool-call") throw new Error("response has no tool call");
  return call.toolCallId;
}
