import { jsonSchema, type ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { toolRound, user } from "../testing/conversationBuilders.ts";
import { summarizeCall } from "../testing/inspectCalls.ts";
import { textResponse, toolCallResponse } from "../testing/mockModels.ts";
import {
  createPlannerExecutorHarness,
  EXECUTOR_PROMPT,
  PLANNER_PROMPT,
} from "../testing/plannerExecutorHarness.ts";
import { PLAN_TOOL_NAME } from "./prompts.ts";

// What each upstream model is shown for a single request. The planner sees the
// client's conversation as-is; the executor sees the same conversation with the
// plan spliced in as a `planning_finished` tool call it appears to have made.

const clientTools: ToolSet = {
  bash: {
    description: "Run a shell command",
    inputSchema: jsonSchema({ type: "object" }),
  },
  edit: {
    description: "Edit a file",
    inputSchema: jsonSchema({ type: "object" }),
  },
};
const clientInstructions = [
  { role: "system" as const, content: "You are a coding agent." },
];
const ls = { tool: "bash", input: { cmd: "ls" }, output: "a.ts b.ts" };

function newTurnHarness(options = {}) {
  return createPlannerExecutorHarness({
    planner: [textResponse("1. edit a.ts")],
    executor: [textResponse("Done.")],
    options,
  });
}

describe("routing to the planner", () => {
  it("receives the client's instructions followed by the planner prompt", async () => {
    const harness = newTurnHarness();
    await harness.send([user("fix it")], { instructions: clientInstructions });

    expect(summarizeCall(harness.planner).system).toBe(
      `You are a coding agent.\n\n${PLANNER_PROMPT}`,
    );
  });

  it("receives the conversation exactly as the client sent it", async () => {
    const harness = newTurnHarness();
    await harness.send([user("fix it"), ...toolRound("c1", ls)], {
      tools: clientTools,
    });

    expect(summarizeCall(harness.planner).conversation).toEqual([
      "user: fix it",
      'assistant → bash {"cmd":"ls"}',
      "tool ← bash: a.ts b.ts",
    ]);
  });

  it("may call any of the client's tools", async () => {
    const harness = newTurnHarness();
    await harness.send([user("fix it")], { tools: clientTools });

    expect(summarizeCall(harness.planner)).toMatchObject({
      tools: ["bash", "edit"],
      toolChoice: "auto",
    });
  });

  it("is not offered tools when the client forbids tool use", async () => {
    const harness = newTurnHarness();
    await harness.send([user("fix it")], {
      tools: clientTools,
      toolChoice: "none",
    });

    expect(summarizeCall(harness.planner).toolChoice).toBe("none");
  });

  it("is offered no tools when the client defines none", async () => {
    const harness = newTurnHarness();
    await harness.send([user("hi")]);

    expect(summarizeCall(harness.planner).tools).toEqual([]);
  });

  it("uses plannerSettings, not the client's sampling settings", async () => {
    const harness = newTurnHarness({ plannerSettings: { temperature: 0.3 } });
    // A client max_tokens sized for the final answer would truncate the plan.
    await harness.send([user("fix it")], {
      settings: { temperature: 0.9, maxOutputTokens: 50 },
    });

    expect(summarizeCall(harness.planner).settings).toEqual({
      temperature: 0.3,
    });
  });
});

describe("routing to the executor", () => {
  it("receives the client's instructions followed by the executor prompt", async () => {
    const harness = newTurnHarness();
    await harness.send([user("fix it")], { instructions: clientInstructions });

    expect(summarizeCall(harness.executor).system).toBe(
      `You are a coding agent.\n\n${EXECUTOR_PROMPT}`,
    );
  });

  it("receives the plan as the result of a planning_finished call it never made", async () => {
    const harness = newTurnHarness();
    await harness.send([user("fix it")]);

    expect(summarizeCall(harness.executor).conversation).toEqual([
      "user: fix it",
      `assistant → ${PLAN_TOOL_NAME} {}`,
      `tool ← ${PLAN_TOOL_NAME}: 1. edit a.ts`,
    ]);
  });

  it("sees the plan after the planner's investigation, so it can reuse those tool results", async () => {
    const harness = createPlannerExecutorHarness({
      planner: [textResponse("1. edit a.ts")],
      executor: [textResponse("Done.")],
    });
    // A tool-result request with no stored session: the planner (re)plans here.
    await harness.send([user("fix it"), ...toolRound("c1", ls)], {
      tools: clientTools,
    });

    expect(summarizeCall(harness.executor).conversation).toEqual([
      "user: fix it",
      'assistant → bash {"cmd":"ls"}',
      "tool ← bash: a.ts b.ts",
      `assistant → ${PLAN_TOOL_NAME} {}`,
      `tool ← ${PLAN_TOOL_NAME}: 1. edit a.ts`,
    ]);
  });

  it("is offered the client's tools plus a declared-but-forbidden planning_finished tool", async () => {
    const harness = newTurnHarness();
    await harness.send([user("fix it")], { tools: clientTools });

    // Anthropic rejects histories that reference undeclared tools, hence the declaration.
    expect(summarizeCall(harness.executor).tools).toEqual([
      "bash",
      "edit",
      PLAN_TOOL_NAME,
    ]);
  });

  it("honors the client's tool_choice", async () => {
    const harness = createPlannerExecutorHarness({
      planner: [textResponse("1. edit a.ts")],
      // The AI SDK verifies that a forced tool choice was obeyed.
      executor: [toolCallResponse("c2", "edit", { path: "a.ts" })],
    });
    await harness.send([user("fix it")], {
      tools: clientTools,
      toolChoice: { type: "tool", toolName: "edit" },
    });

    expect(summarizeCall(harness.executor).toolChoice).toBe("tool:edit");
  });

  it("uses the client's settings, with executorSettings taking precedence", async () => {
    const harness = newTurnHarness({ executorSettings: { temperature: 0 } });
    await harness.send([user("fix it")], {
      settings: { temperature: 0.9, maxOutputTokens: 50 },
    });

    expect(summarizeCall(harness.executor).settings).toEqual({
      temperature: 0,
      maxOutputTokens: 50,
    });
  });
});
