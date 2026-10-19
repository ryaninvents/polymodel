import type { Polymodel, PolymodelEvent } from "#types";
import { assertNever } from "#util";
import { definePolymodel } from "../definitions.ts";
import { computeTurnKey, isNewUserTurn } from "../shared/index.ts";
import { startNextDelegation } from "./delegationQueue.ts";
import {
  DEFAULT_WORKER_LIMITS,
  type ResolvedWorkerBeeOptions,
  type WorkerBeeOptions,
} from "./options.ts";
import { lastAssistantOwner } from "./ownership.ts";
import {
  DEFAULT_PLANNER_INSTRUCTIONS,
  DEFAULT_WORKER_INSTRUCTIONS,
} from "./prompts.ts";
import { plannerStep } from "./plannerStep.ts";
import type { StepContext } from "./stepContext.ts";
import { createTurnSession } from "./turnSession.ts";
import { workerStep } from "./workerStep.ts";

type Step =
  | { kind: "planner" }
  | { kind: "worker"; taskId: string }
  | { kind: "next-delegation" };

function firstStep(step: StepContext, newTurn: boolean): Step {
  // A missing session mid-turn (e.g. after a restart) is survivable: the
  // history's tool-call ids still say whose turn it is.
  const owner = newTurn ? undefined : lastAssistantOwner(step.request.messages);
  const delegation = owner && step.turn.delegation(owner);
  // A finished owner means a retried request; the planner takes over.
  if (owner && (!delegation || delegation.status === "running"))
    return { kind: "worker", taskId: owner };
  return step.turn.get().queue.length > 0
    ? { kind: "next-delegation" }
    : { kind: "planner" };
}

async function* runStep(
  step: StepContext,
  current: Step,
): AsyncGenerator<PolymodelEvent, Step | undefined> {
  switch (current.kind) {
    case "planner": {
      const outcome = yield* plannerStep(step);
      return outcome === "delegating" ? { kind: "next-delegation" } : undefined;
    }
    case "worker": {
      const outcome = yield* workerStep(step, current.taskId);
      return outcome === "reported" ? { kind: "next-delegation" } : undefined;
    }
    case "next-delegation": {
      const taskId = startNextDelegation(step);
      return taskId ? { kind: "worker", taskId } : { kind: "planner" };
    }
    default:
      return assertNever(current);
  }
}

/**
 * A planner that stays in control of the whole turn. It hands small, scoped
 * tasks to cheap worker models through a virtual `worker_bee` tool, reads
 * their reports, and writes the final answer. Workers use the client's tools,
 * so one delegation can span several requests: tool-call ids carry the task id
 * to tell planner and worker messages apart.
 */
export function workerBee({
  description,
  workerLimits,
  ...options
}: WorkerBeeOptions): Polymodel {
  const resolved: ResolvedWorkerBeeOptions = {
    maxPlannerSteps: 40,
    maxDelegations: 12,
    plannerInstructions: DEFAULT_PLANNER_INSTRUCTIONS,
    workerInstructions: DEFAULT_WORKER_INSTRUCTIONS,
    plannerSettings: {},
    workerSettings: {},
    ...options,
    workerLimits: { ...DEFAULT_WORKER_LIMITS, ...workerLimits },
  };

  return definePolymodel({
    description:
      description ??
      `Plans with ${options.planner}, delegates to ${options.worker}`,
    async *run(request, context): AsyncGenerator<PolymodelEvent> {
      const key = await computeTurnKey(request.messages);
      const newTurn = isNewUserTurn(request.messages);
      const step: StepContext = {
        key,
        request,
        context,
        options: resolved,
        turn: createTurnSession(context, key, { resume: !newTurn }),
      };

      // Several hand-offs can happen in one response (worker → planner → next worker).
      let next: Step | undefined = firstStep(step, newTurn);
      while (next) next = yield* runStep(step, next);
    },
  });
}
