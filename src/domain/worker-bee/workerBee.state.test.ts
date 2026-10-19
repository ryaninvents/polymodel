import { describe, expect, it } from "vitest";
import { toolRound, user } from "../testing/conversationBuilders.ts";
import { summarizeCall } from "../testing/inspectCalls.ts";
import {
  createEndlessReasoningModel,
  textResponse,
  toolCallResponse,
  toolCallsResponse,
} from "../testing/mockModels.ts";
import {
  createWorkerBeeHarness,
  firstToolCallId,
  withoutUsage,
} from "../testing/workerBeeHarness.ts";
import { clientTools, createTestBrief, doneReport } from "./fixtures.ts";
import { prefixToolCallId } from "./ownership.ts";

// How session state decides the route, and how a delegation ends: a report,
// a rejected brief, or one of the budgets. Every ending reaches the planner
// as a `worker_bee` result it can act on.

const brief = createTestBrief();
const tools = clientTools;
function report(input: object = doneReport) {
  return toolCallResponse("r1", "report_back", input);
}

function lastResult(conversation: Array<string>) {
  return conversation.findLast((line) => line.startsWith("tool ← worker_bee"));
}

describe("delegation endings", () => {
  it("takes a worker's closing text as a done report when it skips report_back", async () => {
    const harness = createWorkerBeeHarness({
      planner: [
        toolCallResponse("p1", "worker_bee", brief),
        textResponse("Thanks."),
      ],
      worker: [textResponse("It lives in turnKey.ts")],
    });
    await harness.send([user("where?")], { tools });

    expect(lastResult(summarizeCall(harness.planner, 1).conversation)).toBe(
      "tool ← worker_bee: status: done\nsummary: It lives in turnKey.ts\nfiles_changed: none",
    );
  });

  it("reports blocked and failed workers as the worker described them", async () => {
    const harness = createWorkerBeeHarness({
      planner: [
        toolCallResponse("p1", "worker_bee", brief),
        textResponse("Thanks."),
      ],
      worker: [
        report({
          status: "blocked",
          summary: "a.ts does not exist",
          files_changed: [],
          notes: "Checked src/ and test/",
        }),
      ],
    });
    await harness.send([user("where?")], { tools });

    expect(lastResult(summarizeCall(harness.planner, 1).conversation)).toBe(
      "tool ← worker_bee: status: blocked\nsummary: a.ts does not exist\nfiles_changed: none\nnotes: Checked src/ and test/",
    );
  });

  it("fails a delegation whose report_back arguments are invalid", async () => {
    const harness = createWorkerBeeHarness({
      planner: [
        toolCallResponse("p1", "worker_bee", brief),
        textResponse("Thanks."),
      ],
      worker: [report({ status: "done" })],
    });
    await harness.send([user("where?")], { tools });

    expect(lastResult(summarizeCall(harness.planner, 1).conversation)).toMatch(
      /^tool ← worker_bee: status: failed\nsummary: Worker called report_back with invalid arguments/,
    );
  });

  it("never sends an invalid brief to a worker; the planner gets the bad fields", async () => {
    const harness = createWorkerBeeHarness({
      planner: [
        toolCallResponse("p1", "worker_bee", { goal: "do it" }),
        textResponse("Sorry."),
      ],
      worker: [],
    });
    await harness.send([user("fix it")], { tools });

    expect(harness.worker.doStreamCalls).toHaveLength(0);
    const result = lastResult(summarizeCall(harness.planner, 1).conversation);
    expect(result).toContain("status: failed");
    expect(result).toContain("Invalid brief, nothing was delegated");
    expect(result).toContain("done_when");
  });

  it("cuts a worker off after its tool rounds and says what it had done", async () => {
    const harness = createWorkerBeeHarness({
      planner: [
        toolCallResponse("p1", "worker_bee", brief),
        textResponse("I'll take it from here."),
      ],
      worker: [toolCallResponse("w1", "edit", { path: "a.ts" })],
      options: { workerLimits: { maxRounds: 1 } },
    });
    const request1 = [user("fix it")];
    const response1 = await harness.send(request1, { tools });
    await harness.send(
      [
        ...request1,
        ...toolRound(firstToolCallId(response1), {
          tool: "edit",
          input: { path: "a.ts" },
          output: "ok",
        }),
      ],
      { tools },
    );

    expect(harness.worker.doStreamCalls).toHaveLength(1);
    expect(lastResult(summarizeCall(harness.planner, 1).conversation)).toBe(
      'tool ← worker_bee: status: exhausted\nsummary: Worker used 1/1 tool rounds without reporting back.\nfiles_changed: a.ts\nnotes: Last tool call: edit({"path":"a.ts"}) → ok',
    );
  });

  it("lets a brief ask for more rounds than the default", async () => {
    const harness = createWorkerBeeHarness({
      planner: [
        toolCallResponse("p1", "worker_bee", { ...brief, max_rounds: 3 }),
      ],
      worker: [
        toolCallResponse("w1", "bash", { cmd: "ls" }),
        toolCallResponse("w2", "bash", { cmd: "ls" }),
      ],
      options: { workerLimits: { maxRounds: 1 } },
    });
    const request1 = [user("fix it")];
    const response1 = await harness.send(request1, { tools });
    await harness.send(
      [
        ...request1,
        ...toolRound(firstToolCallId(response1), {
          tool: "bash",
          input: { cmd: "ls" },
          output: "a.ts",
        }),
      ],
      { tools },
    );

    expect(harness.worker.doStreamCalls).toHaveLength(2);
  });

  it("aborts a worker that reasons without acting and reports the stall", async () => {
    const harness = createWorkerBeeHarness({
      planner: [
        toolCallResponse("p1", "worker_bee", brief),
        textResponse("I'll do it myself."),
      ],
      worker: createEndlessReasoningModel(),
      options: { workerLimits: { stallMs: 40 } },
    });
    const response = await harness.send([user("fix it")], { tools });

    expect(lastResult(summarizeCall(harness.planner, 1).conversation)).toMatch(
      /^tool ← worker_bee: status: failed\nsummary: Worker stalled: no text or tool call for 0\.04s/,
    );
    expect(withoutUsage(response).at(-1)).toEqual({
      type: "finish",
      reason: "stop",
    });
  });
});

