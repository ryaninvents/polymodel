import { z } from "zod";

/**
 * Per-turn state for the planner/executor polymodel. A "turn" is everything that
 * follows one user message, which may span many requests as the client executes
 * tool calls and sends the results back.
 */
export const PlannerSessionSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("planning"),
    rounds: z.number().int().nonnegative(),
  }),
  z.object({
    phase: z.literal("executing"),
    plan: z.string(),
    /** Position in the conversation where the plan is injected for the executor. */
    planIndex: z.number().int().nonnegative(),
  }),
]);

export type PlannerSession = z.infer<typeof PlannerSessionSchema>;
export type ExecutingPlannerSession = Extract<
  PlannerSession,
  { phase: "executing" }
>;
