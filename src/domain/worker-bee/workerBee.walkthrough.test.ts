import { expect, it } from "vitest";
import { toolRound, user } from "../testing/conversationBuilders.ts";
import { summarizeCall } from "../testing/inspectCalls.ts";
import { textResponse, toolCallResponse } from "../testing/mockModels.ts";
import {
  createWorkerBeeHarness,
  firstToolCallId,
  withoutUsage,
} from "../testing/workerBeeHarness.ts";
import { renderBrief } from "./briefs.ts";
import { clientTools, createTestBrief } from "./fixtures.ts";

// One user turn, request by request: the planner delegates an exploration,
// re-scopes after a worker fails, makes the delicate edit itself and answers.
// The client executes every tool call and re-sends the whole conversation.

const explore = createTestBrief();
const rescoped = createTestBrief({
  goal: "Run the routing tests and report failures",
  done_when: "List failing test names, one per line",
});

it("walks one turn across five requests, then a new turn starts clean", async () => {
  const harness = createWorkerBeeHarness({
    planner: [
      toolCallResponse("p1", "worker_bee", explore), // request 1
      toolCallResponse("p2", "worker_bee", rescoped), // request 2
      toolCallResponse("p3", "edit", { path: "turnKey.ts" }), // request 3
      textResponse("Done: the key now includes the planner."), // request 4
      textResponse("Sure."), // request 5
    ],
    worker: [
      toolCallResponse("w1", "bash", { cmd: "grep -rn computeTurnKey" }), // request 1
      toolCallResponse("r1", "report_back", {
        status: "done",
        summary: "computeTurnKey is in shared/turnKey.ts",
        files_changed: [],
      }), // request 2
      toolCallResponse("w2", "bash", { cmd: "pnpm test" }), // request 2
      toolCallResponse("r2", "report_back", {
        status: "failed",
        summary: "Cannot run tests: no test script",
        files_changed: [],
      }), // request 3
    ],
  });
  const tools = clientTools;

  // ── Request 1: new turn → planner delegates an exploration; its worker calls a client tool.
  const request1 = [user("include the planner in the turn key")];
  const response1 = await harness.send(request1, { tools });
  const worker1Call = firstToolCallId(response1);

  expect(worker1Call).toMatch(/^pmwb_[0-9a-f]{8}_w1$/);
  expect(withoutUsage(response1).map((event) => event.type)).toEqual([
    "tool-call",
  ]);
  expect(await harness.sessionFor(request1)).toMatchObject({
    plannerSteps: 1,
    delegations: [{ status: "running", anchor: 1 }],
    queue: [],
  });

  // ── Request 2: the last assistant message is worker 1's → worker 1 continues, reports,
  // and the planner re-plans in the same response. It delegates again; worker 2 acts.
  const request2 = [
    ...request1,
    ...toolRound(worker1Call, {
      tool: "bash",
      input: { cmd: "grep -rn computeTurnKey" },
      output: "src/domain/shared/turnKey.ts:14",
    }),
  ];
  const response2 = await harness.send(request2, { tools });
  const worker2Call = firstToolCallId(response2);

  expect(summarizeCall(harness.worker, 1).conversation).toEqual([
    `user: ${renderBrief(explore)}`,
    'assistant → bash {"cmd":"grep -rn computeTurnKey"}',
    "tool ← bash: src/domain/shared/turnKey.ts:14",
  ]);
  expect(summarizeCall(harness.planner, 1).conversation).toEqual([
    "user: include the planner in the turn key",
    `assistant → worker_bee ${JSON.stringify(explore)}`,
    "tool ← worker_bee: status: done\nsummary: computeTurnKey is in shared/turnKey.ts\nfiles_changed: none",
  ]);
  expect(worker2Call).toMatch(/^pmwb_[0-9a-f]{8}_w2$/);

  // ── Request 3: worker 2 reports a failure; the planner sees both reports and edits itself.
  const request3 = [
    ...request2,
    ...toolRound(worker2Call, {
      tool: "bash",
      input: { cmd: "pnpm test" },
      output: "ERR_PNPM_NO_SCRIPT",
    }),
  ];
  const response3 = await harness.send(request3, { tools });

  expect(summarizeCall(harness.planner, 2).conversation).toEqual([
    "user: include the planner in the turn key",
    `assistant → worker_bee ${JSON.stringify(explore)}`,
    "tool ← worker_bee: status: done\nsummary: computeTurnKey is in shared/turnKey.ts\nfiles_changed: none",
    `assistant → worker_bee ${JSON.stringify(rescoped)}`,
    "tool ← worker_bee: status: failed\nsummary: Cannot run tests: no test script\nfiles_changed: none",
  ]);
  expect(firstToolCallId(response3)).toBe("p3");

  // ── Request 4: the last assistant message is the planner's → planner step; it answers.
  const request4 = [
    ...request3,
    ...toolRound("p3", {
      tool: "edit",
      input: { path: "turnKey.ts" },
      output: "ok",
    }),
  ];
  const response4 = await harness.send(request4, { tools });

  expect(summarizeCall(harness.planner, 3).conversation.slice(-3)).toEqual([
    "tool ← worker_bee: status: failed\nsummary: Cannot run tests: no test script\nfiles_changed: none",
    'assistant → edit {"path":"turnKey.ts"}',
    "tool ← edit: ok",
  ]);
  expect(withoutUsage(response4)).toEqual([
    { type: "text-delta", text: "Done: the key now includes the planner." },
    { type: "finish", reason: "stop" },
  ]);
  expect(harness.worker.doStreamCalls).toHaveLength(4);

  // ── Request 5: a new user message starts a new turn. Old worker stretches
  // stay collapsed, so the planner's prefix is the one it already cached.
  await harness.send(
    [
      ...request4,
      { role: "assistant", content: "Done: the key now includes the planner." },
      user("thanks"),
    ],
    { tools },
  );

  expect(summarizeCall(harness.planner, 4).conversation).toEqual([
    ...summarizeCall(harness.planner, 3).conversation,
    "assistant: Done: the key now includes the planner.",
    "user: thanks",
  ]);
});
