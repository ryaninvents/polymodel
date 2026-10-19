import {
  WorkerBriefSchema,
  type Delegation,
  type DelegationReport,
  type QueuedDelegation,
} from "#types";
import type { ForwardedToolCall } from "../forwardStream.ts";
import { formatBriefIssues } from "./briefs.ts";
import { createTaskId } from "./ownership.ts";
import type { StepContext } from "./stepContext.ts";

function rejectionFor(call: ForwardedToolCall, overLimit: boolean) {
  if (overLimit)
    return "Delegation limit reached for this turn. Do the remaining work yourself, or answer now.";
  const brief = WorkerBriefSchema.safeParse(call.input);
  return brief.success ? undefined : formatBriefIssues(brief.error);
}

/**
 * Queues a planner step's `worker_bee` calls. The domain validates briefs
 * itself: an invalid one never reaches a worker, and the planner gets an
 * error result naming the bad fields.
 */
export function enqueueDelegations(
  { turn, options }: StepContext,
  calls: ReadonlyArray<ForwardedToolCall>,
): void {
  const batchId = createTaskId();
  const { delegations, queue } = turn.get();
  const remaining = options.maxDelegations - delegations.length - queue.length;
  const queued = calls.map((call, index): QueuedDelegation => ({
    taskId: createTaskId(),
    batchId,
    plannerToolCallId: call.toolCallId,
    input: call.input,
    rejection: rejectionFor(call, index >= remaining),
  }));
  turn.update((current) => ({
    ...current,
    queue: [...current.queue, ...queued],
  }));
}

function rejectedDelegation(
  item: QueuedDelegation,
  anchor: number,
  rejection: string,
): Delegation {
  const report: DelegationReport = {
    status: "failed",
    summary: rejection,
    files_changed: [],
  };
  return { ...baseDelegation(item, anchor), status: "failed", report };
}

function baseDelegation(item: QueuedDelegation, anchor: number) {
  return {
    taskId: item.taskId,
    batchId: item.batchId,
    anchor,
    plannerToolCallId: item.plannerToolCallId,
    input: item.input,
  };
}

/**
 * Takes the next runnable delegation off the queue, recording rejected ones as
 * failed on the way. Returns its task id, or `undefined` when none remain.
 */
export function startNextDelegation({
  turn,
  request,
}: StepContext): string | undefined {
  for (;;) {
    const [item, ...rest] = turn.get().queue;
    if (!item) return undefined;
    turn.update((current) => ({ ...current, queue: rest }));

    // A batch's collapsed pair goes where its first delegation started.
    const anchor =
      turn.get().delegations.find(({ batchId }) => batchId === item.batchId)
        ?.anchor ?? request.messages.length;

    if (item.rejection) {
      turn.saveDelegation(rejectedDelegation(item, anchor, item.rejection));
      continue;
    }
    turn.saveDelegation({ ...baseDelegation(item, anchor), status: "running" });
    return item.taskId;
  }
}