describe("queued delegations", () => {
  it("runs several delegations from one planner step in turn, then returns to the planner", async () => {
    const harness = createWorkerBeeHarness({
      planner: [
        toolCallsResponse([
          { toolCallId: "p1", toolName: "worker_bee", input: brief },
          {
            toolCallId: "p2",
            toolName: "worker_bee",
            input: { ...brief, goal: "Find the callers" },
          },
        ]),
        textResponse("Both found."),
      ],
      worker: [report(), report({ ...doneReport, summary: "two callers" })],
    });
    await harness.send([user("investigate")], { tools });

    const [, secondCall] = harness.planner.doStreamCalls;
    // One assistant message with both calls, then one tool message with both results.
    expect(
      secondCall?.prompt.filter((message) => message.role === "assistant"),
    ).toHaveLength(1);
    expect(
      secondCall?.prompt.filter((message) => message.role === "tool"),
    ).toHaveLength(1);
    expect(
      summarizeCall(harness.planner, 1).conversation.filter((line) =>
        line.startsWith("tool ← worker_bee"),
      ),
    ).toHaveLength(2);
  });

  it("forwards the client calls of a mixed step first and starts the delegation after their results", async () => {
    const harness = createWorkerBeeHarness({
      planner: [
        toolCallsResponse([
          { toolCallId: "p1", toolName: "bash", input: { cmd: "git status" } },
          { toolCallId: "p2", toolName: "worker_bee", input: brief },
        ]),
        textResponse("Done."),
      ],
      worker: [report()],
    });
    const request1 = [user("fix it")];
    const response1 = await harness.send(request1, { tools });

    expect(
      withoutUsage(response1).map((event) =>
        event.type === "tool-call" ? event.toolName : event.type,
      ),
    ).toEqual(["bash"]);
    expect(harness.worker.doStreamCalls).toHaveLength(0);
    expect((await harness.sessionFor(request1))?.queue).toHaveLength(1);

    const request2 = [
      ...request1,
      ...toolRound("p1", {
        tool: "bash",
        input: { cmd: "git status" },
        output: "clean",
      }),
    ];
    await harness.send(request2, { tools });

    expect(harness.planner.doStreamCalls).toHaveLength(2);
    expect(harness.worker.doStreamCalls).toHaveLength(1);
    expect(summarizeCall(harness.planner, 1).conversation).toEqual([
      "user: fix it",
      'assistant → bash {"cmd":"git status"}',
      "tool ← bash: clean",
      `assistant → worker_bee ${JSON.stringify(brief)}`,
      "tool ← worker_bee: status: done\nsummary: computeTurnKey in shared/turnKey.ts\nfiles_changed: none",
    ]);
  });
});

describe("planner budgets", () => {
  it("makes the planner answer once it has used its steps", async () => {
    const harness = createWorkerBeeHarness({
      planner: [
        toolCallResponse("p1", "worker_bee", brief),
        textResponse("Out of steps."),
      ],
      worker: [report()],
      options: { maxPlannerSteps: 1 },
    });
    await harness.send([user("fix it")], { tools });

    expect(summarizeCall(harness.planner, 1)).toMatchObject({
      toolChoice: "none",
      conversation: expect.arrayContaining([
        expect.stringContaining("Write your answer to the user now"),
      ]),
    });
  });

  it("rejects delegations beyond the limit and makes the planner answer", async () => {
    const harness = createWorkerBeeHarness({
      planner: [
        toolCallsResponse([
          { toolCallId: "p1", toolName: "worker_bee", input: brief },
          { toolCallId: "p2", toolName: "worker_bee", input: brief },
        ]),
        textResponse("Partial."),
      ],
      worker: [report()],
      options: { maxDelegations: 1 },
    });
    await harness.send([user("fix it")], { tools });

    expect(harness.worker.doStreamCalls).toHaveLength(1);
    const conversation = summarizeCall(harness.planner, 1).conversation;
    expect(conversation.join("\n")).toContain("Delegation limit reached");
    expect(summarizeCall(harness.planner, 1).toolChoice).toBe("none");
  });
});

describe("after losing state", () => {
  it("lets a worker continue from the history alone, then reports it to the planner", async () => {
    const harness = createWorkerBeeHarness({
      planner: [textResponse("Carry on.")],
      worker: [report()],
    });
    const call = prefixToolCallId("deadbeef", "w1");
    const history = [
      user("fix it"),
      ...toolRound(call, {
        tool: "bash",
        input: { cmd: "ls" },
        output: "a.ts",
      }),
    ];
    await harness.send(history, { tools });

    expect(summarizeCall(harness.worker).conversation[0]).toContain(
      "Continue the task shown in your previous tool calls",
    );
    expect(summarizeCall(harness.planner).conversation).toEqual([
      "user: fix it",
      expect.stringContaining("assistant → worker_bee"),
      expect.stringContaining("tool ← worker_bee: status: done"),
    ]);
  });
});
