import type { LanguageModelV4StreamResult } from "@ai-sdk/provider";
import type { ModelMessage } from "ai";
import {
  PlannerSessionSchema,
  type PolymodelEvent,
  type PolymodelRequest,
} from "#types";
import { computeTurnKey } from "../planner-executor/conversation.ts";
import {
  plannerExecutor,
  type PlannerExecutorOptions,
} from "../planner-executor/plannerExecutor.ts";
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
  /** Scripted executor replies, consumed one per executor call. */
  executor?: Array<LanguageModelV4StreamResult>;
  options?: Partial<PlannerExecutorOptions>;
};

/** Short prompts so test expectations can spell out the full system prompt. */
export const PLANNER_PROMPT = "PLANNER PROMPT";
export const EXECUTOR_PROMPT = "EXECUTOR PROMPT";

/**
 * A planner/executor polymodel wired to two scripted mock models and an
 * inspectable state store. `send` plays the part of the client: one call is
 * one chat-completion request.
 */
export function createPlannerExecutorHarness({
  planner = [],
  executor = [],
  options = {},
}: HarnessOptions = {}) {
  const plannerModel = createMockModel(planner);
  const executorModel = createMockModel(executor);
  const state = createMapStateStore();
  const context = createTestContext(
    { "mock:planner": plannerModel, "mock:executor": executorModel },
    state,
  );
  const model = plannerExecutor({
    planner: "mock:planner",
    executor: "mock:executor",
    plannerInstructions: PLANNER_PROMPT,
    executorInstructions: EXECUTOR_PROMPT,
    ...options,
  });

  return {
    planner: plannerModel,
    executor: executorModel,
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
      return PlannerSessionSchema.optional().parse(
        state.get(await computeTurnKey(messages)),
      );
    },

    async storeSession(messages: Array<ModelMessage>, session: unknown) {
      state.set(await computeTurnKey(messages), session);
    },
  };
}

/** Drops usage events, which every upstream call emits and most tests don't care about. */
export function withoutUsage(
  events: ReadonlyArray<PolymodelEvent>,
): Array<PolymodelEvent> {
  return events.filter((event) => event.type !== "usage");
}
