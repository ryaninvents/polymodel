import { describe, expect, it } from "vitest";
import { assistant, toolRound, user } from "../testing/conversationBuilders.ts";
import { summarizeCall } from "../testing/inspectCalls.ts";
import { textResponse, toolCallResponse } from "../testing/mockModels.ts";
import {
  createWorkerBeeHarness,
  firstToolCallId,
  PLANNER_PROMPT,
  WORKER_PROMPT,
} from "../testing/workerBeeHarness.ts";
import { renderBrief } from "./briefs.ts";
import { clientTools, createTestBrief, doneReport } from "./fixtures.ts";

// What each upstream model is shown for a single request. The planner sees the
// client's conversation with finished worker stretches collapsed into
// `worker_bee` calls; a worker sees only its brief and its own tool rounds.

const clientInstructions = [
  { role: "system" as const, content: "You are a coding agent." },
];
const brief = createTestBrief();
const ls = { tool: "bash", input: { cmd: "ls" }, output: "a.ts b.ts" };

function delegatingHarness(options = {}) {
  return createWorkerBeeHarness({
    planner: [toolCallResponse("w1", "worker_bee", brief)],
    worker: [toolCallResponse("c1", "bash", { cmd: "ls" })],
    options,
  });
}

describe("routing to the planner", () => {
  it("receives the client's instructions followed by the planner prompt", async () => {
    const harness = createWorkerBeeHarness({ planner: [textResponse("Hi")] });
    await harness.send([user("hello")], { instructions: clientInstructions });

    expect(summarizeCall(harness.planner).system).toBe(
      `You are a coding agent.\n\n${PLANNER_PROMPT}`,
    );
  });

  it("may call the client's tools and delegate with worker_bee", async () => {
    const harness = delegatingHarness();
    await harness.send([user("fix it")], { tools: clientTools });

    expect(summarizeCall(harness.planner)).toMatchObject({
      tools: ["bash", "edit", "worker_bee"],
      toolChoice: "auto",
    });
  });

  it("is offered no tools when the client defines none", async () => {
    const harness = createWorkerBeeHarness({ planner: [textResponse("Hi")] });
    await harness.send([user("hello")]);

    expect(summarizeCall(harness.planner).tools).toEqual([]);
  });

  it("may not call tools when the client forbids tool use", async () => {
    const harness = createWorkerBeeHarness({ planner: [textResponse("Hi")] });
    await harness.send([user("hello")], {
      tools: clientTools,
      toolChoice: "none",
    });

    expect(summarizeCall(harness.planner).toolChoice).toBe("none");
  });

  it("uses plannerSettings, not the client's sampling settings", async () => {
    const harness = createWorkerBeeHarness({
      planner: [textResponse("Hi")],
      options: { plannerSettings: { temperature: 0.3 } },
    });
    await harness.send([user("hello")], {
      settings: { temperature: 0.9, maxOutputTokens: 50 },
    });

    expect(summarizeCall(harness.planner).settings).toEqual({
      temperature: 0.3,
    });
  });

  it("sees a finished worker stretch as the worker_bee call it made", async () => {
    const harness = createWorkerBeeHarness({
      planner: [
        toolCallResponse("w1", "worker_bee", brief),
        textResponse("It's in shared/turnKey.ts."),
      ],
      worker: [
        toolCallResponse("c1", "bash", { cmd: "ls" }),
        toolCallResponse("r1", "report_back", doneReport),
      ],
    });
    const first = await harness.send([user("where are turn keys made?")], {
      tools: clientTools,
    });
    const history = [
      user("where are turn keys made?"),
      ...toolRound(firstToolCallId(first), ls),
    ];
    await harness.send(history, { tools: clientTools });

    expect(summarizeCall(harness.planner, 1).conversation).toEqual([
      "user: where are turn keys made?",
      `assistant → worker_bee ${JSON.stringify(brief)}`,
      "tool ← worker_bee: status: done\nsummary: computeTurnKey in shared/turnKey.ts\nfiles_changed: none",
    ]);
  });

  it("uses followUpPlanner once the conversation has an earlier reply", async () => {
    // The worker mock stands in for the follow-up planner: it is a distinct model.
    const harness = createWorkerBeeHarness({
      planner: [textResponse("First")],
      worker: [textResponse("Second")],
      options: { followUpPlanner: "mock:worker" },
    });

    await harness.send([user("one")]);
    await harness.send([user("one"), assistant("First"), user("two")]);

    expect(harness.planner.doStreamCalls).toHaveLength(1);
    expect(harness.worker.doStreamCalls).toHaveLength(1);
  });
});

describe("routing to a worker", () => {
  it("receives the client's instructions followed by the worker prompt", async () => {
    const harness = delegatingHarness();
    await harness.send([user("fix it")], {
      tools: clientTools,
      instructions: clientInstructions,
    });

    expect(summarizeCall(harness.worker).system).toBe(
      `You are a coding agent.\n\n${WORKER_PROMPT}`,
    );
  });

  it("is shown the brief instead of the user's conversation", async () => {
    const harness = delegatingHarness();
    await harness.send([user("a long private request")], {
      tools: clientTools,
    });

    expect(summarizeCall(harness.worker).conversation).toEqual([
      `user: ${renderBrief(brief)}`,
    ]);
  });

  it("is offered the client's tools plus report_back", async () => {
    const harness = delegatingHarness();
    await harness.send([user("fix it")], { tools: clientTools });

    expect(summarizeCall(harness.worker)).toMatchObject({
      tools: ["bash", "edit", "report_back"],
      toolChoice: "auto",
    });
  });

  it("sees only its own tool rounds on later requests", async () => {
    const harness = createWorkerBeeHarness({
      planner: [toolCallResponse("w1", "worker_bee", brief)],
      worker: [
        toolCallResponse("c1", "bash", { cmd: "ls" }),
        toolCallResponse("c2", "bash", { cmd: "pwd" }),
      ],
    });
    const first = await harness.send([user("fix it")], { tools: clientTools });
    await harness.send(
      [user("fix it"), ...toolRound(firstToolCallId(first), ls)],
      { tools: clientTools },
    );

    expect(summarizeCall(harness.worker, 1).conversation).toEqual([
      `user: ${renderBrief(brief)}`,
      'assistant → bash {"cmd":"ls"}',
      "tool ← bash: a.ts b.ts",
    ]);
  });

  it("reasons at low effort with output capped, whatever the client asked for", async () => {
    const harness = delegatingHarness();
    await harness.send([user("fix it")], {
      tools: clientTools,
      settings: { reasoning: "high", maxOutputTokens: 32_000 },
    });

    expect(summarizeCall(harness.worker).settings).toEqual({
      reasoning: "low",
      maxOutputTokens: 4_096,
    });
  });

  it("applies workerSettings and workerLimits over those defaults", async () => {
    const harness = delegatingHarness({
      workerSettings: { reasoning: "none" },
      workerLimits: { maxOutputTokens: 1_000 },
    });
    await harness.send([user("fix it")], {
      tools: clientTools,
      settings: { maxOutputTokens: 32_000 },
    });

    expect(summarizeCall(harness.worker).settings).toEqual({
      reasoning: "none",
      maxOutputTokens: 1_000,
    });
  });

  it("hands the client its tool calls under task-prefixed ids and hides report_back", async () => {
    const harness = delegatingHarness();
    const response = await harness.send([user("fix it")], {
      tools: clientTools,
    });

    expect(firstToolCallId(response)).toMatch(/^pmwb_[0-9a-f]{8}_c1$/);
    expect(response.filter((event) => event.type === "tool-call")).toHaveLength(
      1,
    );
  });
});
