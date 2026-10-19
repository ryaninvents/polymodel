import { z } from "zod";

/** The structured task a planner hands to a worker through `worker_bee`. */
export const WorkerBriefSchema = z.object({
  goal: z
    .string()
    .min(1)
    .describe("One sentence naming the observable outcome"),
  context: z
    .string()
    .describe(
      "Facts the worker needs: paths, symbols, the pattern to copy, conventions",
    ),
  files: z
    .array(z.string())
    .describe(
      "Files the worker may read or change; empty means read-only exploration",
    ),
  decisions: z
    .string()
    .describe("Choices already made; the worker must not revisit them"),
  done_when: z
    .string()
    .min(1)
    .describe(
      "A concrete acceptance check: a command and its expected result, or the exact shape of the summary wanted",
    ),
  out_of_scope: z.string().optional(),
  max_rounds: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Tool rounds the worker may use before it is cut off"),
});

export type WorkerBrief = z.infer<typeof WorkerBriefSchema>;

/** What a worker hands back through `report_back`. */
export const WorkerReportSchema = z.object({
  status: z.enum(["done", "blocked", "failed"]),
  summary: z
    .string()
    .describe("What was found or done, in the form the brief asked for"),
  files_changed: z.array(z.string()),
  notes: z
    .string()
    .optional()
    .describe("Surprises, assumptions, anything the planner should check"),
});

export type WorkerReport = z.infer<typeof WorkerReportSchema>;

/** Polymodel itself reports `exhausted`: the model never got to say anything. */
export const DelegationReportSchema = WorkerReportSchema.extend({
  status: z.enum(["done", "blocked", "failed", "exhausted"]),
});

export type DelegationReport = z.infer<typeof DelegationReportSchema>;

export const DelegationSchema = z.object({
  taskId: z.string(),
  /** Delegations issued by one planner step share a batch and one collapsed pair. */
  batchId: z.string(),
  /** Where in the client's history the batch's collapsed pair belongs. */
  anchor: z.number().int().nonnegative(),
  plannerToolCallId: z.string(),
  /** The arguments exactly as the planner wrote them, so replays are byte-stable. */
  input: z.unknown(),
  status: z.enum(["running", "done", "blocked", "failed", "exhausted"]),
  report: DelegationReportSchema.optional(),
});

export type Delegation = z.infer<typeof DelegationSchema>;

export const QueuedDelegationSchema = z.object({
  taskId: z.string(),
  batchId: z.string(),
  plannerToolCallId: z.string(),
  input: z.unknown(),
  /** Set when the brief can't run (invalid, or over the delegation limit). */
  rejection: z.string().optional(),
});

export type QueuedDelegation = z.infer<typeof QueuedDelegationSchema>;

/**
 * Per-turn state for the worker-bee polymodel. A "turn" is everything that
 * follows one user message, which may span many requests as the client runs
 * tool calls and sends the results back.
 */
export const DelegatingSessionSchema = z.object({
  plannerSteps: z.number().int().nonnegative(),
  /** Started and finished delegations, in issue order. */
  delegations: z.array(DelegationSchema),
  queue: z.array(QueuedDelegationSchema),
});

export type DelegatingSession = z.infer<typeof DelegatingSessionSchema>;
