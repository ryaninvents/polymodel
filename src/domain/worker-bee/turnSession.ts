import type { ModelMessage } from "ai";
import {
  DelegatingSessionSchema,
  DelegationSchema,
  type DelegatingSession,
  type Delegation,
  type PolymodelContext,
} from "#types";
import { workerTaskIds } from "./ownership.ts";

const EMPTY_SESSION = {
  plannerSteps: 0,
  delegations: [],
  queue: [],
} satisfies DelegatingSession;

function taskKey(taskId: string): string {
  return `task:${taskId}`;
}

/**
 * Persists the turn's session after every change, and each delegation under
 * its own key so later turns can still collapse old worker stretches.
 */
export function createTurnSession(
  context: PolymodelContext,
  key: string,
  { resume }: { resume: boolean },
) {
  let session: DelegatingSession =
    (resume &&
      DelegatingSessionSchema.safeParse(context.state.get(key)).data) ||
    EMPTY_SESSION;

  function update(change: (current: DelegatingSession) => DelegatingSession) {
    session = change(session);
    context.state.set(key, session);
  }

  function readTask(taskId: string): Delegation | undefined {
    return DelegationSchema.safeParse(context.state.get(taskKey(taskId))).data;
  }

  return {
    get: () => session,
    update,

    delegation: (taskId: string) =>
      session.delegations.find((delegation) => delegation.taskId === taskId),

    saveDelegation(delegation: Delegation) {
      context.state.set(taskKey(delegation.taskId), delegation);
      update((current) => ({
        ...current,
        delegations: [
          ...current.delegations.filter(
            ({ taskId }) => taskId !== delegation.taskId,
          ),
          delegation,
        ],
      }));
    },

    /**
     * Everything known about the delegations visible in `messages`. Delegations
     * that never produced a tool call leave nothing in the history to find
     * them by, so those are only known within their own turn.
     */
    knownDelegations(
      messages: ReadonlyArray<ModelMessage>,
    ): Map<string, Delegation> {
      const known = new Map(
        session.delegations.map((delegation) => [
          delegation.taskId,
          delegation,
        ]),
      );
      for (const taskId of workerTaskIds(messages)) {
        const stored = known.has(taskId) ? undefined : readTask(taskId);
        if (stored) known.set(taskId, stored);
      }
      return known;
    },
  };
}

export type TurnSession = ReturnType<typeof createTurnSession>;
