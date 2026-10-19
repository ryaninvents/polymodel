import { streamText, type ToolChoice, type ToolSet } from "ai";
import type { PolymodelEvent } from "#types";
import {
  forwardStream,
  toPolymodelFinishReason,
  type ForwardResult,
} from "../forwardStream.ts";
import {
  observeCall,
  rewriteToolCalls,
  suppressStreamErrorLogging,
} from "../shared/index.ts";
import { enqueueDelegations } from "./delegationQueue.ts";
import { plannerReferenceFor } from "./options.ts";
import { FINAL_PLANNER_STEP_NOTE, WORKER_BEE_TOOL_NAME } from "./prompts.ts";
import type { StepContext } from "./stepContext.ts";
import { workerBeeTools } from "./tools.ts";
import { plannerView } from "./views.ts";

/**
 * - `forwarded`: client tool calls went out; the response is over.
 * - `delegating`: `worker_bee` calls were queued; a worker runs next.
 * - `answered`: the planner wrote its final answer.
 */
export type PlannerOutcome = "forwarded" | "delegating" | "answered";

function summarizeResult(result: ForwardResult) {
  return {
    finishReason: result.finishReason,
    textChars: result.text.length,
    reasoningChars: result.reasoning.length,
    toolCalls: result.toolCalls.map((call) => call.toolName),
  };
}

function budgetSpent({ turn, options }: StepContext): boolean {
  const { plannerSteps, delegations, queue } = turn.get();
  return (
    plannerSteps >= options.maxPlannerSteps ||
    delegations.length + queue.length >= options.maxDelegations
  );
}

export async function* plannerStep(
  step: StepContext,
): AsyncGenerator<PolymodelEvent, PlannerOutcome> {
  const { key, request, context, options, turn } = step;
  const exhausted = budgetSpent(step);
  const upstream = plannerReferenceFor(request.messages, options);
  const hasTools = Object.keys(request.tools).length > 0;
  const toolChoice: ToolChoice<ToolSet> =
    exhausted || request.toolChoice === "none" ? "none" : "auto";
  const view = plannerView(
    request.messages,
    turn.knownDelegations(request.messages),
  );

  context.logger.debug(
    {
      turn: key.slice(0, 12),
      plannerSteps: turn.get().plannerSteps,
      exhausted,
      messages: request.messages.length,
      viewMessages: view.length,
      clientTools: Object.keys(request.tools),
    },
    "planner step",
  );

  const result = yield* observeCall(
    context.logger,
    { stage: "planner", upstream },
    rewriteToolCalls(
      forwardStream(
        streamText({
          model: context.resolveModel(upstream),
          instructions: [
            ...request.instructions,
            { role: "system", content: options.plannerInstructions },
          ],
          messages: exhausted
            ? [...view, { role: "user", content: FINAL_PLANNER_STEP_NOTE }]
            : view,
          // Declared whenever tools are, even when disallowed: the history
          // may hold collapsed `worker_bee` calls, which providers require declared.
          ...(hasTools && {
            tools: { ...request.tools, ...workerBeeTools },
            toolChoice,
          }),
          ...options.plannerSettings,
          abortSignal: context.abortSignal,
          onError: suppressStreamErrorLogging,
        }).fullStream,
      ),
      (call) =>
        call.toolName === WORKER_BEE_TOOL_NAME ? undefined : call.toolCallId,
    ),
    summarizeResult,
    context.abortSignal,
  );

  turn.update((current) => ({
    ...current,
    plannerSteps: current.plannerSteps + 1,
  }));
  enqueueDelegations(step, result.hidden);

  // Client calls go first; delegations wait in the queue until their results return.
  if (result.toolCalls.length > 0) return "forwarded";
  if (result.hidden.length > 0) return "delegating";

  const reason = toPolymodelFinishReason(result.finishReason);
  yield { type: "finish", reason: reason === "tool-calls" ? "stop" : reason };
  return "answered";
}
