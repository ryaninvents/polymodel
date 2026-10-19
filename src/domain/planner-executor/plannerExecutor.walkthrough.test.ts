import { jsonSchema, type ToolSet } from "ai";
import { expect, it } from "vitest";
import { assistant, toolRound, user } from "../testing/conversationBuilders.ts";
import { summarizeCall } from "../testing/inspectCalls.ts";
import { textResponse, toolCallResponse } from "../testing/mockModels.ts";
import {
  createPlannerExecutorHarness,
  withoutUsage,
} from "../testing/plannerExecutorHarness.ts";
import { PLAN_TOOL_NAME } from "./prompts.ts";

// One user turn from an agent client (Claude Code, Cursor, …), request by
// request. The client executes every tool call and re-sends the whole
// conversation with the result appended; polymodel decides per request which
// model runs, based on the session stored for the turn.

const tools: ToolSet = {
  bash: {
    description: "Run a shell command",
    inputSchema: jsonSchema({ type: "object" }),
  },
};
const ls = { tool: "bash", input: { cmd: "ls" }, output: "a.ts a.test.ts" };
const runTests = {
  tool: "bash",
  input: { cmd: "pnpm test" },
  output: "1 passed",
};

it("walks one turn: plan → investigate → plan → execute → execute, then a new turn re-plans", async () => {
  const harness = createPlannerExecutorHarness({
    planner: [
      toolCallResponse("c1", "bash", { cmd: "ls" }), // request 1
      textResponse("1. fix a.ts\n2. run tests"), // request 2
      textResponse("1. add a test"), // request 4
    ],
    executor: [
      toolCallResponse("c2", "bash", { cmd: "pnpm test" }), // request 2
      textResponse("Fixed; tests pass."), // request 3
      textResponse("Added."), // request 4
    ],
  });

  // ── Request 1: the user asks. New turn → planner, which investigates with a client tool.
  const request1 = [user("fix the failing test")];
  const response1 = await harness.send(request1, { tools });

  expect(withoutUsage(response1)).toEqual([
    {
      type: "tool-call",
      toolCallId: "c1",
      toolName: "bash",
      input: '{"cmd":"ls"}',
    },
  ]);
  expect(await harness.sessionFor(request1)).toEqual({
    phase: "planning",
    rounds: 1,
  });

  // ── Request 2: the client returns the ls output. Session says "planning" → planner again.
  // This time it writes a plan, so the executor runs in the same response.
  const request2 = [...request1, ...toolRound("c1", ls)];
  const response2 = await harness.send(request2, { tools });

  expect(summarizeCall(harness.planner, 1).conversation).toEqual([
    "user: fix the failing test",
    'assistant → bash {"cmd":"ls"}',
    "tool ← bash: a.ts a.test.ts",
  ]);
  expect(summarizeCall(harness.executor, 0).conversation).toEqual([
    "user: fix the failing test",
    'assistant → bash {"cmd":"ls"}',
    "tool ← bash: a.ts a.test.ts",
    `assistant → ${PLAN_TOOL_NAME} {}`,
    `tool ← ${PLAN_TOOL_NAME}: 1. fix a.ts\n2. run tests`,
  ]);
  expect(withoutUsage(response2)).toEqual([
    { type: "reasoning-delta", text: "1. fix a.ts\n2. run tests" },
    {
      type: "tool-call",
      toolCallId: "c2",
      toolName: "bash",
      input: '{"cmd":"pnpm test"}',
    },
    { type: "finish", reason: "tool-calls" },
  ]);
  expect(await harness.sessionFor(request2)).toEqual({
    phase: "executing",
    plan: "1. fix a.ts\n2. run tests",
    planIndex: 3,
  });

  // ── Request 3: the client returns the test output. Session says "executing" → executor only.
  // The client never saw the plan as a tool call, so polymodel splices it back in from state.
  const request3 = [...request2, ...toolRound("c2", runTests)];
  const response3 = await harness.send(request3, { tools });

  expect(harness.planner.doStreamCalls).toHaveLength(2);
  expect(summarizeCall(harness.executor, 1).conversation).toEqual([
    "user: fix the failing test",
    'assistant → bash {"cmd":"ls"}',
    "tool ← bash: a.ts a.test.ts",
    `assistant → ${PLAN_TOOL_NAME} {}`,
    `tool ← ${PLAN_TOOL_NAME}: 1. fix a.ts\n2. run tests`,
    'assistant → bash {"cmd":"pnpm test"}',
    "tool ← bash: 1 passed",
  ]);
  expect(withoutUsage(response3)).toEqual([
    { type: "text-delta", text: "Fixed; tests pass." },
    { type: "finish", reason: "stop" },
  ]);

  // ── Request 4: a new user message starts a new turn with its own session → planner again.
  // The previous turn's plan is not re-injected; only the client's history carries over.
  const request4 = [
    ...request3,
    assistant("Fixed; tests pass."),
    user("now add a test"),
  ];
  await harness.send(request4, { tools });

  expect(harness.planner.doStreamCalls).toHaveLength(3);
  expect(summarizeCall(harness.executor, 2).conversation).not.toContain(
    `tool ← ${PLAN_TOOL_NAME}: 1. fix a.ts\n2. run tests`,
  );
  expect(await harness.sessionFor(request4)).toEqual({
    phase: "executing",
    plan: "1. add a test",
    planIndex: request4.length,
  });
  expect(harness.state.entries.size).toBe(2);
});
