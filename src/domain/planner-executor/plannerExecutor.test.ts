import { jsonSchema, type ModelMessage, type ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import {
  collectEvents,
  createMapStateStore,
  createMockModel,
  createTestContext,
  createTestRequest,
  textResponse,
  toolCallResponse,
} from "../testing/mockModels.ts";
import { plannerExecutor } from "./plannerExecutor.ts";
import { PLAN_TOOL_NAME } from "./prompts.ts";

const bashTool: ToolSet = {
  bash: {
    description: "Run a command",
    inputSchema: jsonSchema({ type: "object" }),
  },
};

const userTurn: Array<ModelMessage> = [
  { role: "user", content: "Fix the failing test" },
];

function toolRound(id: string, output: string): Array<ModelMessage> {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: id,
          toolName: "bash",
          input: { cmd: "ls" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: id,
          toolName: "bash",
          output: { type: "text", value: output },
        },
      ],
    },
  ];
}

function setup(
  plannerResponses: Parameters<typeof createMockModel>[0],
  executorResponses = plannerResponses,
) {
  const planner = createMockModel(plannerResponses);
  const executor = createMockModel(executorResponses);
  const state = createMapStateStore();
  const context = createTestContext(
    { "p:big": planner, "p:small": executor },
    state,
  );
  const model = plannerExecutor({
    planner: "p:big",
    executor: "p:small",
    maxPlannerRounds: 2,
  });
  return { planner, executor, state, context, model };
}

function promptRoles(model: ReturnType<typeof createMockModel>, call = 0) {
  return model.doStreamCalls[call]?.prompt.map((message) => message.role);
}

describe("plannerExecutor", () => {
  it("streams the plan as reasoning, then the executor answer as text", async () => {
    const { model, context, executor } = setup(
      [textResponse("1. do it")],
      [textResponse("Done.")],
    );

    const events = await collectEvents(
      model.run(createTestRequest(userTurn), context),
    );

    expect(events.filter((event) => event.type !== "usage")).toEqual([
      { type: "reasoning-delta", text: "1. do it" },
      { type: "text-delta", text: "Done." },
      { type: "finish", reason: "stop" },
    ]);
    // AI SDK merges the client and executor instructions into one system message.
    expect(promptRoles(executor)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
    ]);
    expect(JSON.stringify(executor.doStreamCalls[0]?.prompt)).toContain(
      "1. do it",
    );
  });

  it("returns planner tool calls to the client and resumes planning on the tool result", async () => {
    const { model, context, planner, executor } = setup(
      [
        toolCallResponse("call_1", "bash", { cmd: "ls" }),
        textResponse("the plan"),
      ],
      [textResponse("Done.")],
    );

    const first = await collectEvents(
      model.run(createTestRequest(userTurn, { tools: bashTool }), context),
    );
    expect(first).toContainEqual({
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "bash",
      input: '{"cmd":"ls"}',
    });
    expect(executor.doStreamCalls).toHaveLength(0);

    const followUp = [...userTurn, ...toolRound("call_1", "a.ts b.ts")];
    const second = await collectEvents(
      model.run(createTestRequest(followUp, { tools: bashTool }), context),
    );
    expect(planner.doStreamCalls).toHaveLength(2);
    expect(second).toContainEqual({ type: "text-delta", text: "Done." });
    // The plan lands after the planner's own investigation.
    expect(promptRoles(executor)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
    ]);
  });

  it("skips the planner on tool-result turns once executing", async () => {
    const { model, context, planner, executor } = setup(
      [textResponse("the plan")],
      [
        toolCallResponse("call_9", "bash", { cmd: "test" }),
        textResponse("All green."),
      ],
    );
    await collectEvents(
      model.run(createTestRequest(userTurn, { tools: bashTool }), context),
    );

    const followUp = [...userTurn, ...toolRound("call_9", "ok")];
    const events = await collectEvents(
      model.run(createTestRequest(followUp, { tools: bashTool }), context),
    );

    expect(planner.doStreamCalls).toHaveLength(1);
    expect(events).toContainEqual({ type: "text-delta", text: "All green." });
    // user, plan pair, then the executor's own tool round
    expect(promptRoles(executor, 1)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
    ]);
    expect(executor.doStreamCalls[1]?.prompt[2]).toMatchObject({
      content: [{ toolName: PLAN_TOOL_NAME }],
    });
  });

  it("forbids planner tool calls once the round budget is spent", async () => {
    const { model, context, planner, state } = setup(
      [textResponse("forced plan")],
      [textResponse("Done.")],
    );
    const followUp = [
      ...userTurn,
      ...toolRound("call_1", "x"),
      ...toolRound("call_2", "y"),
    ];
    const request = createTestRequest(followUp, { tools: bashTool });
    const { computeTurnKey } = await import("./conversation.ts");
    state.set(await computeTurnKey(followUp), { phase: "planning", rounds: 2 });

    await collectEvents(model.run(request, context));

    expect(planner.doStreamCalls[0]?.toolChoice).toEqual({ type: "none" });
  });

  it("hides executor calls to the plan marker tool", async () => {
    const { model, context } = setup(
      [textResponse("plan")],
      [toolCallResponse("call_x", PLAN_TOOL_NAME, {})],
    );

    const events = await collectEvents(
      model.run(createTestRequest(userTurn), context),
    );

    expect(events.some((event) => event.type === "tool-call")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "finish", reason: "stop" });
  });
});
