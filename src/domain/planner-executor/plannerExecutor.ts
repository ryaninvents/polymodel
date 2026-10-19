import { jsonSchema, streamText, type ToolChoice, type ToolSet } from "ai";
import {
  PlannerSessionSchema,
  type ExecutingPlannerSession,
  type Polymodel,
  type PolymodelCallSettings,
  type PolymodelContext,
  type PolymodelEvent,
  type PolymodelRequest,
} from "#types";
import { definePolymodel } from "../definitions.ts";
import {
  forwardStream,
  toPolymodelFinishReason,
  type ForwardResult,
} from "../forwardStream.ts";
import {
  computeTurnKey,
  injectPlan,
  isNewUserTurn,
  planToolCallId,
} from "./conversation.ts";
import {
  DEFAULT_EXECUTOR_INSTRUCTIONS,
  DEFAULT_PLANNER_INSTRUCTIONS,
  FINAL_PLANNER_ROUND_NOTE,
  PLAN_TOOL_DESCRIPTION,
  PLAN_TOOL_NAME,
} from "./prompts.ts";

export type PlannerExecutorOptions = {
  /** Model reference for planning, e.g. `"litellm:claude-opus-5-5"`. */
  planner: string;
  /** Model reference for execution, e.g. `"litellm:claude-haiku-5-5"`. */
  executor: string;
  description?: string;
  /** Planner tool-call round trips allowed per user turn before it must produce a plan. */
  maxPlannerRounds?: number;
  plannerInstructions?: string;
  executorInstructions?: string;
  /** Planner call settings. Client settings (e.g. max_tokens) are not applied to the planner. */
  plannerSettings?: PolymodelCallSettings;
  /** Overrides applied on top of the client's settings for the executor. */
  executorSettings?: PolymodelCallSettings;
};

type ResolvedOptions = Required<Omit<PlannerExecutorOptions, "description">>;

type TurnInfo = {
  key: string;
  request: PolymodelRequest;
  context: PolymodelContext;
};

function suppressStreamErrorLogging(): void {
  // forwardStream rethrows stream errors, so AI SDK's default console logging would duplicate them.
}

function plannerToolChoice(
  request: PolymodelRequest,
  exhausted: boolean,
): ToolChoice<ToolSet> {
  return exhausted || request.toolChoice === "none" ? "none" : "auto";
}

async function* runPlanner(
  { key, request, context }: TurnInfo,
  options: ResolvedOptions,
  rounds: number,
): AsyncGenerator<PolymodelEvent, ExecutingPlannerSession | undefined> {
  const exhausted = rounds >= options.maxPlannerRounds;
  const hasTools = Object.keys(request.tools).length > 0;
  context.logger.debug(
    { turn: key.slice(0, 12), rounds, exhausted },
    "planner round",
  );

  const result = yield* forwardStream(
    streamText({
      model: context.resolveModel(options.planner),
      instructions: [
        ...request.instructions,
        {
          role: "system",
          content:
            options.plannerInstructions +
            (exhausted ? FINAL_PLANNER_ROUND_NOTE : ""),
        },
      ],
      messages: [...request.messages],
      ...(hasTools && {
        tools: request.tools,
        toolChoice: plannerToolChoice(request, exhausted),
      }),
      ...options.plannerSettings,
      abortSignal: context.abortSignal,
      onError: suppressStreamErrorLogging,
    }).fullStream,
    { textAs: "reasoning" },
  );

  if (result.toolCalls.length > 0) {
    context.state.set(key, { phase: "planning", rounds: rounds + 1 });
    return undefined;
  }

  const session: ExecutingPlannerSession = {
    phase: "executing",
    plan: result.text.trim(),
    planIndex: request.messages.length,
  };
  context.state.set(key, session);
  return session;
}

/** Hides executor calls to the plan marker tool, which the client knows nothing about. */
async function* withoutPlanToolCalls(
  source: AsyncGenerator<PolymodelEvent, ForwardResult>,
): AsyncGenerator<PolymodelEvent, ForwardResult> {
  let next = await source.next();
  while (!next.done) {
    const event = next.value;
    if (!(event.type === "tool-call" && event.toolName === PLAN_TOOL_NAME))
      yield event;
    next = await source.next();
  }
  return {
    ...next.value,
    toolCalls: next.value.toolCalls.filter(
      (call) => call.toolName !== PLAN_TOOL_NAME,
    ),
  };
}

async function* runExecutor(
  { key, request, context }: TurnInfo,
  options: ResolvedOptions,
  session: ExecutingPlannerSession,
): AsyncGenerator<PolymodelEvent> {
  // Anthropic rejects conversations containing tool calls for undeclared tools,
  // so the marker tool must be declared alongside the client's tools.
  const tools: ToolSet = {
    ...request.tools,
    [PLAN_TOOL_NAME]: {
      description: PLAN_TOOL_DESCRIPTION,
      inputSchema: jsonSchema({ type: "object", properties: {} }),
    },
  };

  const result = yield* withoutPlanToolCalls(
    forwardStream(
      streamText({
        model: context.resolveModel(options.executor),
        instructions: [
          ...request.instructions,
          { role: "system", content: options.executorInstructions },
        ],
        messages: injectPlan(request.messages, {
          text: session.plan,
          index: session.planIndex,
          toolCallId: planToolCallId(key),
        }),
        tools,
        toolChoice: request.toolChoice,
        ...request.settings,
        ...options.executorSettings,
        abortSignal: context.abortSignal,
        onError: suppressStreamErrorLogging,
      }).fullStream,
    ),
  );

  const reason = toPolymodelFinishReason(result.finishReason);
  yield {
    type: "finish",
    reason:
      reason === "tool-calls" && result.toolCalls.length === 0
        ? "stop"
        : reason,
  };
}

function readSession(context: PolymodelContext, key: string) {
  return PlannerSessionSchema.safeParse(context.state.get(key)).data;
}

/**
 * The default polymodel: a strong model plans (optionally calling the client's
 * tools to investigate), then a fast model executes with the plan injected.
 * Planning runs once per user turn; tool-result turns go straight to the executor.
 */
export function plannerExecutor({
  description,
  ...options
}: PlannerExecutorOptions): Polymodel {
  const resolved: ResolvedOptions = {
    maxPlannerRounds: 8,
    plannerInstructions: DEFAULT_PLANNER_INSTRUCTIONS,
    executorInstructions: DEFAULT_EXECUTOR_INSTRUCTIONS,
    plannerSettings: {},
    executorSettings: {},
    ...options,
  };

  return definePolymodel({
    description:
      description ??
      `Plans with ${options.planner}, executes with ${options.executor}`,
    async *run(request, context) {
      const turn: TurnInfo = {
        key: await computeTurnKey(request.messages),
        request,
        context,
      };
      // A missing session mid-turn (e.g. after a restart) means planning starts over.
      const session = isNewUserTurn(request.messages)
        ? undefined
        : readSession(context, turn.key);
      const executing =
        session?.phase === "executing"
          ? session
          : yield* runPlanner(turn, resolved, session?.rounds ?? 0);
      if (executing) yield* runExecutor(turn, resolved, executing);
    },
  });
}
