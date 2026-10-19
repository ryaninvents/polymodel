import type { ModelMessage } from "ai";
import type { Delegation, WorkerBrief } from "#types";
import { recoveredBrief, renderBrief, renderReport } from "./briefs.ts";
import { stretchOf, workerTaskOf } from "./ownership.ts";
import { WORKER_BEE_TOOL_NAME } from "./prompts.ts";

/**
 * Both views are pure functions of the client's messages and the delegations
 * polymodel remembers. They decide what each model is shown.
 */

function collapsedPair(batch: ReadonlyArray<Delegation>): Array<ModelMessage> {
  return [
    {
      role: "assistant",
      content: batch.map((delegation) => ({
        type: "tool-call" as const,
        toolCallId: delegation.plannerToolCallId,
        toolName: WORKER_BEE_TOOL_NAME,
        input: delegation.input,
      })),
    },
    {
      role: "tool",
      content: batch.map((delegation) => ({
        type: "tool-result" as const,
        toolCallId: delegation.plannerToolCallId,
        toolName: WORKER_BEE_TOOL_NAME,
        output: {
          type: "text" as const,
          value: delegation.report
            ? renderReport(delegation.report)
            : delegation.status,
        },
      })),
    },
  ];
}

function groupBatches(
  delegations: Iterable<Delegation>,
): Map<string, Array<Delegation>> {
  const batches = new Map<string, Array<Delegation>>();
  for (const delegation of delegations)
    batches.set(delegation.batchId, [
      ...(batches.get(delegation.batchId) ?? []),
      delegation,
    ]);
  return batches;
}

/**
 * The client's conversation with every finished worker stretch replaced by one
 * synthetic `worker_bee` call/result pair, so the planner sees the shape it
 * produced and its prompt prefix is stable (cacheable). Running or unknown
 * stretches pass through unchanged.
 */
export function plannerView(
  messages: ReadonlyArray<ModelMessage>,
  delegations: ReadonlyMap<string, Delegation>,
): Array<ModelMessage> {
  const finished = [...delegations.values()].filter(
    (delegation) => delegation.status !== "running",
  );
  const collapsed = new Set(finished.map((delegation) => delegation.taskId));

  const pairsAt = new Map<number, Array<ModelMessage>>();
  for (const batch of groupBatches(finished).values()) {
    const at = Math.min(batch[0]?.anchor ?? 0, messages.length);
    pairsAt.set(at, [...(pairsAt.get(at) ?? []), ...collapsedPair(batch)]);
  }

  const view: Array<ModelMessage> = [];
  messages.forEach((message, index) => {
    view.push(...(pairsAt.get(index) ?? []));
    const owner = workerTaskOf(message);
    if (!owner || !collapsed.has(owner)) view.push(message);
  });
  view.push(...(pairsAt.get(messages.length) ?? []));
  return view;
}

/**
 * Only the brief and the task's own tool rounds: the user's conversation,
 * the planner's exploration and other tasks stay out, which keeps the worker's
 * context to a few thousand tokens.
 */
export function workerView(
  messages: ReadonlyArray<ModelMessage>,
  taskId: string,
  brief: WorkerBrief | undefined,
): Array<ModelMessage> {
  const ownRounds = stretchOf(messages, taskId).map((message): ModelMessage =>
    message.role === "assistant" && typeof message.content !== "string"
      ? {
          ...message,
          // Any text here was written by the planner earlier in the same response.
          content: message.content.filter((part) => part.type === "tool-call"),
        }
      : message,
  );
  return [
    { role: "user", content: renderBrief(brief ?? recoveredBrief()) },
    ...ownRounds,
  ];
}
