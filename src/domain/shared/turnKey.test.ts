import { describe, expect, it } from "vitest";
import { assistant, toolRound, user } from "../testing/conversationBuilders.ts";
import { computeTurnKey, isNewUserTurn } from "./turnKey.ts";

// A "turn" is everything that follows one user message. Clients send the whole
// conversation on every request, so one turn can span many requests: each time
// a tool call is answered, the client re-sends the conversation with the result
// appended. These helpers decide which turn a request belongs to.

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
