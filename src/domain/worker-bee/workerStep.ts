import { streamText } from "ai";
import {
  WorkerReportSchema,
  type Delegation,
  type DelegationReport,
  type PolymodelCallSettings,
  type PolymodelEvent,
  WorkerBriefSchema,
} from "#types";
import { forwardStream, type ForwardResult } from "../forwardStream.ts";
import {
  createStallGuard,
  observeCall,
  rewriteToolCalls,
  suppressStreamErrorLogging,
  type RewrittenResult,
} from "../shared/index.ts";
import { recoveredBrief, syntheticReport } from "./briefs.ts";
import { countRounds, firstIndexOf, prefixToolCallId } from "./ownership.ts";
import { WORKER_DEFAULT_REASONING } from "./options.ts";
import { REPORT_BACK_TOOL_NAME } from "./prompts.ts";
import type { StepContext } from "./stepContext.ts";
import { reportBackTools } from "./tools.ts";
import { workerView } from "./views.ts";

/**
 * - `forwarded`: the worker's client tool calls went out; the response is over.
 * - `reported`: the delegation finished; polymodel continues the turn.
 */
export type WorkerOutcome = "forwarded" | "reported";

function summarizeResult(result: ForwardResult) {
  return {
    finishReason: result.finishReason,
    textChars: result.text.length,
    reasoningChars: result.reasoning.length,
    toolCalls: result.toolCalls.map((call) => call.toolName),
  };
}

function workerCallSettings({
  request,
  options,
}: StepContext): PolymodelCallSettings {
  const cap = options.workerLimits.maxOutputTokens;
  return {
    ...request.settings,
    reasoning: WORKER_DEFAULT_REASONING,
    maxOutputTokens: Math.min(request.settings.maxOutputTokens ?? cap, cap),
    ...options.workerSettings,
  };
}

/** Falls back for a delegation whose state was lost (e.g. a server restart). */
function recoveredDelegation(
  { request }: StepContext,
  taskId: string,
): Delegation {
  return {
    taskId,
    batchId: taskId,
    anchor: Math.max(0, firstIndexOf(request.messages, taskId)),
    plannerToolCallId: `call_pmwb_${taskId}`,
    input: recoveredBrief(),
    status: "running",
  };
}

function reportFromCall(input: unknown): DelegationReport {
  const parsed = WorkerReportSchema.safeParse(input);
  return parsed.success
    ? parsed.data
    : {
        status: "failed",
        summary: `Worker called ${REPORT_BACK_TOOL_NAME} with invalid arguments: ${JSON.stringify(input)}`,
        files_changed: [],
      };
}

function reportFromResult(
  result: RewrittenResult,
  maxOutputTokens: number,
): DelegationReport {
  const reportCall = result.hidden.find(
    (call) => call.toolName === REPORT_BACK_TOOL_NAME,
  );
  if (reportCall) return reportFromCall(reportCall.input);
  if (result.finishReason === "length")
    return {
      status: "failed",
      summary: `Worker hit its ${maxOutputTokens}-token output limit without acting.`,
      files_changed: [],
    };
  // Models that ignore report_back still work: their closing text is the report.
  const text = result.text.trim();
  return {
    status: text ? "done" : "failed",
    summary: text || "Worker ended without a tool call or any text.",
    files_changed: [],
  };
}

export async function* workerStep(
  step: StepContext,
  taskId: string,
): AsyncGenerator<PolymodelEvent, WorkerOutcome> {
  const { request, context, options, turn } = step;
  const delegation =
    turn.delegation(taskId) ?? recoveredDelegation(step, taskId);
  const brief = WorkerBriefSchema.safeParse(delegation.input).data;
  const round = countRounds(request.messages, taskId);
  const maxRounds = brief?.max_rounds ?? options.workerLimits.maxRounds;
  const { maxOutputTokens, stallMs } = options.workerLimits;

  function finish(report: DelegationReport): WorkerOutcome {
    turn.saveDelegation({ ...delegation, status: report.status, report });
    context.logger.info(
      {
        taskId,
        goal: brief?.goal,
        status: report.status,
        rounds: round,
        filesChanged: report.files_changed.length,
      },
      "delegation finished",
    );
    return "reported";
  }

  if (round >= maxRounds)
    return finish(
      syntheticReport(
        "exhausted",
        `Worker used ${round}/${maxRounds} tool rounds without reporting back.`,
        request.messages,
        taskId,
      ),
    );

  const guard = createStallGuard(context.abortSignal, stallMs);
  let result: RewrittenResult | undefined;
  try {
    result = yield* observeCall(
      context.logger,
      { stage: "worker", upstream: options.worker, taskId, round },
      rewriteToolCalls(
        forwardStream(
          guard.watch(
            streamText({
              model: context.resolveModel(options.worker),
              instructions: [
                ...request.instructions,
                { role: "system", content: options.workerInstructions },
              ],
              messages: workerView(request.messages, taskId, brief),
              tools: { ...request.tools, ...reportBackTools },
              toolChoice: "auto",
              ...workerCallSettings(step),
              abortSignal: guard.signal,
              onError: suppressStreamErrorLogging,
            }).fullStream,
          ),
          // The user follows a worker's progress as reasoning; only the planner answers.
          { textAs: "reasoning" },
        ),
        (call) =>
          call.toolName === REPORT_BACK_TOOL_NAME
            ? undefined
            : prefixToolCallId(taskId, call.toolCallId),
      ),
      summarizeResult,
      context.abortSignal,
    );
  } catch (error) {
    if (!guard.stalled()) throw error;
  } finally {
    guard.dispose();
  }

  if (guard.stalled() || !result)
    return finish(
      syntheticReport(
        "failed",
        `Worker stalled: no text or tool call for ${stallMs / 1000}s (it was reasoning without acting).`,
        request.messages,
        taskId,
      ),
    );

  // Client calls win over a simultaneous report_back: they haven't run yet,
  // and the worker can report once it sees their results.
  if (result.toolCalls.length > 0) return "forwarded";

  return finish(reportFromResult(result, maxOutputTokens));
}
