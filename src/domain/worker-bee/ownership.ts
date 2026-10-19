import type { ModelMessage } from "ai";

const PREFIX = "pmwb_";
const WORKER_ID = /^pmwb_([A-Za-z0-9]{8})_(.+)$/;

export function createTaskId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

/**
 * Worker tool calls leave polymodel with the task id baked into their ids.
 * Clients echo ids back unchanged, so the history says who owns each message
 * with no server state. Characters stay within `[A-Za-z0-9_-]`, which
 * Anthropic's `tool_use.id` pattern requires.
 */
export function prefixToolCallId(taskId: string, upstreamId: string): string {
  return `${PREFIX}${taskId}_${upstreamId}`;
}

export function parseWorkerToolCallId(
  toolCallId: string,
): { taskId: string; upstreamId: string } | undefined {
  const match = WORKER_ID.exec(toolCallId);
  return match?.[1] && match[2]
    ? { taskId: match[1], upstreamId: match[2] }
    : undefined;
}

function toolCallIds(message: ModelMessage): Array<string> {
  if (typeof message.content === "string") return [];
  return message.content.flatMap((part) =>
    part.type === "tool-call" || part.type === "tool-result"
      ? [part.toolCallId]
      : [],
  );
}

/**
 * The worker task a message belongs to, or `undefined` for the planner.
 * Plain assistant text can only come from the planner: worker output is
 * streamed as reasoning, which comes back as `reasoning_content` and is dropped.
 */
export function workerTaskOf(message: ModelMessage): string | undefined {
  for (const id of toolCallIds(message)) {
    const parsed = parseWorkerToolCallId(id);
    if (parsed) return parsed.taskId;
  }
  return undefined;
}

/** Owner of the newest assistant message: the worker task id, or `undefined` for the planner. */
export function lastAssistantOwner(
  messages: ReadonlyArray<ModelMessage>,
): string | undefined {
  const last = messages.findLast((message) => message.role === "assistant");
  return last && workerTaskOf(last);
}

/** Task ids in order of first appearance. */
export function workerTaskIds(
  messages: ReadonlyArray<ModelMessage>,
): Array<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    const taskId = workerTaskOf(message);
    if (taskId) ids.add(taskId);
  }
  return [...ids];
}

export function stretchOf(
  messages: ReadonlyArray<ModelMessage>,
  taskId: string,
): Array<ModelMessage> {
  return messages.filter((message) => workerTaskOf(message) === taskId);
}

/** Counted from history, not state, so the budget survives a restart. */
export function countRounds(
  messages: ReadonlyArray<ModelMessage>,
  taskId: string,
): number {
  return stretchOf(messages, taskId).filter(
    (message) => message.role === "assistant",
  ).length;
}

export function firstIndexOf(
  messages: ReadonlyArray<ModelMessage>,
  taskId: string,
): number {
  return messages.findIndex((message) => workerTaskOf(message) === taskId);
}
