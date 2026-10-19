import { jsonSchema, type ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { toolRound, user } from "../testing/conversationBuilders.ts";
import { summarizeCall } from "../testing/inspectCalls.ts";
import { textResponse, toolCallResponse } from "../testing/mockModels.ts";
import {
  createPlannerExecutorHarness,
  PLANNER_PROMPT,
  withoutUsage,
} from "../testing/plannerExecutorHarness.ts";
import { FINAL_PLANNER_ROUND_NOTE, PLAN_TOOL_NAME } from "./prompts.ts";

// Each turn has one stored session, keyed by the conversation up to its user
// message (see conversation.test.ts):
//
//   (none)                               → run the planner
//   { phase: "planning", rounds }        → run the planner again; it is mid-investigation
//   { phase: "executing", plan, planIndex } → run the executor with the stored plan
//
// A request whose newest message is from the user always starts a new turn.

const tools: ToolSet = {
  bash: {
    description: "Run a shell command",
    inputSchema: jsonSchema({ type: "object" }),
  },
};
const ls = { tool: "bash", input: { cmd: "ls" }, output: "a.ts" };
const runTests = { tool: "bash", input: { cmd: "pnpm test" }, output: "ok" };
const opening = [user("fix it")];

describe("choosing a route from stored state", () => {
  it("plans when the newest message is from the user, even if the turn has a stored session", async () => {
    const harness = createPlannerExecutorHarness({
      planner: [textResponse("fresh plan")],
      executor: [textResponse("Done.")],
    });
    // e.g. the client retried or regenerated the same message
    await harness.storeSession(opening, {
      phase: "executing",
      plan: "stale plan",
      planIndex: 1,
    });

    await harness.send(opening);

    expect(harness.planner.doStreamCalls).toHaveLength(1);
    expect(await harness.sessionFor(opening)).toMatchObject({
      plan: "fresh plan",
    });
  });

  it("skips the planner when the turn is already executing, using the stored plan", async () => {
    const harness = createPlannerExecutorHarness({
      executor: [textResponse("All green.")],
    });
    const conversation = [...opening, ...toolRound("c1", runTests)];
    await harness.storeSession(conversation, {
      phase: "executing",
      plan: "STORED PLAN",
      planIndex: 1,
    });

    await harness.send(conversation, { tools });

    expect(harness.planner.doStreamCalls).toHaveLength(0);
    // The plan comes from state, not from anything the client sent.
    expect(summarizeCall(harness.executor).conversation).toEqual([
      "user: fix it",
      `assistant → ${PLAN_TOOL_NAME} {}`,
      `tool ← ${PLAN_TOOL_NAME}: STORED PLAN`,
      'assistant → bash {"cmd":"pnpm test"}',
      "tool ← bash: ok",
    ]);
  });

  it("resumes the planner when the tool result answers a planner tool call", async () => {
    const harness = createPlannerExecutorHarness({
      planner: [textResponse("plan")],
      executor: [textResponse("Done.")],
    });
    const conversation = [...opening, ...toolRound("c1", ls)];
    await harness.storeSession(conversation, { phase: "planning", rounds: 1 });

    await harness.send(conversation, { tools });

    expect(summarizeCall(harness.planner).conversation).toEqual([
      "user: fix it",
      'assistant → bash {"cmd":"ls"}',
      "tool ← bash: a.ts",
    ]);
  });

  it("starts planning over when a tool result arrives for a turn it has no state for", async () => {
    // e.g. polymodel restarted mid-turn, or the session expired
    const harness = createPlannerExecutorHarness({
      planner: [textResponse("plan")],
      executor: [textResponse("Done.")],
    });

    await harness.send([...opening, ...toolRound("c1", runTests)], { tools });

    expect(harness.planner.doStreamCalls).toHaveLength(1);
  });

  it("treats a stored value of the wrong shape as missing", async () => {
    const harness = createPlannerExecutorHarness({
      planner: [textResponse("plan")],
      executor: [textResponse("Done.")],
    });
    const conversation = [...opening, ...toolRound("c1", ls)];
    await harness.storeSession(conversation, { phase: "executing" });

    await harness.send(conversation, { tools });

    expect(harness.planner.doStreamCalls).toHaveLength(1);
  });

  it("forces the planner to write its plan once its tool-round budget is spent", async () => {
    const harness = createPlannerExecutorHarness({
      planner: [textResponse("plan")],
      executor: [textResponse("Done.")],
      options: { maxPlannerRounds: 2 },
    });
    const conversation = [
      ...opening,
      ...toolRound("c1", ls),
      ...toolRound("c2", runTests),
    ];
    await harness.storeSession(conversation, { phase: "planning", rounds: 2 });

    await harness.send(conversation, { tools });

    expect(summarizeCall(harness.planner)).toMatchObject({
      system: PLANNER_PROMPT + FINAL_PLANNER_ROUND_NOTE,
      toolChoice: "none",
    });
  });
});

describe("merging results back into state and the response", () => {
  it("planner tool call: returned to the client, and the turn records one planning round", async () => {
    const harness = createPlannerExecutorHarness({
      planner: [toolCallResponse("c1", "bash", { cmd: "ls" })],
    });

    const events = await harness.send(opening, { tools });

    expect(withoutUsage(events)).toEqual([
      {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "bash",
        input: '{"cmd":"ls"}',
      },
    ]);
    expect(harness.executor.doStreamCalls).toHaveLength(0);
    expect(await harness.sessionFor(opening)).toEqual({
      phase: "planning",
      rounds: 1,
    });
  });

  it("another planner tool call: the round count goes up", async () => {
    const harness = createPlannerExecutorHarness({
      planner: [toolCallResponse("c2", "bash", { cmd: "pnpm test" })],
    });
    const conversation = [...opening, ...toolRound("c1", ls)];
    await harness.storeSession(conversation, { phase: "planning", rounds: 1 });

    await harness.send(conversation, { tools });

    expect(await harness.sessionFor(conversation)).toEqual({
      phase: "planning",
      rounds: 2,
    });
  });

  it("planner finishes: its text is stored as the plan, positioned at the end of the planning phase", async () => {
    const harness = createPlannerExecutorHarness({
      planner: [textResponse("  1. edit a.ts\n")],
      executor: [textResponse("Done.")],
    });
    const conversation = [...opening, ...toolRound("c1", ls)];

    await harness.send(conversation, { tools });

    expect(await harness.sessionFor(conversation)).toEqual({
      phase: "executing",
      plan: "1. edit a.ts",
      planIndex: 3, // user + the planner's tool call + its result
    });
  });

  it("planner finishes: one response carries the plan as reasoning, then the executor's answer", async () => {
    const harness = createPlannerExecutorHarness({
      planner: [textResponse("1. edit a.ts")],
      executor: [textResponse("Done.")],
    });

    const events = await harness.send(opening);

    expect(withoutUsage(events)).toEqual([
      { type: "reasoning-delta", text: "1. edit a.ts" },
      { type: "text-delta", text: "Done." },
      { type: "finish", reason: "stop" },
    ]);
  });

  it("reports token usage once per upstream call, for the server to add up", async () => {
    const harness = createPlannerExecutorHarness({
      planner: [textResponse("plan")],
      executor: [textResponse("Done.")],
    });

    const events = await harness.send(opening);

    expect(events.filter((event) => event.type === "usage")).toHaveLength(2);
  });

  it("executor tool call: returned to the client, and the session is left unchanged", async () => {
    const harness = createPlannerExecutorHarness({
      executor: [toolCallResponse("c9", "bash", { cmd: "pnpm test" })],
    });
    const conversation = [...opening, ...toolRound("c1", ls)];
    const session = { phase: "executing", plan: "plan", planIndex: 1 };
    await harness.storeSession(conversation, session);

    const events = await harness.send(conversation, { tools });

    expect(withoutUsage(events)).toEqual([
      {
        type: "tool-call",
        toolCallId: "c9",
        toolName: "bash",
        input: '{"cmd":"pnpm test"}',
      },
      { type: "finish", reason: "tool-calls" },
    ]);
    expect(await harness.sessionFor(conversation)).toEqual(session);
  });

  it("executor calls planning_finished anyway: the call is hidden from the client", async () => {
    const harness = createPlannerExecutorHarness({
      planner: [textResponse("plan")],
      executor: [toolCallResponse("c9", PLAN_TOOL_NAME, {})],
    });

    const events = await harness.send(opening);

    expect(withoutUsage(events)).toEqual([
      { type: "reasoning-delta", text: "plan" },
      { type: "finish", reason: "stop" },
    ]);
  });
});
