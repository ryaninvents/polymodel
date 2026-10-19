import { jsonSchema, type ToolSet } from "ai";
import type { Delegation, WorkerBrief } from "#types";

/** Shared by the worker-bee tests; not part of the module's API. */

export const clientTools: ToolSet = {
  bash: {
    description: "Run a shell command",
    inputSchema: jsonSchema({ type: "object" }),
  },
  edit: {
    description: "Edit a file",
    inputSchema: jsonSchema({ type: "object" }),
  },
};

export function createTestBrief(overrides: Partial<WorkerBrief> = {}) {
  return {
    goal: "Find where turn keys are computed",
    context: "Look under src/domain",
    files: [],
    decisions: "Read-only; change nothing",
    done_when: "Reply with the file and function name",
    ...overrides,
  } satisfies WorkerBrief;
}

export function createTestDelegation(
  overrides: Partial<Delegation> = {},
): Delegation {
  return {
    taskId: "aaaaaaaa",
    batchId: "batch001",
    anchor: 1,
    plannerToolCallId: "call_planner_1",
    input: createTestBrief(),
    status: "done",
    report: { status: "done", summary: "In turnKey.ts", files_changed: [] },
    ...overrides,
  };
}

export const doneReport = {
  status: "done",
  summary: "computeTurnKey in shared/turnKey.ts",
  files_changed: [],
} as const;
