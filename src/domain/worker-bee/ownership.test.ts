import { describe, expect, it } from "vitest";
import { assistant, toolRound, user } from "../testing/conversationBuilders.ts";
import {
  countRounds,
  createTaskId,
  lastAssistantOwner,
  parseWorkerToolCallId,
  prefixToolCallId,
  stretchOf,
  workerTaskIds,
  workerTaskOf,
} from "./ownership.ts";

// Worker tool calls leave polymodel with their task id in the call id, which
// the client echoes back. These helpers read ownership out of the history.

const ls = { tool: "bash", input: { cmd: "ls" }, output: "a.ts" };
const cat = { tool: "read", input: { path: "a.ts" }, output: "export {}" };

describe("tool call id prefixing", () => {
  it("round-trips the upstream id", () => {
    const id = prefixToolCallId("abcd1234", "toolu_01Abc-def");

    expect(parseWorkerToolCallId(id)).toEqual({
      taskId: "abcd1234",
      upstreamId: "toolu_01Abc-def",
    });
  });

  it("only uses characters Anthropic accepts in tool_use ids", () => {
    expect(prefixToolCallId(createTaskId(), "call_1")).toMatch(
      /^[A-Za-z0-9_-]+$/,
    );
  });

  it("leaves planner ids unrecognized", () => {
    expect(parseWorkerToolCallId("toolu_01Abc")).toBeUndefined();
    expect(parseWorkerToolCallId("pmwb_short_x")).toBeUndefined();
  });
});

describe("ownership of a history", () => {
  function workerA(id: string) {
    return prefixToolCallId("aaaaaaaa", id);
  }
  function workerB(id: string) {
    return prefixToolCallId("bbbbbbbb", id);
  }
  const history = [
    user("fix it"),
    ...toolRound("planner1", ls),
    ...toolRound(workerA("c1"), cat),
    ...toolRound(workerA("c2"), ls),
    ...toolRound(workerB("c1"), cat),
  ];

  it("attributes assistant and tool messages by their call ids", () => {
    expect(history.map(workerTaskOf)).toEqual([
      undefined,
      undefined,
      undefined,
      "aaaaaaaa",
      "aaaaaaaa",
      "aaaaaaaa",
      "aaaaaaaa",
      "bbbbbbbb",
      "bbbbbbbb",
    ]);
  });

  it("treats plain assistant text as the planner's", () => {
    expect(workerTaskOf(assistant("Done."))).toBeUndefined();
  });

  it("collects a task's messages across tool rounds", () => {
    expect(stretchOf(history, "aaaaaaaa")).toHaveLength(4);
    expect(workerTaskIds(history)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
  });

  it("counts rounds as the task's assistant messages", () => {
    expect(countRounds(history, "aaaaaaaa")).toBe(2);
    expect(countRounds(history, "bbbbbbbb")).toBe(1);
    expect(countRounds(history, "cccccccc")).toBe(0);
  });

  it("finds who made the newest assistant message", () => {
    expect(lastAssistantOwner(history)).toBe("bbbbbbbb");
    expect(lastAssistantOwner(history.slice(0, 3))).toBeUndefined();
    expect(lastAssistantOwner([user("hi")])).toBeUndefined();
  });
});
