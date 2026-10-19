import type { ModelMessage } from "ai";
import type { PolymodelCallSettings } from "#types";

export type WorkerLimits = {
  /** Tool rounds a worker may use before it is cut off. A brief may ask for fewer or more (up to 20). */
  maxRounds: number;
  /** Output tokens per worker call. */
  maxOutputTokens: number;
  /** Milliseconds a worker may go without producing text or a tool call. */
  stallMs: number;
};

export type WorkerBeeOptions = {
  /** Model reference for the planner, e.g. `"anthropic:claude-opus-5-5"`. */
  planner: string;
  /** Model reference for workers, e.g. `"anthropic:claude-haiku-5-5"`. */
  worker: string;
  /** Planner for turns after the conversation's first, e.g. a cheaper model. */
  followUpPlanner?: string;
  description?: string;
  workerLimits?: Partial<WorkerLimits>;
  /** Planner steps allowed per user turn before it must answer. */
  maxPlannerSteps?: number;
  /** Delegations allowed per user turn before the planner must answer. */
  maxDelegations?: number;
  plannerInstructions?: string;
  workerInstructions?: string;
  /** Planner call settings. Client settings (e.g. max_tokens) are not applied to the planner. */
  plannerSettings?: PolymodelCallSettings;
  /**
   * Overrides applied on top of the client's settings for workers. By default
   * workers reason at `"low"` effort and output is capped by `workerLimits`.
   */
  workerSettings?: PolymodelCallSettings;
};

export type ResolvedWorkerBeeOptions = Required<
  Omit<WorkerBeeOptions, "description" | "followUpPlanner" | "workerLimits">
> &
  Pick<WorkerBeeOptions, "followUpPlanner"> & { workerLimits: WorkerLimits };

export const DEFAULT_WORKER_LIMITS = {
  maxRounds: 8,
  maxOutputTokens: 4_096,
  stallMs: 60_000,
} satisfies WorkerLimits;

/** A small worker reasons at length about a whole task; the brief already carries the thinking. */
export const WORKER_DEFAULT_REASONING = "low";

/** Follow-up turns have an assistant reply before the newest user message. */
export function plannerReferenceFor(
  messages: ReadonlyArray<ModelMessage>,
  options: Pick<ResolvedWorkerBeeOptions, "planner" | "followUpPlanner">,
): string {
  const lastUser = messages.findLastIndex((message) => message.role === "user");
  const isFollowUp = messages
    .slice(0, lastUser)
    .some((message) => message.role === "assistant");
  return isFollowUp && options.followUpPlanner
    ? options.followUpPlanner
    : options.planner;
}
