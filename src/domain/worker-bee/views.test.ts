import { describe, expect, it } from "vitest";
import { assistant, toolRound, user } from "../testing/conversationBuilders.ts";
import { renderBrief, renderReport } from "./briefs.ts";
import { createTestBrief, createTestDelegation } from "./fixtures.ts";
import { prefixToolCallId } from "./ownership.ts";
import { plannerView, workerView } from "./views.ts";

// The views are pure: what a model is shown is a function of the client's
// messages and the delegations polymodel remembers.

const ls = { tool: "bash", input: { cmd: "ls" }, output: "a.ts" };
function workerCall(taskId: string, id: string) {
  return prefixToolCallId(taskId, id);
}

function collapsedPair(
  ...delegations: Array<ReturnType<typeof createTestDelegation>>
) {
  return [
    {
      role: "assistant",
      content: delegations.map((d) => ({
        type: "tool-call",
        toolCallId: d.plannerToolCallId,
        toolName: "worker_bee",
        input: d.input,
      })),
    },
    {
      role: "tool",
      content: delegations.map((d) => ({
        type: "tool-result",
        toolCallId: d.plannerToolCallId,
        toolName: "worker_bee",
        output: { type: "text", value: renderReport(d.report!) },
      })),
    },
  ];
}

describe("plannerView", () => {
  const delegation = createTestDelegation();
  const stretch = [
    ...toolRound(workerCall("aaaaaaaa", "c1"), ls),
    ...toolRound(workerCall("aaaaaaaa", "c2"), ls),
  ];

  it("replaces a finished worker stretch with one worker_bee call and result", () => {
    const messages = [user("fix it"), ...stretch];

    expect(plannerView(messages, new Map([["aaaaaaaa", delegation]]))).toEqual([
      user("fix it"),
      ...collapsedPair(delegation),
    ]);
  });

  it("keeps the planner's own messages around the collapsed stretch", () => {
    const messages = [
      user("fix it"),
      ...toolRound("planner1", ls),
      ...stretch,
      ...toolRound("planner2", ls),
    ];
    const view = plannerView(
      messages,
      new Map([["aaaaaaaa", createTestDelegation({ anchor: 3 })]]),
    );

    expect(view).toEqual([
      ...messages.slice(0, 3),
      ...collapsedPair(delegation),
      ...messages.slice(7),
    ]);
  });

  it("merges delegations from one planner step into a single call and result message", () => {
    const second = createTestDelegation({
      taskId: "bbbbbbbb",
      plannerToolCallId: "call_planner_2",
    });
    const messages = [
      user("fix it"),
      ...stretch,
      ...toolRound(workerCall("bbbbbbbb", "c1"), ls),
    ];

    expect(
      plannerView(
        messages,
        new Map([
          ["aaaaaaaa", delegation],
          ["bbbbbbbb", second],
        ]),
      ),
    ).toEqual([user("fix it"), ...collapsedPair(delegation, second)]);
  });

  it("places a delegation that left no messages at its anchor", () => {
    const rejected = createTestDelegation({
      status: "failed",
      report: { status: "failed", summary: "bad brief", files_changed: [] },
    });

    expect(
      plannerView([user("fix it")], new Map([["aaaaaaaa", rejected]])),
    ).toEqual([user("fix it"), ...collapsedPair(rejected)]);
  });

  it("passes running and unknown stretches through unchanged", () => {
    const messages = [user("fix it"), ...stretch];

    expect(
      plannerView(
        messages,
        new Map([["aaaaaaaa", createTestDelegation({ status: "running" })]]),
      ),
    ).toEqual(messages);
    expect(plannerView(messages, new Map())).toEqual(messages);
  });

  it("is byte-identical however much the turn has grown, so the prefix stays cacheable", () => {
    const before = plannerView(
      [user("fix it"), ...stretch],
      new Map([["aaaaaaaa", delegation]]),
    );
    const after = plannerView(
      [user("fix it"), ...stretch, ...toolRound("planner1", ls)],
      new Map([["aaaaaaaa", delegation]]),
    );

    expect(after.slice(0, before.length)).toEqual(before);
  });
});

describe("workerView", () => {
  const brief = createTestBrief();

  it("is the brief followed by the task's own tool rounds", () => {
    const own = toolRound(workerCall("aaaaaaaa", "c1"), ls);
    const messages = [
      user("fix it"),
      ...toolRound("planner1", ls),
      ...own,
      ...toolRound(workerCall("bbbbbbbb", "c1"), ls),
    ];

    expect(workerView(messages, "aaaaaaaa", brief)).toEqual([
      user(renderBrief(brief)),
      ...own,
    ]);
  });

  it("drops text the planner wrote before the worker's first call", () => {
    const id = workerCall("aaaaaaaa", "c1");
    const mixed = {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "Let me delegate." },
        {
          type: "tool-call" as const,
          toolCallId: id,
          toolName: "bash",
          input: {},
        },
      ],
    };

    expect(workerView([user("x"), mixed], "aaaaaaaa", brief)[1]).toEqual({
      role: "assistant",
      content: [mixed.content[1]],
    });
  });

  it("falls back to a generic brief when the real one was lost", () => {
    const [first] = workerView(
      [user("x"), assistant("y")],
      "aaaaaaaa",
      undefined,
    );

    expect(first).toMatchObject({
      role: "user",
      content: expect.stringContaining("Continue the task"),
    });
  });
});
