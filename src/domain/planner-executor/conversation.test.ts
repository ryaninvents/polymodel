import { describe, expect, it } from "vitest";
import { assistant, toolRound, user } from "../testing/conversationBuilders.ts";
import {
  computeTurnKey,
  injectPlan,
  isNewUserTurn,
  planToolCallId,
} from "./conversation.ts";
import { PLAN_TOOL_NAME } from "./prompts.ts";

// A "turn" is everything that follows one user message. Clients send the whole
// conversation on every request, so one turn can span many requests: each time
// a tool call is answered, the client re-sends the conversation with the result
// appended. These helpers decide which turn a request belongs to and where the
// plan is spliced in for the executor.

const ls = { tool: "bash", input: { cmd: "ls" }, output: "a.ts" };
const test = { tool: "bash", input: { cmd: "pnpm test" }, output: "1 failed" };

describe("isNewUserTurn", () => {
  it("is true only when the newest message is from the user", () => {
    expect(isNewUserTurn([user("hi")])).toBe(true);
    expect(
      isNewUserTurn([user("hi"), assistant("hello"), user("fix it")]),
    ).toBe(true);
    expect(isNewUserTurn([user("hi"), ...toolRound("c1", ls)])).toBe(false);
    expect(isNewUserTurn([user("hi"), assistant("hello")])).toBe(false);
  });
});

describe("computeTurnKey", () => {
  it("stays the same for every follow-up request within a turn", async () => {
    const opening = [user("fix it")];
    const afterOneTool = [...opening, ...toolRound("c1", ls)];
    const afterTwoTools = [...afterOneTool, ...toolRound("c2", test)];

    const key = await computeTurnKey(opening);
    expect(await computeTurnKey(afterOneTool)).toBe(key);
    expect(await computeTurnKey(afterTwoTools)).toBe(key);
  });

  it("changes when the user sends a new message", async () => {
    const firstTurn = [
      user("fix it"),
      ...toolRound("c1", ls),
      assistant("Fixed."),
    ];
    const secondTurn = [...firstTurn, user("now add a test")];

    expect(await computeTurnKey(secondTurn)).not.toBe(
      await computeTurnKey(firstTurn),
    );
  });

  it("depends on the whole history, so identical messages in different chats don't collide", async () => {
    const chatA = [user("hello"), assistant("hi"), user("continue")];
    const chatB = [user("howdy"), assistant("hi"), user("continue")];

    expect(await computeTurnKey(chatA)).not.toBe(await computeTurnKey(chatB));
  });
});

describe("planToolCallId", () => {
  it("is deterministic per turn so repeated requests share a cacheable prompt prefix", async () => {
    const key = await computeTurnKey([user("fix it")]);

    expect(planToolCallId(key)).toBe(planToolCallId(key));
    expect(planToolCallId(key)).toMatch(/^call_polymodel_plan_[0-9a-f]{24}$/);
  });
});

describe("injectPlan", () => {
  const plan = { text: "1. edit a.ts", toolCallId: "call_plan" };
  const planCall = {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "call_plan",
        toolName: PLAN_TOOL_NAME,
        input: {},
      },
    ],
  };
  const planResult = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call_plan",
        toolName: PLAN_TOOL_NAME,
        output: { type: "text", value: "1. edit a.ts" },
      },
    ],
  };

  it("splices a planning_finished call/result pair in at the given index", () => {
    const messages = [user("fix it"), ...toolRound("c1", ls)];

    // index 3: after the planner's own investigation (user + one tool round)
    expect(injectPlan(messages, { ...plan, index: 3 })).toEqual([
      ...messages,
      planCall,
      planResult,
    ]);
  });

  it("keeps the executor's later messages after the plan", () => {
    const planningPhase = [user("fix it")];
    const executorWork = toolRound("c9", test);

    expect(
      injectPlan([...planningPhase, ...executorWork], { ...plan, index: 1 }),
    ).toEqual([...planningPhase, planCall, planResult, ...executorWork]);
  });

  it("appends the plan when the conversation got shorter than the stored index", () => {
    const messages = [user("fix it")];

    expect(injectPlan(messages, { ...plan, index: 5 })).toEqual([
      ...messages,
      planCall,
      planResult,
    ]);
  });

  it("does not modify the client's message array", () => {
    const messages = [user("fix it")];
    injectPlan(messages, { ...plan, index: 1 });

    expect(messages).toEqual([user("fix it")]);
  });
});
