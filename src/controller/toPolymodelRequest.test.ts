import { describe, expect, it } from "vitest";
import { InvalidPolymodelRequestError } from "#domain";
import { OpenAIChatRequestSchema } from "#types";
import { toPolymodelRequest } from "./toPolymodelRequest.ts";

function parse(body: object) {
  return OpenAIChatRequestSchema.parse({ model: "m", ...body });
}

describe("toPolymodelRequest", () => {
  it("lifts system messages and groups parallel tool results", () => {
    const request = toPolymodelRequest(
      parse({
        messages: [
          { role: "developer", content: "rules" },
          { role: "user", content: "go" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "a",
                type: "function",
                function: { name: "read", arguments: '{"p":1}' },
              },
              {
                id: "b",
                type: "function",
                function: { name: "ls", arguments: "" },
              },
            ],
          },
          { role: "tool", tool_call_id: "a", content: "one" },
          {
            role: "tool",
            tool_call_id: "b",
            content: [{ type: "text", text: "two" }],
          },
        ],
        max_tokens: 100,
        stop: "END",
        reasoning_effort: "low",
      }),
    );

    expect(request.instructions).toEqual([
      { role: "system", content: "rules" },
    ]);
    expect(request.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);
    expect(request.messages[1]).toMatchObject({
      content: [
        { type: "tool-call", toolName: "read", input: { p: 1 } },
        { type: "tool-call", toolName: "ls", input: {} },
      ],
    });
    expect(request.messages[2]).toMatchObject({
      content: [
        {
          toolCallId: "a",
          toolName: "read",
          output: { type: "text", value: "one" },
        },
        {
          toolCallId: "b",
          toolName: "ls",
          output: { type: "text", value: "two" },
        },
      ],
    });
    expect(request.settings).toEqual({
      maxOutputTokens: 100,
      stopSequences: ["END"],
      reasoning: "low",
    });
  });

  it("rejects tool results without a matching call", () => {
    const body = parse({
      messages: [
        { role: "user", content: "go" },
        { role: "tool", tool_call_id: "missing", content: "x" },
      ],
    });
    expect(() => toPolymodelRequest(body)).toThrow(
      InvalidPolymodelRequestError,
    );
  });

  it("maps a named tool_choice to an AI SDK tool choice", () => {
    const request = toPolymodelRequest(
      parse({
        messages: [{ role: "user", content: "go" }],
        tool_choice: { type: "function", function: { name: "read" } },
      }),
    );
    expect(request.toolChoice).toEqual({ type: "tool", toolName: "read" });
  });
});
